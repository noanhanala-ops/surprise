import { HttpException, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

export interface Hit { allowed: boolean; count: number; retryAfterSec: number }

/** Limitador de janela fixa. Redis em produção (partilhado entre instâncias); memória em dev/testes. */
export abstract class RateLimiter {
  /** Conta um pedido na janela. `allowed=false` quando excede `limit`. */
  abstract hit(key: string, limit: number, windowMs: number): Promise<Hit>;
  /** Estado actual da janela (sem incrementar). */
  abstract peek(key: string): Promise<{ count: number; retryAfterSec: number }>;
  abstract reset(key: string): Promise<void>;
}

export class RateLimitedException extends HttpException {
  constructor(public retryAfterSec: number, message = 'Demasiadas tentativas. Tente mais tarde.') { super({ message, code: 'RATE_LIMITED', retry_after: retryAfterSec }, 429); }
}

@Injectable()
export class MemoryRateLimiter extends RateLimiter {
  private m = new Map<string, { n: number; exp: number }>();
  private live(key: string) { const e = this.m.get(key); if (e && e.exp <= Date.now()) { this.m.delete(key); return undefined; } return e; }
  async hit(key: string, limit: number, windowMs: number): Promise<Hit> {
    const e = this.live(key) ?? { n: 0, exp: Date.now() + windowMs }; e.n++; this.m.set(key, e);
    return { allowed: e.n <= limit, count: e.n, retryAfterSec: Math.max(1, Math.ceil((e.exp - Date.now()) / 1000)) };
  }
  async peek(key: string) { const e = this.live(key); return { count: e?.n ?? 0, retryAfterSec: e ? Math.max(1, Math.ceil((e.exp - Date.now()) / 1000)) : 1 }; }
  async reset(key: string) { this.m.delete(key); }
}

/**
 * Redis: `SET key 0 PX win NX` (cria com TTL) + `INCR` (mantém o TTL). Falha-aberta: se o Redis cair, os pedidos passam
 * (disponibilidade) e o erro fica registado — ver docs/security/SECURITY.md.
 */
export class RedisRateLimiter extends RateLimiter implements OnModuleDestroy {
  private log = new Logger('RateLimiter'); private r: Redis; private ready: Promise<void>;
  constructor(url: string, private prefix = 'drp:rl:', private connectWaitMs = 300) {
    super(); this.r = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
    this.r.on('error', (e) => this.log.warn(`redis: ${e.message}`));
    this.ready = new Promise((res) => this.r.once('ready', () => res()));
  }
  /** Espera (pouco) pela ligação: sem isto, os primeiros pedidos após o arranque falhariam em falha-aberta. */
  private async up(): Promise<boolean> {
    if (this.r.status === 'ready') return true;
    let t: NodeJS.Timeout; const timeout = new Promise<boolean>((res) => { t = setTimeout(() => res(false), this.connectWaitMs); });
    return Promise.race([this.ready.then(() => true), timeout]).finally(() => clearTimeout(t));
  }
  async hit(key: string, limit: number, windowMs: number): Promise<Hit> {
    try {
      if (!(await this.up())) throw new Error('sem ligação ao Redis');
      const k = this.prefix + key;
      await this.r.set(k, 0, 'PX', windowMs, 'NX'); const n = await this.r.incr(k); const ttl = await this.r.pttl(k);
      return { allowed: n <= limit, count: n, retryAfterSec: Math.max(1, Math.ceil(ttl / 1000)) };
    } catch (e: any) { this.log.error(`rate limiter indisponível (falha-aberta): ${e.message}`); return { allowed: true, count: 0, retryAfterSec: 1 }; }
  }
  async peek(key: string) {
    try { if (!(await this.up())) throw new Error('sem ligação'); const k = this.prefix + key; const [n, ttl] = await Promise.all([this.r.get(k), this.r.pttl(k)]); return { count: Number(n ?? 0), retryAfterSec: Math.max(1, Math.ceil(ttl / 1000)) }; }
    catch { return { count: 0, retryAfterSec: 1 }; }
  }
  async reset(key: string) { try { if (await this.up()) await this.r.del(this.prefix + key); } catch { /* idem */ } }
  async onModuleDestroy() { if (this.r.status === 'ready') await this.r.quit().catch(() => undefined); else this.r.disconnect(); }
}

const num = (name: string, d: number) => { const v = Number(process.env[name]); return Number.isFinite(v) && v > 0 ? v : d; };
/** Limites configuráveis em tempo de execução (os testes sobrepõem-nos). */
export const LIMITS = {
  loginIp: () => ({ limit: num('RATE_LOGIN_IP', 30), windowMs: 60_000 }),
  loginFails: () => ({ limit: num('RATE_LOGIN_FAILS', 5), windowMs: 15 * 60_000 }),
  registerIp: () => ({ limit: num('RATE_REGISTER_IP', 10), windowMs: 60 * 60_000 }),
  forgotIp: () => ({ limit: num('RATE_FORGOT_IP', 10), windowMs: 60 * 60_000 }),
  forgotEmail: () => ({ limit: num('RATE_FORGOT_EMAIL', 3), windowMs: 60 * 60_000 }),
  mfaFails: () => ({ limit: num('RATE_MFA_FAILS', 5), windowMs: 5 * 60_000 }),
};
