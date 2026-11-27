import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DbService } from '../common/db.service';

export interface AuthUser { id: string; sessionId: string; mfaAt: number | null }

@Injectable()
export class JwtAuthGuard implements CanActivate {
  /** sid → instante até ao qual a verificação "sessão viva" é reaproveitada (só resultados positivos). */
  private alive = new Map<string, number>();
  constructor(private jwt: JwtService, private db: DbService) {}

  /**
   * A sessão (família de refresh tokens) tem de estar viva: logout, revogação de dispositivo, reposição de palavra-passe e
   * deteção de reutilização cortam os access tokens de imediato (≤ SESSION_CHECK_TTL_MS, 5 s por omissão) em vez de esperarem
   * pela expiração (15 min). A rotação do refresh mantém sempre 1 membro activo por família, logo não invalida o token anterior.
   */
  private async sessionAlive(sid: string): Promise<boolean> {
    const ttl = Number(process.env.SESSION_CHECK_TTL_MS ?? 5000); const now = Date.now();
    if (ttl > 0 && (this.alive.get(sid) ?? 0) > now) return true;
    const r = await this.db.query(`SELECT 1 FROM refresh_sessions a JOIN refresh_sessions b ON b.family_id=a.family_id AND b.revoked_at IS NULL AND b.expires_at > now() WHERE a.id=$1 LIMIT 1`, [sid]);
    if (!r.rowCount) { this.alive.delete(sid); return false; }
    if (ttl > 0) { this.alive.set(sid, now + ttl); if (this.alive.size > 5000) for (const [k, v] of this.alive) if (v < now) this.alive.delete(k); }
    return true;
  }

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const m = /^Bearer (.+)$/.exec(req.headers['authorization'] ?? '');
    if (!m) throw new UnauthorizedException();
    try {
      const p = await this.jwt.verifyAsync(m[1]);
      if (p.purpose !== 'access') throw new Error('wrong purpose');
      if (!(await this.sessionAlive(p.sid))) throw new Error('session revoked');
      req.user = { id: p.sub, sessionId: p.sid, mfaAt: typeof p.mfa_at === 'number' ? p.mfa_at : null } as AuthUser;
      return true;
    } catch { throw new UnauthorizedException(); }
  }
}
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);
