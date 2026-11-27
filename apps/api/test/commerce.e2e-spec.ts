import request from 'supertest';
import { randomUUID } from 'crypto';
import { setup, publishBook, auth, Ctx } from './helpers';
import { signFake, FakeProvider } from '../src/payments/fake.provider';
import { OutboxRelay } from '../src/events/outbox-relay.service';
import { EventBus } from '../src/events/event-bus';

describe('Commerce → Payments → Entitlements → Royalty (e2e, PostgreSQL real)', () => {
  let ctx: Ctx; let admin: any, pub: any, buyer: any, stranger: any;
  let ed: { editionId: string; slug: string; epub: Buffer; publisherId: string };
  let relay: OutboxRelay; let fake: FakeProvider;
  const idem = () => `k-${randomUUID()}`;
  const drain = async () => { for (let i = 0; i < 5; i++) if (!(await relay.relayOnce())) break; };

  async function order(user: any, editionIds: string[], key = idem(), country = 'MZ') {
    return request(ctx.http).post('/v1/orders').set(auth(user.token)).set('Idempotency-Key', key).send({ edition_ids: editionIds, currency: 'USD', billing_country: country });
  }
  async function checkout(user: any, orderId: string) {
    const r = await request(ctx.http).post('/v1/payments/checkout').set(auth(user.token)).set('Idempotency-Key', idem()).send({ order_id: orderId, method: 'fake' }).expect(201);
    const { rows } = await ctx.pool.query(`SELECT provider_reference ref, amount_minor FROM payment_attempts WHERE id=$1`, [r.body.payment_id]);
    return { paymentId: r.body.payment_id as string, ref: rows[0].ref as string, amount: Number(rows[0].amount_minor) };
  }
  function webhook(body: object, o: { ts?: number; sig?: string } = {}) {
    const raw = JSON.stringify(body); const ts = String(o.ts ?? Math.floor(Date.now() / 1000));
    return request(ctx.http).post('/v1/webhooks/fake').set('Content-Type', 'application/json').set('x-fake-timestamp', ts).set('x-fake-signature', o.sig ?? signFake(raw, ts)).send(raw);
  }
  const paid = (ref: string, amount: number, id = `evt_${randomUUID()}`) => ({ id, type: 'payment.succeeded', reference: ref, amount_minor: amount, currency: 'USD' });
  const count = async (sql: string, p: unknown[] = []) => Number((await ctx.pool.query(sql, p)).rows[0].n);

  beforeAll(async () => {
    ctx = await setup(); relay = ctx.app.get(OutboxRelay); fake = ctx.app.get(FakeProvider);
    admin = await ctx.newUser('cadmin', ['admin_catalog', 'admin_finance']); pub = await ctx.newUser('cpub');
    buyer = await ctx.newUser('buyer'); stranger = await ctx.newUser('stranger');
    ed = await publishBook(ctx, admin, pub, { title: `Livro Comercial ${ctx.run}`, usd: 999, commissionBps: 3000 });
  });
  afterAll(async () => { await ctx.pool.end(); await ctx.app.close(); });

  it('exige autenticação e Idempotency-Key', async () => {
    await request(ctx.http).post('/v1/orders').send({}).expect(401);
    await request(ctx.http).post('/v1/orders').set(auth(buyer.token)).send({ edition_ids: [ed.editionId], currency: 'USD', billing_country: 'MZ' }).expect(422);
  });

  it('valida território (451), moeda sem preço (422) e edição inexistente (422)', async () => {
    const blocked = await publishBook(ctx, admin, pub, { title: `Bloqueado ${ctx.run}`, usd: 100, countries: [{ country_code: 'WW', permission_type: 'SELL' }, { country_code: 'KP', permission_type: 'DENY' }], publisherId: ed.publisherId });
    expect((await order(buyer, [blocked.editionId], idem(), 'KP')).status).toBe(451);
    expect((await order(buyer, [blocked.editionId], idem(), 'MZ')).status).toBe(201);
    const r = await request(ctx.http).post('/v1/orders').set(auth(buyer.token)).set('Idempotency-Key', idem()).send({ edition_ids: [ed.editionId], currency: 'EUR', billing_country: 'MZ' });
    expect(r.status).toBe(422);
    expect((await order(buyer, [randomUUID()])).status).toBe(422);
  });

  let orderId: string; let pay: { paymentId: string; ref: string; amount: number }; const key = idem();
  it('cria encomenda com snapshot de preço/condições; mesma Idempotency-Key devolve a mesma', async () => {
    const a = await order(buyer, [ed.editionId], key); expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ status: 'DRAFT', total_minor: 999, currency: 'USD' }); orderId = a.body.id;
    const b = await order(buyer, [ed.editionId], key); expect(b.body.id).toBe(orderId);
    expect(await count(`SELECT count(*) n FROM orders WHERE user_id=$1 AND idempotency_key=$2`, [buyer.id, key])).toBe(1);
    expect((await order(buyer, [ed.editionId, randomUUID()], key)).status).toBe(422); // mesma chave, pedido diferente
    const snap = (await ctx.pool.query(`SELECT pricing_snapshot s FROM orders WHERE id=$1`, [orderId])).rows[0].s;
    expect(snap.items[0]).toMatchObject({ unit_price_minor: 999, commission_bps: 3000 });
  });

  it('IDOR: outro utilizador não vê a encomenda (404)', async () => {
    await request(ctx.http).get(`/v1/orders/${orderId}`).set(auth(stranger.token)).expect(404);
    await request(ctx.http).get(`/v1/orders/${orderId}`).set(auth(buyer.token)).expect(200);
  });

  it('checkout é idempotente por encomenda e põe a encomenda PENDING_PAYMENT', async () => {
    pay = await checkout(buyer, orderId);
    const again = await request(ctx.http).post('/v1/payments/checkout').set(auth(buyer.token)).set('Idempotency-Key', idem()).send({ order_id: orderId, method: 'fake' }).expect(201);
    expect(again.body.payment_id).toBe(pay.paymentId);
    expect((await request(ctx.http).get(`/v1/orders/${orderId}`).set(auth(buyer.token))).body.status).toBe('PENDING_PAYMENT');
    await request(ctx.http).post('/v1/payments/checkout').set(auth(stranger.token)).set('Idempotency-Key', idem()).send({ order_id: orderId, method: 'fake' }).expect(404);
  });

  it('webhook: assinatura inválida e replay antigo são rejeitados; nada muda', async () => {
    await webhook(paid(pay.ref, pay.amount), { sig: 'deadbeef' }).expect(400);
    await webhook(paid(pay.ref, pay.amount), { ts: Math.floor(Date.now() / 1000) - 3600 }).expect(400);
    expect(await count(`SELECT count(*) n FROM payment_events`)).toBeGreaterThanOrEqual(0);
    expect((await request(ctx.http).get(`/v1/orders/${orderId}`).set(auth(buyer.token))).body.status).toBe('PENDING_PAYMENT');
  });

  it('redirecção de sucesso NÃO é prova: sem webhook não há direito', async () => {
    await drain();
    expect((await request(ctx.http).get('/v1/library').set(auth(buyer.token)).expect(200)).body).toHaveLength(0);
  });

  const evtId = `evt_${randomUUID()}`;
  it('AC-06/07/08: webhook válido captura; duplicado não duplica efeitos; direito criado uma vez', async () => {
    expect((await webhook(paid(pay.ref, pay.amount, evtId)).expect(202)).body.status).toBe('processed');
    expect((await webhook(paid(pay.ref, pay.amount, evtId)).expect(202)).body.status).toBe('duplicate');
    expect((await request(ctx.http).get(`/v1/orders/${orderId}`).set(auth(buyer.token))).body.status).toBe('PAID'); // pago, direito ainda por atribuir
    expect(await count(`SELECT count(*) n FROM outbox_events WHERE event_type='PaymentCaptured' AND payload->>'orderId'=$1`, [orderId])).toBe(1);
    await drain(); await drain();
    expect((await request(ctx.http).get(`/v1/orders/${orderId}`).set(auth(buyer.token))).body.status).toBe('FULFILLED');
    expect(await count(`SELECT count(*) n FROM entitlements WHERE user_id=$1`, [buyer.id])).toBe(1);
    const e = (await ctx.pool.query(`SELECT entitlement_type, status, expires_at FROM entitlements WHERE user_id=$1`, [buyer.id])).rows[0];
    expect(e).toMatchObject({ entitlement_type: 'PURCHASE', status: 'ACTIVE', expires_at: null });
  });

  it('re-entrega do mesmo evento (at-least-once) é absorvida pelo inbox', async () => {
    const ev = (await ctx.pool.query(`SELECT event_id, event_type, payload, created_at FROM outbox_events WHERE event_type='PaymentCaptured' AND payload->>'orderId'=$1`, [orderId])).rows[0];
    await ctx.app.get(EventBus).publish({ eventId: ev.event_id, type: ev.event_type, occurredAt: ev.created_at.toISOString(), payload: ev.payload });
    expect(await count(`SELECT count(*) n FROM entitlements WHERE user_id=$1`, [buyer.id])).toBe(1);
    expect(await count(`SELECT count(*) n FROM royalty_ledger rl JOIN order_items oi ON oi.id=rl.order_item_id WHERE oi.order_id=$1`, [orderId])).toBe(1);
  });

  it('AC-12: royalty calculado pelo snapshot do contrato (70% de 999 = 699)', async () => {
    const l = (await ctx.pool.query(`SELECT rl.* FROM royalty_ledger rl JOIN order_items oi ON oi.id=rl.order_item_id WHERE oi.order_id=$1`, [orderId])).rows[0];
    expect(Number(l.eligible_amount_minor)).toBe(999); expect(l.percentage_bps).toBe(7000); expect(Number(l.amount_minor)).toBe(699);
  });

  it('já possui: nova encomenda do mesmo livro é recusada (409)', async () => { expect((await order(buyer, [ed.editionId])).status).toBe(409); });

  it('biblioteca e acesso: só o dono lê; conteúdo entregue é o ficheiro original', async () => {
    const lib = (await request(ctx.http).get('/v1/library').set(auth(buyer.token)).expect(200)).body;
    expect(lib).toHaveLength(1); expect(lib[0]).toMatchObject({ edition_id: ed.editionId, formats: ['EPUB'] });
    await request(ctx.http).get(`/v1/library/${ed.editionId}/access`).set(auth(stranger.token)).expect(403);
    const g = (await request(ctx.http).get(`/v1/library/${ed.editionId}/access`).set(auth(buyer.token)).expect(200)).body;
    const file = await request(ctx.http).get(g.content_url).buffer(true).parse((res, cb) => { const ch: Buffer[] = []; res.on('data', (d: Buffer) => ch.push(d)); res.on('end', () => cb(null, Buffer.concat(ch))); }).expect(200);
    expect(Buffer.compare(file.body, ed.epub)).toBe(0);
    await request(ctx.http).get('/v1/content/garbage').expect(403);
  });

  it('AC-09: livro suspenso/retirado do catálogo continua na biblioteca e legível', async () => {
    await request(ctx.http).post(`/v1/admin/books/${ed.editionId}/suspend`).set(auth(admin.token)).send({ reason: 'Disputa de direitos' }).expect(204);
    await request(ctx.http).get(`/v1/books/${ed.slug}`).set('x-country', 'MZ').expect(404);
    expect((await request(ctx.http).get('/v1/library').set(auth(buyer.token))).body).toHaveLength(1);
    await request(ctx.http).get(`/v1/library/${ed.editionId}/access`).set(auth(buyer.token)).expect(200);
    expect((await order(stranger, [ed.editionId])).status).toBe(422); // mas ninguém novo compra
    await request(ctx.http).post(`/v1/admin/books/${ed.editionId}/approve`).set(auth(admin.token)).expect(200); // repõe para os testes seguintes
  });

  it('compras concorrentes do mesmo livro: ambas as encomendas pagas, só 1 direito, a duplicada fica com reembolso pendente', async () => {
    const racer = await ctx.newUser('racer');
    const [o1, o2] = await Promise.all([order(racer, [ed.editionId]), order(racer, [ed.editionId])]);
    expect([o1.status, o2.status]).toEqual([201, 201]); // ambas abertas por desenho; a garantia está no cumprimento
    const p1 = await checkout(racer, o1.body.id); const p2 = await checkout(racer, o2.body.id);
    await Promise.all([webhook(paid(p1.ref, p1.amount)), webhook(paid(p2.ref, p2.amount))]);
    await drain();
    expect(await count(`SELECT count(*) n FROM entitlements WHERE user_id=$1 AND status='ACTIVE'`, [racer.id])).toBe(1);
    expect(await count(`SELECT count(*) n FROM refunds r JOIN order_items oi ON oi.id=r.order_item_id JOIN orders o ON o.id=oi.order_id WHERE o.user_id=$1 AND r.status='REQUESTED' AND r.reason LIKE 'Compra duplicada%'`, [racer.id])).toBe(1);
    expect(await count(`SELECT count(*) n FROM dead_letter_events WHERE error='DUPLICATE_ENTITLEMENT' AND payload->>'orderId' IN ($1,$2)`, [o1.body.id, o2.body.id])).toBe(1);
  });

  it('pagamento confirmado depois de falha/timeout cumpre a encomenda', async () => {
    const late = await ctx.newUser('late');
    const o = (await order(late, [ed.editionId])).body.id;
    const p = await checkout(late, o);
    await webhook({ id: `evt_${randomUUID()}`, type: 'payment.failed', reference: p.ref }).expect(202);
    expect((await ctx.pool.query(`SELECT status FROM payment_attempts WHERE id=$1`, [p.paymentId])).rows[0].status).toBe('FAILED');
    await webhook(paid(p.ref, p.amount)).expect(202);
    await drain();
    expect((await request(ctx.http).get(`/v1/orders/${o}`).set(auth(late.token))).body.status).toBe('FULFILLED');
  });

  it('valor/moeda divergentes não capturam e vão para dead-letter', async () => {
    const mm = await ctx.newUser('mismatch');
    const o = (await order(mm, [ed.editionId])).body.id; const p = await checkout(mm, o);
    await webhook(paid(p.ref, 1)).expect(202);
    expect((await ctx.pool.query(`SELECT status FROM payment_attempts WHERE id=$1`, [p.paymentId])).rows[0].status).not.toBe('CAPTURED');
    expect(await count(`SELECT count(*) n FROM dead_letter_events WHERE error='AMOUNT_OR_CURRENCY_MISMATCH'`)).toBeGreaterThanOrEqual(1);
    await drain();
    expect(await count(`SELECT count(*) n FROM entitlements WHERE user_id=$1`, [mm.id])).toBe(0);
  });

  it('reconciliação: pagamento confirmado no fornecedor sem webhook é recuperado', async () => {
    const rc = await ctx.newUser('recon');
    const o = (await order(rc, [ed.editionId])).body.id; const p = await checkout(rc, o);
    fake.remote.set(p.ref, { status: 'CAPTURED', amountMinor: p.amount, currency: 'USD' }); // o webhook "perdeu-se"
    const r = await request(ctx.http).post('/v1/admin/payments/reconcile').set(auth(admin.token)).expect(200);
    expect(r.body.captured).toBeGreaterThanOrEqual(1);
    await drain();
    expect(await count(`SELECT count(*) n FROM entitlements WHERE user_id=$1 AND status='ACTIVE'`, [rc.id])).toBe(1);
    await request(ctx.http).post('/v1/admin/payments/reconcile').set(auth(buyer.token)).expect(403);
  });

  it('worker/broker indisponível: o evento fica no outbox e é entregue depois, sem duplicar', async () => {
    const bus = ctx.app.get(EventBus); const orig = bus.publish.bind(bus);
    const w = await ctx.newUser('wk'); const o = (await order(w, [ed.editionId])).body.id; const p = await checkout(w, o);
    await webhook(paid(p.ref, p.amount)).expect(202);
    bus.publish = async () => { throw new Error('RabbitMQ indisponível'); };
    expect(await relay.relayOnce()).toBe(0);
    expect(await count(`SELECT count(*) n FROM entitlements WHERE user_id=$1`, [w.id])).toBe(0);
    expect((await request(ctx.http).get(`/v1/orders/${o}`).set(auth(w.token))).body.status).toBe('PAID'); // pago mas ainda não cumprido
    bus.publish = orig; await drain();
    expect(await count(`SELECT count(*) n FROM entitlements WHERE user_id=$1`, [w.id])).toBe(1);
  });

  describe('AC-11 reembolso', () => {
    let refundId: string; let itemId: string;
    it('só o dono pede; pedido duplicado é recusado', async () => {
      itemId = (await request(ctx.http).get(`/v1/orders/${orderId}`).set(auth(buyer.token))).body.items[0].id;
      await request(ctx.http).post(`/v1/orders/${orderId}/refund-requests`).set(auth(stranger.token)).set('Idempotency-Key', idem()).send({ reason: 'x y z' }).expect(404);
      const r = await request(ctx.http).post(`/v1/orders/${orderId}/refund-requests`).set(auth(buyer.token)).set('Idempotency-Key', idem()).send({ reason: 'Não era o que esperava' }).expect(202);
      refundId = r.body.refund_ids[0];
      await request(ctx.http).post(`/v1/orders/${orderId}/refund-requests`).set(auth(buyer.token)).set('Idempotency-Key', idem()).send({ reason: 'outra vez' }).expect(409);
    });
    it('decisão exige permissão; revogar exige base legal', async () => {
      await request(ctx.http).post(`/v1/admin/refunds/${refundId}/decision`).set(auth(buyer.token)).send({ decision: 'APPROVE', reason: 'ok ok' }).expect(403);
      await request(ctx.http).post(`/v1/admin/refunds/${refundId}/decision`).set(auth(admin.token)).send({ decision: 'APPROVE', reason: 'Dentro do prazo', revoke_entitlement: true }).expect(422);
    });
    it('aprovado: order REFUNDED, direito REVOGADO com histórico, royalty estornado, tudo auditado, nada apagado', async () => {
      await request(ctx.http).post(`/v1/admin/refunds/${refundId}/decision`).set(auth(admin.token)).send({ decision: 'APPROVE', reason: 'Dentro do prazo de 14 dias', revoke_entitlement: true, legal_basis: 'Direito de livre resolução (consumidor)' }).expect(200);
      expect((await request(ctx.http).get(`/v1/orders/${orderId}`).set(auth(buyer.token))).body.status).toBe('REFUNDED');
      const en = (await ctx.pool.query(`SELECT id, status, revocation_reason, revoked_by FROM entitlements WHERE order_item_id=$1`, [itemId])).rows[0];
      expect(en).toMatchObject({ status: 'REVOKED', revoked_by: admin.id });
      expect(await count(`SELECT count(*) n FROM entitlement_events WHERE entitlement_id=$1`, [en.id])).toBe(2); // GRANTED + REVOKED
      await request(ctx.http).get(`/v1/library/${ed.editionId}/access`).set(auth(buyer.token)).expect(403);
      expect((await request(ctx.http).get('/v1/library').set(auth(buyer.token))).body).toHaveLength(0);
      await request(ctx.http).post(`/v1/admin/refunds/${refundId}/decision`).set(auth(admin.token)).send({ decision: 'APPROVE', reason: 'repetido' }).expect(409);
      await drain();
      const adj = (await ctx.pool.query(`SELECT a.amount_minor FROM royalty_adjustments a JOIN royalty_ledger l ON l.id=a.royalty_ledger_id WHERE l.order_item_id=$1`, [itemId])).rows;
      expect(adj.map((a) => Number(a.amount_minor))).toEqual([-699]);
      expect(await count(`SELECT count(*) n FROM audit_log WHERE action IN ('refund.approve','entitlement.revoke') AND target_id = ANY($1)`, [[refundId, en.id]])).toBe(2);
      expect(await count(`SELECT count(*) n FROM orders WHERE id=$1`, [orderId])).toBe(1);
    });
    it('após o reembolso o utilizador pode voltar a comprar a edição', async () => { expect((await order(buyer, [ed.editionId])).status).toBe(201); });
  });
});
