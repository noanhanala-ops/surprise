import { Queryable } from '../common/db.service';
/** Insere um evento no outbox na MESMA transacção da alteração de estado. */
export async function emit(c: Queryable, aggregateType: string, aggregateId: string, eventType: string, payload: unknown) {
  await c.query(`INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload) VALUES ($1,$2,$3,$4)`, [aggregateType, aggregateId, eventType, JSON.stringify(payload)]);
}
