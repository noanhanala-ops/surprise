import { ConflictException, Injectable, UnauthorizedException, BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { DbService } from '../common/db.service';
import { DeviceInfoDto, LoginDto, RegisterDto } from './dto';
import { LIMITS, RateLimitedException, RateLimiter } from '../security/rate-limiter';
import { MfaService } from './mfa.service';

const REFRESH_TTL_DAYS = 30;
const sha256 = (s: string) => createHash('sha256').update(s).digest();
const ARGON = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const; // OWASP min.

export interface AuthResult { access_token?: string; refresh_token?: string; expires_in?: number; mfa_challenge_id?: string }

@Injectable()
export class IdentityService {
  private dummyHash?: Promise<string>;
  constructor(private db: DbService, private jwt: JwtService, private limiter: RateLimiter, private mfa: MfaService) {}

  async register(dto: RegisterDto, ip = 'unknown') {
    const rl = LIMITS.registerIp(); const h = await this.limiter.hit(`register:ip:${ip}`, rl.limit, rl.windowMs);
    if (!h.allowed) throw new RateLimitedException(h.retryAfterSec);
    const hash = await argon2.hash(dto.password, ARGON);
    const userId = await this.db.tx(async (c) => {
      const r = await c.query(
        `INSERT INTO users (email, password_hash, country_code) VALUES ($1,$2,$3)
         ON CONFLICT (email) DO NOTHING RETURNING id`,
        [dto.email.trim(), hash, dto.country_code.toUpperCase()],
      );
      if (!r.rowCount) throw new ConflictException('E-mail já registado');
      const id: string = r.rows[0].id;
      await c.query(`INSERT INTO user_profiles (user_id, display_name, locale) VALUES ($1,$2,$3)`, [id, dto.display_name, dto.locale ?? 'en']);
      await c.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name='customer'`, [id]);
      // O e-mail é enviado pelo notification-worker a partir do outbox (ADR-0004).
      const token = await this.jwt.signAsync({ sub: id, purpose: 'verify-email' }, { expiresIn: '24h' });
      await c.query(
        `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload) VALUES ('user',$1,'EmailVerificationRequested',$2)`,
        [id, JSON.stringify({ userId: id, email: dto.email.trim().toLowerCase(), token })],
      );
      return id;
    });
    return { id: userId };
  }

  /** Fingerprint do hash actual: o token deixa de servir assim que a palavra-passe muda (uso único). */
  private fp = (hash: string) => createHash('sha256').update(hash).digest('hex').slice(0, 16);

  /**
   * Resposta SEMPRE igual (existe ou não a conta): não revela quem está registado. Limites por IP e por e-mail
   * (o limite por e-mail é silencioso, para não permitir enumeração nem spam a uma vítima).
   */
  async forgotPassword(email: string, ip = 'unknown') {
    const li = LIMITS.forgotIp(); const ih = await this.limiter.hit(`forgot:ip:${ip}`, li.limit, li.windowMs);
    if (!ih.allowed) throw new RateLimitedException(ih.retryAfterSec);
    const e = email.trim().toLowerCase(); const le = LIMITS.forgotEmail();
    if (!(await this.limiter.hit(`forgot:email:${e}`, le.limit, le.windowMs)).allowed) return;
    const u = (await this.db.query(`SELECT id, password_hash FROM users WHERE email=$1 AND status IN ('ACTIVE','PENDING_VERIFICATION') AND password_hash IS NOT NULL`, [e])).rows[0];
    if (!u) return;
    const token = await this.jwt.signAsync({ sub: u.id, purpose: 'reset-password', ph: this.fp(u.password_hash) }, { expiresIn: '1h' });
    await this.db.query(`INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload) VALUES ('user',$1,'PasswordResetRequested',$2)`, [u.id, JSON.stringify({ userId: u.id, email: e, token })]);
  }

  /** Define a nova palavra-passe, revoga TODAS as sessões e limpa o bloqueio de falhas. O MFA (se existir) continua a ser exigido no login. */
  async resetPassword(token: string, password: string) {
    let p: { sub: string; purpose: string; ph: string };
    try { p = await this.jwt.verifyAsync(token); } catch { throw new BadRequestException('Link inválido ou expirado'); }
    if (p.purpose !== 'reset-password') throw new BadRequestException('Link inválido ou expirado');
    const hash = await argon2.hash(password, ARGON);
    await this.db.tx(async (c) => {
      const u = (await c.query(`SELECT id, email, password_hash FROM users WHERE id=$1 FOR UPDATE`, [p.sub])).rows[0];
      if (!u || !u.password_hash || this.fp(u.password_hash) !== p.ph) throw new BadRequestException('Link inválido ou expirado'); // já usado
      await c.query(`UPDATE users SET password_hash=$2, email_verified_at=COALESCE(email_verified_at, now()), status=CASE WHEN status='PENDING_VERIFICATION' THEN 'ACTIVE'::user_status ELSE status END WHERE id=$1`, [u.id, hash]);
      await c.query(`UPDATE refresh_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [u.id]);
      await c.query(`INSERT INTO audit_log (actor_id, actor_type, action, target_type, target_id) VALUES ($1,'USER','user.password_reset','user',$2)`, [u.id, String(u.id)]); // $1 uuid e $2 texto: o mesmo parâmetro não pode ter dois tipos
      await this.limiter.reset(`login:fail:${String(u.email).toLowerCase()}`);
    });
  }

  async verifyEmail(token: string) {
    let p: { sub: string; purpose: string };
    try { p = await this.jwt.verifyAsync(token); } catch { throw new BadRequestException('Token inválido ou expirado'); }
    if (p.purpose !== 'verify-email') throw new BadRequestException('Token inválido ou expirado');
    await this.db.query(
      `UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()),
              status = CASE WHEN status='PENDING_VERIFICATION' THEN 'ACTIVE'::user_status ELSE status END WHERE id=$1`,
      [p.sub],
    );
  }

  async login(dto: LoginDto, ip = 'unknown'): Promise<AuthResult> {
    const li = LIMITS.loginIp(); const ih = await this.limiter.hit(`login:ip:${ip}`, li.limit, li.windowMs);
    if (!ih.allowed) throw new RateLimitedException(ih.retryAfterSec);
    // Bloqueio por conta (credential stuffing): conta falhas por e-mail, existam ou não — não revela que contas existem.
    const email = dto.email.trim().toLowerCase(); const failKey = `login:fail:${email}`; const lf = LIMITS.loginFails();
    const pk = await this.limiter.peek(failKey); if (pk.count >= lf.limit) throw new RateLimitedException(pk.retryAfterSec);
    const r = await this.db.query(`SELECT id, password_hash, status, mfa_enabled FROM users WHERE email=$1`, [email]);
    const u = r.rows[0];
    // Verificação de tempo constante-ish: faz sempre um hash, exista ou não o utilizador.
    this.dummyHash ??= argon2.hash('dummy-password-for-timing', ARGON);
    const ok = await argon2.verify(u?.password_hash ?? (await this.dummyHash), dto.password).catch(() => false);
    if (!u || !ok || u.status !== 'ACTIVE') { await this.limiter.hit(failKey, lf.limit, lf.windowMs); throw new UnauthorizedException('Credenciais inválidas'); }
    await this.limiter.reset(failKey);
    const deviceId = dto.device ? await this.upsertDevice(u.id, dto.device) : null;
    if (u.mfa_enabled) { // 2.º factor: o login só termina em /auth/mfa/verify
      return { mfa_challenge_id: await this.jwt.signAsync({ purpose: 'mfa-challenge', sub: u.id, dev: deviceId }, { expiresIn: '5m' }) };
    }
    return this.issue(u.id, deviceId, randomUUID(), null);
  }

  /** Verifica o 2.º factor de um login em curso (TOTP ou código de recuperação) e emite a sessão com MFA verificado. */
  async verifyMfa(challengeId: string, code: string): Promise<AuthResult> {
    let c: any; try { c = await this.jwt.verifyAsync(challengeId); } catch { throw new UnauthorizedException('Desafio inválido ou expirado'); }
    if (c.purpose !== 'mfa-challenge') throw new UnauthorizedException('Desafio inválido ou expirado');
    await this.mfaAttempt(c.sub, code);
    return this.issue(c.sub, c.dev ?? null, randomUUID(), new Date());
  }

  /** Reautenticação para operações sensíveis: renova o "MFA recente" da sessão e devolve novo access token. */
  async stepUp(userId: string, sessionId: string, code: string) {
    await this.mfaAttempt(userId, code);
    await this.db.query(`UPDATE refresh_sessions SET mfa_at=now() WHERE id=$1 AND user_id=$2`, [sessionId, userId]);
    return this.accessToken(userId, sessionId, new Date());
  }

  async enrollMfa(userId: string) { return this.mfa.enroll(userId, (await this.me(userId)).email); }

  /** Confirmar a inscrição prova a posse do dispositivo ⇒ a sessão actual passa a ter MFA verificado. */
  async confirmMfa(userId: string, sessionId: string, code: string) {
    const recovery_codes = await this.mfa.confirm(userId, code);
    await this.db.query(`UPDATE refresh_sessions SET mfa_at=now() WHERE id=$1 AND user_id=$2`, [sessionId, userId]);
    return { recovery_codes, ...(await this.accessToken(userId, sessionId, new Date())) };
  }
  async disableMfa(userId: string, code: string) {
    const lm = LIMITS.mfaFails(); const key = `mfa:fail:${userId}`;
    const pk = await this.limiter.peek(key); if (pk.count >= lm.limit) throw new RateLimitedException(pk.retryAfterSec);
    try { await this.mfa.disable(userId, code); await this.limiter.reset(key); }
    catch (e) { if (e instanceof UnauthorizedException) await this.limiter.hit(key, lm.limit, lm.windowMs); throw e; }
  }

  /** Limita tentativas de código por utilizador e valida; falha ⇒ conta a tentativa. */
  private async mfaAttempt(userId: string, code: string) {
    const lm = LIMITS.mfaFails(); const key = `mfa:fail:${userId}`;
    const pk = await this.limiter.peek(key); if (pk.count >= lm.limit) throw new RateLimitedException(pk.retryAfterSec);
    if (!(await this.mfa.verifyCode(userId, code))) { await this.limiter.hit(key, lm.limit, lm.windowMs); throw new UnauthorizedException('Código inválido'); }
    await this.limiter.reset(key);
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    const hash = sha256(refreshToken);
    return this.db.tx(async (c) => {
      const s = (await c.query(`SELECT id, user_id, device_id, family_id, expires_at, revoked_at, mfa_at FROM refresh_sessions WHERE token_hash=$1 FOR UPDATE`, [hash])).rows[0];
      if (!s) throw new UnauthorizedException();
      if (s.revoked_at) { // reutilização de token rodado => comprometido: revoga a família inteira
        await c.query(`UPDATE refresh_sessions SET revoked_at = now() WHERE family_id=$1 AND revoked_at IS NULL`, [s.family_id]);
        await c.query('COMMIT'); await c.query('BEGIN');
        throw new UnauthorizedException();
      }
      if (new Date(s.expires_at) < new Date()) throw new UnauthorizedException();
      const st = (await c.query(`SELECT status FROM users WHERE id=$1`, [s.user_id])).rows[0];
      if (st?.status !== 'ACTIVE') throw new UnauthorizedException();
      const next = await this.createSession(c, s.user_id, s.device_id, s.family_id, s.mfa_at);
      await c.query(`UPDATE refresh_sessions SET revoked_at = now(), replaced_by=$2 WHERE id=$1`, [s.id, next.sessionId]);
      return this.sign(s.user_id, next.sessionId, next.token, s.mfa_at);
    });
  }

  async logout(sessionId: string) {
    await this.db.query(`UPDATE refresh_sessions SET revoked_at = now() WHERE id=$1 AND revoked_at IS NULL`, [sessionId]);
  }

  async me(userId: string) {
    const r = await this.db.query(
      `SELECT u.id, u.email, u.country_code, u.mfa_enabled, p.display_name, p.locale,
              COALESCE((SELECT array_agg(ro.name::text ORDER BY ro.name) FROM user_roles ur JOIN roles ro ON ro.id=ur.role_id WHERE ur.user_id=u.id), '{}'::text[]) AS roles
         FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id=$1`, [userId]);
    if (!r.rowCount) throw new NotFoundException();
    return { ...r.rows[0], is_admin: r.rows[0].roles.some((x: string) => x.startsWith('admin_') || x === 'super_admin') };
  }

  async listDevices(userId: string) {
    return (await this.db.query(`SELECT id, platform, label, last_seen_at FROM user_devices WHERE user_id=$1 AND revoked_at IS NULL ORDER BY last_seen_at DESC`, [userId])).rows;
  }

  async revokeDevice(userId: string, deviceId: string) {
    const r = await this.db.tx(async (c) => {
      const d = await c.query(`UPDATE user_devices SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id`, [deviceId, userId]);
      if (d.rowCount) await c.query(`UPDATE refresh_sessions SET revoked_at=now() WHERE device_id=$1 AND revoked_at IS NULL`, [deviceId]);
      return d.rowCount;
    });
    if (!r) throw new NotFoundException();
  }

  // ---- internos
  private async upsertDevice(userId: string, d: DeviceInfoDto): Promise<string> {
    const r = await this.db.query(
      `INSERT INTO user_devices (user_id, device_fingerprint, platform, label) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, device_fingerprint) DO UPDATE SET last_seen_at=now(), revoked_at=NULL, platform=EXCLUDED.platform
       RETURNING id`, [userId, d.fingerprint, d.platform, d.label ?? null]);
    return r.rows[0].id;
  }

  private async issue(userId: string, deviceId: string | null, familyId: string, mfaAt: Date | null): Promise<AuthResult> {
    return this.db.tx(async (c) => {
      const s = await this.createSession(c, userId, deviceId, familyId, mfaAt);
      return this.sign(userId, s.sessionId, s.token, mfaAt);
    });
  }

  private async createSession(c: { query: DbService['query'] }, userId: string, deviceId: string | null, familyId: string, mfaAt: Date | null = null) {
    const token = randomBytes(32).toString('base64url');
    const r = await c.query(
      `INSERT INTO refresh_sessions (user_id, device_id, family_id, token_hash, expires_at, mfa_at)
       VALUES ($1,$2,$3,$4, now() + make_interval(days => $5), $6) RETURNING id`,
      [userId, deviceId, familyId, sha256(token), REFRESH_TTL_DAYS, mfaAt]);
    return { sessionId: r.rows[0].id as string, token };
  }

  private async sign(userId: string, sessionId: string, refreshToken: string, mfaAt: Date | null = null): Promise<AuthResult> {
    const { access_token, expires_in } = await this.accessToken(userId, sessionId, mfaAt);
    return { access_token, refresh_token: refreshToken, expires_in };
  }

  /** `mfa_at` (epoch s) vai no token: é o que o PermissionsGuard usa para exigir MFA / MFA recente. */
  private async accessToken(userId: string, sessionId: string, mfaAt: Date | null) {
    const expires_in = Number(process.env.ACCESS_TTL_SECONDS ?? 900);
    const access_token = await this.jwt.signAsync({ sub: userId, sid: sessionId, purpose: 'access', ...(mfaAt ? { mfa_at: Math.floor(+mfaAt / 1000) } : {}) }, { expiresIn: expires_in });
    return { access_token, expires_in };
  }
}
