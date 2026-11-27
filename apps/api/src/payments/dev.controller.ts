import { Controller, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../identity/jwt-auth.guard';
import { OutboxRelay } from '../events/outbox-relay.service';
import { signFake } from './fake.provider';
import { PaymentsService } from './payments.service';
import { DbService } from '../common/db.service';
import { randomUUID } from 'crypto';

/** SANDBOX: simula o fornecedor a confirmar o pagamento (assina um webhook real e processa-o pelo caminho normal). Inexistente em produção. */
@UseGuards(JwtAuthGuard)
@Controller('dev')
export class DevController {
  constructor(private payments: PaymentsService, private relay: OutboxRelay, private db: DbService) {}

  @Post('fake-pay/:paymentId') @HttpCode(200)
  async fakePay(@CurrentUser() u: AuthUser, @Param('paymentId', ParseUUIDPipe) id: string) {
    if (process.env.NODE_ENV === 'production' && process.env.ENABLE_FAKE_PROVIDER !== 'true') throw new NotFoundException();
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
