import request from 'supertest';
import { randomUUID } from 'crypto';
import { setup, publishBook, auth, Ctx } from './helpers';
import { signFake } from '../src/payments/fake.provider';
import { OutboxRelay } from '../src/events/outbox-relay.service';

describe('Reading: progresso sincronizado, anotações e preferências (e2e, PostgreSQL real)', () => {
  let ctx: Ctx; let admin: any, pub: any, reader: any, other: any, nobody: any; let editionId: string;
  const L = (href: string, p = 0.1) => ({ href, type: 'application/xhtml+xml', locations: { progression: p } });

  async function buy(user: any, edId: string) {
    const o = (await request(ctx.http).post('/v1/orders').set(auth(user.token)).set('Idempotency-Key', `k-${randomUUID()}`).send({ edition_ids: [edId], currency: 'USD', billing_country: 'MZ' }).expect(201)).body.id;
    const p = (await request(ctx.http).post('/v1/payments/checkout').set(auth(user.token)).set('Idempotency-Key', `k-${randomUUID()}`).send({ order_id: o, method: 'fake' }).expect(201)).body.payment_id;
    const { rows } = await ctx.pool.query(`SELECT provider_reference ref, amount_minor FROM payment_attempts WHERE id=$1`, [p]);
    const raw = JSON.stringify({ id: `evt_${randomUUID()}`, type: 'payment.succeeded', reference: rows[0].ref, amount_minor: Number(rows[0].amount_minor), currency: 'USD' });
    const ts = String(Math.floor(Date.now() / 1000));
    await request(ctx.http).post('/v1/webhooks/fake').set('Content-Type', 'application/json').set('x-fake-timestamp', ts).set('x-fake-signature', signFake(raw, ts)).send(raw).expect(202);
    const relay = ctx.app.get(OutboxRelay); while (await relay.relayOnce()) { /* drena */ }
  }
  const prog = (u: any, body: object) => request(ctx.http).put(`/v1/reading/${editionId}/progress`).set(auth(u.token)).send(body);

  beforeAll(async () => {
    ctx = await setup();
    admin = await ctx.newUser('radmin', ['admin_catalog']); pub = await ctx.newUser('rpub'); reader = await ctx.newUser('reader'); other = await ctx.newUser('rother'); nobody = await ctx.newUser('nobody');
    editionId = (await publishBook(ctx, admin, pub, { title: `Leitura ${ctx.run}`, usd: 300 })).editionId;
    await buy(reader, editionId); await buy(other, editionId);
  });
  afterAll(async () => { await ctx.pool.end(); await ctx.app.close(); });

  it('sem direito de acesso: 403 em tudo o que é por-edição', async () => {
    await request(ctx.http).get(`/v1/reading/${editionId}/progress`).set(auth(nobody.token)).expect(403);
    await prog(nobody, { locator: L('c1.xhtml'), progress_percent: 5, base_version: 0 }).expect(403);
    await request(ctx.http).post(`/v1/reading/${editionId}/bookmarks`).set(auth(nobody.token)).send({ locator: L('c1.xhtml') }).expect(403);
    await request(ctx.http).post(`/v1/reading/${editionId}/session`).set(auth(nobody.token)).send({}).expect(403);
  });

  it('valida entradas (locator sem href, percentagem fora de 0..100)', async () => {
    await request(ctx.http).get(`/v1/reading/${editionId}/progress`).set(auth(reader.token)).expect(404); // ainda sem progresso
    await prog(reader, { locator: { type: 'x' }, progress_percent: 5, base_version: 0 }).expect(400);
    await prog(reader, { locator: L('c1.xhtml'), progress_percent: 150, base_version: 0 }).expect(422);
  });

  let v1: any, v2: any;
  it('AC-10: dispositivo A grava; B lê e continua; A desactualizado não sobrescreve', async () => {
    v1 = (await prog(reader, { locator: L('c1.xhtml', 0.2), progress_percent: 10, base_version: 0 }).expect(200)).body; // A (web)
    expect(v1.version).toBe(1);
    const seenByB = (await request(ctx.http).get(`/v1/reading/${editionId}/progress`).set(auth(reader.token)).expect(200)).body; // B (android)
    expect(seenByB.locator.href).toBe('c1.xhtml'); expect(seenByB.version).toBe(1);
    v2 = (await prog(reader, { locator: L('c5.xhtml', 0.9), progress_percent: 60, base_version: 1 }).expect(200)).body; // B avança
    expect(v2.version).toBe(2);
    const stale = await prog(reader, { locator: L('c1.xhtml', 0.3), progress_percent: 12, base_version: 1 }).expect(409); // A volta com versão antiga
    expect(stale.body.current).toMatchObject({ version: 2, progress_percent: 60 }); expect(stale.body.current.locator.href).toBe('c5.xhtml');
    expect((await request(ctx.http).get(`/v1/reading/${editionId}/progress`).set(auth(reader.token))).body.progress_percent).toBe(60); // não foi sobrescrito
  });

  it('primeira escrita repetida (base_version 0) também dá conflito', async () => {
    await prog(reader, { locator: L('c9.xhtml'), progress_percent: 99, base_version: 0 }).expect(409);
  });

  it('escritas concorrentes com a mesma versão base: exactamente uma vence', async () => {
    const rs = await Promise.all([1, 2, 3, 4].map((i) => prog(reader, { locator: L(`c${i}.xhtml`), progress_percent: 60 + i, base_version: 2 })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1); expect(rs.filter((r) => r.status === 409)).toHaveLength(3);
    expect((await request(ctx.http).get(`/v1/reading/${editionId}/progress`).set(auth(reader.token))).body.version).toBe(3);
  });

  it('isolamento: o progresso de um utilizador é independente do de outro', async () => {
    expect((await prog(other, { locator: L('c2.xhtml'), progress_percent: 20, base_version: 0 }).expect(200)).body.version).toBe(1);
    expect((await request(ctx.http).get('/v1/library').set(auth(reader.token))).body[0].progress_percent).toBeGreaterThan(60);
    expect((await request(ctx.http).get('/v1/library').set(auth(other.token))).body[0].progress_percent).toBe(20);
  });

  it('marcadores e destaques com nota; sync incremental inclui apagados', async () => {
    const before = new Date().toISOString(); await new Promise((r) => setTimeout(r, 20));
    const bm = (await request(ctx.http).post(`/v1/reading/${editionId}/bookmarks`).set(auth(reader.token)).send({ locator: L('c3.xhtml'), title: 'Importante' }).expect(201)).body;
    const hl = (await request(ctx.http).post(`/v1/reading/${editionId}/highlights`).set(auth(reader.token)).send({ locator: L('c3.xhtml'), selected_text: 'uma frase', color: 'yellow', note: 'minha nota' }).expect(201)).body;
    expect(hl.annotation_id).toBeTruthy();
    const full = (await request(ctx.http).get(`/v1/reading/${editionId}/annotations`).set(auth(reader.token)).expect(200)).body;
    expect(full.bookmarks).toHaveLength(1); expect(full.highlights[0].selected_text).toBe('uma frase'); expect(full.notes[0].content).toBe('minha nota');
    expect((await request(ctx.http).get(`/v1/reading/${editionId}/annotations`).set(auth(other.token))).body.bookmarks).toHaveLength(0); // não vê as de outro
    await request(ctx.http).delete(`/v1/reading/${editionId}/bookmarks/${bm.id}`).set(auth(other.token)).expect(404); // não apaga as de outro
    await request(ctx.http).delete(`/v1/reading/${editionId}/bookmarks/${bm.id}`).set(auth(reader.token)).expect(204);
    await request(ctx.http).delete(`/v1/reading/${editionId}/highlights/${hl.id}`).set(auth(reader.token)).expect(204);
    const after = (await request(ctx.http).get(`/v1/reading/${editionId}/annotations`).set(auth(reader.token))).body;
    expect(after.bookmarks).toHaveLength(0); expect(after.highlights).toHaveLength(0); expect(after.notes).toHaveLength(0);
    const delta = (await request(ctx.http).get(`/v1/reading/${editionId}/annotations`).query({ since: before }).set(auth(reader.token))).body;
    expect(delta.bookmarks[0].deleted_at).toBeTruthy(); expect(delta.highlights[0].deleted_at).toBeTruthy(); expect(delta.notes[0].deleted_at).toBeTruthy();
  });

  it('sessão de leitura e preferências', async () => {
    expect((await request(ctx.http).post(`/v1/reading/${editionId}/session`).set(auth(reader.token)).send({}).expect(201)).body.id).toBeTruthy();
    await request(ctx.http).put('/v1/reading/preferences').set(auth(reader.token)).send({ theme: 'DARK', font_size: 18 }).expect(200);
    const p = (await request(ctx.http).put('/v1/reading/preferences').set(auth(reader.token)).send({ line_spacing: 1.5 }).expect(200)).body;
    expect(p).toMatchObject({ theme: 'DARK', font_size: 18, line_spacing: 1.5 }); // actualização parcial preserva o resto
    await request(ctx.http).put('/v1/reading/preferences').set(auth(reader.token)).send({ theme: 'NEON' }).expect(422);
  });

  it('direito revogado: perde acesso à leitura/sync (os dados guardados permanecem)', async () => {
    await ctx.pool.query(`UPDATE entitlements SET status='REVOKED', revoked_at=now(), revocation_reason='teste', revoked_by=$2 WHERE user_id=$1 AND book_edition_id=$3`, [other.id, admin.id, editionId]);
    await request(ctx.http).get(`/v1/reading/${editionId}/progress`).set(auth(other.token)).expect(403);
    expect((await ctx.pool.query(`SELECT count(*)::int n FROM reading_progress WHERE user_id=$1`, [other.id])).rows[0].n).toBe(1);
  });
});
