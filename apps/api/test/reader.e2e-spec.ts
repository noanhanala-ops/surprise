import request from 'supertest';
import { randomUUID } from 'crypto';
import { setup, publishBook, makeRichEpub, auth, sha, Ctx } from './helpers';

describe('Servidor de publicação Readium: manifesto, posições e recursos (e2e)', () => {
  let ctx: Ctx; let admin: any, pub: any, buyer: any, stranger: any; let ed: any; let base: string; let readToken: string;
  const get = (path: string) => request(ctx.http).get(`/v1/read/${readToken}/${path}`);

  beforeAll(async () => {
    ctx = await setup();
    admin = await ctx.newUser('radm', ['admin_catalog', 'admin_finance']); pub = await ctx.newUser('rpb'); buyer = await ctx.newUser('rbuyer'); stranger = await ctx.newUser('rstr');
    ed = await publishBook(ctx, admin, pub, { title: `Rico ${ctx.run}`, usd: 400, epub: await makeRichEpub(`Rico ${ctx.run}`) });
    // compra pelo caminho SANDBOX (o mesmo que a app web usa)
    const o = (await request(ctx.http).post('/v1/orders').set(auth(buyer.token)).set('Idempotency-Key', `k-${randomUUID()}`).send({ edition_ids: [ed.editionId], currency: 'USD', billing_country: 'MZ' }).expect(201)).body.id;
    const p = (await request(ctx.http).post('/v1/payments/checkout').set(auth(buyer.token)).set('Idempotency-Key', `k-${randomUUID()}`).send({ order_id: o, method: 'fake' }).expect(201)).body.payment_id;
    await request(ctx.http).post(`/v1/dev/fake-pay/${p}`).set(auth(stranger.token)).expect(404); // não paga por outro
    await request(ctx.http).post(`/v1/dev/fake-pay/${p}`).set(auth(buyer.token)).expect(200);
    const g = (await request(ctx.http).get(`/v1/library/${ed.editionId}/access`).set(auth(buyer.token)).expect(200)).body; // sem esperar: o fake-pay já entregou os eventos
    base = g.manifest_url.replace(/manifest\.json$/, ''); readToken = g.manifest_url.split('/')[3];
    expect(g.manifest_url).toMatch(/^\/v1\/read\/.+\/manifest\.json$/);
  });
  afterAll(async () => { await ctx.pool.end(); await ctx.app.close(); });

  it('capa pública: listada no catálogo e servida com o tipo real; invisível se o livro sair da loja', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 7)]);
    const draft = (await request(ctx.http).post('/v1/publisher/books').set(auth(pub.token)).send({ publisher_id: ed.publisherId, title: `Capa ${ctx.run}`, language_code: 'pt', prices: [{ currency: 'USD', amount_minor: 100 }] }).expect(201)).body.edition_id;
    const intent = (await request(ctx.http).post(`/v1/publisher/books/${draft}/assets`).set(auth(pub.token)).send({ kind: 'COVER', mime_type: 'image/png', size_bytes: png.length, checksum_sha256: sha(png) }).expect(201)).body;
    await request(ctx.http).put(new URL(intent.url).pathname).set('Content-Type', 'application/octet-stream').send(png).expect(201);
    await request(ctx.http).get(`/v1/covers/${draft}`).set('x-country', 'MZ').expect(404); // rascunho: não público
    const list = (await request(ctx.http).get('/v1/books?limit=100').set('x-country', 'MZ')).body.items;
    expect(list.find((b: any) => b.edition_id === ed.editionId).cover_url).toBeNull(); // este livro não tem capa
    // publicar um livro com capa
    const b2 = await publishBook(ctx, admin, pub, { title: `ComCapa ${ctx.run}`, usd: 200, publisherId: ed.publisherId, cover: png });
    const c = await request(ctx.http).get(`/v1/covers/${b2.editionId}`).set('x-country', 'MZ').buffer(true).parse((res, cb) => { const ch: Buffer[] = []; res.on('data', (d: Buffer) => ch.push(d)); res.on('end', () => cb(null, Buffer.concat(ch))); }).expect(200).expect('Content-Type', 'image/png').expect('Cache-Control', /public/);
    expect(Buffer.compare(c.body, png)).toBe(0);
    expect((await request(ctx.http).get(`/v1/books/${b2.slug}`).set('x-country', 'MZ')).body.cover_url).toBe(`/v1/covers/${b2.editionId}`);
    await request(ctx.http).post(`/v1/admin/books/${b2.editionId}/suspend`).set(auth(admin.token)).send({ reason: 'teste capa' }).expect(204);
    await request(ctx.http).get(`/v1/covers/${b2.editionId}`).set('x-country', 'MZ').expect(404);
  });

  it('sem direito não há token de leitura', async () => {
    await request(ctx.http).get(`/v1/library/${ed.editionId}/access`).set(auth(stranger.token)).expect(403);
    await request(ctx.http).get('/v1/read/lixo/manifest.json').expect(403);
  });

  it('manifesto Readium: metadados, ordem de leitura, TOC aninhado, capa e ligação às posições', async () => {
    const m = (await get('manifest.json').expect(200).expect('Content-Type', /webpub\+json/).expect('Cache-Control', /no-store/)).body;
    expect(m.metadata).toMatchObject({ title: `Rico ${ctx.run}`, identifier: 'urn:uuid:rich-1', language: ['pt'], author: [{ name: 'Mia Couto' }, { name: 'Outro Autor' }], publisher: { name: 'Editora X' }, readingProgression: 'ltr' });
    expect(m.readingOrder.map((l: any) => l.href)).toEqual(['OEBPS/c1.xhtml', 'OEBPS/cap%20dois.xhtml', 'OEBPS/text/c3.xhtml']);
    expect(m.readingOrder[0]).toMatchObject({ type: 'application/xhtml+xml', title: 'Capítulo Um' });
    expect(m.toc.map((t: any) => t.title)).toEqual(['Capítulo Um', 'Capítulo Dois', 'Capítulo Três']);
    expect(m.toc[1].children).toEqual([{ title: 'Secção 2.1', href: 'OEBPS/cap%20dois.xhtml#s1' }]);
    expect(m.resources.find((r: any) => r.rel === 'cover')).toMatchObject({ href: 'OEBPS/images/cover.png', type: 'image/png' });
    expect(m.resources.map((r: any) => r.href)).toEqual(expect.arrayContaining(['OEBPS/style.css', 'OEBPS/nav.xhtml']));
    expect(m.links).toEqual(expect.arrayContaining([{ rel: 'http://readium.org/positions', href: 'positions.json', type: 'application/vnd.readium.position-list+json' }]));
  });

  it('lista de posições: sequencial, com progressão coerente e mais posições para capítulos maiores', async () => {
    const { total, positions } = (await get('positions.json').expect(200).expect('Content-Type', /position-list/)).body;
    expect(total).toBe(positions.length); expect(total).toBeGreaterThan(3);
    expect(positions.map((p: any) => p.locations.position)).toEqual(positions.map((_: any, i: number) => i + 1));
    const tp = positions.map((p: any) => p.locations.totalProgression); expect([...tp].sort((a, b) => a - b)).toEqual(tp); expect(tp[0]).toBe(0); expect(tp[tp.length - 1]).toBeLessThan(1);
    const per = (h: string) => positions.filter((p: any) => p.href === h).length;
    expect(per('OEBPS/c1.xhtml')).toBeGreaterThan(per('OEBPS/text/c3.xhtml')); expect(per('OEBPS/text/c3.xhtml')).toBe(1);
  });

  it('serve recursos declarados com o tipo certo (incl. nomes com espaço) e nunca ficheiros internos', async () => {
    expect((await get('OEBPS/c1.xhtml').expect(200).expect('Content-Type', /application\/xhtml\+xml/).expect('X-Content-Type-Options', 'nosniff')).text).toContain('<h1>Um</h1>');
    expect((await get('OEBPS/cap%20dois.xhtml').expect(200)).text).toContain('Dois');
    await get('OEBPS/style.css').expect(200).expect('Content-Type', /text\/css/);
    await get('OEBPS/images/cover.png').expect(200).expect('Content-Type', 'image/png');
    await get('META-INF/encryption.xml').expect(404); await get('META-INF/container.xml').expect(404); await get('mimetype').expect(404);
    await get('OEBPS/nao-existe.xhtml').expect(404);
    for (const evil of ['..%2F..%2Fetc%2Fpasswd', 'OEBPS/..%2Fmimetype', '%2e%2e/%2e%2e/x']) expect([403, 404]).toContain((await get(evil)).status);
  });

  it('token de download não serve para leitura e vice-versa; token adulterado é recusado', async () => {
    const g = (await request(ctx.http).get(`/v1/library/${ed.editionId}/access`).set(auth(buyer.token))).body;
    const dl = g.content_url.split('/')[3];
    await request(ctx.http).get(`/v1/read/${dl}/manifest.json`).expect(403);
    await request(ctx.http).get(`/v1/content/${readToken}`).expect(403);
    await request(ctx.http).get(`/v1/read/${readToken}x/manifest.json`).expect(403);
  });

  it('revogar o direito corta a leitura de imediato, mesmo com o token ainda válido', async () => {
    await get('manifest.json').expect(200);
    await ctx.pool.query(`UPDATE entitlements SET status='REVOKED', revoked_at=now(), revocation_reason='teste', revoked_by=$2 WHERE user_id=$1 AND book_edition_id=$3`, [buyer.id, admin.id, ed.editionId]);
    await get('manifest.json').expect(403); await get('OEBPS/c1.xhtml').expect(403); await get('positions.json').expect(403);
  });
});
