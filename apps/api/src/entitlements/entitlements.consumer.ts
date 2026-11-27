import { Injectable, OnModuleInit } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../common/db.service';
import { BusEvent, EventBus } from '../events/event-bus';
import { emit } from '../events/outbox';

/** Único sítio que cria entitlements (ADR-0003/0004). Idempotente por inbox + UNIQUE(order_item_id). */
@Injectable()
export class EntitlementsConsumer implements OnModuleInit {
  constructor(private db: DbService, private bus: EventBus) {}
  onModuleInit() { this.bus.subscribe('entitlements', 'PaymentCaptured', (e) => this.onPaymentCaptured(e)); }

  async onPaymentCaptured(e: BusEvent) {
    await this.db.tx(async (c) => {
      const seen = await c.query(`INSERT INTO inbox_events (consumer, event_id) VALUES ('entitlements',$1) ON CONFLICT DO NOTHING RETURNING 1`, [e.eventId]);
      if (!seen.rowCount) return; // já processado
      const items = (await c.query(`SELECT oi.id, oi.edition_id, o.user_id FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.order_id=$1`, [e.payload.orderId])).rows;
      for (const it of items) await this.grant(c, e.payload.orderId, e.payload.paymentAttemptId, it);
      await c.query(`UPDATE orders SET status='FULFILLED' WHERE id=$1 AND status='PAID'`, [e.payload.orderId]);
    });
  }

  private async grant(c: PoolClient, orderId: string, attemptId: string, it: { id: string; edition_id: string; user_id: string }) {
    await c.query('SAVEPOINT g');
    try {
      const r = await c.query(
        `INSERT INTO entitlements (user_id, book_edition_id, order_item_id) VALUES ($1,$2,$3) ON CONFLICT (order_item_id) DO NOTHING RETURNING id`, [it.user_id, it.edition_id, it.id]);
      if (r.rowCount) {
        await c.query(`INSERT INTO entitlement_events (entitlement_id, event_type) VALUES ($1,'GRANTED')`, [r.rows[0].id]);
        await emit(c, 'entitlement', r.rows[0].id, 'EntitlementGranted', { entitlementId: r.rows[0].id, userId: it.user_id, editionId: it.edition_id, orderItemId: it.id });
      }
      await c.query('RELEASE SAVEPOINT g');
    } catch (err: any) {
      await c.query('ROLLBACK TO SAVEPOINT g');
      if (err.code !== '23505') throw err;
      // O utilizador já possui esta edição (compra duplicada concorrente): não cria 2º direito; pede reembolso automático.
      await c.query(`INSERT INTO dead_letter_events (source, event_type, payload, error) VALUES ('entitlements','PaymentCaptured',$1,'DUPLICATE_ENTITLEMENT')`, [JSON.stringify({ orderId, orderItemId: it.id })]);
      await c.query(`INSERT INTO refunds (payment_attempt_id, order_item_id, amount_minor, reason)
                     SELECT $1, oi.id, oi.unit_price_minor - oi.discount_minor + oi.tax_minor, 'Compra duplicada: direito já existente (reembolso automático pendente de aprovação)'
                       FROM order_items oi WHERE oi.id=$2
                        AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.order_item_id=oi.id AND r.status IN ('REQUESTED','APPROVED','PROCESSING','COMPLETED'))`, [attemptId, it.id]);
    }
  }
}
