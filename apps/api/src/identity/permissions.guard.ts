import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DbService } from '../common/db.service';

export const RequirePermission = (code: string) => SetMetadata('permission', code);

/** RBAC: exige a permissão explícita (roles → permissions). Usar depois de JwtAuthGuard. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector, private db: DbService) {}
  async canActivate(ctx: ExecutionContext) {
    const code = this.reflector.get<string>('permission', ctx.getHandler());
    if (!code) return true;
    const user = ctx.switchToHttp().getRequest().user;
    const r = await this.db.query(
      `SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id JOIN users u ON u.id = ur.user_id
        WHERE ur.user_id=$1 AND p.code=$2 AND u.status='ACTIVE' LIMIT 1`, [user.id, code]);
    if (!r.rowCount) throw new ForbiddenException('Permissão insuficiente');
    return true;
  }
}
