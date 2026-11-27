import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../common/db.service';
import { StorageService } from '../storage/storage.service';

/** Leitura pública. Só mostra edições PUBLISHED e vendáveis no país do pedido (AC-04). */
@Injectable()
export class CatalogService {
  constructor(private db: DbService, private storage: StorageService) {}

  private editionsSql(where: string) {
    return `SELECT e.id, e.book_id, e.isbn, e.language_code, e.publisher_id, b.slug, b.title, b.description,
              (SELECT COALESCE(array_agg(f.format::text ORDER BY f.format), '{}'::text[]) FROM book_formats f JOIN book_format_versions v ON v.id=f.current_version_id AND v.processing_status='READY' WHERE f.book_edition_id=e.id) AS formats,
              (SELECT json_build_object('amount_minor', p.amount_minor, 'currency', p.currency) FROM book_prices p
                WHERE p.book_edition_id=e.id AND p.currency=$2 AND p.effective_from<=now() AND (p.effective_to IS NULL OR p.effective_to>now()) LIMIT 1) AS price
            ,EXISTS (SELECT 1 FROM book_assets a WHERE a.book_edition_id=e.id AND a.asset_type='COVER' AND a.is_public) AS has_cover
            FROM book_editions e JOIN books b ON b.id=e.book_id
           WHERE e.status='PUBLISHED' AND edition_sellable_in(e.id, $1) ${where}`;
  }

  async list(country: string, currency: string, limit: number, cursor?: string, category?: string, language?: string) {
    const after = cursor ? Buffer.from(cursor, 'base64url').toString() : '';
    const r = await this.db.query(
      this.editionsSql(`AND b.slug > $3 AND ($4::text IS NULL OR e.language_code=$4)
        AND ($5::text IS NULL OR EXISTS (SELECT 1 FROM book_categories bc JOIN categories c ON c.id=bc.category_id WHERE bc.book_edition_id=e.id AND c.slug=$5))
        ORDER BY b.slug LIMIT $6`),
      [country, currency, after, language ?? null, category ?? null, limit + 1]);
    const rows = r.rows.slice(0, limit);
    return { items: rows.map(this.shape), next_cursor: r.rows.length > limit ? Buffer.from(rows[rows.length - 1].slug).toString('base64url') : null };
  }

  async bySlug(slug: string, country: string, currency: string) {
    const r = await this.db.query(this.editionsSql(`AND b.slug=$3`), [country, currency, slug]);
    if (!r.rowCount) throw new NotFoundException(); // inexistente OU não disponível no país: indistinguível
    return { ...this.shape(r.rows[0]), editions: r.rows.map(this.shape) };
  }

  async editions(bookId: string, country: string, currency: string) {
    const r = await this.db.query(this.editionsSql(`AND e.book_id=$3`), [country, currency, bookId]);
    return r.rows.map(this.shape);
  }

  async categories() {
    return (await this.db.query(`SELECT id, parent_id, name, slug FROM categories ORDER BY name`)).rows;
  }

  private shape = (r: any) => ({ id: r.book_id, edition_id: r.id, slug: r.slug, title: r.title, description: r.description, isbn: r.isbn,
    language_code: r.language_code, publisher_id: r.publisher_id, formats: r.formats, price: r.price, purchasable: !!r.price,
    cover_url: r.has_cover ? `/v1/covers/${r.id}` : null });

  /** Capa pública da edição (só de edições PUBLISHED e vendáveis no país — não revela rascunhos). */
  async cover(editionId: string, country: string) {
    const r = await this.db.query(
      `SELECT a.storage_key, a.mime_type FROM book_assets a JOIN book_editions e ON e.id=a.book_edition_id
        WHERE a.book_edition_id=$1 AND a.asset_type='COVER' AND a.is_public AND e.status='PUBLISHED' AND edition_sellable_in(e.id,$2) ORDER BY a.created_at DESC LIMIT 1`, [editionId, country]);
    if (!r.rowCount) throw new NotFoundException();
    const data = await this.storage.get(r.rows[0].storage_key);
    const png = data[0] === 0x89; const webp = data.subarray(0, 4).toString() === 'RIFF';
    return { data, type: png ? 'image/png' : webp ? 'image/webp' : 'image/jpeg' }; // tipo pelo conteúdo validado, não pelo declarado
  }
}
