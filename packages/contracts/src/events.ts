/** Eventos de domínio publicados via outbox (RabbitMQ). Todos incluem eventId para o inbox idempotente. */
export interface DomainEvent<T extends string, P> { eventId: string; type: T; occurredAt: string; payload: P }
export type PaymentCaptured = DomainEvent<'PaymentCaptured', { orderId: string; paymentAttemptId: string; userId: string; currency: string; amountMinor: number; orderItemIds: string[] }>;
export type EntitlementGranted = DomainEvent<'EntitlementGranted', { entitlementId: string; userId: string; editionId: string; orderItemId: string }>;
export type RefundCompleted = DomainEvent<'RefundCompleted', { refundId: string; orderId: string; orderItemIds: string[]; amountMinor: number }>;
export type EditionPublished = DomainEvent<'EditionPublished', { editionId: string }>;
export type FormatProcessed = DomainEvent<'FormatProcessed', { formatVersionId: string; status: 'READY' | 'REJECTED' }>;
export type AnyDomainEvent = PaymentCaptured | EntitlementGranted | RefundCompleted | EditionPublished | FormatProcessed;
