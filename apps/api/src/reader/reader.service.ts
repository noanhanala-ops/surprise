import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import JSZip from 'jszip';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { StorageService } from '../storage/storage.service';
import { parseEpub, ParsedPublication } from './epub-publication';

interface Cached { zip: JSZip; pub: ParsedPublication }
const MAX_CACHE = Number(process.env.READER_CACHE_ENTRIES ?? 8);

/**
 * O Readium assume que cada documento tem <head> (a spec EPUB exige-o, mas há EPUBs reais sem ele).
 * Normalizamos na entrega em vez de rejeitar o livro: insere um <head> vazio logo após <html>.
 */
export function ensureHead(buf: Buffer): Buffer {
  const src = buf.toString('utf8');
  if (/<head[\s>\/]/i.test(src)) return buf;
  const out = src.replace(/(<html\b[^>]*>)/i, '$1<head><title></title></head>');
  return out === src ? buf : Buffer.from(out, 'utf8');
}

/** Servidor de publicação controlado (ADR-0007): só serve recursos do EPUB a quem tem direito ACTIVE no momento do pedido. */
@Injectable()
export class ReaderService {
  private cache = new Map<string, Promise<Cached>>(); // chave de storage é endereçada por hash ⇒ imutável ⇒ cache seguro
  constructor(private ent: EntitlementsService, private storage: StorageService) {}

  private async load(token: string): Promise<Cached> {
    const f = await this.ent.resolveContent(token, 'read'); // revalida o direito em CADA pedido
    if (f.format !== 'EPUB') throw new NotFoundException('Formato não suportado por este leitor');
    let p = this.cache.get(f.storage_key);
    if (p) { this.cache.delete(f.storage_key); this.cache.set(f.storage_key, p); } // LRU
    else {
      p = (async () => { const zip = await JSZip.loadAsync(await this.storage.get(f.storage_key)); return { zip, pub: await parseEpub(zip) }; })();
      this.cache.set(f.storage_key, p); p.catch(() => this.cache.delete(f.storage_key));
      while (this.cache.size > MAX_CACHE) this.cache.delete(this.cache.keys().next().value!);
    }
    return p;
  }

  async manifest(token: string) { return (await this.load(token)).pub.manifest; }
  async positions(token: string) { return (await this.load(token)).pub.positions; }

  /** Só recursos declarados no manifesto do EPUB (nunca META-INF/encryption.xml, etc.). */
  async resource(token: string, rawPath: string) {
    const { zip, pub } = await this.load(token);
    const path = rawPath.split('/').map((s) => { try { return decodeURIComponent(s); } catch { return s; } }).join('/');
    if (path.includes('..')) throw new ForbiddenException();
    const res = pub.resources.get(path); const file = res && zip.file(path);
    if (!res || !file) throw new NotFoundException();
    let data = await file.async('nodebuffer');
    if (res.type === 'application/xhtml+xml' || res.type === 'text/html') data = ensureHead(data);
    return { type: res.type, data };
  }
}
