import * as amqp from 'amqplib';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { BrokerUnavailableError, BusEvent } from '../src/events/event-bus';
import { RabbitMqEventBus } from '../src/events/rabbitmq-event-bus';
import { OutboxRelay } from '../src/events/outbox-relay.service';
import { DbService } from '../src/common/db.service';
import { eventually, requireInfra } from './infra-env';

process.env.DATABASE_URL ??= 'postgres://postgres@localhost:5544/drp';
const ev = (type: string, n = 1): BusEvent => ({ eventId: randomUUID(), type, occurredAt: new Date().toISOString(), payload: { n } });

describe('RabbitMQ real: EventBus adapter', () => {
  const prefix = `t${Date.now()}`; let bus: RabbitMqEventBus; const url = process.env.RABBITMQ_URL!;
  beforeAll(async () => { requireInfra(['RABBITMQ_URL']); bus = new RabbitMqEventBus({ url, prefix, maxRetries: 3, retryDelayMs: 150, confirmTimeoutMs: 800 }); await bus.onModuleInit(); });
  afterAll(async () => {
    await bus.onModuleDestroy();
    const c = await amqp.connect(url); const ch = await c.createChannel();
    for (const t of ['A', 'B', 'Retry', 'Poison', 'Reco']) for (const k of ['x', 'y']) for (const suf of ['', '.retry']) await ch.deleteQueue(`${prefix}.${k}.${t}${suf}`).catch(() => undefined);
    await ch.deleteQueue(`${prefix}.dead`).catch(() => undefined); await ch.deleteExchange(`${prefix}.events`).catch(() => undefined); await ch.deleteExchange(`${prefix}.retry`).catch(() => undefined);
    await c.close();
  });

  it('entrega a cada consumidor a sua cópia e respeita o routing por tipo', async () => {
    const x: BusEvent[] = [], y: BusEvent[] = [], other: BusEvent[] = [];
    bus.subscribe('x', 'A', async (e) => { x.push(e); }); bus.subscribe('y', 'A', async (e) => { y.push(e); }); bus.subscribe('x', 'B', async (e) => { other.push(e); });
    const e = ev('A', 7); await bus.publish(e);
    await eventually(async () => x.length === 1 && y.length === 1);
    expect(x[0]).toMatchObject({ eventId: e.eventId, type: 'A', payload: { n: 7 } }); expect(other).toHaveLength(0);
  });

  it('falha transitória do handler: reentregue com atraso até ter sucesso', async () => {
    let calls = 0; const done: string[] = [];
    bus.subscribe('x', 'Retry', async (e) => { calls++; if (calls < 3) throw new Error('falha transitória'); done.push(e.eventId); });
    const e = ev('Retry'); await bus.publish(e);
    await eventually(async () => done.length === 1, 8000);
    expect(calls).toBe(3);
  });

  it('mensagem venenosa: após maxRetries vai para a fila dead e sai da fila principal', async () => {
    let calls = 0; bus.subscribe('x', 'Poison', async () => { calls++; throw new Error('sempre falha'); });
    const e = ev('Poison'); await bus.publish(e);
    const c = await amqp.connect(url); const ch = await c.createChannel();
    const dead = await eventually(async () => { const m = await ch.get(`${prefix}.dead`, { noAck: true }); return m || false; }, 8000);
    expect(JSON.parse(dead.content.toString()).eventId).toBe(e.eventId); expect(dead.properties.headers).toMatchObject({ queue: `${prefix}.x.Poison`, attempts: 3 }); expect(calls).toBe(3);
    await new Promise((r) => setTimeout(r, 400)); expect(calls).toBe(3); // não continua a tentar
    expect((await ch.checkQueue(`${prefix}.x.Poison`)).messageCount).toBe(0); await c.close();
  });

  it('o broker cai e volta: reconecta, republica e mantém as subscrições', async () => {
    const got: string[] = []; bus.subscribe('x', 'Reco', async (e) => { got.push(e.eventId); });
    const first = ev('Reco'); await bus.publish(first); await eventually(async () => got.length === 1);
    // O broker fecha todas as ligações (queda real). Local: rabbitmqctl; no CI (serviço Docker): RABBITMQ_KILL_CMD com `docker exec`.
    const kill = process.env.RABBITMQ_KILL_CMD ?? 'rabbitmqctl -n rabbit@localhost close_all_connections "teste de reconexao"';
    try { execSync(kill, { stdio: 'pipe', shell: '/bin/bash' }); } catch (e: any) { throw new Error(`não consegui simular a queda do broker com «${kill}»: ${e.stderr?.toString() ?? e.message}`); }
    await eventually(async () => !bus.isReady(), 3000).catch(() => undefined);
    const second = ev('Reco');
    // Como o relay: se o broker ainda não está disponível, publish falha (BrokerUnavailableError) e tenta-se de novo mais tarde.
    await eventually(async () => { try { await bus.publish(second); return true; } catch (e) { expect(e).toBeInstanceOf(BrokerUnavailableError); return false; } }, 20000, 200);
    await eventually(async () => got.includes(second.eventId), 15000);
    expect(got[0]).toBe(first.eventId); expect(new Set(got)).toEqual(new Set([first.eventId, second.eventId])); // at-least-once: um duplicado seria aceitável
    // regressão: reconectar não pode duplicar consumidores nem ligações (cada evento entregue exactamente 1 vez)
    const third = ev('Reco'); await bus.publish(third); await new Promise((r) => setTimeout(r, 500));
    expect(got.filter((id) => id === third.eventId)).toHaveLength(1);
    const c = await amqp.connect(url); const ch = await c.createChannel(); expect((await ch.checkQueue(`${prefix}.x.Reco`)).consumerCount).toBe(1); await c.close();
  });

  it('broker inacessível: o relay NÃO conta tentativas nem envia para dead-letter; o evento fica no outbox', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL }); const db = new DbService();
    const down = new RabbitMqEventBus({ url: 'amqp://guest:guest@127.0.0.1:1', prefix: `${prefix}d`, publishWaitMs: 300 });
    const relay = new OutboxRelay(db, down);
    const id = randomUUID(); await pool.query(`INSERT INTO outbox_events (event_id, aggregate_type, aggregate_id, event_type, payload) VALUES ($1,'t',$1,'NeverDelivered','{}')`, [id]);
    expect(await relay.relayOnce()).toBe(0);
    const r = (await pool.query(`SELECT attempts, published_at FROM outbox_events WHERE event_id=$1`, [id])).rows[0];
    expect(r).toEqual({ attempts: 0, published_at: null });
    expect((await pool.query(`SELECT count(*)::int n FROM dead_letter_events WHERE event_id=$1`, [id])).rows[0].n).toBe(0);
    await expect(down.publish(ev('X'))).rejects.toBeInstanceOf(BrokerUnavailableError);
    await pool.query(`UPDATE outbox_events SET published_at=now() WHERE event_id=$1`, [id]); await pool.end(); await db.onModuleDestroy(); await down.onModuleDestroy();
  });
});
