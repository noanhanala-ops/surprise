import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { DbService } from '../common/db.service';
import { emit } from '../events/outbox';
import { ProviderRegistry } from '../payments/provider.registry';

export interface RefundDecision { decision: 'APPROVE' | 'REJECT'; reason: string; revoke_entitlement?: boolean; legal_basis?: string }

@Injectable()
export class RefundsService {
  constructor(private db: DbService, private audit: AuditService, private providers: ProviderRegistry) {}

  async list(status?: string) {
    return (await this.db.query(`SELECT id, payment_attempt_id, order_item_id, amount_minor, reason, status, created_at FROM refunds WHERE ($1::text IS NULL OR status::text=$1) ORDER BY created_at DESC LIMIT 200`, [status ?? null])).rows;
  }

  async decide(adminId: string, refundId: string, d: RefundDecision) {
    if (d.decision === 'APPROVE' && d.revoke_entitlement && !d.legal_basis?.trim())
      throw new UnprocessableEntityException('Revogar o direito exige base legal/contratual (legal_basis)');
    // Fase 1: reserva a decisão (REQUESTED → PROCESSING/REJECTED).
    const r = await this.db.tx(async (c) => {
      const row = (await c.query(`SELECT r.*, pa.provider, pa.provider_reference FROM refunds r JOIN payment_attempts pa ON pa.id=r.payment_attempt_id WHERE r.id=$1 FOR UPDATE OF r`, [refundId])).rows[0];
      if (!row) throw new NotFoundException();
      if (row.status !== 'REQUESTED') throw new ConflictException(`Reembolso em estado ${row.status}`);
      const next = d.decision === 'APPROVE' ? 'PROCESSING' : 'REJECTED';
      await c.query(`UPDATE refunds SET status=$2, decided_by=$3 WHERE id=$1`, [refundId, next, adminId]);
      await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: d.decision === 'APPROVE' ? 'refund.approve' : 'refund.reject', targetType: 'refund', targetId: refundId, reason: d.reason }, c);
      return row;
    });
    if (d.decision === 'REJECT') return { status: 'REJECTED' };

    // Fase 2: chama o fornecedor (fora da transacção) e finaliza.
    let pr;
    try { pr = await this.providers.get(r.provider).refund({ providerReference: r.provider_reference, amountMinor: Number(r.amount_minor), reason: d.reason, idempotencyKey: refundId }); }
    catch (e) { await this.db.query(`UPDATE refunds SET status='FAILED' WHERE id=$1`, [refundId]); throw e; }
    if (pr.status === 'FAILED') { await this.db.query(`UPDATE refunds SET status='FAILED' WHERE id=$1`, [refundId]); throw new ConflictException('O fornecedor recusou o reembolso'); }

    return this.db.tx(async (c) => {
      await c.query(`UPDATE refunds SET status=$2, provider_reference=$3 WHERE id=$1`, [refundId, pr.status === 'COMPLETED' ? 'COMPLETED' : 'PROCESSING', pr.providerRefundReference]);
      const orderId = (await c.query(`SELECT order_id FROM order_items WHERE id=$1`, [r.order_item_id])).rows[0].order_id;
      const sums = (await c.query(
        `SELECT o.total_minor, COALESCE((SELECT SUM(rf.amount_minor) FROM refunds rf JOIN order_items oi ON oi.id=rf.order_item_id WHERE oi.order_id=o.id AND rf.status='COMPLETED'),0) AS refunded
           FROM orders o WHERE o.id=$1 FOR UPDATE`, [orderId])).rows[0];
      const full = Number(sums.refunded) >= Number(sums.total_minor);
      await c.query(`UPDATE orders SET status=$2 WHERE id=$1`, [orderId, full ? 'REFUNDED' : 'PARTIALLY_REFUNDED']);
      await c.query(`UPDATE payment_attempts SET status=$2 WHERE id=$1 AND status IN ('CAPTURED','PARTIALLY_REFUNDED')`, [r.payment_attempt_id, full ? 'REFUNDED' : 'PARTIALLY_REFUNDED']);
      if (d.revoke_entitlement) {
        const en = (await c.query(
          `UPDATE entitlements SET status='REVOKED', revoked_at=now(), revocation_reason=$2, revoked_by=$3 WHERE order_item_id=$1 AND status<>'REVOKED' RETURNING id`,
          [r.order_item_id, d.reason, adminId])).rows[0];
        if (en) {
          await c.query(`INSERT INTO entitlement_events (entitlement_id, event_type, reason, actor_id, legal_basis) VALUES ($1,'REVOKED',$2,$3,$4)`, [en.id, d.reason, adminId, d.legal_basis]);
          await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'entitlement.revoke', targetType: 'entitlement', targetId: en.id, reason: d.reason, after: { legal_basis: d.legal_basis } }, c);
        }
      }
      await emit(c, 'refund', refundId, 'RefundCompleted', { refundId, orderId, orderItemId: r.order_item_id, amountMinor: Number(r.amount_minor) });
      return { status: pr.status === 'COMPLETED' ? 'COMPLETED' : 'PROCESSING', order_status: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED' };
    });
  }
}
