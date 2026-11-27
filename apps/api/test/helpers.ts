import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Pool } from 'pg';
import JSZip from 'jszip';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';

process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123';
process.env.DATABASE_URL ??= 'postgres://postgres@localhost:5544/drp';
process.env.STORAGE_DIR ??= join(tmpdir(), `drp-storage-${Date.now()}`);
process.env.OUTBOX_POLL_MS = '0'; // testes accionam o relay explicitamente

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/setup';

export const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
export const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
export const password = 'correct horse battery';

export async function makeEpub(title: string, opts: { badMimetype?: boolean } = {}) {
  const z = new JSZip();
  z.file('mimetype', opts.badMimetype ? 'text/plain' : 'application/epub+zip');
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:language>pt</dc:language><dc:identifier>urn:uuid:1</dc:identifier></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`);
  z.file('OEBPS/c1.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Olá</p></body></html>');
  return z.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' });
}

/** EPUB 3 realista: nav com TOC aninhado, capa, 3 capítulos (um grande → várias posições), ficheiro com espaço no nome. */
export async function makeRichEpub(title: string) {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip');
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file('META-INF/encryption.xml', '<encryption/>');
  z.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf"><dc:identifier id="id">urn:uuid:rich-1</dc:identifier><dc:title>${title}</dc:title><dc:creator>Mia Couto</dc:creator><dc:creator>Outro Autor</dc:creator><dc:language>pt</dc:language><dc:publisher>Editora X</dc:publisher><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="cap%20dois.xhtml" media-type="application/xhtml+xml"/><item id="c3" href="text/c3.xhtml" media-type="application/xhtml+xml"/><item id="css" href="style.css" media-type="text/css"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/></spine></package>`);
  z.file('OEBPS/nav.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">Capítulo <i>Um</i></a></li><li><a href="cap%20dois.xhtml">Capítulo Dois</a><ol><li><a href="cap%20dois.xhtml#s1">Secção 2.1</a></li></ol></li><li><a href="text/c3.xhtml">Capítulo Três</a></li></ol></nav><nav epub:type="landmarks"><ol><li><a href="c1.xhtml">Início</a></li></ol></nav></body></html>`);
  z.file('OEBPS/images/cover.png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]));
  z.file('OEBPS/style.css', 'body{font-family:serif}');
  const para = '<p>' + 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(40) + '</p>';
  z.file('OEBPS/c1.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>1</title></head><body><h1>Um</h1>${para.repeat(30)}</body></html>`, { compression: 'STORE' });
  z.file('OEBPS/cap dois.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1 id="s1">Dois</h1>${para}</body></html>`);
  z.file('OEBPS/text/c3.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Três</h1><p>Fim.</p></body></html>');
  return z.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' });
}

export interface Ctx { app: INestApplication; pool: Pool; http: any; run: number; newUser: (tag: string, roles?: string[]) => Promise<{ email: string; token: string; id: string }> }

export async function setup(): Promise<Ctx> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(mod.createNestApplication({ rawBody: true })); await app.init();
  const http = app.getHttpServer(); const run = Date.now() + Math.floor(Math.random() * 1000);
  async function newUser(tag: string, roles: string[] = []) {
    const email = `${tag}${run}@cat.test`;
    await request(http).post('/v1/auth/register').send({ email, password, display_name: tag, country_code: 'MZ' }).expect(201);
    const { rows } = await pool.query(`SELECT payload->>'token' t FROM outbox_events WHERE payload->>'email'=$1`, [email]);
    await request(http).post('/v1/auth/verify-email').send({ token: rows[0].t }).expect(204);
    for (const r of roles) await pool.query(`INSERT INTO user_roles SELECT u.id, r.id FROM users u, roles r WHERE u.email=$1 AND r.name=$2`, [email, r]);
    const token = (await request(http).post('/v1/auth/login').send({ email, password }).expect(200)).body.access_token as string;
    return { email, token, id: (await pool.query(`SELECT id FROM users WHERE email=$1`, [email])).rows[0].id as string };
  }
  return { app, pool, http, run, newUser };
}

/** Publica uma edição de ponta a ponta (publisher + admin). Devolve ids e o EPUB enviado. */
export async function publishBook(ctx: Ctx, admin: { token: string }, pub: { token: string }, o: { title: string; usd: number; epub?: Buffer; commissionBps?: number; countries?: { country_code: string; permission_type: 'SELL' | 'DENY' }[]; publisherId?: string }) {
  const { http } = ctx;
  let publisherId = o.publisherId;
  if (!publisherId) {
    publisherId = (await request(http).post('/v1/publisher/register').set(auth(pub.token)).send({ legal_name: `${o.title} Lda`, display_name: o.title, country_code: 'MZ' }).expect(201)).body.id;
    await request(http).post(`/v1/admin/publishers/${publisherId}/approve`).set(auth(admin.token)).expect(204);
  }
  const b = (await request(http).post('/v1/publisher/books').set(auth(pub.token)).send({ publisher_id: publisherId, title: o.title, language_code: 'pt', prices: [{ currency: 'USD', amount_minor: o.usd }] }).expect(201)).body;
  const epub = o.epub ?? await makeEpub(o.title);
  const intent = (await request(http).post(`/v1/publisher/books/${b.edition_id}/assets`).set(auth(pub.token)).send({ kind: 'EPUB', mime_type: 'application/epub+zip', size_bytes: epub.length, checksum_sha256: sha(epub) }).expect(201)).body;
  if (intent.mode === 'direct') { // produção: PUT directo ao bucket + completar
    const put = await fetch(intent.url, { method: 'PUT', headers: intent.headers, body: epub }); if (!put.ok) throw new Error(`PUT ao bucket falhou: ${put.status}`);
    await request(http).post('/v1/uploads/complete').set(auth(pub.token)).send({ upload_token: intent.upload_token }).expect(201);
  } else await request(http).put(new URL(intent.url).pathname).set('Content-Type', 'application/octet-stream').send(epub).expect(201);
  await request(http).post(`/v1/publisher/books/${b.edition_id}/submit`).set(auth(pub.token)).expect(200);
  await request(http).post('/v1/admin/contracts').set(auth(admin.token)).send({ edition_id: b.edition_id, commission_bps: o.commissionBps ?? 3000, start_at: new Date(Date.now() - 86400000).toISOString(),
    territories: o.countries ?? [{ country_code: 'WW', permission_type: 'SELL' }] }).expect(201);
  await request(http).post(`/v1/admin/books/${b.edition_id}/approve`).set(auth(admin.token)).expect(200);
  return { editionId: b.edition_id as string, slug: b.slug as string, publisherId: publisherId!, epub };
}
