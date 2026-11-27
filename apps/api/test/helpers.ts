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
process.env.SANDBOX_MODE = 'true';
// Os limites por IP/conta são testados em security.e2e-spec.ts; aqui não atrapalham (todos os pedidos vêm de 127.0.0.1).
for (const k of ['RATE_LOGIN_IP', 'RATE_REGISTER_IP']) process.env[k] ??= '100000';
process.env.OUTBOX_POLL_MS = '0'; // testes accionam o relay explicitamente

import { AppModule } from '../src/app.module';
import { totp, base32Decode } from '../src/identity/totp';
import { configureApp } from '../src/setup';

export const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
export const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
export const password = 'correct horse battery';

export { makeEpub, makeRichEpub, makePng } from '../fixtures/epub';
import { makeEpub } from '../fixtures/epub';

export const totpNow = (secretB32: string, offsetSteps = 0) => totp(base32Decode(secretB32), Date.now() + offsetSteps * 30_000);
export const isAdminRole = (r: string) => r.startsWith('admin_') || r === 'super_admin';
export interface TestUser { email: string; token: string; id: string; mfaSecret?: string; recoveryCodes?: string[] }
export interface Ctx { app: INestApplication; pool: Pool; http: any; run: number; newUser: (tag: string, roles?: string[]) => Promise<TestUser> }

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
    let token = (await request(http).post('/v1/auth/login').send({ email, password }).expect(200)).body.access_token as string;
    const id = (await pool.query(`SELECT id FROM users WHERE email=$1`, [email])).rows[0].id as string;
    if (!roles.some(isAdminRole)) return { email, token, id };
    // Administradores têm de usar MFA: inscreve e confirma (a confirmação devolve um token com MFA verificado).
    const enr = (await request(http).post('/v1/auth/mfa/enroll').set(auth(token)).expect(200)).body;
    const conf = (await request(http).post('/v1/auth/mfa/confirm').set(auth(token)).send({ code: totpNow(enr.secret) }).expect(200)).body;
    return { email, token: conf.access_token as string, id, mfaSecret: enr.secret as string, recoveryCodes: conf.recovery_codes as string[] };
  }
  return { app, pool, http, run, newUser };
}

/** Publica uma edição de ponta a ponta (publisher + admin). Devolve ids e o EPUB enviado. */
export async function publishBook(ctx: Ctx, admin: { token: string }, pub: { token: string }, o: { title: string; usd: number; epub?: Buffer; cover?: Buffer; commissionBps?: number; countries?: { country_code: string; permission_type: 'SELL' | 'DENY' }[]; publisherId?: string }) {
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
  if (o.cover) {
    const ci = (await request(http).post(`/v1/publisher/books/${b.edition_id}/assets`).set(auth(pub.token)).send({ kind: 'COVER', mime_type: 'image/png', size_bytes: o.cover.length, checksum_sha256: sha(o.cover) }).expect(201)).body;
    if (ci.mode === 'direct') { await fetch(ci.url, { method: 'PUT', headers: ci.headers, body: o.cover }); await request(http).post('/v1/uploads/complete').set(auth(pub.token)).send({ upload_token: ci.upload_token }).expect(201); }
    else await request(http).put(new URL(ci.url).pathname).set('Content-Type', 'application/octet-stream').send(o.cover).expect(201);
  }
  await request(http).post(`/v1/publisher/books/${b.edition_id}/submit`).set(auth(pub.token)).expect(200);
  await request(http).post('/v1/admin/contracts').set(auth(admin.token)).send({ edition_id: b.edition_id, commission_bps: o.commissionBps ?? 3000, start_at: new Date(Date.now() - 86400000).toISOString(),
    territories: o.countries ?? [{ country_code: 'WW', permission_type: 'SELL' }] }).expect(201);
  await request(http).post(`/v1/admin/books/${b.edition_id}/approve`).set(auth(admin.token)).expect(200);
  return { editionId: b.edition_id as string, slug: b.slug as string, publisherId: publisherId!, epub };
}
