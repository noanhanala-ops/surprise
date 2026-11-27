import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Pool } from 'pg';
import { JwtService } from '@nestjs/jwt';

process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123';
process.env.DATABASE_URL ??= 'postgres://postgres@localhost:5544/drp';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/setup';

describe('Identity (e2e, PostgreSQL real)', () => {
  let app: INestApplication; let pool: Pool; let http: any;
  const email = `t${Date.now()}@example.com`; const password = 'correct horse battery';
  const device = { fingerprint: 'fp-1', platform: 'WEB' };

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication()); await app.init(); http = app.getHttpServer();
  });
  afterAll(async () => { await pool.query(`DELETE FROM users WHERE email LIKE 't%@example.com'`); await pool.end(); await app.close(); });

  it('rejeita password curta e e-mail inválido (422)', async () => {
    await request(http).post('/v1/auth/register').send({ email: 'x', password: 'short', display_name: 'A', country_code: 'MZ' }).expect(422);
  });

  it('regista, rejeita duplicado e grava evento no outbox', async () => {
    await request(http).post('/v1/auth/register').send({ email, password, display_name: 'Leitor', country_code: 'mz' }).expect(201);
    await request(http).post('/v1/auth/register').send({ email: email.toUpperCase(), password, display_name: 'Leitor', country_code: 'MZ' }).expect(409);
    const ob = await pool.query(`SELECT payload FROM outbox_events WHERE event_type='EmailVerificationRequested' AND payload->>'email'=$1`, [email]);
    expect(ob.rowCount).toBe(1);
    const u = await pool.query(`SELECT password_hash FROM users WHERE email=$1`, [email]);
    expect(u.rows[0].password_hash).toMatch(/^\$argon2id\$/);
  });

  it('não permite login antes de verificar o e-mail', async () => {
    await request(http).post('/v1/auth/login').send({ email, password }).expect(401);
  });

  let tokens: any;
  it('verifica e-mail com o token do outbox e faz login', async () => {
    const { rows } = await pool.query(`SELECT payload->>'token' t FROM outbox_events WHERE payload->>'email'=$1`, [email]);
    await request(http).post('/v1/auth/verify-email').send({ token: rows[0].t }).expect(204);
    await request(http).post('/v1/auth/login').send({ email, password: 'wrong password!!' }).expect(401);
    tokens = (await request(http).post('/v1/auth/login').send({ email, password, device }).expect(200)).body;
    expect(tokens.access_token && tokens.refresh_token).toBeTruthy();
  });

  it('rejeita um token de verificação usado como access token', async () => {
    const { rows } = await pool.query(`SELECT payload->>'token' t FROM outbox_events WHERE payload->>'email'=$1`, [email]);
    await request(http).get('/v1/users/me').set('Authorization', `Bearer ${rows[0].t}`).expect(401);
  });

  it('GET /users/me exige autenticação e devolve o próprio perfil', async () => {
    await request(http).get('/v1/users/me').expect(401);
    const r = await request(http).get('/v1/users/me').set('Authorization', `Bearer ${tokens.access_token}`).expect(200);
    expect(r.body.email).toBe(email); expect(r.body.password_hash).toBeUndefined();
  });

  it('rotação de refresh: o novo funciona; a reutilização do antigo revoga a família', async () => {
    const r1 = (await request(http).post('/v1/auth/refresh').send({ refresh_token: tokens.refresh_token }).expect(200)).body;
    expect(r1.refresh_token).not.toBe(tokens.refresh_token);
    await request(http).post('/v1/auth/refresh').send({ refresh_token: tokens.refresh_token }).expect(401); // reutilização
    await request(http).post('/v1/auth/refresh').send({ refresh_token: r1.refresh_token }).expect(401);     // família revogada
  });

  it('refresh concorrente com o mesmo token: só um sucede', async () => {
    const t = (await request(http).post('/v1/auth/login').send({ email, password, device }).expect(200)).body;
    const rs = await Promise.all([1, 2, 3].map(() => request(http).post('/v1/auth/refresh').send({ refresh_token: t.refresh_token })));
    expect(rs.filter((r) => r.status === 200).length).toBe(1);
  });

  it('dispositivos: lista e revoga (revoga também as sessões)', async () => {
    const t = (await request(http).post('/v1/auth/login').send({ email, password, device }).expect(200)).body;
    const list = (await request(http).get('/v1/users/me/devices').set('Authorization', `Bearer ${t.access_token}`).expect(200)).body;
    expect(list.length).toBe(1);
    await request(http).delete(`/v1/users/me/devices/${list[0].id}`).set('Authorization', `Bearer ${t.access_token}`).expect(204);
    await request(http).post('/v1/auth/refresh').send({ refresh_token: t.refresh_token }).expect(401);
  });

  it('logout revoga a sessão', async () => {
    const t = (await request(http).post('/v1/auth/login').send({ email, password }).expect(200)).body;
    await request(http).post('/v1/auth/logout').set('Authorization', `Bearer ${t.access_token}`).expect(204);
    await request(http).post('/v1/auth/refresh').send({ refresh_token: t.refresh_token }).expect(401);
  });
});
