import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DbService } from '../common/db.service';
import { BrokerUnavailableError, EventBus } from './event-bus';

const MAX_ATTEMPTS = 5;

/** Publica eventos do outbox no broker (at-least-once). Vários relays em paralelo são seguros (SKIP LOCKED). */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnModuleDestroy {
  private log = new Logger('OutboxRelay');
  private timer?: NodeJS.Timeout;
  constructor(private db: DbService, private bus: EventBus) {}

  onApplicationBootstrap() {
    const ms = Number(process.env.OUTBOX_POLL_MS ?? 500);
    if (ms > 0) { this.timer = setInterval(() => this.relayOnce().catch((e) => this.log.error(e)), ms); this.timer.unref(); }
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** Devolve quantos eventos foram publicados. */
  async relayOnce(batch = 50): Promise<number> {
    return this.db.tx(async (c) => {
      const { rows } = await c.query(
        `SELECT id, event_id, event_type, payload, created_at, attempts FROM outbox_events
          WHERE published_at IS NULL AND attempts < $2 ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`, [batch, MAX_ATTEMPTS]);
      let ok = 0;
      for (const r of rows) {
        try {
          await this.bus.publish({ eventId: r.event_id, type: r.event_type, occurredAt: r.created_at.toISOString(), payload: r.payload });
          await c.query(`UPDATE outbox_events SET published_at=now() WHERE id=$1`, [r.id]);
          ok++;
        } catch (e: any) {
          if (e instanceof BrokerUnavailableError) { this.log.warn(`broker indisponível; ${rows.length - ok} evento(s) ficam no outbox`); break; } // infra ≠ falha do evento
          await c.query(`UPDATE outbox_events SET attempts = attempts + 1 WHERE id=$1`, [r.id]);
          if (r.attempts + 1 >= MAX_ATTEMPTS)
            await c.query(`INSERT INTO dead_letter_events (source, event_id, event_type, payload, error) VALUES ('outbox',$1,$2,$3,$4)`, [r.event_id, r.event_type, r.payload, String(e?.message ?? e)]);
          this.log.warn(`falha a publicar ${r.event_type} ${r.event_id}: ${e?.message}`);
        }
      }
      return ok;
    });
  }
}
