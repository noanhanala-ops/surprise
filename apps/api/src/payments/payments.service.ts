import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../common/db.service';
import { AuditService } from '../common/audit.service';
import { emit } from '../events/outbox';
import { ProviderRegistry } from './provider.registry';

const OPEN = ['INITIATED', 'PENDING', 'REQUIRES_ACTION'];

@Injectable()
export class PaymentsService {
  constructor(private db: DbService, private providers: ProviderRegistry, private audit: AuditService) {}

  /** Inicia (ou devolve o já aberto) pagamento de uma encomenda. Idempotente por encomenda. */
  async checkout(userId: string, orderId: string, method: string, returnUrl?: string) {
    const provider = this.providers.get(method);
    const phase1 = await this.db.tx(async (c) => {
      const o = (await c.query(`SELECT id, status, total_minor, currency, billing_country FROM orders WHERE id=$1 AND user_id=$2 FOR UPDATE`, [orderId, userId])).rows[0];
      if (!o) throw new NotFoundException();
      if (!['DRAFT', 'PENDING_PAYMENT'].includes(o.status)) throw new ConflictException(`Encomenda em estado ${o.status}`);
      const open = (await c.query(`SELECT id, provider, provider_reference, status FROM payment_attempts WHERE order_id=$1 AND status = ANY($2) ORDER BY created_at DESC LIMIT 1`, [orderId, OPEN])).rows[0];
      if (open) { if (!open.provider_reference) throw new ConflictException('Pagamento em preparação, tente novamente'); return { existing: open }; }
      const a = await c.query(`INSERT INTO payment_attempts (order_id, provider, amount_minor, currency) VALUES ($1,$2,$3,$4) RETURNING id`, [orderId, method, o.total_minor, o.currency]);
      await c.query(`UPDATE orders SET status='PENDING_PAYMENT' WHERE id=$1`, [orderId]);
      return { attemptId: a.rows[0].id as string, order: o };
    });
    if ('existing' in phase1) return { payment_id: phase1.existing!.id, status: phase1.existing!.status, provider: phase1.existing!.provider };
    try {
      const r = await provider.createCheckout({ orderId, amountMinor: Number(phase1.order.total_minor), currency: phase1.order.currency, method, returnUrl,
        customer: { userId, country: phase1.order.billing_country }, idempotencyKey: phase1.attemptId });
      await this.db.query(`UPDATE payment_attempts SET provider_reference=$2, status=$3 WHERE id=$1`, [phase1.attemptId, r.providerReference, r.status]);
      return { payment_id: phase1.attemptId, status: r.status, provider: method, redirect_url: r.redirectUrl, instructions: r.instructions };
    } catch (e) {
      await this.db.query(`UPDATE payment_attempts SET status='FAILED' WHERE id=$1`, [phase1.attemptId]);
      throw e;
    }
  }

  async get(userId: string, id: string) {
    const r = await this.db.query(`SELECT pa.id, pa.order_id, pa.status, pa.provider FROM payment_attempts pa JOIN orders o ON o.id=pa.order_id WHERE pa.id=$1 AND o.user_id=$2`, [id, userId]);
    if (!r.rowCount) throw new NotFoundException(); return r.rows[0];
  }

  methods() { return this.providers.list().map((code) => ({ code, label: code, currencies: ['USD', 'MZN', 'EUR'] })); }

  /** Webhook: verifica assinatura/replay → regista evento (UNIQUE) → aplica; tudo numa transacção. */
  async handleWebhook(providerCode: string, headers: Record<string, string>, rawBody: Buffer) {
    const provider = this.providers.get(providerCode);
    let evt;
    try { evt = await provider.verifyWebhook({ headers, rawBody, receivedAt: new Date() }); }
    catch { throw new BadRequestException('Webhook inválido'); }
    let payload: unknown; try { payload = JSON.parse(rawBody.toString('utf8')); } catch { payload = { raw_base64: rawBody.toString('base64') }; }
    return this.db.tx(async (c) => {
      const ins = await c.query(
        `INSERT INTO payment_events (provider, external_event_id, payload_hash, payload, signature_valid) VALUES ($1,$2,$3,$4,true)
         ON CONFLICT (provider, external_event_id) DO NOTHING RETURNING id`, [providerCode, evt.externalEventId, evt.payloadHash, JSON.stringify(payload)]);
      if (!ins.rowCount) return { status: 'duplicate' };
      await this.apply(c, providerCode, evt);
      await c.query(`UPDATE payment_events SET processed_at=now() WHERE id=$1`, [ins.rows[0].id]);
      return { status: 'processed' };
    });
  }

  private async apply(c: PoolClient, providerCode: string, evt: { type: string; providerReference: string; amountMinor?: number; currency?: string; externalEventId: string }) {
    const a = (await c.query(`SELECT id, order_id, status, amount_minor, currency FROM payment_attempts WHERE provider=$1 AND provider_reference=$2 FOR UPDATE`, [providerCode, evt.providerReference])).rows[0];
    if (!a) { await this.deadLetter(c, evt, 'UNKNOWN_PAYMENT_REFERENCE'); return; }
    switch (evt.type) {
      case 'payment.succeeded':
        if (evt.amountMinor !== Number(a.amount_minor) || (evt.currency && evt.currency !== a.currency)) { await this.deadLetter(c, evt, 'AMOUNT_OR_CURRENCY_MISMATCH'); return; }
        await this.capture(c, a); break;
      case 'payment.failed':
        await c.query(`UPDATE payment_attempts SET status='FAILED' WHERE id=$1 AND status = ANY($2)`, [a.id, OPEN]); break;
      case 'dispute.opened':
        await c.query(`UPDATE payment_attempts SET status='DISPUTED' WHERE id=$1`, [a.id]);
        await this.audit.log({ actorType: 'SYSTEM', action: 'payment.dispute', targetType: 'payment_attempt', targetId: a.id }, c); break;
      default: break; // refund.succeeded: os reembolsos são iniciados por nós
    }
  }

  /** Transição financeira idempotente PENDING→CAPTURED + order PAID + evento PaymentCaptured (mesma TX). */
  async capture(c: PoolClient, a: { id: string; order_id: string; status: string; amount_minor: string | number; currency: string }) {
    if (!OPEN.concat(['FAILED', 'CANCELLED']).includes(a.status)) return false; // já capturado/reembolsado/disputado
    await c.query(`UPDATE payment_attempts SET status='CAPTURED', captured_at=now() WHERE id=$1`, [a.id]);
    // Pagamento confirmado tarde (após timeout/cancelamento) também cumpre a encomenda: o dinheiro foi recebido.
    const o = (await c.query(`UPDATE orders SET status='PAID' WHERE id=$1 AND status IN ('DRAFT','PENDING_PAYMENT','CANCELLED','FAILED') RETURNING user_id, currency`, [a.order_id])).rows[0];
    if (!o) return false;
    const items = (await c.query(`SELECT id FROM order_items WHERE order_id=$1`, [a.order_id])).rows.map((r) => r.id);
    await emit(c, 'order', a.order_id, 'PaymentCaptured', { orderId: a.order_id, paymentAttemptId: a.id, userId: o.user_id, currency: o.currency, amountMinor: Number(a.amount_minor), orderItemIds: items });
    return true;
  }

  private async deadLetter(c: PoolClient, evt: any, error: string) {
    await c.query(`INSERT INTO dead_letter_events (source, event_type, payload, error) VALUES ('payments',$1,$2,$3)`, [evt.type, JSON.stringify(evt), error]);
  }

  /** Reconciliação: pagamentos abertos há > `olderThanMinutes` são consultados ao fornecedor. */
  async reconcile(olderThanMinutes = 10) {
    const { rows } = await this.db.query(
      `SELECT id FROM payment_attempts WHERE status = ANY($1) AND provider_reference IS NOT NULL AND created_at < now() - make_interval(mins => $2) ORDER BY created_at LIMIT 200`, [OPEN, olderThanMinutes]);
    let captured = 0; const errors: { payment_id: string; error: string }[] = [];
    for (const r of rows) {
      // Uma falha num pagamento (referência desconhecida, fornecedor em baixo) não pode travar os restantes.
      await this.db.tx(async (c) => {
        const a = (await c.query(`SELECT * FROM payment_attempts WHERE id=$1 FOR UPDATE`, [r.id])).rows[0];
        if (!OPEN.includes(a.status)) return;
        const remote = await this.providers.get(a.provider).getPayment(a.provider_reference);
        if (remote.status === 'CAPTURED' && remote.amountMinor === Number(a.amount_minor) && remote.currency === a.currency) { if (await this.capture(c, a)) captured++; }
        else if (remote.status === 'FAILED' || remote.status === 'CANCELLED') await c.query(`UPDATE payment_attempts SET status=$2 WHERE id=$1`, [a.id, remote.status]);
      }).catch((e) => { errors.push({ payment_id: r.id, error: String(e?.message ?? e) }); });
    }
    return { checked: rows.length, captured, errors };
  }
}
