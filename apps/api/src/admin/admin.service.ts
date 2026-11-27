import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { DbService } from '../common/db.service';
import { ContractDto } from '../publisher/dto';

@Injectable()
export class AdminService {
  constructor(private db: DbService, private audit: AuditService) {}

  async approvePublisher(adminId: string, id: string) {
    await this.db.tx(async (c) => {
      const r = await c.query(`UPDATE publishers SET status='ACTIVE' WHERE id=$1 AND status IN ('PENDING','KYC_REVIEW','SUSPENDED') RETURNING id`, [id]);
      if (!r.rowCount) throw new NotFoundException('Editora não encontrada ou já activa');
      await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'publisher.approve', targetType: 'publisher', targetId: id }, c);
    });
  }

  async createContract(adminId: string, dto: ContractDto) {
    return this.db.tx(async (c) => {
      const e = await c.query(`SELECT publisher_id FROM book_editions WHERE id=$1`, [dto.edition_id]);
      if (!e.rowCount) throw new NotFoundException('Edição não encontrada');
      const k = await c.query(
        `INSERT INTO rights_contracts (publisher_id, book_edition_id, start_at, end_at, commission_bps, status) VALUES ($1,$2,$3,$4,$5,'ACTIVE') RETURNING id`,
        [e.rows[0].publisher_id, dto.edition_id, dto.start_at, dto.end_at ?? null, dto.commission_bps]);
      for (const t of dto.territories) await c.query(`INSERT INTO rights_territories (contract_id, country_code, permission_type) VALUES ($1,$2,$3)`, [k.rows[0].id, t.country_code, t.permission_type]);
      await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'contract.create', targetType: 'contract', targetId: k.rows[0].id, after: dto }, c);
      return { contract_id: k.rows[0].id };
    });
  }

  /** Aprovar = publicar: exige contrato activo com território de venda, preço e formato READY. */
  async approveEdition(adminId: string, id: string) {
    return this.db.tx(async (c) => {
      const e = (await c.query(`SELECT status FROM book_editions WHERE id=$1 FOR UPDATE`, [id])).rows[0];
      if (!e) throw new NotFoundException();
      if (!['IN_REVIEW', 'SUSPENDED'].includes(e.status)) throw new ConflictException(`Estado ${e.status} não pode ser aprovado`);
      const has = async (sql: string) => (await c.query(sql, [id])).rowCount! > 0;
      if (!(await has(`SELECT 1 FROM rights_contracts k JOIN rights_territories t ON t.contract_id=k.id AND t.permission_type='SELL'
                        WHERE k.book_edition_id=$1 AND k.status='ACTIVE' AND k.start_at<=now() AND (k.end_at IS NULL OR k.end_at>now())`)))
        throw new UnprocessableEntityException('Sem contrato de direitos activo com território de venda');
      if (!(await has(`SELECT 1 FROM book_prices WHERE book_edition_id=$1 AND effective_to IS NULL`))) throw new UnprocessableEntityException('Sem preço vigente');
      if (!(await has(`SELECT 1 FROM book_formats f JOIN book_format_versions v ON v.id=f.current_version_id AND v.processing_status='READY' WHERE f.book_edition_id=$1`)))
        throw new UnprocessableEntityException('Sem formato validado');
      await c.query(`UPDATE book_editions SET status='PUBLISHED', published_at=COALESCE(published_at, now()), delisted_at=NULL WHERE id=$1`, [id]);
      await c.query(`INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload) VALUES ('edition',$1,'EditionPublished',$2)`, [id, JSON.stringify({ editionId: id })]);
      await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'edition.approve', targetType: 'edition', targetId: id, before: { status: e.status }, after: { status: 'PUBLISHED' } }, c);
      return { edition_id: id, status: 'PUBLISHED' };
    });
  }

  async rejectEdition(adminId: string, id: string, reason: string) {
    await this.transition(adminId, id, ['IN_REVIEW'], 'DRAFT', 'edition.reject', reason);
  }
  /** Suspende a venda. NÃO toca em entitlements: quem comprou mantém o acesso (ADR-0003). */
  async suspendEdition(adminId: string, id: string, reason: string) {
    await this.transition(adminId, id, ['PUBLISHED'], 'SUSPENDED', 'edition.suspend', reason);
  }

  private async transition(adminId: string, id: string, from: string[], to: string, action: string, reason: string) {
    await this.db.tx(async (c) => {
      const r = await c.query(`UPDATE book_editions SET status=$3 WHERE id=$1 AND status = ANY($2) RETURNING id`, [id, from, to]);
      if (!r.rowCount) throw new ConflictException(`Transição inválida (esperado: ${from.join('/')})`);
      await c.query(`INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload) VALUES ('edition',$1,'EditionStatusChanged',$2)`, [id, JSON.stringify({ editionId: id, status: to })]);
      await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action, targetType: 'edition', targetId: id, after: { status: to }, reason }, c);
    });
  }

  async pendingPublishers(status = 'PENDING') {
    return (await this.db.query(
      `SELECT p.id, p.legal_name, p.display_name, p.country_code, p.status::text AS status, p.is_individual_author, p.created_at,
              (SELECT u.email FROM publisher_users pu JOIN users u ON u.id=pu.user_id WHERE pu.publisher_id=p.id AND pu.role='OWNER' LIMIT 1) AS owner_email
         FROM publishers p WHERE p.status::text = $1 ORDER BY p.created_at LIMIT 200`, [status])).rows;
  }

  async editionsByStatus(status = 'IN_REVIEW') {
    return (await this.db.query(
      `SELECT e.id, b.title, e.status::text AS status, e.language_code, p.display_name AS publisher, p.id AS publisher_id,
              EXISTS (SELECT 1 FROM rights_contracts k WHERE k.book_edition_id=e.id AND k.status='ACTIVE') AS has_contract,
              (SELECT count(*)::int FROM book_prices x WHERE x.book_edition_id=e.id AND x.effective_to IS NULL) AS prices, e.created_at
         FROM book_editions e JOIN books b ON b.id=e.book_id JOIN publishers p ON p.id=e.publisher_id WHERE e.status::text=$1 ORDER BY e.created_at LIMIT 200`, [status])).rows;
  }

  /** Tudo o que o revisor precisa para decidir: ficheiros (com metadados extraídos), preços, contratos/territórios, histórico. */
  async editionDetail(id: string) {
    const e = (await this.db.query(
      `SELECT e.id, e.status::text AS status, e.isbn, e.language_code, b.title, b.description, p.display_name AS publisher, p.id AS publisher_id, p.status::text AS publisher_status
         FROM book_editions e JOIN books b ON b.id=e.book_id JOIN publishers p ON p.id=e.publisher_id WHERE e.id=$1`, [id])).rows[0];
    if (!e) throw new NotFoundException();
    const q = async (sql: string) => (await this.db.query(sql, [id])).rows;
    const [prices, formats, contracts, history] = await Promise.all([
      q(`SELECT currency, amount_minor::bigint AS amount_minor FROM book_prices WHERE book_edition_id=$1 AND effective_to IS NULL ORDER BY currency`),
      q(`SELECT f.format::text AS format, v.version_number, v.processing_status::text AS status, v.rejection_reason, v.size_bytes::bigint AS size_bytes, v.metadata, (f.current_version_id=v.id) AS is_current
           FROM book_formats f JOIN book_format_versions v ON v.book_format_id=f.id WHERE f.book_edition_id=$1 ORDER BY v.created_at DESC LIMIT 20`),
      q(`SELECT k.id, k.status, k.start_at, k.end_at, k.commission_bps, (SELECT json_agg(json_build_object('country_code', t.country_code, 'permission_type', t.permission_type) ORDER BY t.country_code) FROM rights_territories t WHERE t.contract_id=k.id) AS territories
           FROM rights_contracts k WHERE k.book_edition_id=$1 ORDER BY k.start_at DESC`),
      q(`SELECT action, actor_type, reason, created_at FROM audit_log WHERE target_type='edition' AND target_id=$1::text ORDER BY id DESC LIMIT 30`),
    ]);
    return { ...e, prices: prices.map((x) => ({ ...x, amount_minor: Number(x.amount_minor) })), formats: formats.map((x) => ({ ...x, size_bytes: Number(x.size_bytes) })), contracts, history };
  }

  async contentJobs() {
    return (await this.db.query(
      `SELECT j.id, j.stage, j.status, j.attempts, j.last_error, v.id AS format_version_id, v.processing_status, f.format, f.book_edition_id
         FROM content_processing_jobs j JOIN book_format_versions v ON v.id=j.format_version_id JOIN book_formats f ON f.id=v.book_format_id
        ORDER BY j.updated_at DESC LIMIT 200`)).rows;
  }
}
