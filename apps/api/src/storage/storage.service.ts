import { Injectable } from '@nestjs/common';
import { mkdir, readFile, rm, stat, writeFile } from 'fs/promises';
import * as path from 'path';

/** Porta de armazenamento. Dev: disco local. Produção: S3/R2 (bucket PRIVADO), com upload directo por URL pré-assinada. */
export abstract class StorageService {
  abstract put(key: string, data: Buffer, contentType?: string): Promise<void>;
  abstract get(key: string): Promise<Buffer>;
  abstract delete(key: string): Promise<void>;
  /** Tamanho do objecto, ou null se não existir. */
  abstract head(key: string): Promise<{ size: number } | null>;
  /** true ⇒ o cliente carrega directamente para o bucket (a API nunca recebe os bytes). */
  supportsDirectUpload(): boolean { return false; }
  async signedPutUrl(_key: string, _o: { ttlSeconds: number; contentType: string; size: number }): Promise<string> { throw new Error('direct upload não suportado'); }
}

@Injectable()
export class LocalStorageService extends StorageService {
  private root = path.resolve(process.env.STORAGE_DIR ?? './.storage');
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error('invalid storage key');
    return p;
  }
  async put(key: string, data: Buffer) { const p = this.resolve(key); await mkdir(path.dirname(p), { recursive: true }); await writeFile(p, data); }
  async get(key: string) { return readFile(this.resolve(key)); }
  async delete(key: string) { await rm(this.resolve(key), { force: true }); }
  async head(key: string) { try { return { size: (await stat(this.resolve(key))).size }; } catch { return null; } }
}
