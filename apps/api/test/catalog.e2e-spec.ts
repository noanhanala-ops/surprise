import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Pool } from 'pg';

import { sha, makeEpub } from './helpers';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/setup';

describe('Catalog / Publisher / Content / Admin (e2e, PostgreSQL real)', () => {
  let app: INestApplication; let pool: Pool; let http: any;
  const run = Date.now();
  const password = 'correct horse battery';
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function newUser(tag: string, roles: string[] = []) {
    const email = `${tag}${run}@cat.test`;
    await request(http).post('/v1/auth/register').send({ email, password, display_name: tag, country_code: 'MZ' }).expect(201);
    const { rows } = await pool.query(`SELECT payload->>'token' t FROM outbox_events WHERE payload->>'email'=$1`, [email]);
    await request(http).post('/v1/auth/verify-email').send({ token: rows[0].t }).expect(204);
    for (const r of roles) await pool.query(`INSERT INTO user_roles SELECT u.id, r.id FROM users u, roles r WHERE u.email=$1 AND r.name=$2`, [email, r]);
    const tk = (await request(http).post('/v1/auth/login').send({ email, password }).expect(200)).body.access_token as string;
    return { email, token: tk };
  }

  let admin: any, pub: any, other: any, customer: any;
  let publisherId: string, editionId: string, slug: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication()); await app.init(); http = app.getHttpServer();
    admin = await newUser('admin', ['admin_catalog']); pub = await newUser('pub'); other = await newUser('other'); customer = await newUser('cust');
  });
  afterAll(async () => { await pool.end(); await app.close(); });

  it('RBAC: cliente não acede a rotas admin (403) e sem token (401)', async () => {
    await request(http).post(`/v1/admin/publishers/${'0'.repeat(8)}-0000-0000-0000-000000000000/approve`).expect(401);
    await request(http).post('/v1/admin/publishers/00000000-0000-0000-0000-000000000000/approve').set(auth(customer.token)).expect(403);
  });

  it('editora nova fica PENDING e não pode criar livros até ser aprovada', async () => {
    const r = await request(http).post('/v1/publisher/register').set(auth(pub.token)).send({ legal_name: 'Editora Teste Lda', display_name: 'Editora Teste', country_code: 'MZ' }).expect(201);
    publisherId = r.body.id; expect(r.body.status).toBe('PENDING');
    await request(http).post('/v1/publisher/books').set(auth(pub.token)).send({ title: 'X', language_code: 'pt' }).expect(403);
    await request(http).post(`/v1/admin/publishers/${publisherId}/approve`).set(auth(admin.token)).expect(204);
  });

  it('cria livro/edição em DRAFT com preço', async () => {
    const r = await request(http).post('/v1/publisher/books').set(auth(pub.token))
      .send({ title: `Mia Couto Teste ${run}`, description: 'Romance', language_code: 'pt', prices: [{ currency: 'USD', amount_minor: 999 }, { currency: 'MZN', amount_minor: 60000 }] }).expect(201);
    editionId = r.body.edition_id; slug = r.body.slug; expect(r.body.status).toBe('DRAFT');
  });

  it('isolamento: outra conta não vê nem altera a edição (404)', async () => {
    await request(http).put(`/v1/publisher/books/${editionId}`).set(auth(other.token)).send({ title: 'Roubado', language_code: 'pt' }).expect(404);
    await request(http).post(`/v1/publisher/books/${editionId}/assets`).set(auth(customer.token)).send({ kind: 'EPUB', mime_type: 'application/epub+zip', size_bytes: 10, checksum_sha256: 'a'.repeat(64) }).expect(404);
  });

  it('não permite submeter sem ficheiro válido', async () => {
    await request(http).post(`/v1/publisher/books/${editionId}/submit`).set(auth(pub.token)).expect(422);
  });

  async function upload(kind: string, buf: Buffer, declaredSha = sha(buf)) {
    const intent = await request(http).post(`/v1/publisher/books/${editionId}/assets`).set(auth(pub.token))
      .send({ kind, mime_type: 'application/octet-stream', size_bytes: buf.length, checksum_sha256: declaredSha }).expect(201);
    const path = new URL(intent.body.url).pathname;
    return request(http).put(path).set('Content-Type', 'application/octet-stream').send(buf);
  }

  it('AC-05: ficheiros inválidos são rejeitados (EPUB mau, PDF falso, checksum errado)', async () => {
    const bad = await upload('EPUB', await makeEpub('Mau', { badMimetype: true }));
    expect(bad.status).toBe(422); expect(bad.body.message).toMatch(/mimetype/);
    expect((await upload('EPUB', Buffer.from('isto não é um zip'))).status).toBe(422);
    expect((await upload('PDF', Buffer.from('not a pdf at all'))).status).toBe(422);
    const good = await makeEpub('Bom');
    expect((await upload('EPUB', good, 'f'.repeat(64))).status).toBe(422); // checksum declarado errado
    const { rows } = await pool.query(`SELECT processing_status FROM book_format_versions v JOIN book_formats f ON f.id=v.book_format_id WHERE f.book_edition_id=$1`, [editionId]);
    expect(rows.every((r) => r.processing_status === 'REJECTED')).toBe(true);
    await request(http).post(`/v1/publisher/books/${editionId}/submit`).set(auth(pub.token)).expect(422); // rejeitados não contam
  });

  it('upload com token adulterado/expirado é recusado', async () => {
    await request(http).put('/v1/uploads/not-a-token').set('Content-Type', 'application/octet-stream').send(Buffer.from('x')).expect(401);
  });

  it('EPUB válido fica READY com metadados; capa PNG aceite', async () => {
    const r = await upload('EPUB', await makeEpub('Terra Sonâmbula'));
    expect(r.status).toBe(201); expect(r.body.metadata.title).toBe('Terra Sonâmbula'); expect(r.body.status).toBe('READY');
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
    expect((await upload('COVER', png)).status).toBe(201);
  });

  it('edição em DRAFT/IN_REVIEW nunca aparece no catálogo público', async () => {
    await request(http).post(`/v1/publisher/books/${editionId}/submit`).set(auth(pub.token)).expect(200);
    const r = await request(http).get('/v1/books').set('x-country', 'MZ').expect(200);
    expect(r.body.items.find((b: any) => b.slug === slug)).toBeUndefined();
  });

  it('aprovação exige contrato de direitos; depois publica', async () => {
    const a = await request(http).post(`/v1/admin/books/${editionId}/approve`).set(auth(admin.token));
    expect(a.status).toBe(422); expect(a.body.message).toMatch(/contrato/);
    await request(http).post('/v1/admin/contracts').set(auth(admin.token)).send({ edition_id: editionId, commission_bps: 3000, start_at: new Date(Date.now() - 86400000).toISOString(),
      territories: [{ country_code: 'WW', permission_type: 'SELL' }, { country_code: 'KP', permission_type: 'DENY' }] }).expect(201);
    await request(http).post(`/v1/admin/books/${editionId}/approve`).set(auth(admin.token)).expect(200);
    await request(http).post(`/v1/admin/books/${editionId}/approve`).set(auth(admin.token)).expect(409); // já publicada
  });

  it('AC-04: catálogo respeita territórios (MZ vê, KP não, desconhecido vê por ser WW)', async () => {
    const mz = await request(http).get('/v1/books?currency=USD').set('x-country', 'MZ').expect(200);
    const item = mz.body.items.find((b: any) => b.slug === slug);
    expect(item.price).toEqual({ amount_minor: 999, currency: 'USD' }); expect(item.formats).toEqual(['EPUB']); expect(item.purchasable).toBe(true);
    const mzn = await request(http).get(`/v1/books/${slug}?currency=MZN`).set('x-country', 'MZ').expect(200);
    expect(mzn.body.price.amount_minor).toBe(60000);
    const kp = await request(http).get('/v1/books').set('x-country', 'KP').expect(200);
    expect(kp.body.items.find((b: any) => b.slug === slug)).toBeUndefined();
    await request(http).get(`/v1/books/${slug}`).set('x-country', 'KP').expect(404);
    expect((await request(http).get('/v1/books').expect(200)).body.items.some((b: any) => b.slug === slug)).toBe(true);
  });

  it('edição publicada não é editável pela editora e mantém um preço vigente por moeda', async () => {
    // edição PUBLISHED não é editável pelo publisher (fluxo de nova versão é outra fase)
    await request(http).put(`/v1/publisher/books/${editionId}`).set(auth(pub.token)).send({ title: 'x', language_code: 'pt' }).expect(409);
    const { rows } = await pool.query(`SELECT count(*)::int n FROM book_prices WHERE book_edition_id=$1 AND effective_to IS NULL`, [editionId]);
    expect(rows[0].n).toBe(2);
  });

  it('mudar o preço de um DRAFT fecha o vigente e abre um novo, sem sobreposição', async () => {
    const b = await request(http).post('/v1/publisher/books').set(auth(pub.token)).send({ title: `Preço ${run}`, language_code: 'pt', prices: [{ currency: 'USD', amount_minor: 500 }] }).expect(201);
    const id = b.body.edition_id;
    await request(http).put(`/v1/publisher/books/${id}`).set(auth(pub.token)).send({ title: `Preço ${run}`, language_code: 'pt', prices: [{ currency: 'USD', amount_minor: 700 }] }).expect(200);
    const { rows } = await pool.query(`SELECT amount_minor, effective_to IS NULL AS current FROM book_prices WHERE book_edition_id=$1 ORDER BY effective_from`, [id]);
    expect(rows.map((r) => [Number(r.amount_minor), r.current])).toEqual([[500, false], [700, true]]);
  });

  it('suspensão retira da loja, é auditada e gera evento no outbox', async () => {
    await request(http).post(`/v1/admin/books/${editionId}/suspend`).set(auth(customer.token)).send({ reason: 'teste' }).expect(403);
    await request(http).post(`/v1/admin/books/${editionId}/suspend`).set(auth(admin.token)).send({ reason: 'Disputa de direitos' }).expect(204);
    await request(http).get(`/v1/books/${slug}`).set('x-country', 'MZ').expect(404);
    const a = await pool.query(`SELECT action, reason FROM audit_log WHERE target_id=$1 ORDER BY id`, [editionId]);
    expect(a.rows.map((r) => r.action)).toEqual(expect.arrayContaining(['edition.create', 'edition.submit', 'edition.approve', 'edition.suspend']));
    const o = await pool.query(`SELECT 1 FROM outbox_events WHERE aggregate_id=$1 AND event_type='EditionStatusChanged'`, [editionId]);
    expect(o.rowCount).toBe(1);
  });

  it('admin vê jobs de processamento incluindo rejeitados', async () => {
    const r = await request(http).get('/v1/admin/content-jobs').set(auth(admin.token)).expect(200);
    expect(r.body.some((j: any) => j.processing_status === 'REJECTED' && j.status === 'FAILED')).toBe(true);
    await request(http).get('/v1/admin/content-jobs').set(auth(pub.token)).expect(403);
  });
});
