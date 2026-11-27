import request from 'supertest';
import { setup, publishBook, buyBook, auth, makeEpub, sha, Ctx } from './helpers';
import { OutboxRelay } from '../src/events/outbox-relay.service';

describe('APIs dos portais: editora (detalhe, vendas, royalties, contratos) e administração (filas de revisão)', () => {
  let ctx: Ctx; let admin: any, pub: any, editor: any, other: any, cust: any, b1: any, b2: any;
  let pubId: string; let published: { editionId: string };
  const drain = async () => { const r = ctx.app.get(OutboxRelay); while (await r.relayOnce()) { /* drena */ } };
  const upload = async (token: string, editionId: string, buf: Buffer, declared = sha(buf)) => {
    const i = (await request(ctx.http).post(`/v1/publisher/books/${editionId}/assets`).set(auth(token)).send({ kind: 'EPUB', mime_type: 'application/epub+zip', size_bytes: buf.length, checksum_sha256: declared }).expect(201)).body;
    return request(ctx.http).put(new URL(i.url).pathname).set('Content-Type', 'application/octet-stream').send(buf);
  };

  beforeAll(async () => {
    ctx = await setup();
    admin = await ctx.newUser('padm', ['admin_catalog', 'admin_finance']); pub = await ctx.newUser('ppub'); editor = await ctx.newUser('pedit'); other = await ctx.newUser('poth');
    cust = await ctx.newUser('pcust'); b1 = await ctx.newUser('pb1'); b2 = await ctx.newUser('pb2');
    published = await publishBook(ctx, admin, pub, { title: `Portal ${ctx.run}`, usd: 1000, commissionBps: 3000 });
    pubId = published['publisherId' as never] as string;
    await ctx.pool.query(`INSERT INTO publisher_users (publisher_id, user_id, role) VALUES ($1,$2,'EDITOR')`, [pubId, editor.id]);
  });
  afterAll(async () => { await ctx.pool.end(); await ctx.app.close(); });

  describe('editora', () => {
    it('/publisher/me lista as editoras do utilizador com o papel', async () => {
      const r = (await request(ctx.http).get('/v1/publisher/me').set(auth(pub.token)).expect(200)).body;
      expect(r).toEqual([expect.objectContaining({ id: pubId, status: 'ACTIVE', role: 'OWNER' })]);
      expect((await request(ctx.http).get('/v1/publisher/me').set(auth(cust.token)).expect(200)).body).toEqual([]);
    });

    let draft: string;
    it('detalhe de edição: preços, ficheiros rejeitados (com motivo) e válidos (metadados), capa e isolamento entre editoras', async () => {
      draft = (await request(ctx.http).post('/v1/publisher/books').set(auth(pub.token)).send({ publisher_id: pubId, title: `Rascunho ${ctx.run}`, language_code: 'pt', prices: [{ currency: 'USD', amount_minor: 500 }, { currency: 'MZN', amount_minor: 32000 }] }).expect(201)).body.edition_id;
      let d = (await request(ctx.http).get(`/v1/publisher/books/${draft}`).set(auth(pub.token)).expect(200)).body;
      expect(d).toMatchObject({ status: 'DRAFT', title: `Rascunho ${ctx.run}`, formats: [], last_rejection: null }); expect(d.prices).toEqual([{ currency: 'MZN', amount_minor: 32000 }, { currency: 'USD', amount_minor: 500 }]);
      expect((await upload(pub.token, draft, await makeEpub('Mau', { badMimetype: true }))).status).toBe(422);
      await upload(pub.token, draft, await makeEpub('Bom')).then((r) => expect(r.status).toBe(201));
      d = (await request(ctx.http).get(`/v1/publisher/books/${draft}`).set(auth(pub.token))).body;
      expect(d.formats.map((f: any) => [f.format, f.status, f.is_current])).toEqual(expect.arrayContaining([['EPUB', 'REJECTED', false], ['EPUB', 'READY', true]]));
      expect(d.formats.find((f: any) => f.status === 'REJECTED').rejection_reason).toMatch(/mimetype/);
      await request(ctx.http).get(`/v1/publisher/books/${draft}`).set(auth(other.token)).expect(403); // sem editora
      await request(ctx.http).get(`/v1/publisher/books/${draft}`).set(auth(cust.token)).expect(403);
      const stranger = await ctx.newUser('pstr'); const own = (await request(ctx.http).post('/v1/publisher/register').set(auth(stranger.token)).send({ legal_name: 'Outra Lda', display_name: 'Outra', country_code: 'MZ' }).expect(201)).body.id;
      await request(ctx.http).post(`/v1/admin/publishers/${own}/approve`).set(auth(admin.token)).expect(204);
      await request(ctx.http).get(`/v1/publisher/books/${draft}`).set(auth(stranger.token)).expect(404); // outra editora: não vê
    });

    it('revisão: fila do admin → detalhe → rejeitar com motivo → editora vê o motivo → volta a submeter', async () => {
      await request(ctx.http).post(`/v1/publisher/books/${draft}/submit`).set(auth(pub.token)).expect(200);
      const q = (await request(ctx.http).get('/v1/admin/books?status=IN_REVIEW').set(auth(admin.token)).expect(200)).body;
      expect(q.find((x: any) => x.id === draft)).toMatchObject({ publisher: expect.any(String), has_contract: false, prices: 2 });
      await request(ctx.http).get('/v1/admin/books?status=IN_REVIEW').set(auth(cust.token)).expect(403);
      const ad = (await request(ctx.http).get(`/v1/admin/books/${draft}`).set(auth(admin.token)).expect(200)).body;
      expect(ad.formats.find((f: any) => f.status === 'READY').metadata).toMatchObject({ title: 'Bom', language: 'pt' }); expect(ad.history.map((h: any) => h.action)).toEqual(expect.arrayContaining(['edition.submit']));
      await request(ctx.http).post(`/v1/admin/books/${draft}/reject`).set(auth(admin.token)).send({ reason: 'Falta a página de direitos de autor' }).expect(204);
      const d = (await request(ctx.http).get(`/v1/publisher/books/${draft}`).set(auth(pub.token))).body;
      expect(d.status).toBe('DRAFT'); expect(d.last_rejection.reason).toBe('Falta a página de direitos de autor');
      await request(ctx.http).post(`/v1/publisher/books/${draft}/submit`).set(auth(pub.token)).expect(200);
      expect((await request(ctx.http).get('/v1/admin/books?status=IN_REVIEW').set(auth(admin.token))).body.some((x: any) => x.id === draft)).toBe(true);
    });

    it('administração: editoras pendentes (com e-mail do dono) → aprovar → saem da fila', async () => {
      const np = await ctx.newUser('ppend'); const id = (await request(ctx.http).post('/v1/publisher/register').set(auth(np.token)).send({ legal_name: 'Pendente Lda', display_name: 'Pendente', country_code: 'PT' }).expect(201)).body.id;
      const l = (await request(ctx.http).get('/v1/admin/publishers').set(auth(admin.token)).expect(200)).body;
      expect(l.find((p: any) => p.id === id)).toMatchObject({ owner_email: np.email, status: 'PENDING', country_code: 'PT' });
      await request(ctx.http).get('/v1/admin/publishers').set(auth(cust.token)).expect(403);
      await request(ctx.http).post(`/v1/admin/publishers/${id}/approve`).set(auth(admin.token)).expect(204);
      expect((await request(ctx.http).get('/v1/admin/publishers').set(auth(admin.token))).body.some((p: any) => p.id === id)).toBe(false);
    });
  });

  describe('relatórios da editora (vendas, royalties, contratos)', () => {
    let refundOrder: string;
    it('vendas e royalties reflectem compras e reembolsos; estorno proporcional no saldo', async () => {
      const o1 = await buyBook(ctx, b1, published.editionId); refundOrder = await buyBook(ctx, b2, published.editionId);
      await drain();
      let sales = (await request(ctx.http).get('/v1/publisher/sales').set(auth(pub.token)).expect(200)).body.find((s: any) => s.edition_id === published.editionId);
      expect(sales).toMatchObject({ units: 2, gross_minor: 2000, refunded_units: 0, currency: 'USD' });
      let roy = (await request(ctx.http).get('/v1/publisher/royalties').set(auth(pub.token)).expect(200)).body;
      expect(roy.balances.find((b: any) => b.currency === 'USD').accrued_minor).toBe(1400); // 2 × 70% de 1000
      expect(roy.ledger[0]).toMatchObject({ percentage_bps: 7000, amount_minor: 700, eligible_minor: 1000, adjustments_minor: 0 });
      // reembolso do b2 (decidido pelo admin com MFA recente)
      await request(ctx.http).post(`/v1/orders/${refundOrder}/refund-requests`).set(auth(b2.token)).set('Idempotency-Key', 'k-refund-portal-1').send({ reason: 'Comprei por engano' }).expect(202);
      const list = (await request(ctx.http).get('/v1/admin/refunds').set(auth(admin.token)).expect(200)).body;
      const rf = list.find((x: any) => x.order_id === refundOrder); expect(rf).toMatchObject({ customer_email: b2.email, title: expect.stringContaining('Portal'), amount_minor: 1000, currency: 'USD', is_duplicate: false, status: 'REQUESTED' });
      await request(ctx.http).post(`/v1/admin/refunds/${rf.id}/decision`).set(auth(admin.token)).send({ decision: 'APPROVE', reason: 'Dentro do prazo de 14 dias', revoke_entitlement: true, legal_basis: 'Livre resolução' }).expect(200);
      await drain();
      sales = (await request(ctx.http).get('/v1/publisher/sales').set(auth(pub.token))).body.find((s: any) => s.edition_id === published.editionId);
      expect(sales).toMatchObject({ units: 2, refunded_units: 1 });
      roy = (await request(ctx.http).get('/v1/publisher/royalties').set(auth(pub.token))).body;
      expect(roy.balances.find((b: any) => b.currency === 'USD').accrued_minor).toBe(700); // 1400 − 700 estornados
      expect(roy.ledger.some((l: any) => l.adjustments_minor === -700)).toBe(true);
      expect(o1).toBeTruthy();
    });
    it('royalties/pagamentos só para OWNER/FINANCE; vendas e contratos também para EDITOR; outsiders 403', async () => {
      await request(ctx.http).get('/v1/publisher/royalties').set(auth(editor.token)).expect(403);
      await request(ctx.http).get('/v1/publisher/payouts').set(auth(editor.token)).expect(403);
      await request(ctx.http).get('/v1/publisher/sales').set(auth(editor.token)).expect(200);
      expect((await request(ctx.http).get('/v1/publisher/contracts').set(auth(editor.token)).expect(200)).body[0]).toMatchObject({ commission_bps: 3000, status: 'ACTIVE', territories: [{ country_code: 'WW', permission_type: 'SELL' }] });
      expect((await request(ctx.http).get('/v1/publisher/payouts').set(auth(pub.token)).expect(200)).body).toEqual([]);
      for (const p of ['sales', 'royalties', 'payouts', 'contracts']) await request(ctx.http).get(`/v1/publisher/${p}`).set(auth(cust.token)).expect(403);
    });
    it('os dados de uma editora nunca aparecem a outra', async () => {
      const x = await ctx.newUser('pother2'); const id = (await request(ctx.http).post('/v1/publisher/register').set(auth(x.token)).send({ legal_name: 'Xis Lda', display_name: 'Editora Xis', country_code: 'MZ' }).expect(201)).body.id;
      await request(ctx.http).post(`/v1/admin/publishers/${id}/approve`).set(auth(admin.token)).expect(204);
      expect((await request(ctx.http).get('/v1/publisher/sales').set(auth(x.token)).expect(200)).body).toEqual([]);
      const roy = (await request(ctx.http).get('/v1/publisher/royalties').set(auth(x.token)).expect(200)).body; expect(roy.balances).toEqual([]); expect(roy.ledger).toEqual([]);
      expect((await request(ctx.http).get('/v1/publisher/contracts').set(auth(x.token))).body).toEqual([]);
    });
  });
});
