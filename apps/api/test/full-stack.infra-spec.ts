import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { requireInfra, eventually } from './infra-env';

// A configuração tem de estar no ambiente ANTES de a aplicação ser criada.
requireInfra(['RABBITMQ_URL', 'S3_ENDPOINT', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']);
const bucket = `drp-fs-${Date.now()}`;
Object.assign(process.env, { S3_BUCKET: bucket, S3_REGION: 'us-east-1', S3_FORCE_PATH_STYLE: 'true', RABBITMQ_PREFIX: `fs${Date.now()}`, RABBITMQ_RETRY_DELAY_MS: '150', RABBITMQ_MAX_RETRIES: '3' });

import { setup, publishBook, auth, makeEpub, sha, Ctx } from './helpers';
import { signFake } from '../src/payments/fake.provider';
import { OutboxRelay } from '../src/events/outbox-relay.service';
import { StorageService } from '../src/storage/storage.service';

describe('Pilha completa: PostgreSQL + RabbitMQ + S3 reais', () => {
  let ctx: Ctx; let admin: any, pub: any, buyer: any; let ed: any; let draft: string; // draft: edição em DRAFT para testar uploads
  beforeAll(async () => {
    await new S3Client({ region: 'us-east-1', endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }).send(new CreateBucketCommand({ Bucket: bucket }));
    ctx = await setup();
    admin = await ctx.newUser('fadmin', ['admin_catalog']); pub = await ctx.newUser('fpub'); buyer = await ctx.newUser('fbuyer');
    ed = await publishBook(ctx, admin, pub, { title: `Full Stack ${ctx.run}`, usd: 800 });
    draft = (await request(ctx.http).post('/v1/publisher/books').set(auth(pub.token)).send({ publisher_id: ed.publisherId, title: `Rascunho ${ctx.run}`, language_code: 'pt', prices: [{ currency: 'USD', amount_minor: 100 }] }).expect(201)).body.edition_id;
  });
  afterAll(async () => { await ctx.app.close(); await ctx.pool.end(); });

  const intent = (editionId: string, kind: string, buf: Buffer, declared = sha(buf)) =>
    request(ctx.http).post(`/v1/publisher/books/${editionId}/assets`).set(auth(pub.token)).send({ kind, mime_type: 'application/epub+zip', size_bytes: buf.length, checksum_sha256: declared }).expect(201).then((r) => r.body);
  const putDirect = (i: any, buf: Buffer) => fetch(i.url, { method: 'PUT', headers: i.headers, body: buf });
  const complete = (token: string, who = pub) => request(ctx.http).post('/v1/uploads/complete').set(auth(who.token)).send({ upload_token: token });

  it('o upload é DIRECTO ao bucket: a API devolve URL pré-assinada e o ficheiro final fica no S3', async () => {
    const storage = ctx.app.get(StorageService);
    const key = (await ctx.pool.query(`SELECT v.storage_key k FROM book_format_versions v JOIN book_formats f ON f.id=v.book_format_id WHERE f.book_edition_id=$1`, [ed.editionId])).rows[0].k;
    expect(Buffer.compare(await storage.get(key), ed.epub)).toBe(0);
  });

  it('upload inválido directo: 422 e o staging é apagado', async () => {
    const bad = await makeEpub('Mau', { badMimetype: true }); const i = await intent(draft, 'EPUB', bad);
    expect((await putDirect(i, bad)).ok).toBe(true);
    const storage = ctx.app.get(StorageService); const stagingKey = JSON.parse(Buffer.from(i.upload_token.split('.')[1], 'base64url').toString()).key;
    expect(await storage.head(stagingKey)).not.toBeNull();
    expect((await complete(i.upload_token)).status).toBe(422);
    expect(await storage.head(stagingKey)).toBeNull();
  });

  it('tamanho carregado ≠ declarado é rejeitado e o staging apagado; sem upload → 404; token de outro → 401', async () => {
    const good = await makeEpub('Tamanho'); const i = await intent(draft, 'EPUB', good);
    await putDirect(i, Buffer.concat([good, Buffer.from('lixo')]));
    expect([413, 422]).toContain((await complete(i.upload_token)).status);
    expect((await complete(i.upload_token)).status).toBe(404); // staging já limpo
    const j = await intent(draft, 'EPUB', good); expect((await complete(j.upload_token)).status).toBe(404); // nunca carregado
    await putDirect(j, good); expect((await complete(j.upload_token, buyer)).status).toBe(401); // outro utilizador
  });

  it('o mesmo conteúdo reenviado é idempotente (sem duplicar versões)', async () => {
    const count = async () => (await ctx.pool.query(`SELECT count(*)::int n FROM book_format_versions v JOIN book_formats f ON f.id=v.book_format_id WHERE f.book_edition_id=$1 AND v.processing_status='READY'`, [draft])).rows[0].n;
    const first = await intent(draft, 'EPUB', ed.epub); await putDirect(first, ed.epub);
    expect((await complete(first.upload_token)).body.duplicate).toBeUndefined(); const before = await count();
    const i = await intent(draft, 'EPUB', ed.epub); await putDirect(i, ed.epub);
    const r = await complete(i.upload_token); expect(r.status).toBe(201); expect(r.body.duplicate).toBe(true);
    expect(await count()).toBe(before);
  });

  it('compra → webhook → outbox → RabbitMQ → entitlement (assíncrono) → leitura do ficheiro vindo do S3', async () => {
    const o = (await request(ctx.http).post('/v1/orders').set(auth(buyer.token)).set('Idempotency-Key', `k-${randomUUID()}`).send({ edition_ids: [ed.editionId], currency: 'USD', billing_country: 'MZ' }).expect(201)).body.id;
    const pid = (await request(ctx.http).post('/v1/payments/checkout').set(auth(buyer.token)).set('Idempotency-Key', `k-${randomUUID()}`).send({ order_id: o, method: 'fake' }).expect(201)).body.payment_id;
    const { rows } = await ctx.pool.query(`SELECT provider_reference ref, amount_minor FROM payment_attempts WHERE id=$1`, [pid]);
    const raw = JSON.stringify({ id: `evt_${randomUUID()}`, type: 'payment.succeeded', reference: rows[0].ref, amount_minor: Number(rows[0].amount_minor), currency: 'USD' });
    const ts = String(Math.floor(Date.now() / 1000));
    await request(ctx.http).post('/v1/webhooks/fake').set('Content-Type', 'application/json').set('x-fake-timestamp', ts).set('x-fake-signature', signFake(raw, ts)).send(raw).expect(202);
    expect((await request(ctx.http).get(`/v1/orders/${o}`).set(auth(buyer.token))).body.status).toBe('PAID'); // ainda sem direito: falta o broker
    expect(await ctx.app.get(OutboxRelay).relayOnce()).toBeGreaterThanOrEqual(1);
    await eventually(async () => (await request(ctx.http).get(`/v1/orders/${o}`).set(auth(buyer.token))).body.status === 'FULFILLED', 10000); // chegou via RabbitMQ
    const g = (await request(ctx.http).get(`/v1/library/${ed.editionId}/access`).set(auth(buyer.token)).expect(200)).body;
    const file = await request(ctx.http).get(g.manifest_url).buffer(true).parse((res, cb) => { const ch: Buffer[] = []; res.on('data', (d: Buffer) => ch.push(d)); res.on('end', () => cb(null, Buffer.concat(ch))); }).expect(200);
    expect(Buffer.compare(file.body, ed.epub)).toBe(0);
    expect((await ctx.pool.query(`SELECT count(*)::int n FROM entitlements WHERE user_id=$1`, [buyer.id])).rows[0].n).toBe(1);
    expect((await ctx.pool.query(`SELECT count(*)::int n FROM royalty_ledger rl JOIN order_items oi ON oi.id=rl.order_item_id WHERE oi.order_id=$1`, [o])).rows[0].n).toBe(1);
  });

  it('/health reporta o estado do broker', async () => { expect((await request(ctx.http).get('/v1/health').expect(200)).body).toEqual({ status: 'ok', broker: true }); });
});
