import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DbService } from '../common/db.service';

@Injectable()
export class EntitlementsService {
  constructor(private db: DbService, private jwt: JwtService) {}

  async library(userId: string, limit: number) {
    const r = await this.db.query(
      `SELECT en.id AS entitlement_id, e.id AS edition_id, b.title, b.slug,
              (SELECT COALESCE(array_agg(f.format::text ORDER BY f.format), '{}'::text[]) FROM book_formats f JOIN book_format_versions v ON v.id=f.current_version_id AND v.processing_status='READY' WHERE f.book_edition_id=e.id) AS formats,
              (SELECT progress_percent FROM reading_progress rp WHERE rp.user_id=en.user_id AND rp.edition_id=e.id) AS progress_percent
         FROM entitlements en JOIN book_editions e ON e.id=en.book_edition_id JOIN books b ON b.id=e.book_id
        WHERE en.user_id=$1 AND en.status IN ('ACTIVE','SUSPENDED') ORDER BY en.granted_at DESC LIMIT $2`, [userId, limit]);
    return r.rows.map((x) => ({ ...x, progress_percent: x.progress_percent == null ? 0 : Number(x.progress_percent) }));
  }

  async list(userId: string) {
    return (await this.db.query(`SELECT id, book_edition_id, status, granted_at, expires_at FROM entitlements WHERE user_id=$1 ORDER BY granted_at DESC`, [userId])).rows;
  }
  async get(userId: string, id: string) {
    const r = await this.db.query(`SELECT id, book_edition_id, status, granted_at, expires_at, revocation_reason FROM entitlements WHERE id=$1 AND user_id=$2`, [id, userId]);
    if (!r.rowCount) throw new NotFoundException(); return r.rows[0];
  }

  /** Concede acesso ao conteúdo: exige direito ACTIVE. Independente do estado da edição no catálogo (AC-09). */
  async access(userId: string, editionId: string, format?: string) {
    const r = await this.db.query(
      `SELECT f.format::text AS format FROM entitlements en JOIN book_formats f ON f.book_edition_id=en.book_edition_id
         JOIN book_format_versions v ON v.id=f.current_version_id AND v.processing_status='READY'
        WHERE en.user_id=$1 AND en.book_edition_id=$2 AND en.status='ACTIVE' AND ($3::text IS NULL OR f.format::text=$3)
        ORDER BY (f.format='EPUB') DESC LIMIT 1`, [userId, editionId, format ?? null]);
    if (!r.rowCount) throw new ForbiddenException('Sem direito de acesso');
    const ttl = 300;
    const token = await this.jwt.signAsync({ purpose: 'content', sub: userId, ed: editionId, fmt: r.rows[0].format }, { expiresIn: ttl });
    return { format: r.rows[0].format, manifest_url: `/v1/content/${token}`, lcp_license_url: null, expires_at: new Date(Date.now() + ttl * 1000).toISOString(), watermark: false };
  }

  /** Resolve o ficheiro; revalida o direito no momento do download (uma revogação tem efeito imediato). */
  async resolveContent(token: string) {
    let t: any; try { t = await this.jwt.verifyAsync(token); } catch { throw new ForbiddenException(); }
    if (t.purpose !== 'content') throw new ForbiddenException();
    const r = await this.db.query(
      `SELECT v.storage_key, f.format::text AS format FROM entitlements en JOIN book_formats f ON f.book_edition_id=en.book_edition_id AND f.format=$3::book_format_type
         JOIN book_format_versions v ON v.id=f.current_version_id AND v.processing_status='READY'
        WHERE en.user_id=$1 AND en.book_edition_id=$2 AND en.status='ACTIVE'`, [t.sub, t.ed, t.fmt]);
    if (!r.rowCount) throw new ForbiddenException();
    return r.rows[0] as { storage_key: string; format: string };
  }
}
