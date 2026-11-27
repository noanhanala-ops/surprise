import request from 'supertest';
import { randomUUID } from 'crypto';
import { setup, auth, Ctx, password } from './helpers';
import { OutboxRelay } from '../src/events/outbox-relay.service';

describe('Modo sandbox: explícito, nunca por omissão', () => {
  afterEach(() => { process.env.SANDBOX_MODE = 'true'; });

  it('a API recusa arrancar em produção com SANDBOX_MODE=true', async () => {
    const prev = process.env.NODE_ENV; process.env.NODE_ENV = 'production'; process.env.SANDBOX_MODE = 'true';
    try { await expect(setup()).rejects.toThrow(/proibido com NODE_ENV=production/); } finally { process.env.NODE_ENV = prev; }
  });

  it('SANDBOX_MODE != true: FakeProvider desconhecido e endpoints dev inexistentes', async () => {
    process.env.SANDBOX_MODE = 'false';
    const ctx = await setup();
    try {
      const u = await ctx.newUser('nosand');
      await request(ctx.http).get('/v1/dev/verification-token?email=x@y.z').expect(404);
      await request(ctx.http).post(`/v1/dev/fake-pay/${randomUUID()}`).set(auth(u.token)).expect(404);
      expect((await request(ctx.http).get('/v1/payments/methods').set(auth(u.token)).expect(200)).body).toEqual([]);
      await request(ctx.http).post('/v1/webhooks/fake').set('Content-Type', 'application/json').send('{}').expect(404);
    } finally { await ctx.pool.end(); await ctx.app.close(); }
  });

  it('SANDBOX_MODE=true: registo → outbox → notificação → "link do e-mail" → verificação → login', async () => {
    process.env.SANDBOX_MODE = 'true';
    const ctx: Ctx = await setup();
    try {
      const email = `mail${ctx.run}@cat.test`;
      await request(ctx.http).post('/v1/auth/register').send({ email, password, display_name: 'M', country_code: 'MZ' }).expect(201);
      await request(ctx.http).get(`/v1/dev/verification-token?email=${email}`).expect(404); // ainda sem notificação: falta correr o relay
      const relay = ctx.app.get(OutboxRelay); while (await relay.relayOnce()) { /* drena */ }
      const t = (await request(ctx.http).get(`/v1/dev/verification-token?email=${email}`).expect(200)).body.token;
      expect((await ctx.pool.query(`SELECT n.status, n.payload->>'link' AS link FROM notifications n JOIN users u ON u.id=n.user_id WHERE u.email=$1`, [email])).rows[0]).toMatchObject({ status: 'PENDING', link: expect.stringContaining('/verify?token=') });
      await request(ctx.http).post('/v1/auth/login').send({ email, password }).expect(401);
      await request(ctx.http).post('/v1/auth/verify-email').send({ token: t }).expect(204);
      await request(ctx.http).post('/v1/auth/login').send({ email, password }).expect(200);
      await relay.relayOnce(); // re-entrega: não duplica a notificação
      expect((await ctx.pool.query(`SELECT count(*)::int n FROM notifications n JOIN users u ON u.id=n.user_id WHERE u.email=$1`, [email])).rows[0].n).toBe(1);
    } finally { await ctx.pool.end(); await ctx.app.close(); }
  });
});
