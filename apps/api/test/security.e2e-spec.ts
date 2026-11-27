import request from 'supertest';
import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { setup, auth, Ctx, password, totpNow } from './helpers';
import { AppModule } from '../src/app.module';
import { OutboxRelay } from '../src/events/outbox-relay.service';
import { configureApp } from '../src/setup';

/** Repõe/aplica variáveis de ambiente durante um teste. */
const withEnv = async <T>(vars: Record<string, string | undefined>, fn: () => Promise<T>) => {
  const prev: Record<string, string | undefined> = {}; for (const k of Object.keys(vars)) { prev[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

describe('Segurança: rate limiting (credential stuffing) e MFA', () => {
  let ctx: Ctx;
  // Relógio controlável: o TOTP muda de 30 em 30 s e o anti-replay impede reutilizar um passo, por isso "avançamos" o tempo em vez de esperar.
  let skew = 0; const realNow = Date.now.bind(Date); const tick = () => { skew += 30_000; };
  beforeAll(async () => { jest.spyOn(Date, 'now').mockImplementation(() => realNow() + skew); ctx = await setup(); });
  afterAll(async () => { jest.restoreAllMocks(); await ctx.pool.end(); await ctx.app.close(); });
  const login = (email: string, pw = password, xff?: string) => { const r = request(ctx.http).post('/v1/auth/login'); if (xff) r.set('X-Forwarded-For', xff); return r.send({ email, password: pw }); };
  const fresh = async (tag: string) => { const u = await ctx.newUser(tag); return u; };

  describe('rate limiting', () => {
    it('bloqueio por conta: N falhas ⇒ 429 com Retry-After, mesmo com a palavra-passe certa; outras contas não são afectadas', async () => {
      await withEnv({ RATE_LOGIN_FAILS: '3' }, async () => {
        const u = await fresh('lock'); const other = await fresh('lockother');
        for (let i = 0; i < 3; i++) await login(u.email, 'palavra-errada-123').expect(401);
        const blocked = await login(u.email).expect(429);
        expect(blocked.headers['retry-after']).toBeDefined(); expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0); expect(blocked.body.code).toBe('RATE_LIMITED');
        await login(other.email).expect(200);
      });
    });
    it('contas inexistentes são bloqueadas da mesma forma (não revela quem está registado)', async () => {
      await withEnv({ RATE_LOGIN_FAILS: '3' }, async () => {
        const ghost = `ghost${ctx.run}@cat.test`;
        for (let i = 0; i < 3; i++) await login(ghost, 'qualquer-coisa-123').expect(401);
        await login(ghost).expect(429);
      });
    });
    it('um login com sucesso repõe o contador de falhas', async () => {
      await withEnv({ RATE_LOGIN_FAILS: '3' }, async () => {
        const u = await fresh('reset');
        await login(u.email, 'errada-errada-1').expect(401); await login(u.email, 'errada-errada-2').expect(401);
        await login(u.email).expect(200); // repõe
        await login(u.email, 'errada-errada-3').expect(401); await login(u.email, 'errada-errada-4').expect(401);
        await login(u.email).expect(200); // ainda não bloqueado
      });
    });
    it('limite por IP: o (N+1).º pedido do mesmo IP é recusado; X-Forwarded-For forjado NÃO contorna (sem TRUST_PROXY)', async () => {
      const u = await fresh('ip'); // criado ANTES de baixar o limite (o login do helper também conta)
      await withEnv({ RATE_LOGIN_IP: '4' }, async () => {
        const mod = await Test.createTestingModule({ imports: [AppModule] }).compile(); const app = configureApp(mod.createNestApplication({ rawBody: true })); await app.init();
        try {
          const h = app.getHttpServer(); const go = (xff: string) => request(h).post('/v1/auth/login').set('X-Forwarded-For', xff).send({ email: u.email, password });
          for (let i = 0; i < 4; i++) await go(`10.0.0.${i}`).expect(200);
          await go('10.9.9.9').expect(429); // cabeçalho diferente, mesmo socket ⇒ mesmo balde
        } finally { await app.close(); }
      });
    });
    it('com TRUST_PROXY=1 cada cliente atrás do proxy tem o seu balde (X-Forwarded-For)', async () => {
      const u = await fresh('proxy');
      await withEnv({ RATE_LOGIN_IP: '2', TRUST_PROXY: '1' }, async () => {
        const mod = await Test.createTestingModule({ imports: [AppModule] }).compile(); const app = configureApp(mod.createNestApplication({ rawBody: true })); await app.init();
        try {
          const h = app.getHttpServer(); const go = (xff: string) => request(h).post('/v1/auth/login').set('X-Forwarded-For', xff).send({ email: u.email, password });
          await go('203.0.113.1').expect(200); await go('203.0.113.1').expect(200); await go('203.0.113.1').expect(429);
          await go('203.0.113.2').expect(200); // outro cliente real
        } finally { await app.close(); }
      });
    });
    it('registo limitado por IP', async () => {
      await withEnv({ RATE_REGISTER_IP: '2' }, async () => {
        const mod = await Test.createTestingModule({ imports: [AppModule] }).compile(); const app = configureApp(mod.createNestApplication({ rawBody: true })); await app.init();
        try {
          const reg = (i: number) => request(app.getHttpServer()).post('/v1/auth/register').send({ email: `rl${ctx.run}${i}@cat.test`, password, display_name: 'R', country_code: 'MZ' });
          await reg(1).expect(201); await reg(2).expect(201); await reg(3).expect(429);
        } finally { await app.close(); }
      });
    });
  });

  describe('MFA (TOTP)', () => {
    let u: any; let secret: string; let codes: string[];
    it('inscrição → o segredo é cifrado em repouso; confirmação exige um código válido', async () => {
      u = await fresh('mfa');
      const enr = (await request(ctx.http).post('/v1/auth/mfa/enroll').set(auth(u.token)).expect(200)).body; secret = enr.secret;
      expect(enr.otpauth_uri).toMatch(/^otpauth:\/\/totp\/.+secret=/);
      const row = (await ctx.pool.query(`SELECT secret_enc FROM mfa_credentials WHERE user_id=$1 AND kind='TOTP'`, [u.id])).rows[0].secret_enc as Buffer;
      expect(row.toString('latin1').includes(secret)).toBe(false); expect(row.length).toBe(12 + 16 + 20); // iv + tag GCM + segredo de 20 bytes
      await request(ctx.http).post('/v1/auth/mfa/confirm').set(auth(u.token)).send({ code: '000000' }).expect(401);
      const conf = (await request(ctx.http).post('/v1/auth/mfa/confirm').set(auth(u.token)).send({ code: totpNow(secret) }).expect(200)).body;
      codes = conf.recovery_codes; expect(codes).toHaveLength(10); expect(new Set(codes).size).toBe(10); expect(codes[0]).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
      expect((await request(ctx.http).get('/v1/users/me').set(auth(u.token))).body.mfa_enabled).toBe(true);
      await request(ctx.http).post('/v1/auth/mfa/enroll').set(auth(conf.access_token)).expect(409); // já activo
    });
    it('os códigos de recuperação são guardados só como hash', async () => {
      const rows = (await ctx.pool.query(`SELECT secret_enc FROM mfa_credentials WHERE user_id=$1 AND kind='RECOVERY_CODE'`, [u.id])).rows;
      expect(rows).toHaveLength(10); for (const r of rows) for (const c of codes) expect((r.secret_enc as Buffer).toString('latin1')).not.toContain(c.replace('-', ''));
    });

    let challenge: string;
    it('login com MFA activo devolve só um desafio (sem tokens); o desafio não serve de access token', async () => {
      const r = (await login(u.email).expect(200)).body;
      expect(r.mfa_challenge_id).toBeTruthy(); expect(r.access_token).toBeUndefined(); expect(r.refresh_token).toBeUndefined(); challenge = r.mfa_challenge_id;
      await request(ctx.http).get('/v1/users/me').set(auth(challenge)).expect(401);
    });
    it('um access token não serve de desafio', async () => {
      await request(ctx.http).post('/v1/auth/mfa/verify').send({ challenge_id: u.token, code: totpNow(secret) }).expect(401);
    });
    it('código errado ⇒ 401 e as tentativas são limitadas (429)', async () => {
      await withEnv({ RATE_MFA_FAILS: '3' }, async () => {
        for (let i = 0; i < 3; i++) await request(ctx.http).post('/v1/auth/mfa/verify').send({ challenge_id: challenge, code: '123456' }).expect(401);
        tick(); // um código que, sem bloqueio, seria válido
        const r = await request(ctx.http).post('/v1/auth/mfa/verify').send({ challenge_id: challenge, code: totpNow(secret) }).expect(429); // até o certo é recusado enquanto bloqueado
        expect(r.headers['retry-after']).toBeDefined();
      });
    });

    it('código certo emite a sessão com MFA; o MESMO código não pode ser reutilizado (anti-replay)', async () => {
      const app2 = await Test.createTestingModule({ imports: [AppModule] }).compile().then((m) => configureApp(m.createNestApplication({ rawBody: true })).init()); // limiter novo
      try {
        const h = app2.getHttpServer(); const lg = () => request(h).post('/v1/auth/login').send({ email: u.email, password });
        tick(); const code = totpNow(secret); // passo seguinte (≠ do usado na confirmação)
        const c1 = (await lg().expect(200)).body.mfa_challenge_id; const ok = (await request(h).post('/v1/auth/mfa/verify').send({ challenge_id: c1, code }).expect(200)).body;
        expect(ok.access_token && ok.refresh_token).toBeTruthy();
        const c2 = (await lg().expect(200)).body.mfa_challenge_id;
        await request(h).post('/v1/auth/mfa/verify').send({ challenge_id: c2, code }).expect(401); // replay
        tick(); const next = totpNow(secret); // passo seguinte: aceite (> último usado)
        await request(h).post('/v1/auth/mfa/verify').send({ challenge_id: c2, code: next }).expect(200);
      } finally { await app2.close(); }
    });

    it('código de recuperação: serve uma vez só', async () => {
      const rc = codes[0]; const c1 = (await login(u.email).expect(200)).body.mfa_challenge_id;
      await request(ctx.http).post('/v1/auth/mfa/verify').send({ challenge_id: c1, code: rc.toLowerCase() }).expect(200); // maiúsculas/minúsculas indiferentes
      const c2 = (await login(u.email).expect(200)).body.mfa_challenge_id;
      await request(ctx.http).post('/v1/auth/mfa/verify').send({ challenge_id: c2, code: rc }).expect(401);
      expect((await ctx.pool.query(`SELECT count(*)::int n FROM mfa_credentials WHERE user_id=$1 AND kind='RECOVERY_CODE'`, [u.id])).rows[0].n).toBe(9);
    });

    it('desactivar MFA (cliente) exige código válido; depois o login volta a ser directo', async () => {
      const u2 = await fresh('mfaoff'); const e = (await request(ctx.http).post('/v1/auth/mfa/enroll').set(auth(u2.token))).body;
      const t = (await request(ctx.http).post('/v1/auth/mfa/confirm').set(auth(u2.token)).send({ code: totpNow(e.secret) }).expect(200)).body.access_token;
      await request(ctx.http).post('/v1/auth/mfa/disable').set(auth(t)).send({ code: '111111' }).expect(401);
      await request(ctx.http).post('/v1/auth/mfa/disable').set(auth(t)).send({ code: (tick(), totpNow(e.secret)) }).expect(204);
      expect((await login(u2.email).expect(200)).body.access_token).toBeTruthy();
      expect((await ctx.pool.query(`SELECT count(*)::int n FROM mfa_credentials WHERE user_id=$1`, [u2.id])).rows[0].n).toBe(0);
    });
  });

  describe('revogação de sessões (o access token deixa de valer logo, não só ao expirar)', () => {
    it('logout, revogar dispositivo e reposição de palavra-passe cortam o access token de imediato; o refresh não o invalida', async () => {
      const u = await fresh('sess'); const dev = { fingerprint: 'fp-sess', platform: 'WEB' };
      const l1 = (await request(ctx.http).post('/v1/auth/login').send({ email: u.email, password, device: dev }).expect(200)).body;
      await request(ctx.http).get('/v1/users/me').set(auth(l1.access_token)).expect(200);
      // rotação do refresh: o token novo e o antigo (mesma família, p.ex. pedidos em voo) continuam válidos
      const r = (await request(ctx.http).post('/v1/auth/refresh').send({ refresh_token: l1.refresh_token }).expect(200)).body;
      await request(ctx.http).get('/v1/users/me').set(auth(r.access_token)).expect(200); await request(ctx.http).get('/v1/users/me').set(auth(l1.access_token)).expect(200);
      // logout
      await request(ctx.http).post('/v1/auth/logout').set(auth(r.access_token)).expect(204);
      await request(ctx.http).get('/v1/users/me').set(auth(r.access_token)).expect(401);
      // revogar dispositivo
      const l2 = (await request(ctx.http).post('/v1/auth/login').send({ email: u.email, password, device: dev }).expect(200)).body;
      const devices = (await request(ctx.http).get('/v1/users/me/devices').set(auth(l2.access_token)).expect(200)).body;
      await request(ctx.http).delete(`/v1/users/me/devices/${devices[0].id}`).set(auth(l2.access_token)).expect(204);
      await request(ctx.http).get('/v1/users/me').set(auth(l2.access_token)).expect(401);
      // reposição de palavra-passe
      const l3 = (await request(ctx.http).post('/v1/auth/login').send({ email: u.email, password }).expect(200)).body;
      await request(ctx.http).post('/v1/auth/forgot-password').send({ email: u.email }).expect(202);
      const rel = ctx.app.get(OutboxRelay); while (await rel.relayOnce()) { /* drena */ }
      const t = (await request(ctx.http).get(`/v1/dev/reset-token?email=${encodeURIComponent(u.email)}`)).body.token;
      await request(ctx.http).get('/v1/users/me').set(auth(l3.access_token)).expect(200);
      await request(ctx.http).post('/v1/auth/reset-password').send({ token: t, password: 'brand new passphrase 4242' }).expect(204);
      await request(ctx.http).get('/v1/users/me').set(auth(l3.access_token)).expect(401);
    });

    it('detecção de reutilização do refresh corta também os access tokens da família', async () => {
      const u = await fresh('reuse'); const l = (await request(ctx.http).post('/v1/auth/login').send({ email: u.email, password }).expect(200)).body;
      const r = (await request(ctx.http).post('/v1/auth/refresh').send({ refresh_token: l.refresh_token }).expect(200)).body;
      await request(ctx.http).post('/v1/auth/refresh').send({ refresh_token: l.refresh_token }).expect(401); // reutilização ⇒ família revogada
      await request(ctx.http).get('/v1/users/me').set(auth(r.access_token)).expect(401);
    });
  });

  describe('MFA obrigatório para administradores e "MFA recente" em operações sensíveis', () => {
    it('admin sem MFA recebe 403 MFA_REQUIRED; cliente comum não é afectado; com MFA passa', async () => {
      const email = `adm${ctx.run}@cat.test`;
      await request(ctx.http).post('/v1/auth/register').send({ email, password, display_name: 'A', country_code: 'MZ' }).expect(201);
      const { rows } = await ctx.pool.query(`SELECT payload->>'token' t FROM outbox_events WHERE payload->>'email'=$1`, [email]);
      await request(ctx.http).post('/v1/auth/verify-email').send({ token: rows[0].t }).expect(204);
      await ctx.pool.query(`INSERT INTO user_roles SELECT u.id, r.id FROM users u, roles r WHERE u.email=$1 AND r.name='admin_finance'`, [email]);
      const t0 = (await login(email).expect(200)).body.access_token; // ainda sem MFA
      const denied = await request(ctx.http).get('/v1/admin/refunds').set(auth(t0)).expect(403); expect(denied.body.code).toBe('MFA_REQUIRED');
      const e = (await request(ctx.http).post('/v1/auth/mfa/enroll').set(auth(t0))).body;
      const t1 = (await request(ctx.http).post('/v1/auth/mfa/confirm').set(auth(t0)).send({ code: totpNow(e.secret) }).expect(200)).body.access_token;
      await request(ctx.http).get('/v1/admin/refunds').set(auth(t1)).expect(200);
      await request(ctx.http).post('/v1/auth/mfa/disable').set(auth(t1)).send({ code: (tick(), totpNow(e.secret)) }).expect(403); // admin não pode desactivar
      // o token antigo (sem mfa_at) continua a ser recusado
      await request(ctx.http).get('/v1/admin/refunds').set(auth(t0)).expect(403);
    });

    it('decidir reembolsos exige MFA recente (≤15 min): STEP_UP_REQUIRED → step-up → passa; o MFA envelhece mesmo após refresh', async () => {
      const adm = await ctx.newUser('stepadm', ['admin_finance']);
      const fakeRefund = randomUUID();
      const decide = (t: string) => request(ctx.http).post(`/v1/admin/refunds/${fakeRefund}/decision`).set(auth(t)).send({ decision: 'REJECT', reason: 'teste de step-up' });
      expect((await decide(adm.token)).status).toBe(404); // guard passou (reembolso inexistente ⇒ 404)
      // simula: o MFA foi verificado há 1 hora; a sessão foi renovada por refresh entretanto
      const lg = (await login(adm.email).expect(200)).body; const c = (await request(ctx.http).post('/v1/auth/mfa/verify').send({ challenge_id: lg.mfa_challenge_id, code: (tick(), totpNow(adm.mfaSecret!)) }).expect(200)).body;
      await ctx.pool.query(`UPDATE refresh_sessions SET mfa_at = now() - interval '1 hour' WHERE user_id=$1`, [adm.id]);
      const old = (await request(ctx.http).post('/v1/auth/refresh').send({ refresh_token: c.refresh_token }).expect(200)).body;
      const r = await decide(old.access_token).expect(403); expect(r.body.code).toBe('STEP_UP_REQUIRED');
      await request(ctx.http).get('/v1/admin/refunds').set(auth(old.access_token)).expect(200); // rotas sem @RequireRecentMfa continuam a funcionar
      const su = await request(ctx.http).post('/v1/auth/mfa/step-up').set(auth(old.access_token)).send({ code: '000000' }).expect(401);
      expect(su.status).toBe(401);
      const fresh = (await request(ctx.http).post('/v1/auth/mfa/step-up').set(auth(old.access_token)).send({ code: (tick(), totpNow(adm.mfaSecret!)) }).expect(200)).body;
      expect((await decide(fresh.access_token)).status).toBe(404); // agora passa o guard
    });

    it('um refresh mantém o MFA da sessão (não o "promove" nem o perde)', async () => {
      const adm = await ctx.newUser('refadm', ['admin_catalog']);
      const lg = (await login(adm.email).expect(200)).body; const s = (await request(ctx.http).post('/v1/auth/mfa/verify').send({ challenge_id: lg.mfa_challenge_id, code: (tick(), totpNow(adm.mfaSecret!)) }).expect(200)).body;
      const r = (await request(ctx.http).post('/v1/auth/refresh').send({ refresh_token: s.refresh_token }).expect(200)).body;
      await request(ctx.http).get('/v1/admin/content-jobs').set(auth(r.access_token)).expect(200);
      // sessão sem MFA (customer) nunca ganha MFA por refresh
      const cust = await fresh('refcust'); const l2 = (await login(cust.email).expect(200)).body; const r2 = (await request(ctx.http).post('/v1/auth/refresh').send({ refresh_token: l2.refresh_token }).expect(200)).body;
      expect(JSON.parse(Buffer.from(r2.access_token.split('.')[1], 'base64url').toString()).mfa_at).toBeUndefined();
    });
  });
});
