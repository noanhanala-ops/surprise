import Redis from 'ioredis';
import { RedisRateLimiter } from '../src/security/rate-limiter';
import { requireInfra } from './infra-env';

describe('Redis real: RateLimiter', () => {
  const prefix = `t${Date.now()}:`; let a: RedisRateLimiter; let b: RedisRateLimiter; let raw: Redis;
  beforeAll(() => { requireInfra(['REDIS_URL']); a = new RedisRateLimiter(process.env.REDIS_URL!, prefix); b = new RedisRateLimiter(process.env.REDIS_URL!, prefix); raw = new Redis(process.env.REDIS_URL!); });
  afterAll(async () => { for (const k of await raw.keys(prefix + '*')) await raw.del(k); await a.onModuleDestroy(); await b.onModuleDestroy(); await raw.quit(); });

  it('conta e recusa acima do limite; devolve Retry-After', async () => {
    const r = [] as boolean[]; for (let i = 0; i < 5; i++) r.push((await a.hit('k1', 3, 5000)).allowed);
    expect(r).toEqual([true, true, true, false, false]);
    const h = await a.hit('k1', 3, 5000); expect(h.count).toBe(6); expect(h.retryAfterSec).toBeGreaterThanOrEqual(1); expect(h.retryAfterSec).toBeLessThanOrEqual(5);
    expect(await a.peek('k1')).toMatchObject({ count: 6 });
  });
  it('é partilhado entre instâncias da aplicação (mesmo Redis)', async () => {
    await a.hit('shared', 2, 5000); await b.hit('shared', 2, 5000);
    expect((await a.hit('shared', 2, 5000)).allowed).toBe(false); expect((await b.peek('shared')).count).toBe(3);
  });
  it('a janela expira e volta a deixar passar; a chave tem TTL (nunca fica para sempre)', async () => {
    await a.hit('win', 1, 300); expect((await a.hit('win', 1, 300)).allowed).toBe(false);
    expect(await raw.pttl(prefix + 'win')).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 450));
    expect((await a.hit('win', 1, 300)).allowed).toBe(true);
  });
  it('reset limpa o contador; chaves diferentes não se influenciam', async () => {
    await a.hit('r1', 1, 5000); await a.hit('r1', 1, 5000); await a.reset('r1'); expect((await a.peek('r1')).count).toBe(0); expect((await a.hit('r1', 1, 5000)).allowed).toBe(true);
    expect((await a.hit('r2', 1, 5000)).allowed).toBe(true);
  });
  it('concorrência: 50 pedidos em paralelo contam exactamente 50 (atómico) e só `limit` passam', async () => {
    const rs = await Promise.all(Array.from({ length: 50 }, () => a.hit('par', 10, 5000)));
    expect(rs.filter((x) => x.allowed)).toHaveLength(10); expect(Math.max(...rs.map((x) => x.count))).toBe(50);
  });
  it('Redis indisponível ⇒ falha-aberta (disponibilidade) sem lançar', async () => {
    const down = new RedisRateLimiter('redis://127.0.0.1:1', prefix, 100);
    expect((await down.hit('x', 1, 1000)).allowed).toBe(true); expect((await down.peek('x')).count).toBe(0); await down.reset('x'); await down.onModuleDestroy();
  });
});
