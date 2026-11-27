# ACCEPTANCE_TESTS — rastreabilidade AC-01…AC-18

Estado: ✅ automatizado e a passar · 🟡 especificado, a implementar com o módulo · ⛔ depende de decisão externa.

| ID | Critério | Estado | Onde |
|---|---|---|---|
| AC-01 | Registo e verificação | ✅ | `apps/api/test/identity.e2e-spec.ts` |
| AC-02 | Isolamento de dados | 🟡 | Catalog/Publisher ✅ (edição alheia → 404); falta orders/library/reading |
| AC-03 | Edição/formatos validados | ✅ | `catalog.e2e-spec.ts` (submissão exige formato READY + preço; aprovação exige contrato) |
| AC-04 | Territórios | ✅ | BD `edition_sellable_in` + API `catalog.e2e-spec.ts` (MZ vê, KP não) |
| AC-05 | Upload inválido rejeitado | ✅ (EPUB/PDF/CBZ/imagem) | `catalog.e2e-spec.ts`. Antivírus (ClamAV) ainda por integrar |
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
| AC-17 | Auditoria | ✅ (BD) + acções de catálogo/admin registadas | cadeia de hash imutável |
| AC-18 | Continuidade documentada | 🟡 | `docs/operations/CONTINUITY_POLICY.md` (revisão jurídica) |

Testes financeiros obrigatórios (Fase 4): pedidos concorrentes do mesmo livro; webhook repetido; pagamento após timeout; worker indisponível; reembolso parcial/total; FX; alteração de preço durante checkout; livro retirado; editora suspensa.
