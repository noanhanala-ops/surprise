import { BadRequestException, ConflictException, Injectable, NotFoundException, PayloadTooLargeException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'crypto';
import { AuditService } from '../common/audit.service';
import { DbService } from '../common/db.service';
import { StorageService } from '../storage/storage.service';
import { Kind, validate } from './validators';

const FORMAT: Record<string, 'EPUB' | 'PDF' | 'COMIC'> = { EPUB: 'EPUB', PDF: 'PDF', COMIC: 'COMIC' };
const ASSET: Record<string, 'COVER' | 'PREVIEW'> = { COVER: 'COVER', PREVIEW: 'PREVIEW' };

@Injectable()
export class UploadService {
  constructor(private db: DbService, private jwt: JwtService, private storage: StorageService, private audit: AuditService) {}

  private async verify(token: string, purpose: string) {
    let t: any;
    try { t = await this.jwt.verifyAsync(token); } catch { throw new UnauthorizedException('URL de upload inválida ou expirada'); }
    if (t.purpose !== purpose) throw new UnauthorizedException();
    return t;
  }

  /** Modo proxy (dev): a API recebe os bytes via PUT. */
  async receive(token: string, body: Buffer) {
    const t = await this.verify(token, 'upload');
    if (!Buffer.isBuffer(body) || !body.length) throw new BadRequestException('Corpo vazio (use Content-Type: application/octet-stream)');
    return this.process(t, body);
  }

  /** Modo directo (produção): o cliente já carregou para o staging do bucket; validamos e promovemos. */
  async complete(userId: string, token: string) {
    const t = await this.verify(token, 'upload-direct');
    if (t.sub !== userId) throw new UnauthorizedException();
    const head = await this.storage.head(t.key);
    if (!head) throw new NotFoundException('Ficheiro não encontrado no staging (já processado, ou não carregado)');
    try {
      if (head.size !== t.size) throw new PayloadTooLargeException('Tamanho diferente do declarado');
      return await this.process(t, await this.storage.get(t.key));
    } finally { await this.storage.delete(t.key).catch(() => undefined); } // o staging nunca fica para trás
  }

  private async process(t: any, body: Buffer) {
    if (body.length !== t.size) throw new PayloadTooLargeException('Tamanho diferente do declarado');
    const sha = createHash('sha256').update(body).digest();
    if (sha.toString('hex') !== t.sha) throw new UnprocessableEntityException('Checksum SHA-256 não corresponde ao declarado');

    const kind = t.kind as Kind;
    const v = await validate(kind, body);
    if (FORMAT[kind]) return this.saveFormat(t, FORMAT[kind], body, sha, v);
    if (ASSET[kind]) {
      if (!v.ok) throw new UnprocessableEntityException(v.reason);
      const key = `editions/${t.ed}/assets/${kind.toLowerCase()}-${sha.toString('hex').slice(0, 16)}`;
      await this.storage.put(key, body, t.mime);
      const r = await this.db.query(
        `INSERT INTO book_assets (book_edition_id, asset_type, storage_key, mime_type, size_bytes, is_public) VALUES ($1,$2,$3,$4,$5,true)
         ON CONFLICT (storage_key) DO UPDATE SET mime_type=EXCLUDED.mime_type RETURNING id`, [t.ed, kind, key, t.mime, body.length]);
      return { asset_id: r.rows[0].id, status: 'READY' };
    }
    throw new UnprocessableEntityException(`Tipo ${kind} ainda não suportado`);
  }

  private async saveFormat(t: any, format: 'EPUB' | 'PDF' | 'COMIC', body: Buffer, sha: Buffer, v: { ok: boolean; reason?: string; metadata?: any }) {
    // Endereçamento por conteúdo: grava o ficheiro ANTES da BD (idempotente), para nunca existir versão READY sem ficheiro.
    const okKey = `editions/${t.ed}/${format.toLowerCase()}/${sha.toString('hex')}`;
    if (v.ok) {
      // Reenvio do mesmo conteúdo: devolve a versão existente (idempotente) em vez de violar UNIQUE(storage_key).
      const dup = await this.db.query(`SELECT v.id FROM book_format_versions v WHERE v.storage_key=$1`, [okKey]);
      if (dup.rowCount) return { format_version_id: dup.rows[0].id, status: 'READY', metadata: v.metadata, duplicate: true };
      await this.storage.put(okKey, body);
    }
    const res = await this.db.tx(async (c) => {
      const f = await c.query(
        `INSERT INTO book_formats (book_edition_id, format) VALUES ($1,$2) ON CONFLICT (book_edition_id, format) DO UPDATE SET format=EXCLUDED.format RETURNING id`, [t.ed, format]);
      const fid = f.rows[0].id;
      const n = (await c.query(`SELECT COALESCE(MAX(version_number),0)+1 AS n FROM book_format_versions WHERE book_format_id=$1`, [fid])).rows[0].n;
      const key = v.ok ? okKey : `rejected/${randomUUID()}`;
      const ver = await c.query(
        `INSERT INTO book_format_versions (book_format_id, version_number, storage_key, checksum_sha256, size_bytes, processing_status, rejection_reason, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [fid, n, key, sha, body.length, v.ok ? 'READY' : 'REJECTED', v.ok ? null : v.reason, JSON.stringify(v.metadata ?? {})]);
      await c.query(`INSERT INTO content_processing_jobs (format_version_id, stage, status, attempts, last_error) VALUES ($1,'VALIDATE',$2,1,$3)`,
        [ver.rows[0].id, v.ok ? 'DONE' : 'FAILED', v.ok ? null : v.reason]);
      if (v.ok) await c.query(`UPDATE book_formats SET current_version_id=$2 WHERE id=$1`, [fid, ver.rows[0].id]);
      await this.audit.log({ actorId: t.sub, actorType: 'PUBLISHER', action: v.ok ? 'content.upload.ready' : 'content.upload.rejected', targetType: 'format_version', targetId: ver.rows[0].id, reason: v.reason }, c);
      return { format_version_id: ver.rows[0].id as string, key };
    });
    if (!v.ok) throw new UnprocessableEntityException({ message: v.reason, format_version_id: res.format_version_id });
    return { format_version_id: res.format_version_id, status: 'READY', metadata: v.metadata };
  }
}
