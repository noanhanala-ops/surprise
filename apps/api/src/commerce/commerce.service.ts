import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DbService } from '../common/db.service';

export interface CreateOrderInput { edition_ids: string[]; currency: string; billing_country: string }
const TAX_RULE_VERSION = 'none-v0'; // IVA/impostos: ainda não implementado (ver docs/commerce/COMMERCE_SPEC.md)

@Injectable()
export class CommerceService {
  constructor(private db: DbService) {}

  async createOrder(userId: string, dto: CreateOrderInput, key: string) {
    const ids = [...new Set(dto.edition_ids)];
    const currency = dto.currency.toUpperCase(); const country = dto.billing_country.toUpperCase();
    const prior = await this.findByKey(userId, key);
    if (prior) return this.sameRequest(prior, ids, currency);

    const created = await this.db.tx(async (c) => {
      // Serializa compras do mesmo utilizador para evitar corridas na verificação "já possui".
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`order:${userId}`]);
      const { rows } = await c.query(
        `SELECT e.id, e.publisher_id, e.status, edition_sellable_in(e.id, $3) AS sellable,
                (SELECT p.amount_minor FROM book_prices p WHERE p.book_edition_id=e.id AND p.currency=$2 AND p.effective_from<=now() AND (p.effective_to IS NULL OR p.effective_to>now()) LIMIT 1) AS price,
                (SELECT row_to_json(k) FROM (SELECT k.id, k.commission_bps FROM rights_contracts k WHERE k.book_edition_id=e.id AND k.status='ACTIVE' AND k.start_at<=now() AND (k.end_at IS NULL OR k.end_at>now()) ORDER BY k.start_at DESC LIMIT 1) k) AS contract,
                EXISTS (SELECT 1 FROM entitlements en WHERE en.user_id=$4 AND en.book_edition_id=e.id AND en.status IN ('ACTIVE','SUSPENDED')) AS owned
           FROM book_editions e WHERE e.id = ANY($1)`, [ids, currency, country, userId]);
      const byId = new Map(rows.map((r) => [r.id, r]));
      const items: any[] = [];
      for (const id of ids) {
        const r = byId.get(id);
        if (!r || r.status !== 'PUBLISHED') throw new UnprocessableEntityException(`Edição ${id} indisponível`);
        if (!r.sellable) throw new HttpException(`Edição ${id} não pode ser vendida em ${country}`, 451);
        if (r.price == null) throw new UnprocessableEntityException(`Edição ${id} sem preço em ${currency}`);
        if (r.owned) throw new ConflictException(`Já possui a edição ${id}`);
        if (!r.contract) throw new UnprocessableEntityException(`Edição ${id} sem contrato activo`);
        items.push({ edition_id: id, publisher_id: r.publisher_id, unit_price_minor: Number(r.price), contract_id: r.contract.id, commission_bps: r.contract.commission_bps });
      }
      const subtotal = items.reduce((n, i) => n + i.unit_price_minor, 0);
      const snapshot = { items, currency, billing_country: country, tax_rule_version: TAX_RULE_VERSION, priced_at: new Date().toISOString() };
      const o = await c.query(
        `INSERT INTO orders (user_id, currency, subtotal_minor, tax_minor, total_minor, billing_country, idempotency_key, pricing_snapshot)
         VALUES ($1,$2,$3,0,$3,$4,$5,$6) ON CONFLICT (user_id, idempotency_key) DO NOTHING RETURNING id`, [userId, currency, subtotal, country, key, JSON.stringify(snapshot)]);
      if (!o.rowCount) return null;
      const orderId = o.rows[0].id;
      for (const i of items)
        await c.query(`INSERT INTO order_items (order_id, edition_id, publisher_id, contract_id, unit_price_minor, commission_bps) VALUES ($1,$2,$3,$4,$5,$6)`,
          [orderId, i.edition_id, i.publisher_id, i.contract_id, i.unit_price_minor, i.commission_bps]);
      await c.query(`INSERT INTO tax_calculations (order_id, country_code, tax_amount_minor, tax_rule_version) VALUES ($1,$2,0,$3)`, [orderId, country, TAX_RULE_VERSION]);
      return orderId as string;
    });
    return created ? this.getOrder(userId, created) : this.sameRequest((await this.findByKey(userId, key))!, ids, currency);
  }

  private async sameRequest(order: any, ids: string[], currency: string) {
    const same = order.currency === currency && order.items.length === ids.length && order.items.every((i: any) => ids.includes(i.edition_id));
    if (!same) throw new UnprocessableEntityException('Idempotency-Key já usada com um pedido diferente');
    return order;
  }

  private async findByKey(userId: string, key: string) {
    const r = await this.db.query(`SELECT id FROM orders WHERE user_id=$1 AND idempotency_key=$2`, [userId, key]);
    return r.rowCount ? this.getOrder(userId, r.rows[0].id) : null;
  }

  async getOrder(userId: string, orderId: string) {
    const o = await this.db.query(`SELECT * FROM orders WHERE id=$1 AND user_id=$2`, [orderId, userId]);
    if (!o.rowCount) throw new NotFoundException();
    const it = await this.db.query(`SELECT id, edition_id, unit_price_minor, discount_minor, tax_minor FROM order_items WHERE order_id=$1 ORDER BY id`, [orderId]);
    const r = o.rows[0];
    return { id: r.id, status: r.status, currency: r.currency, subtotal_minor: Number(r.subtotal_minor), tax_minor: Number(r.tax_minor), total_minor: Number(r.total_minor), created_at: r.created_at,
      items: it.rows.map((i) => ({ id: i.id, edition_id: i.edition_id, unit_price_minor: Number(i.unit_price_minor), tax_minor: Number(i.tax_minor) })) };
  }

  async listOrders(userId: string, limit: number) {
    const r = await this.db.query(`SELECT id FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`, [userId, limit]);
    return Promise.all(r.rows.map((x) => this.getOrder(userId, x.id)));
  }

  async requestRefund(userId: string, orderId: string, reason: string, itemIds?: string[]) {
    if (!reason?.trim()) throw new BadRequestException('Motivo obrigatório');
    return this.db.tx(async (c) => {
      const o = (await c.query(`SELECT id, status FROM orders WHERE id=$1 AND user_id=$2 FOR UPDATE`, [orderId, userId])).rows[0];
      if (!o) throw new NotFoundException();
      if (!['PAID', 'FULFILLED', 'PARTIALLY_REFUNDED'].includes(o.status)) throw new ConflictException(`Encomenda em estado ${o.status} não é reembolsável`);
      const att = (await c.query(`SELECT id FROM payment_attempts WHERE order_id=$1 AND status IN ('CAPTURED','PARTIALLY_REFUNDED') ORDER BY captured_at LIMIT 1`, [orderId])).rows[0];
      if (!att) throw new ConflictException('Sem pagamento capturado');
      const items = (await c.query(
        `SELECT oi.id, (oi.unit_price_minor - oi.discount_minor + oi.tax_minor) AS amount FROM order_items oi
          WHERE oi.order_id=$1 AND ($2::uuid[] IS NULL OR oi.id = ANY($2))
            AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.order_item_id=oi.id AND r.status IN ('REQUESTED','APPROVED','PROCESSING','COMPLETED'))`, [orderId, itemIds ?? null])).rows;
      if (!items.length || (itemIds && items.length !== new Set(itemIds).size)) throw new ConflictException('Artigos inexistentes ou com reembolso já pedido');
      const ids: string[] = [];
      for (const i of items) {
        const r = await c.query(`INSERT INTO refunds (payment_attempt_id, order_item_id, amount_minor, reason) VALUES ($1,$2,$3,$4) RETURNING id`, [att.id, i.id, i.amount, reason]);
        ids.push(r.rows[0].id);
      }
      return { refund_ids: ids, status: 'REQUESTED' };
    });
  }
}
