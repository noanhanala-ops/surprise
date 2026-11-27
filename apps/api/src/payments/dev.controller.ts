import { Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../identity/jwt-auth.guard';
import { OutboxRelay } from '../events/outbox-relay.service';
import { signFake } from './fake.provider';
import { PaymentsService } from './payments.service';
import { DbService } from '../common/db.service';
import { randomUUID } from 'crypto';

export const sandboxOnly = () => { if (process.env.SANDBOX_MODE !== 'true' || process.env.NODE_ENV === 'production') throw new NotFoundException(); };

/** SANDBOX: simula o fornecedor a confirmar o pagamento (assina um webhook real e processa-o pelo caminho normal). Inexistente em produção. */
@UseGuards(JwtAuthGuard)
@Controller('dev')
export class DevController {
  constructor(private payments: PaymentsService, private relay: OutboxRelay, private db: DbService) {}

  @Post('fake-pay/:paymentId') @HttpCode(200)
  async fakePay(@CurrentUser() u: AuthUser, @Param('paymentId', ParseUUIDPipe) id: string) {
    sandboxOnly();
    const a = (await this.db.query(
      `SELECT pa.provider, pa.provider_reference ref, pa.amount_minor, pa.currency FROM payment_attempts pa JOIN orders o ON o.id=pa.order_id WHERE pa.id=$1 AND o.user_id=$2`, [id, u.id])).rows[0];
    if (!a || a.provider !== 'fake') throw new NotFoundException();
    const raw = Buffer.from(JSON.stringify({ id: `evt_${randomUUID()}`, type: 'payment.succeeded', reference: a.ref, amount_minor: Number(a.amount_minor), currency: a.currency }));
    const ts = String(Math.floor(Date.now() / 1000));
    const r = await this.payments.handleWebhook('fake', { 'x-fake-timestamp': ts, 'x-fake-signature': signFake(raw, ts) }, raw);
    for (let i = 0; i < 5 && (await this.relay.relayOnce()); i++) { /* entrega os eventos já */ }
    return r;
  }

}

/** SANDBOX: equivalente a "clicar no link do e-mail" quando não há transporte de e-mail real. Sem autenticação, por isso só com SANDBOX_MODE=true e nunca em produção. */
@Controller('dev')
export class DevMailController {
  constructor(private db: DbService) {}
  @Get('verification-token')
  async token(@Query('email') email: string) {
    sandboxOnly();
    const r = await this.db.query(`SELECT n.payload->>'token' AS token FROM notifications n JOIN users u ON u.id=n.user_id WHERE u.email=$1 AND n.template='verify_email' ORDER BY n.created_at DESC LIMIT 1`, [email ?? '']);
    if (!r.rowCount) throw new NotFoundException();
    return { token: r.rows[0].token };
  }
}
