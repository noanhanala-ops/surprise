import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DbService } from '../common/db.service';
import { BusEvent, EventBus } from '../events/event-bus';

/**
 * Converte eventos de domínio em linhas de `notifications` (PENDING). O envio real (SMTP/API de e-mail) é feito
 * por um transporte à parte (notification-worker, pendente); aqui garantimos que o pedido nunca se perde.
 */
@Injectable()
export class NotificationsConsumer implements OnModuleInit {
  private log = new Logger('Notifications');
  constructor(private db: DbService, private bus: EventBus) {}
  onModuleInit() { this.bus.subscribe('notifications', 'EmailVerificationRequested', (e) => this.onVerification(e)); }

  async onVerification(e: BusEvent) {
    await this.db.tx(async (c) => {
      const seen = await c.query(`INSERT INTO inbox_events (consumer, event_id) VALUES ('notifications',$1) ON CONFLICT DO NOTHING RETURNING 1`, [e.eventId]);
      if (!seen.rowCount) return;
      const link = `${process.env.WEB_BASE_URL ?? 'http://localhost:3000'}/verify?token=${encodeURIComponent(e.payload.token)}`;
      await c.query(`INSERT INTO notifications (user_id, channel, template, payload) VALUES ($1,'EMAIL','verify_email',$2)`, [e.payload.userId, JSON.stringify({ email: e.payload.email, token: e.payload.token, link })]);
      if (process.env.SANDBOX_MODE === 'true') this.log.log(`[sandbox] e-mail de verificação para ${e.payload.email}: ${link}`);
    });
  }
}
