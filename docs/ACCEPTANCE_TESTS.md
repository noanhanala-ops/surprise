# ACCEPTANCE_TESTS — rastreabilidade AC-01…AC-18

Estado: ✅ automatizado e a passar · 🟡 especificado, a implementar com o módulo · ⛔ depende de decisão externa.

| ID | Critério | Estado | Onde |
|---|---|---|---|
| AC-01 | Registo e verificação | 🟡 | tests/e2e (Identity) · BD: `users_active_requires_verified`, email único ✅ |
| AC-02 | Isolamento de dados | 🟡 | tests/security (IDOR em orders/library/reading) |
| AC-03 | Edição/formatos validados | 🟡 | tests/integration (Content) · BD: checksum/estado ✅ |
| AC-04 | Territórios | ✅ (BD) | `database/tests/invariants.sql` → `edition_sellable_in` |
| AC-05 | Upload inválido rejeitado | 🟡 | tests/integration (book-processor) |
| AC-06 | Pedido↔pagamento | 🟡 | tests/integration (Commerce/Payments) |
| AC-07 | Webhook duplicado | ✅ (BD) | UNIQUE `(provider, external_event_id)`; falta teste de API |
| AC-08 | Direito único | ✅ (BD) | UNIQUE `order_item_id`, índice parcial `(user, edição)` |
| AC-09 | Livro fora do catálogo continua acessível | ✅ (BD) | invariante "permanece ACTIVE após delist" |
| AC-10 | Sync de progresso | ✅ (BD CAS) | falta teste multi-dispositivo na API |
| AC-11 | Reembolso auditável | 🟡 | tests/integration; BD: ledger/adjustments/auditoria imutáveis ✅ |
| AC-12 | Royalties por contrato | 🟡 | ROYALTY: snapshot `commission_bps`/`percentage_bps` ✅ (BD) |
| AC-13 | Bucket privado | 🟡 | tests/security + IaC |
| AC-14 | Sem vulnerabilidades altas | 🟡 | CI: SCA/SAST |
| AC-15 | Restauro de backup | 🟡 | tests/ops mensal |
| AC-16 | Aprovação nas lojas | ⛔ | revisão Apple/Google |
| AC-17 | Auditoria | ✅ (BD) | cadeia de hash imutável |
| AC-18 | Continuidade documentada | 🟡 | `docs/operations/CONTINUITY_POLICY.md` (revisão jurídica) |

Testes financeiros obrigatórios (Fase 4): pedidos concorrentes do mesmo livro; webhook repetido; pagamento após timeout; worker indisponível; reembolso parcial/total; FX; alteração de preço durante checkout; livro retirado; editora suspensa.
