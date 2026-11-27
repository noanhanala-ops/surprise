# ADR-0004: Transactional Outbox, Inbox e idempotência ponta-a-ponta

- **Estado:** Aceite
- **Data:** 2026-11-27

## Contexto
Payments não pode criar direitos directamente; webhooks chegam duplicados e fora de ordem; o broker pode estar indisponível.

## Decisão
Webhook: verificar assinatura + anti-replay → INSERT em `payment_events` (UNIQUE provider+external_event_id) → actualizar `payment_attempts` → INSERT em `outbox_events`, tudo na mesma transacção. Um relay publica no RabbitMQ (at-least-once). Consumidores usam `inbox_events` (PK consumer+event_id) e `entitlements.order_item_id` UNIQUE. Falhas repetidas vão para `dead_letter_events`. Endpoints de escrita críticos usam `Idempotency-Key`.

## Consequências
+ Sem direitos duplicados nem perdidos; recuperação após falha do broker. − Latência adicional (ms–s) entre pagamento e atribuição; UI deve mostrar estado 'a processar'.
