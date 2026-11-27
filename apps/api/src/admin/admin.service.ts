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

  async contentJobs() {
    return (await this.db.query(
      `SELECT j.id, j.stage, j.status, j.attempts, j.last_error, v.id AS format_version_id, v.processing_status, f.format, f.book_edition_id
         FROM content_processing_jobs j JOIN book_format_versions v ON v.id=j.format_version_id JOIN book_formats f ON f.id=v.book_format_id
        ORDER BY j.updated_at DESC LIMIT 200`)).rows;
  }
}
