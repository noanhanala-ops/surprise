import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DbService } from '../common/db.service';

export const RequirePermission = (code: string) => SetMetadata('permission', code);
/** Operação sensível: exige que o MFA tenha sido verificado há no máximo `minutes` (senão 403 STEP_UP_REQUIRED → POST /auth/mfa/step-up). */
export const RequireRecentMfa = (minutes = 15) => SetMetadata('recent_mfa', minutes);

/**
 * RBAC + política de MFA. Depois de JwtAuthGuard:
 *  - exige a permissão explícita (roles → permissions);
 *  - quem tem papel administrativo (admin_* / super_admin) só opera com sessão MFA (403 MFA_REQUIRED);
 *  - `@RequireRecentMfa(n)` exige MFA verificado nos últimos n minutos.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector, private db: DbService) {}
  async canActivate(ctx: ExecutionContext) {
    const code = this.reflector.get<string>('permission', ctx.getHandler());
    if (!code) return true;
    const user = ctx.switchToHttp().getRequest().user;
    const r = await this.db.query(
      `SELECT bool_or(p.code=$2) AS has_perm, bool_or(ro.name LIKE 'admin\\_%' OR ro.name='super_admin') AS is_admin
         FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles ro ON ro.id=ur.role_id
         LEFT JOIN role_permissions rp ON rp.role_id=ro.id LEFT JOIN permissions p ON p.id=rp.permission_id
        WHERE u.id=$1 AND u.status='ACTIVE'`, [user.id, code]);
    const row = r.rows[0];
    if (!row?.has_perm) throw new ForbiddenException('Permissão insuficiente');
    if (row.is_admin && !user.mfaAt) throw new ForbiddenException({ message: 'Os administradores têm de autenticar com MFA', code: 'MFA_REQUIRED' });
    const recent = this.reflector.get<number>('recent_mfa', ctx.getHandler());
    if (recent && (!user.mfaAt || Date.now() / 1000 - user.mfaAt > recent * 60)) throw new ForbiddenException({ message: 'Confirme o MFA para esta operação', code: 'STEP_UP_REQUIRED' });
    return true;
  }
}
