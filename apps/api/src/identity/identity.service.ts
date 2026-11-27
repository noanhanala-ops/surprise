import { ConflictException, ForbiddenException, Injectable, UnauthorizedException, BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { DbService } from '../common/db.service';
import { DeviceInfoDto, LoginDto, RegisterDto } from './dto';

const REFRESH_TTL_DAYS = 30;
const sha256 = (s: string) => createHash('sha256').update(s).digest();
const ARGON = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const; // OWASP min.

export interface AuthResult { access_token: string; refresh_token: string; expires_in: number }

@Injectable()
export class IdentityService {
  private dummyHash?: Promise<string>;
  constructor(private db: DbService, private jwt: JwtService) {}

  async register(dto: RegisterDto) {
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

  async login(dto: LoginDto): Promise<AuthResult> {
    const r = await this.db.query(`SELECT id, password_hash, status, mfa_enabled FROM users WHERE email=$1`, [dto.email.trim()]);
    const u = r.rows[0];
    // Verificação de tempo constante-ish: faz sempre um hash, exista ou não o utilizador.
    this.dummyHash ??= argon2.hash('dummy-password-for-timing', ARGON);
    const ok = await argon2.verify(u?.password_hash ?? (await this.dummyHash), dto.password).catch(() => false);
    if (!u || !ok) throw new UnauthorizedException('Credenciais inválidas');
    if (u.status !== 'ACTIVE') throw new UnauthorizedException('Credenciais inválidas');
    if (u.mfa_enabled) throw new ForbiddenException({ code: 'MFA_REQUIRED', message: 'MFA ainda não implementado nesta versão' });
    const deviceId = dto.device ? await this.upsertDevice(u.id, dto.device) : null;
    return this.issue(u.id, deviceId, randomUUID());
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    const hash = sha256(refreshToken);
    return this.db.tx(async (c) => {
      const s = (await c.query(`SELECT id, user_id, device_id, family_id, expires_at, revoked_at FROM refresh_sessions WHERE token_hash=$1 FOR UPDATE`, [hash])).rows[0];
      if (!s) throw new UnauthorizedException();
      if (s.revoked_at) { // reutilização de token rodado => comprometido: revoga a família inteira
        await c.query(`UPDATE refresh_sessions SET revoked_at = now() WHERE family_id=$1 AND revoked_at IS NULL`, [s.family_id]);
        await c.query('COMMIT'); await c.query('BEGIN');
        throw new UnauthorizedException();
      }
      if (new Date(s.expires_at) < new Date()) throw new UnauthorizedException();
      const st = (await c.query(`SELECT status FROM users WHERE id=$1`, [s.user_id])).rows[0];
      if (st?.status !== 'ACTIVE') throw new UnauthorizedException();
      const next = await this.createSession(c, s.user_id, s.device_id, s.family_id);
      await c.query(`UPDATE refresh_sessions SET revoked_at = now(), replaced_by=$2 WHERE id=$1`, [s.id, next.sessionId]);
      return this.sign(s.user_id, next.sessionId, next.token);
    });
  }

  async logout(sessionId: string) {
    await this.db.query(`UPDATE refresh_sessions SET revoked_at = now() WHERE id=$1 AND revoked_at IS NULL`, [sessionId]);
  }

  async me(userId: string) {
    const r = await this.db.query(
      `SELECT u.id, u.email, u.country_code, u.mfa_enabled, p.display_name, p.locale
         FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id=$1`, [userId]);
    if (!r.rowCount) throw new NotFoundException();
    return r.rows[0];
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

  private async issue(userId: string, deviceId: string | null, familyId: string): Promise<AuthResult> {
    return this.db.tx(async (c) => {
      const s = await this.createSession(c, userId, deviceId, familyId);
      return this.sign(userId, s.sessionId, s.token);
    });
  }

  private async createSession(c: { query: DbService['query'] }, userId: string, deviceId: string | null, familyId: string) {
    const token = randomBytes(32).toString('base64url');
    const r = await c.query(
      `INSERT INTO refresh_sessions (user_id, device_id, family_id, token_hash, expires_at)
       VALUES ($1,$2,$3,$4, now() + make_interval(days => $5)) RETURNING id`,
      [userId, deviceId, familyId, sha256(token), REFRESH_TTL_DAYS]);
    return { sessionId: r.rows[0].id as string, token };
  }

  private async sign(userId: string, sessionId: string, refreshToken: string): Promise<AuthResult> {
    const expires_in = Number(process.env.ACCESS_TTL_SECONDS ?? 900);
    const access_token = await this.jwt.signAsync({ sub: userId, sid: sessionId, purpose: 'access' }, { expiresIn: expires_in });
    return { access_token, refresh_token: refreshToken, expires_in };
  }
}
