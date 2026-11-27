import { Injectable, OnModuleInit } from '@nestjs/common';
import { DbService } from '../common/db.service';
import { BusEvent, EventBus } from '../events/event-bus';

/** Ledger de royalties (ADR-0008): snapshot do contrato na venda; nunca usa o preço actual. */
@Injectable()
export class RoyaltyConsumer implements OnModuleInit {
  constructor(private db: DbService, private bus: EventBus) {}
  onModuleInit() {
    this.bus.subscribe('royalty', 'PaymentCaptured', (e) => this.onSale(e));
    this.bus.subscribe('royalty', 'RefundCompleted', (e) => this.onRefund(e));
  }

  async onSale(e: BusEvent) {
    await this.db.tx(async (c) => {
      const seen = await c.query(`INSERT INTO inbox_events (consumer, event_id) VALUES ('royalty',$1) ON CONFLICT DO NOTHING RETURNING 1`, [e.eventId]);
      if (!seen.rowCount) return;
      // Valor elegível = preço − desconto (impostos e taxas do PSP ainda não deduzidos: ver COMMERCE_SPEC).
      await c.query(
        `INSERT INTO royalty_ledger (publisher_id, order_item_id, eligible_amount_minor, percentage_bps, amount_minor, currency)
         SELECT oi.publisher_id, oi.id, oi.unit_price_minor - oi.discount_minor, 10000 - oi.commission_bps,
                ((oi.unit_price_minor - oi.discount_minor) * (10000 - oi.commission_bps)) / 10000, o.currency
           FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.order_id=$1
         ON CONFLICT (order_item_id, entry_type) DO NOTHING`, [e.payload.orderId]);
    });
  }

  async onRefund(e: BusEvent) {
    await this.db.tx(async (c) => {
      const seen = await c.query(`INSERT INTO inbox_events (consumer, event_id) VALUES ('royalty',$1) ON CONFLICT DO NOTHING RETURNING 1`, [e.eventId]);
      if (!seen.rowCount) return;
      // Reembolsos são por artigo completo nesta versão: estorna-se a totalidade do royalty da linha.
      await c.query(
        `INSERT INTO royalty_adjustments (royalty_ledger_id, amount_minor, reason, refund_id)
         SELECT l.id, -l.amount_minor, 'Reembolso', $2 FROM royalty_ledger l WHERE l.order_item_id=$1 AND l.amount_minor > 0
            AND NOT EXISTS (SELECT 1 FROM royalty_adjustments a WHERE a.refund_id=$2)`, [e.payload.orderItemId, e.payload.refundId]);
    });
  }
}
