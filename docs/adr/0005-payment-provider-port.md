# ADR-0005: Pagamentos via porta PaymentProvider (sem fornecedor fixo)

- **Estado:** Aceite
- **Data:** 2026-11-27

## Contexto
A empresa começa em Moçambique; disponibilidade de Stripe depende do país de incorporação. M-Pesa/e-Mola, cartões e SEPA exigem fornecedores distintos.

## Decisão
Interface `PaymentProvider { createCheckout, verifyWebhook, getPayment, refund }` em `packages/contracts`. Cada fornecedor é um adaptador; Commerce/Entitlements só conhecem a interface. Adaptador `FakeProvider` para dev/testes. Reconciliação periódica de pagamentos pendentes (índice parcial dedicado). A escolha de fornecedores de produção é decisão da Fase 0 (ver `docs/commerce/PAYMENT_PROVIDERS.md`).

## Consequências
+ Troca de gateway sem reescrever domínio. − Cada adaptador exige testes de contrato e sandbox próprios.
