/** Porta de pagamentos (ADR-0005). Commerce/Entitlements dependem só desta interface. */
export type Currency = string; // ISO-4217, ex.: "USD"

export interface CheckoutInput {
  orderId: string;
  amountMinor: number;       // unidades menores
  currency: Currency;
  method: string;            // ex.: "mpesa", "card"
  returnUrl?: string;
  customer: { userId: string; country: string; email?: string };
  idempotencyKey: string;
}
export interface CheckoutResult {
  providerReference: string;
  status: 'PENDING' | 'REQUIRES_ACTION';
  redirectUrl?: string;
  instructions?: Record<string, unknown>;
}
export interface WebhookRequest { headers: Record<string, string>; rawBody: Buffer; receivedAt: Date }
export interface VerifiedPaymentEvent {
  externalEventId: string;   // chave de idempotência (provider, externalEventId)
  type: 'payment.succeeded' | 'payment.failed' | 'refund.succeeded' | 'dispute.opened';
  providerReference: string;
  amountMinor?: number;
  currency?: Currency;
  occurredAt: Date;
  payloadHash: Buffer;
}
export type PaymentStatus = 'PENDING' | 'REQUIRES_ACTION' | 'CAPTURED' | 'FAILED' | 'CANCELLED' | 'REFUNDED' | 'PARTIALLY_REFUNDED' | 'DISPUTED';
export interface RefundInput { providerReference: string; amountMinor: number; reason: string; idempotencyKey: string }
export interface RefundResult { providerRefundReference: string; status: 'PROCESSING' | 'COMPLETED' | 'FAILED' }

export interface PaymentProvider {
  readonly code: string;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  /** Deve lançar se a assinatura for inválida ou o evento for um replay fora da janela. */
  verifyWebhook(request: WebhookRequest): Promise<VerifiedPaymentEvent>;
  getPayment(providerReference: string): Promise<{ status: PaymentStatus; amountMinor: number; currency: Currency }>;
  refund(input: RefundInput): Promise<RefundResult>;
}
