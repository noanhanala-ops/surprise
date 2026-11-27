import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../common/db.service';

/** Leitura para o portal da editora: detalhe de edição, vendas, royalties, pagamentos e contratos. Tudo limitado às editoras do utilizador. */
@Injectable()
export class PublisherReportsService {
  constructor(private db: DbService) {}

  /** Editoras do utilizador com um dos papéis indicados (vazio ⇒ 403). */
  private async publisherIds(userId: string, roles: string[]): Promise<string[]> {
    const r = await this.db.query(`SELECT publisher_id FROM publisher_users WHERE user_id=$1 AND role = ANY($2)`, [userId, roles]);
    if (!r.rowCount) throw new ForbiddenException('Sem acesso a dados da editora');
    return r.rows.map((x) => x.publisher_id);
  }
  private readonly ANY = ['OWNER', 'EDITOR', 'FINANCE', 'VIEWER']; private readonly FIN = ['OWNER', 'FINANCE'];

  async myPublishers(userId: string) {
    return (await this.db.query(`SELECT p.id, p.display_name, p.status, pu.role FROM publisher_users pu JOIN publishers p ON p.id=pu.publisher_id WHERE pu.user_id=$1 ORDER BY p.display_name`, [userId])).rows;
  }

  /** Detalhe de uma edição: metadados, preços, formatos (com motivo de rejeição), capas, contrato, último motivo de rejeição editorial. */
  async editionDetail(userId: string, editionId: string) {
    const ids = await this.publisherIds(userId, this.ANY);
    const e = (await this.db.query(
      `SELECT e.id, e.status, e.isbn, e.language_code, e.published_at, e.publisher_id, b.title, b.description, b.slug
         FROM book_editions e JOIN books b ON b.id=e.book_id WHERE e.id=$1 AND e.publisher_id = ANY($2)`, [editionId, ids])).rows[0];
    if (!e) throw new NotFoundException();
    const q = async (sql: string) => (await this.db.query(sql, [editionId])).rows;
    const [prices, formats, assets, contracts, rejection] = await Promise.all([
      q(`SELECT currency, amount_minor::bigint AS amount_minor FROM book_prices WHERE book_edition_id=$1 AND effective_to IS NULL ORDER BY currency`),
      q(`SELECT f.id, f.format::text AS format, v.id AS version_id, v.version_number, v.processing_status::text AS status, v.rejection_reason, v.size_bytes::bigint AS size_bytes, v.created_at, (f.current_version_id = v.id) AS is_current
           FROM book_formats f JOIN book_format_versions v ON v.book_format_id=f.id WHERE f.book_edition_id=$1 ORDER BY v.created_at DESC LIMIT 50`),
      q(`SELECT id, asset_type::text AS asset_type, mime_type, size_bytes::bigint AS size_bytes FROM book_assets WHERE book_edition_id=$1 ORDER BY created_at DESC`),
      q(`SELECT k.id, k.status, k.start_at, k.end_at, k.commission_bps, (SELECT json_agg(json_build_object('country_code', t.country_code, 'permission_type', t.permission_type) ORDER BY t.country_code) FROM rights_territories t WHERE t.contract_id=k.id) AS territories
           FROM rights_contracts k WHERE k.book_edition_id=$1 ORDER BY k.start_at DESC`),
      q(`SELECT reason, created_at FROM audit_log WHERE target_type='edition' AND target_id=$1::text AND action='edition.reject' ORDER BY id DESC LIMIT 1`),
    ]);
    return { ...e, prices: prices.map((p) => ({ ...p, amount_minor: Number(p.amount_minor) })), formats: formats.map((f) => ({ ...f, size_bytes: Number(f.size_bytes) })),
      assets: assets.map((a) => ({ ...a, size_bytes: Number(a.size_bytes) })), contracts, last_rejection: rejection[0] ?? null };
  }

  /** Vendas por edição (artigos em encomendas pagas) e reembolsos concluídos. */
  async sales(userId: string) {
    const ids = await this.publisherIds(userId, this.FIN.concat(['EDITOR', 'VIEWER']));
    const r = await this.db.query(
      `SELECT e.id AS edition_id, b.title, o.currency,
              count(*)::int AS units, COALESCE(sum(oi.unit_price_minor - oi.discount_minor),0)::bigint AS gross_minor,
              count(rf.id)::int AS refunded_units
         FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN book_editions e ON e.id=oi.edition_id JOIN books b ON b.id=e.book_id
         LEFT JOIN refunds rf ON rf.order_item_id=oi.id AND rf.status='COMPLETED'
        WHERE oi.publisher_id = ANY($1) AND o.status IN ('PAID','FULFILLED','PARTIALLY_REFUNDED','REFUNDED')
        GROUP BY e.id, b.title, o.currency ORDER BY b.title, o.currency`, [ids]);
    return r.rows.map((x) => ({ ...x, gross_minor: Number(x.gross_minor) }));
  }

  /** Saldo contabilístico por moeda e últimas linhas do ledger (com ajustes). Só OWNER/FINANCE. */
  async royalties(userId: string) {
    const ids = await this.publisherIds(userId, this.FIN);
    const balances = (await this.db.query(`SELECT publisher_id, currency, accrued_minor::bigint AS accrued_minor FROM publisher_balances WHERE publisher_id = ANY($1) ORDER BY currency`, [ids])).rows;
    const ledger = (await this.db.query(
      `SELECT l.id, b.title, l.currency, l.eligible_amount_minor::bigint AS eligible_minor, l.percentage_bps, l.amount_minor::bigint AS amount_minor, l.created_at,
              COALESCE((SELECT sum(a.amount_minor) FROM royalty_adjustments a WHERE a.royalty_ledger_id=l.id),0)::bigint AS adjustments_minor
         FROM royalty_ledger l JOIN order_items oi ON oi.id=l.order_item_id JOIN book_editions e ON e.id=oi.edition_id JOIN books b ON b.id=e.book_id
        WHERE l.publisher_id = ANY($1) ORDER BY l.created_at DESC LIMIT 100`, [ids])).rows;
    const n = (v: any) => Number(v);
    return { balances: balances.map((b) => ({ ...b, accrued_minor: n(b.accrued_minor) })),
      ledger: ledger.map((l) => ({ ...l, eligible_minor: n(l.eligible_minor), amount_minor: n(l.amount_minor), adjustments_minor: n(l.adjustments_minor) })) };
  }

  async payouts(userId: string) {
    const ids = await this.publisherIds(userId, this.FIN);
    return (await this.db.query(`SELECT id, currency, total_minor::bigint AS total_minor, status::text AS status, period_start, period_end FROM payout_batches WHERE publisher_id = ANY($1) ORDER BY created_at DESC LIMIT 100`, [ids]))
      .rows.map((p) => ({ ...p, total_minor: Number(p.total_minor) }));
  }

  async contracts(userId: string) {
    const ids = await this.publisherIds(userId, this.ANY);
    return (await this.db.query(
      `SELECT k.id, b.title, k.book_edition_id AS edition_id, k.status, k.start_at, k.end_at, k.commission_bps,
              (SELECT json_agg(json_build_object('country_code', t.country_code, 'permission_type', t.permission_type) ORDER BY t.country_code) FROM rights_territories t WHERE t.contract_id=k.id) AS territories
         FROM rights_contracts k JOIN book_editions e ON e.id=k.book_edition_id JOIN books b ON b.id=e.book_id WHERE k.publisher_id = ANY($1) ORDER BY k.start_at DESC`, [ids])).rows;
  }
}
