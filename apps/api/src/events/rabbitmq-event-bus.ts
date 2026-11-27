import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as amqp from 'amqplib';
import { BrokerUnavailableError, BusEvent, EventBus, Handler } from './event-bus';

export interface RabbitOptions { url: string; prefix?: string; publishWaitMs?: number; maxRetries?: number; retryDelayMs?: number; prefetch?: number }
interface Sub { consumer: string; type: string; handler: Handler }

/**
 * Adaptador RabbitMQ:
 *  - exchange topic `<p>.events`, routing key = tipo de evento, mensagens persistentes + confirmações do publicador;
 *  - fila durável por (consumidor, tipo): `<p>.<consumidor>.<tipo>`;
 *  - falha do handler → fila `.retry` (TTL) → volta à fila principal; após `maxRetries` → `<p>.dead` (e ack);
 *  - reconexão automática; enquanto desligado, publish() lança BrokerUnavailableError (o evento fica no outbox).
 */
export class RabbitMqEventBus extends EventBus implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('RabbitMq');
  private p: string; private maxRetries: number; private retryDelay: number; private prefetch: number;
  private conn?: amqp.ChannelModel; private pub?: amqp.ConfirmChannel; private chans: amqp.Channel[] = [];
  private subs: Sub[] = []; private closing = false; private backoff = 500; private connecting?: Promise<void>;
  private readyWaiters: Array<() => void> = []; private starting = new Set<Promise<unknown>>();

  constructor(private o: RabbitOptions) {
    super();
    this.p = o.prefix ?? 'drp'; this.maxRetries = o.maxRetries ?? 5; this.retryDelay = o.retryDelayMs ?? 5000; this.prefetch = o.prefetch ?? 10;
  }
  get exchange() { return `${this.p}.events`; }
  get deadQueue() { return `${this.p}.dead`; }
  queueName(consumer: string, type: string) { return `${this.p}.${consumer}.${type}`; }
  isReady() { return !!this.conn && !!this.pub; }

  async onModuleInit() { await this.connect().catch((e) => this.log.warn(`broker indisponível no arranque: ${e.message} (a tentar de novo)`)); }
  async onModuleDestroy() { this.closing = true; await this.teardown(); }

  subscribe(consumer: string, type: string, handler: Handler) {
    const sub = { consumer, type, handler }; this.subs.push(sub);
    if (this.isReady()) this.track(this.startConsumer(sub));
  }

  /** Regista o arranque de um consumidor: publish() espera por ele, para nunca publicar para uma fila que ainda não existe (seria descartado). */
  private track(p: Promise<unknown>) {
    const t = p.catch((e) => this.log.error(`consumer: ${e.message}`)).finally(() => this.starting.delete(t)); this.starting.add(t);
  }

  async publish(e: BusEvent) {
    await this.waitReady(this.o.publishWaitMs ?? 5000);
    await Promise.all([...this.starting]);
    try {
      this.pub!.publish(this.exchange, e.type, Buffer.from(JSON.stringify(e)), { persistent: true, messageId: e.eventId, type: e.type, contentType: 'application/json', timestamp: Date.parse(e.occurredAt) });
      await this.pub!.waitForConfirms(); // só dá "publicado" quando o broker confirma (senão o evento fica no outbox)
    } catch (err: any) { throw new BrokerUnavailableError(err?.message ?? 'falha ao publicar'); }
  }

  private waitReady(ms: number): Promise<void> {
    if (this.isReady()) return Promise.resolve();
    this.connect().catch(() => undefined);
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new BrokerUnavailableError('RabbitMQ indisponível')), ms);
      this.readyWaiters.push(() => { clearTimeout(t); res(); });
    });
  }

  private connect(): Promise<void> {
    if (this.closing) return Promise.reject(new Error('bus a encerrar'));
    if (this.conn) return Promise.resolve(); // já ligado: nunca abrir uma 2.ª ligação (duplicaria consumidores)
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      try {
        const conn = await amqp.connect(this.o.url);
        if (this.closing) { await conn.close().catch(() => undefined); throw new Error('bus a encerrar'); }
        conn.on('error', (e) => this.log.warn(`erro de ligação: ${e.message}`));
        conn.on('close', () => { this.conn = undefined; this.pub = undefined; this.chans = []; if (!this.closing) this.scheduleReconnect(); });
        const pub = await conn.createConfirmChannel();
        pub.on('error', () => undefined);
        await pub.assertExchange(this.exchange, 'topic', { durable: true });
        await pub.assertExchange(`${this.p}.retry`, 'direct', { durable: true });
        await pub.assertQueue(this.deadQueue, { durable: true });
        this.conn = conn; this.pub = pub; this.backoff = 500;
        for (const s of this.subs) await this.startConsumer(s);
        this.readyWaiters.splice(0).forEach((w) => w());
      } finally { this.connecting = undefined; }
    })();
    return this.connecting;
  }

  private scheduleReconnect() {
    const d = Math.min(this.backoff, 10_000); this.backoff *= 2;
    setTimeout(() => { if (!this.closing) this.connect().catch(() => this.scheduleReconnect()); }, d).unref();
  }

  private async startConsumer(s: Sub) {
    const ch = await this.conn!.createChannel(); this.chans.push(ch); ch.on('error', () => undefined);
    const q = this.queueName(s.consumer, s.type); const retryQ = `${q}.retry`;
    await ch.assertQueue(retryQ, { durable: true, messageTtl: this.retryDelay, deadLetterExchange: '', deadLetterRoutingKey: q });
    await ch.bindQueue(retryQ, `${this.p}.retry`, q);
    await ch.assertQueue(q, { durable: true, deadLetterExchange: `${this.p}.retry`, deadLetterRoutingKey: q });
    await ch.bindQueue(q, this.exchange, s.type);
    await ch.prefetch(this.prefetch);
    await ch.consume(q, async (msg) => {
      if (!msg) return;
      try {
        await s.handler(JSON.parse(msg.content.toString()));
        ch.ack(msg);
      } catch (err: any) {
        const deaths = ((msg.properties.headers?.['x-death'] as any[]) ?? []).filter((d) => d.queue === q).reduce((n, d) => n + Number(d.count ?? 0), 0);
        if (deaths + 1 >= this.maxRetries) {
          this.log.error(`${q}: ${deaths + 1} falhas, a enviar para ${this.deadQueue}: ${err?.message}`);
          ch.sendToQueue(this.deadQueue, msg.content, { persistent: true, headers: { queue: q, error: String(err?.message ?? err), attempts: deaths + 1 } });
          ch.ack(msg);
        } else ch.nack(msg, false, false); // → fila .retry → volta depois do atraso
      }
    });
  }

  private async teardown() {
    for (const c of this.chans) await c.close().catch(() => undefined);
    await this.pub?.close().catch(() => undefined); await this.conn?.close().catch(() => undefined);
    this.conn = undefined; this.pub = undefined; this.chans = [];
  }
}
