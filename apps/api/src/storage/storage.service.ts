import { Injectable } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'fs/promises';
import * as path from 'path';

/** Porta de armazenamento. Dev: disco local. Produção: adaptador S3/R2 (bucket PRIVADO) com a mesma interface. */
export abstract class StorageService {
  abstract put(key: string, data: Buffer): Promise<void>;
  abstract get(key: string): Promise<Buffer>;
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
}
