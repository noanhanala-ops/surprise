import { Injectable } from '@nestjs/common';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import type { CheckoutInput, CheckoutResult, PaymentProvider, PaymentStatus, RefundInput, RefundResult, VerifiedPaymentEvent, WebhookRequest } from '@drp/contracts';

const secret = () => {
  const s = process.env.FAKE_PROVIDER_SECRET ?? (process.env.NODE_ENV === 'production' ? '' : 'dev-fake-provider-secret');
  if (!s) throw new Error('FAKE_PROVIDER_SECRET em falta'); return s;
};
export const signFake = (body: string | Buffer, ts: string) => createHmac('sha256', secret()).update(`${ts}.`).update(body).digest('hex');
const TOLERANCE_MS = 5 * 60_000;

/** Fornecedor simulado (dev/testes/sandbox). Assina webhooks com HMAC-SHA256 + timestamp (anti-replay). NUNCA activar em produção. */
@Injectable()
export class FakeProvider implements PaymentProvider {
  readonly code = 'fake';
  /** Estado "do lado do fornecedor", para a reconciliação. */
  readonly remote = new Map<string, { status: PaymentStatus; amountMinor: number; currency: string }>();

  async createCheckout(i: CheckoutInput): Promise<CheckoutResult> {
    const ref = `fake_${randomUUID()}`;
    this.remote.set(ref, { status: 'PENDING', amountMinor: i.amountMinor, currency: i.currency });
    return { providerReference: ref, status: 'REQUIRES_ACTION', redirectUrl: `https://sandbox.invalid/pay/${ref}` };
  }

  async verifyWebhook(req: WebhookRequest): Promise<VerifiedPaymentEvent> {
    const ts = req.headers['x-fake-timestamp']; const sig = req.headers['x-fake-signature'];
    if (!ts || !sig) throw new Error('assinatura em falta');
    if (Math.abs(req.receivedAt.getTime() - Number(ts) * 1000) > TOLERANCE_MS) throw new Error('timestamp fora da janela (replay)');
    const expected = Buffer.from(signFake(req.rawBody, ts), 'hex'); const got = Buffer.from(sig, 'hex');
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) throw new Error('assinatura inválida');
    const b = JSON.parse(req.rawBody.toString('utf8'));
    return { externalEventId: String(b.id), type: b.type, providerReference: String(b.reference), amountMinor: b.amount_minor, currency: b.currency,
      occurredAt: new Date(b.occurred_at ?? req.receivedAt), payloadHash: createHash('sha256').update(req.rawBody).digest() };
  }

  async getPayment(ref: string) {
    const p = this.remote.get(ref); if (!p) throw new Error('referência desconhecida'); return p;
  }
  async refund(i: RefundInput): Promise<RefundResult> {
    if (!this.remote.has(i.providerReference)) throw new Error('referência desconhecida');
    return { providerRefundReference: `fake_ref_${randomUUID()}`, status: 'COMPLETED' };
  }
}
