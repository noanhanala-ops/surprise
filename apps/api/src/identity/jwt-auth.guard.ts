import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface AuthUser { id: string; sessionId: string; mfaAt: number | null }

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const m = /^Bearer (.+)$/.exec(req.headers['authorization'] ?? '');
    if (!m) throw new UnauthorizedException();
    try {
      const p = await this.jwt.verifyAsync(m[1]);
      if (p.purpose !== 'access') throw new Error('wrong purpose');
      req.user = { id: p.sub, sessionId: p.sid, mfaAt: typeof p.mfa_at === 'number' ? p.mfa_at : null } as AuthUser;
      return true;
    } catch { throw new UnauthorizedException(); }
  }
}
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);
