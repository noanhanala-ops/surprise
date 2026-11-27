import request from 'supertest';
import { Test } from '@nestjs/testing';
import { setup, publishBook, buyBook, auth, Ctx, password, totpNow } from './helpers';
import { OutboxRelay } from '../src/events/outbox-relay.service';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/setup';

const withEnv = async <T>(vars: Record<string, string>, fn: () => Promise<T>) => {
  const prev: Record<string, string | undefined> = {}; for (const k of Object.keys(vars)) { prev[k] = process.env[k]; process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

describe('Conta: recuperação de palavra-passe e encomendas', () => {
  let ctx: Ctx; const drain = async () => { const r = ctx.app.get(OutboxRelay); while (await r.relayOnce()) { /* drena */ } };
  beforeAll(async () => { ctx = await setup(); });
  afterAll(async () => { await ctx.pool.end(); await ctx.app.close(); });
  const forgot = (email: string) => request(ctx.http).post('/v1/auth/forgot-password').send({ email });
  const resetToken = async (email: string) => { await drain(); return (await request(ctx.http).get(`/v1/dev/reset-token?email=${encodeURIComponent(email)}`)).body.token as string | undefined; };
  const reset = (token: string, pw: string) => request(ctx.http).post('/v1/auth/reset-password').send({ token, password: pw });
  const login = (email: string, pw: string) => request(ctx.http).post('/v1/auth/login').send({ email, password: pw });

  describe('recuperação de palavra-passe', () => {
    it('conta inexistente: mesma resposta (202) e nada é enviado — não revela quem está registado', async () => {
      const ghost = `ghost${ctx.run}@cat.test`;
      expect((await forgot(ghost).expect(202)).body).toEqual({ status: 'accepted' });
      await drain(); expect(await resetToken(ghost)).toBeUndefined();
      expect((await ctx.pool.query(`SELECT count(*)::int n FROM outbox_events WHERE event_type='PasswordResetRequested' AND payload->>'email'=$1`, [ghost])).rows[0].n).toBe(0);
    });

    it('fluxo completo: pedido → link → nova palavra-passe; a antiga deixa de servir e as sessões são revogadas', async () => {
      const u = await ctx.newUser('rst'); const old = (await login(u.email, password).expect(200)).body; const newPw = 'a brand new passphrase 99';
      await request(ctx.http).get('/v1/users/me').set(auth(old.access_token)).expect(200);
      expect((await forgot(u.email).expect(202)).body).toEqual({ status: 'accepted' });
      const t = await resetToken(u.email); expect(t).toBeTruthy();
      expect((await ctx.pool.query(`SELECT payload->>'link' l FROM notifications n JOIN users x ON x.id=n.user_id WHERE x.email=$1 AND n.template='reset_password'`, [u.email])).rows[0].l).toContain('/reset-password?token=');
      await reset(t!, 'curta').expect(422);                          // política de palavra-passe
      await reset('lixo', newPw).expect(400); await reset(u.token, newPw).expect(400); // token inválido / de outro tipo
      await reset(t!, newPw).expect(204);
      await login(u.email, password).expect(401); expect((await login(u.email, newPw).expect(200)).body.access_token).toBeTruthy();
      await request(ctx.http).post('/v1/auth/refresh').send({ refresh_token: old.refresh_token }).expect(401); // sessões antigas revogadas
      await reset(t!, 'another passphrase 1234').expect(400);       // uso único
      expect((await ctx.pool.query(`SELECT count(*)::int n FROM audit_log WHERE action='user.password_reset' AND target_id=$1`, [u.id])).rows[0].n).toBe(1);
    });

    it('um token de verificação de e-mail ou de acesso não serve para repor a palavra-passe', async () => {
      const u = await ctx.newUser('rst2'); const { rows } = await ctx.pool.query(`SELECT payload->>'token' t FROM outbox_events WHERE event_type='EmailVerificationRequested' AND payload->>'email'=$1`, [u.email]);
      await reset(rows[0].t, 'a brand new passphrase 99').expect(400);
    });

    it('limpa o bloqueio por falhas: depois de repor, entra de imediato', async () => {
      await withEnv({ RATE_LOGIN_FAILS: '3' }, async () => {
        const u = await ctx.newUser('rstlock');
        for (let i = 0; i < 3; i++) await login(u.email, 'errada-errada-12').expect(401);
        await login(u.email, password).expect(429);
        await forgot(u.email).expect(202); const t = await resetToken(u.email);
        await reset(t!, 'unlocked passphrase 777').expect(204);
        await login(u.email, 'unlocked passphrase 777').expect(200);
      });
    });

    it('com MFA ativo, repor a palavra-passe NÃO dispensa o segundo factor', async () => {
      const u = await ctx.newUser('rstmfa'); const e = (await request(ctx.http).post('/v1/auth/mfa/enroll').set(auth(u.token))).body;
      await request(ctx.http).post('/v1/auth/mfa/confirm').set(auth(u.token)).send({ code: totpNow(e.secret) }).expect(200);
      await forgot(u.email).expect(202); const t = await resetToken(u.email); await reset(t!, 'mfa still required 1234').expect(204);
      const r = (await login(u.email, 'mfa still required 1234').expect(200)).body; expect(r.mfa_challenge_id).toBeTruthy(); expect(r.access_token).toBeUndefined();
    });

    it('limites: por e-mail é silencioso (sem spam à vítima); por IP devolve 429', async () => {
      const u = await ctx.newUser('rstrl');
      for (let i = 0; i < 5; i++) await forgot(u.email).expect(202);
      expect((await ctx.pool.query(`SELECT count(*)::int n FROM outbox_events WHERE event_type='PasswordResetRequested' AND payload->>'email'=$1`, [u.email])).rows[0].n).toBe(3); // só 3/hora
      await withEnv({ RATE_FORGOT_IP: '2' }, async () => {
        const app = configureApp((await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication({ rawBody: true })); await app.init();
        try { const f = () => request(app.getHttpServer()).post('/v1/auth/forgot-password').send({ email: `x${ctx.run}@cat.test` });
          await f().expect(202); await f().expect(202); const r = await f().expect(429); expect(r.headers['retry-after']).toBeDefined(); } finally { await app.close(); }
      });
    });

    it('sandbox: reset-token com `since` ignora tokens antigos (não devolve um link já inválido)', async () => {
      const u = await ctx.newUser('rstsince'); await forgot(u.email).expect(202); const first = await resetToken(u.email); expect(first).toBeTruthy();
      const since = new Date(Date.now() + 1000).toISOString();
      expect((await request(ctx.http).get(`/v1/dev/reset-token?email=${encodeURIComponent(u.email)}&since=${encodeURIComponent(since)}`)).status).toBe(404); // nada novo ainda
      await new Promise((r) => setTimeout(r, 1100)); await forgot(u.email).expect(202); await drain();
      const second = (await request(ctx.http).get(`/v1/dev/reset-token?email=${encodeURIComponent(u.email)}&since=${encodeURIComponent(since)}`).expect(200)).body.token; expect(second).not.toBe(first);
    });

    it('endpoint de teste só existe em sandbox', async () => {
      await withEnv({ SANDBOX_MODE: 'false' }, async () => {
        const app = configureApp((await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication({ rawBody: true })); await app.init();
        try { await request(app.getHttpServer()).get('/v1/dev/reset-token?email=a@b.c').expect(404); } finally { await app.close(); }
      });
    });
  });

  describe('encomendas', () => {
    it('detalhe com título, estado do direito e do reembolso; só o dono vê', async () => {
      const admin = await ctx.newUser('oadm', ['admin_catalog']); const pub = await ctx.newUser('opub'); const buyer = await ctx.newUser('obuy'); const other = await ctx.newUser('ooth');
      const b = await publishBook(ctx, admin, pub, { title: `Encomenda ${ctx.run}`, usd: 700 });
      const oid = await buyBook(ctx, buyer, b.editionId); await drain();
      let o = (await request(ctx.http).get(`/v1/orders/${oid}`).set(auth(buyer.token)).expect(200)).body;
      expect(o.status).toBe('FULFILLED'); expect(o.items[0]).toMatchObject({ title: `Encomenda ${ctx.run}`, slug: b.slug, entitlement_status: 'ACTIVE', refund_status: null, unit_price_minor: 700 });
      await request(ctx.http).get(`/v1/orders/${oid}`).set(auth(other.token)).expect(404);
      await request(ctx.http).post(`/v1/orders/${oid}/refund-requests`).set(auth(buyer.token)).set('Idempotency-Key', `k-ord-${ctx.run}`).send({ reason: 'Não era o que esperava' }).expect(202);
      o = (await request(ctx.http).get(`/v1/orders/${oid}`).set(auth(buyer.token))).body; expect(o.items[0].refund_status).toBe('REQUESTED');
      expect((await request(ctx.http).get('/v1/orders').set(auth(buyer.token)).expect(200)).body[0].id).toBe(oid);
    });
  });
});
