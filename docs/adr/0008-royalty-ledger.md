# ADR-0008: Royalties por ledger imutável com snapshot contratual

- **Estado:** Aceite
- **Data:** 2026-11-27

## Contexto
Percentagens, impostos e preços mudam; os pagamentos a editoras têm de ser reproduzíveis.

## Decisão
`royalty_ledger` é append-only (trigger), UNIQUE por `order_item_id`, guarda `eligible_amount_minor` e `percentage_bps` no momento da venda. Reembolsos/chargebacks geram `royalty_adjustments` (também imutáveis). Saldo = vista `publisher_balances`. Pagamentos em lotes (`payout_batches`), nunca por compra; cada linha de ledger só pode ser paga uma vez (UNIQUE em `payout_items`).

## Consequências
+ Auditabilidade total. − Correcções são sempre lançamentos novos.
