import { Injectable } from '@nestjs/common';
import { DbService, Queryable } from './db.service';

export interface AuditEntry {
  actorId?: string | null; actorType: 'USER' | 'ADMIN' | 'PUBLISHER' | 'SYSTEM' | 'WORKER';
  action: string; targetType: string; targetId: string; before?: unknown; after?: unknown; reason?: string;
}
/** Escreve em audit_log (append-only, hash encadeado). Passar o `client` para ficar na mesma transacção da acção. */
@Injectable()
export class AuditService {
  constructor(private db: DbService) {}
  async log(e: AuditEntry, client?: Queryable) {
    const q = client ?? this.db;
    await q.query(
      `INSERT INTO audit_log (actor_id, actor_type, action, target_type, target_id, before_data, after_data, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [e.actorId ?? null, e.actorType, e.action, e.targetType, e.targetId,
       e.before === undefined ? null : JSON.stringify(e.before), e.after === undefined ? null : JSON.stringify(e.after), e.reason ?? null]);
  }
}
