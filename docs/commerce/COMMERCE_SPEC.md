# COMMERCE_SPEC

## Estados
**Order:** DRAFT → PENDING_PAYMENT → PAID → FULFILLED; ramos CANCELLED, FAILED, PARTIALLY_REFUNDED, REFUNDED.
**Payment:** INITIATED → PENDING/REQUIRES_ACTION → CAPTURED | FAILED | CANCELLED; depois REFUNDED/PARTIALLY_REFUNDED/DISPUTED.
Estados de order e payment são **independentes**: uma order pode estar PAID sem estar FULFILLED (evento ainda por processar).

## Regras
1. `POST /orders` valida por item: edição PUBLISHED, `edition_sellable_in(edition, billing_country)`, utilizador ainda não possui direito activo, preço vigente em `book_prices` na moeda pedida. Grava `pricing_snapshot`, `commission_bps` e `contract_id` no `order_item`.
2. Mesmo `Idempotency-Key` ⇒ mesma resposta (tabela `idempotency_keys` + UNIQUE `(user_id, idempotency_key)` em orders).
3. Pagamento só é confirmado por webhook verificado (ou reconciliação activa via `getPayment`). Redireccionamento de sucesso **não** é prova.
4. Webhook: assinatura → janela anti-replay → INSERT `payment_events` (duplicado ⇒ 202 sem efeitos) → TX única: payment CAPTURED + order PAID + `outbox_events(PaymentCaptured)`.
5. Entitlements consome `PaymentCaptured` via inbox; cria 1 direito por `order_item` (UNIQUE); marca order FULFILLED; emite `EntitlementGranted` (→ Royalty, Notifications).
6. Royalty consome `EntitlementGranted`/`PaymentCaptured`: `eligible = unit_price − discount − tax(se aplicável) − fees` × `percentage_bps` do snapshot.
7. Reconciliação: job periódico sobre `payment_attempts` em INITIATED/PENDING/REQUIRES_ACTION há > N minutos chama `getPayment`; pagamento confirmado após timeout segue o mesmo caminho do webhook.

## Reembolsos
- Antes de disponibilização: reembolso total, sem revogar nada que não foi atribuído.
- Depois: decisão por política legal/contratual do mercado; direitos imperativos do consumidor prevalecem.
- Fraude: suspensão cautelar (`entitlement.status = SUSPENDED`) + contestação.
- Reembolso confirmado ⇒ `royalty_adjustments` negativo; entitlement revisto/revogado só com `reason`, `legal_basis`, ator e auditoria. Nunca apagar order/pagamento.

## Pagamentos: abordagem por mercado (a validar na Fase 0)
Moçambique: M-Pesa/e-Mola (agregador local); ZA: cartões/EFT; UE: cartões/SEPA; EUA: cartões/carteiras. Critérios: país de incorporação, conta de liquidação, suporte a marketplace/KYC de vendedores, chargebacks, custo FX.
