import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { PoolClient } from 'pg';
import { AuditService } from '../common/audit.service';
import { DbService, Queryable } from '../common/db.service';
import { MoneyDto, PublisherBookInput, RegisterPublisherDto, UploadIntentDto } from './dto';

const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'livro';
const suffix = () => randomBytes(3).toString('hex');
const WRITE_ROLES = ['OWNER', 'EDITOR'];

@Injectable()
export class PublisherService {
  constructor(private db: DbService, private audit: AuditService, private jwt: JwtService) {}

  async registerPublisher(userId: string, dto: RegisterPublisherDto) {
    return this.db.tx(async (c) => {
      const slug = `${slugify(dto.display_name)}-${suffix()}`;
      const p = await c.query(
        `INSERT INTO publishers (legal_name, display_name, slug, country_code, is_individual_author) VALUES ($1,$2,$3,$4,$5) RETURNING id, status`,
        [dto.legal_name, dto.display_name, slug, dto.country_code.toUpperCase(), dto.is_individual_author ?? false]);
      await c.query(`INSERT INTO publisher_users (publisher_id, user_id, role) VALUES ($1,$2,'OWNER')`, [p.rows[0].id, userId]);
      await c.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name='publisher_owner' ON CONFLICT DO NOTHING`, [userId]);
      await this.audit.log({ actorId: userId, actorType: 'PUBLISHER', action: 'publisher.register', targetType: 'publisher', targetId: p.rows[0].id }, c);
      return p.rows[0];
    });
  }

  /** Resolve a editora do utilizador (explícita ou única) e confirma papel de escrita. */
  private async membership(c: Queryable, userId: string, publisherId?: string) {
    const r = await c.query(
      `SELECT pu.publisher_id, pu.role, p.status FROM publisher_users pu JOIN publishers p ON p.id = pu.publisher_id
        WHERE pu.user_id=$1 AND ($2::uuid IS NULL OR pu.publisher_id=$2)`, [userId, publisherId ?? null]);
    if (!r.rowCount) throw new ForbiddenException('Sem editora associada');
    if (r.rowCount > 1) throw new BadRequestException('publisher_id é obrigatório (pertence a várias editoras)');
    const m = r.rows[0];
    if (!WRITE_ROLES.includes(m.role)) throw new ForbiddenException('Papel sem permissão de escrita');
    if (m.status !== 'ACTIVE') throw new ForbiddenException('Editora ainda não aprovada');
    return m as { publisher_id: string; role: string; status: string };
  }

  /** Edição pertencente a uma editora do utilizador, senão 404 (não revela existência). */
  private async ownEdition(c: Queryable, userId: string, editionId: string, lock = false) {
    const r = await c.query(
      `SELECT e.id, e.status, e.publisher_id, e.book_id FROM book_editions e
         JOIN publisher_users pu ON pu.publisher_id = e.publisher_id AND pu.user_id = $1 AND pu.role = ANY($3)
        WHERE e.id=$2 ${lock ? 'FOR UPDATE OF e' : ''}`, [userId, editionId, WRITE_ROLES]);
    if (!r.rowCount) throw new NotFoundException();
    return r.rows[0] as { id: string; status: string; publisher_id: string; book_id: string };
  }

  async createBook(userId: string, dto: PublisherBookInput) {
    return this.db.tx(async (c) => {
      const m = await this.membership(c, userId, dto.publisher_id);
      const book = await c.query(`INSERT INTO books (slug, title, description, original_language) VALUES ($1,$2,$3,$4) RETURNING id, slug`,
        [`${slugify(dto.title)}-${suffix()}`, dto.title, dto.description ?? null, dto.language_code]);
      let ed;
      try {
        ed = await c.query(`INSERT INTO book_editions (book_id, publisher_id, isbn, language_code) VALUES ($1,$2,$3,$4) RETURNING id, status`,
          [book.rows[0].id, m.publisher_id, dto.isbn ?? null, dto.language_code]);
      } catch (e: any) { if (e.code === '23505') throw new ConflictException('ISBN já registado'); throw e; }
      const id = ed.rows[0].id;
      await c.query(`INSERT INTO book_languages (book_id, language_code) VALUES ($1,$2)`, [book.rows[0].id, dto.language_code]);
      await this.setRelations(c, id, dto);
      await this.audit.log({ actorId: userId, actorType: 'PUBLISHER', action: 'edition.create', targetType: 'edition', targetId: id }, c);
      return { book_id: book.rows[0].id, slug: book.rows[0].slug, edition_id: id, status: ed.rows[0].status };
    });
  }

  async updateBook(userId: string, editionId: string, dto: PublisherBookInput) {
    return this.db.tx(async (c) => {
      const ed = await this.ownEdition(c, userId, editionId, true);
      if (ed.status !== 'DRAFT') throw new ConflictException('Só edições em DRAFT podem ser editadas');
      await c.query(`UPDATE books SET title=$2, description=$3 WHERE id=$1`, [ed.book_id, dto.title, dto.description ?? null]);
      await c.query(`UPDATE book_editions SET isbn=$2 WHERE id=$1`, [editionId, dto.isbn ?? null]);
      await this.setRelations(c, editionId, dto);
      await this.audit.log({ actorId: userId, actorType: 'PUBLISHER', action: 'edition.update', targetType: 'edition', targetId: editionId }, c);
      return { edition_id: editionId };
    });
  }

  private async setRelations(c: PoolClient, editionId: string, dto: PublisherBookInput) {
    if (dto.author_ids) {
      await c.query(`DELETE FROM book_authors WHERE book_edition_id=$1`, [editionId]);
      for (const [i, a] of dto.author_ids.entries()) await c.query(`INSERT INTO book_authors (book_edition_id, author_id, position) VALUES ($1,$2,$3)`, [editionId, a, i]);
    }
    if (dto.category_ids) {
      await c.query(`DELETE FROM book_categories WHERE book_edition_id=$1`, [editionId]);
      for (const cat of dto.category_ids) await c.query(`INSERT INTO book_categories (book_edition_id, category_id) VALUES ($1,$2)`, [editionId, cat]);
    }
    for (const p of dto.prices ?? []) await this.setPrice(c, editionId, p);
  }

  /** Fecha o preço vigente e abre um novo (sem sobreposição — exclusion constraint). Compras passadas não são afectadas (snapshot). */
  private async setPrice(c: PoolClient, editionId: string, p: MoneyDto) {
    await c.query(`UPDATE book_prices SET effective_to = now() WHERE book_edition_id=$1 AND currency=$2 AND effective_to IS NULL AND effective_from < now()`, [editionId, p.currency]);
    await c.query(`DELETE FROM book_prices WHERE book_edition_id=$1 AND currency=$2 AND effective_to IS NULL AND effective_from >= now()`, [editionId, p.currency]);
    await c.query(`INSERT INTO book_prices (book_edition_id, currency, amount_minor, effective_from) VALUES ($1,$2,$3, now())`, [editionId, p.currency, p.amount_minor]);
  }

  /** Gera uma "URL pré-assinada" (token JWT de curta duração). Em produção aponta para o bucket privado (S3/R2). */
  async uploadIntent(userId: string, editionId: string, dto: UploadIntentDto, baseUrl: string) {
    const ed = await this.ownEdition(this.db, userId, editionId);
    if (!['DRAFT', 'IN_REVIEW'].includes(ed.status)) throw new ConflictException('Edição já publicada: crie uma nova versão');
    const token = await this.jwt.signAsync({ purpose: 'upload', sub: userId, ed: editionId, kind: dto.kind, size: dto.size_bytes, sha: dto.checksum_sha256.toLowerCase(), mime: dto.mime_type }, { expiresIn: '15m' });
    return { url: `${baseUrl}/v1/uploads/${token}`, method: 'PUT', expires_at: new Date(Date.now() + 15 * 60_000).toISOString() };
  }

  async submit(userId: string, editionId: string) {
    return this.db.tx(async (c) => {
      const ed = await this.ownEdition(c, userId, editionId, true);
      if (ed.status !== 'DRAFT') throw new ConflictException('Só edições em DRAFT podem ser submetidas');
      const fmt = await c.query(`SELECT 1 FROM book_formats f JOIN book_format_versions v ON v.id=f.current_version_id AND v.processing_status='READY' WHERE f.book_edition_id=$1`, [editionId]);
      if (!fmt.rowCount) throw new UnprocessableEntityException('Carregue pelo menos um ficheiro válido (formato READY)');
      const pr = await c.query(`SELECT 1 FROM book_prices WHERE book_edition_id=$1 AND effective_to IS NULL`, [editionId]);
      if (!pr.rowCount) throw new UnprocessableEntityException('Defina pelo menos um preço');
      await c.query(`UPDATE book_editions SET status='IN_REVIEW' WHERE id=$1`, [editionId]);
      await this.audit.log({ actorId: userId, actorType: 'PUBLISHER', action: 'edition.submit', targetType: 'edition', targetId: editionId }, c);
      return { edition_id: editionId, status: 'IN_REVIEW' };
    });
  }

  async myBooks(userId: string) {
    return (await this.db.query(
      `SELECT e.id AS edition_id, b.title, b.slug, e.status, e.language_code FROM book_editions e JOIN books b ON b.id=e.book_id
         JOIN publisher_users pu ON pu.publisher_id=e.publisher_id AND pu.user_id=$1 ORDER BY e.created_at DESC LIMIT 200`, [userId])).rows;
  }
}
