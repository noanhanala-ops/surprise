import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, Queryable } from '../common/db.service';

export interface Locator { href: string; type?: string; locations?: Record<string, unknown>; text?: unknown }
const checkLocator = (l: any): Locator => {
  if (!l || typeof l !== 'object' || typeof l.href !== 'string' || !l.href || l.href.length > 2000) throw new BadRequestException('locator inválido (Readium Locator com href)');
  return l;
};

/** Progresso e anotações por (utilizador, edição). Estado canónico no servidor, escrita por compare-and-set (ADR/AC-10). */
@Injectable()
export class ReadingService {
  constructor(private db: DbService) {}

  /** Só quem tem direito ACTIVE lê/escreve. A edição pode já não estar no catálogo. */
  private async assertAccess(userId: string, editionId: string, c: Queryable = this.db) {
    const r = await c.query(`SELECT 1 FROM entitlements WHERE user_id=$1 AND book_edition_id=$2 AND status='ACTIVE'`, [userId, editionId]);
    if (!r.rowCount) throw new ForbiddenException('Sem direito de acesso a esta edição');
  }

  async startSession(userId: string, editionId: string, deviceId?: string) {
    await this.assertAccess(userId, editionId);
    const r = await this.db.query(
      `INSERT INTO reading_sessions (user_id, edition_id, device_id) VALUES ($1,$2,(SELECT id FROM user_devices WHERE id=$3 AND user_id=$1 AND revoked_at IS NULL)) RETURNING id, started_at`, [userId, editionId, deviceId ?? null]);
    return r.rows[0];
  }

  private shape = (r: any) => ({ edition_id: r.edition_id, locator: r.locator_json, progress_percent: Number(r.progress_percent), version: Number(r.version), updated_at: r.updated_at });

  async getProgress(userId: string, editionId: string) {
    await this.assertAccess(userId, editionId);
    const r = await this.db.query(`SELECT * FROM reading_progress WHERE user_id=$1 AND edition_id=$2`, [userId, editionId]);
    if (!r.rowCount) throw new NotFoundException('Sem progresso');
    return this.shape(r.rows[0]);
  }

  /**
   * base_version = versão em que o cliente se baseou (0 = primeira escrita).
   * Se divergir do servidor → 409 com o estado canónico; o cliente decide, nunca há sobrescrita silenciosa.
   */
  async putProgress(userId: string, editionId: string, b: { locator: Locator; progress_percent: number; base_version: number; device_id?: string; client_updated_at?: string }) {
    checkLocator(b.locator);
    if (!(b.progress_percent >= 0 && b.progress_percent <= 100)) throw new BadRequestException('progress_percent fora de 0..100');
    if (!Number.isInteger(b.base_version) || b.base_version < 0) throw new BadRequestException('base_version inválido');
    await this.assertAccess(userId, editionId);
    const device = `(SELECT id FROM user_devices WHERE id=$6 AND user_id=$1 AND revoked_at IS NULL)`;
    const params = [userId, editionId, JSON.stringify(b.locator), b.progress_percent, b.client_updated_at ?? null, b.device_id ?? null];
    // Gravação idêntica ao estado actual (mesma versão base): no-op — não sobe a versão, para que abrir o livro noutro
    // dispositivo ou repetir um pedido não provoque conflitos falsos nos restantes.
    const cur0 = (await this.db.query(`SELECT * FROM reading_progress WHERE user_id=$1 AND edition_id=$2`, [userId, editionId])).rows[0];
    if (cur0 && Number(cur0.version) === b.base_version && Number(cur0.progress_percent) === Math.round(b.progress_percent * 100) / 100
        && JSON.stringify(cur0.locator_json) === JSON.stringify(JSON.parse(JSON.stringify(b.locator)))) return this.shape(cur0);
    let r;
    if (b.base_version === 0) {
      r = await this.db.query(
        `INSERT INTO reading_progress (user_id, edition_id, locator_json, progress_percent, client_updated_at, last_device_id) VALUES ($1,$2,$3,$4,$5,${device})
         ON CONFLICT (user_id, edition_id) DO NOTHING RETURNING *`, params);
    } else {
      r = await this.db.query(
        `UPDATE reading_progress SET locator_json=$3, progress_percent=$4, client_updated_at=$5, last_device_id=${device}, version=version+1, updated_at=now()
          WHERE user_id=$1 AND edition_id=$2 AND version=$7 RETURNING *`, [...params, b.base_version]);
    }
    if (r.rowCount) return this.shape(r.rows[0]);
    const cur = await this.db.query(`SELECT * FROM reading_progress WHERE user_id=$1 AND edition_id=$2`, [userId, editionId]);
    throw new ConflictException({ message: 'Conflito de versão', current: cur.rowCount ? this.shape(cur.rows[0]) : null });
  }

  async addBookmark(userId: string, editionId: string, locator: Locator, title?: string) {
    checkLocator(locator); await this.assertAccess(userId, editionId);
    return (await this.db.query(`INSERT INTO bookmarks (user_id, edition_id, locator_json, title) VALUES ($1,$2,$3,$4) RETURNING id, created_at`, [userId, editionId, JSON.stringify(locator), title ?? null])).rows[0];
  }

  async addHighlight(userId: string, editionId: string, locator: Locator, selectedText: string, color?: string, note?: string) {
    checkLocator(locator); await this.assertAccess(userId, editionId);
    return this.db.tx(async (c) => {
      const h = (await c.query(`INSERT INTO highlights (user_id, edition_id, locator_json, selected_text, color) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`, [userId, editionId, JSON.stringify(locator), selectedText, color ?? null])).rows[0];
      let annotationId: string | null = null;
      if (note?.trim()) annotationId = (await c.query(`INSERT INTO annotations (user_id, highlight_id, content) VALUES ($1,$2,$3) RETURNING id`, [userId, h.id, note])).rows[0].id;
      return { ...h, annotation_id: annotationId };
    });
  }

  /** Altera a cor e/ou a nota de um destaque. `note: ''` apaga a nota. Sobe a versão (sincronização). */
  async updateHighlight(userId: string, editionId: string, id: string, p: { color?: string; note?: string }) {
    await this.assertAccess(userId, editionId);
    return this.db.tx(async (c) => {
      const h = await c.query(`UPDATE highlights SET color=COALESCE($4,color), version=version+1 WHERE id=$1 AND user_id=$2 AND edition_id=$3 AND deleted_at IS NULL RETURNING id, version`, [id, userId, editionId, p.color ?? null]);
      if (!h.rowCount) throw new NotFoundException();
      if (p.note !== undefined) {
        const txt = p.note.trim();
        const cur = (await c.query(`SELECT id FROM annotations WHERE highlight_id=$1 AND user_id=$2 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1`, [id, userId])).rows[0];
        if (!txt && cur) await c.query(`UPDATE annotations SET deleted_at=now(), version=version+1 WHERE id=$1`, [cur.id]);
        else if (txt && cur) await c.query(`UPDATE annotations SET content=$2, version=version+1, updated_at=now() WHERE id=$1`, [cur.id, txt]);
        else if (txt) await c.query(`INSERT INTO annotations (user_id, highlight_id, content) VALUES ($1,$2,$3)`, [userId, id, txt]);
      }
      return { id: h.rows[0].id, version: Number(h.rows[0].version) };
    });
  }

  /** Remoção lógica (para propagar a outros dispositivos). Só do próprio utilizador. */
  async remove(userId: string, editionId: string, kind: 'bookmarks' | 'highlights', id: string) {
    await this.assertAccess(userId, editionId);
    const r = await this.db.tx(async (c) => {
      const d = await c.query(`UPDATE ${kind} SET deleted_at=now(), version=version+1 WHERE id=$1 AND user_id=$2 AND edition_id=$3 AND deleted_at IS NULL RETURNING id`, [id, userId, editionId]);
      if (d.rowCount && kind === 'highlights') await c.query(`UPDATE annotations SET deleted_at=now(), version=version+1 WHERE highlight_id=$1 AND deleted_at IS NULL`, [id]);
      return d.rowCount;
    });
    if (!r) throw new NotFoundException();
  }

  /** `since`: devolve alterações (incl. apagadas) depois dessa data, para sincronização incremental. */
  async annotations(userId: string, editionId: string, since?: string) {
    await this.assertAccess(userId, editionId);
    const s = since ? new Date(since) : null; if (s && isNaN(+s)) throw new BadRequestException('since inválido');
    const q = (sql: string) => this.db.query(sql, [userId, editionId, s]).then((r) => r.rows);
    return {
      bookmarks: await q(`SELECT id, locator_json AS locator, title, version, created_at, deleted_at FROM bookmarks WHERE user_id=$1 AND edition_id=$2 AND ($3::timestamptz IS NULL AND deleted_at IS NULL OR created_at>$3 OR deleted_at>$3) ORDER BY created_at`),
      highlights: await q(`SELECT id, locator_json AS locator, selected_text, color, version, created_at, deleted_at FROM highlights WHERE user_id=$1 AND edition_id=$2 AND ($3::timestamptz IS NULL AND deleted_at IS NULL OR created_at>$3 OR deleted_at>$3) ORDER BY created_at`),
      notes: await q(`SELECT a.id, a.highlight_id, a.content, a.version, a.updated_at, a.deleted_at FROM annotations a JOIN highlights h ON h.id=a.highlight_id
                       WHERE a.user_id=$1 AND h.edition_id=$2 AND ($3::timestamptz IS NULL AND a.deleted_at IS NULL OR a.updated_at>$3 OR a.deleted_at>$3) ORDER BY a.updated_at`),
    };
  }

  async getPreferences(userId: string) {
    return (await this.db.query(`SELECT font_family, font_size, theme, line_spacing::float AS line_spacing FROM reading_preferences WHERE user_id=$1`, [userId])).rows[0] ?? {};
  }
  async putPreferences(userId: string, p: { font_family?: string; font_size?: number; theme?: string; line_spacing?: number }) {
    await this.db.query(
      `INSERT INTO reading_preferences (user_id, font_family, font_size, theme, line_spacing) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id) DO UPDATE SET font_family=COALESCE($2, reading_preferences.font_family), font_size=COALESCE($3, reading_preferences.font_size),
         theme=COALESCE($4, reading_preferences.theme), line_spacing=COALESCE($5, reading_preferences.line_spacing), updated_at=now()`,
      [userId, p.font_family ?? null, p.font_size ?? null, p.theme ?? null, p.line_spacing ?? null]);
    return this.getPreferences(userId);
  }
}
