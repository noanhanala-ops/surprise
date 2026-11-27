# ACCEPTANCE_TESTS — rastreabilidade AC-01…AC-18

Estado: ✅ automatizado e a passar · 🟡 especificado, a implementar com o módulo · ⛔ depende de decisão externa.

| ID | Critério | Estado | Onde |
|---|---|---|---|
| AC-01 | Registo e verificação | ✅ | `apps/api/test/identity.e2e-spec.ts` |
| AC-02 | Isolamento de dados | 🟡 | Catalog/Publisher ✅ (edição alheia → 404); falta orders/library/reading |
| AC-03 | Edição/formatos validados | ✅ | `catalog.e2e-spec.ts` (submissão exige formato READY + preço; aprovação exige contrato) |
| AC-04 | Territórios | ✅ | BD `edition_sellable_in` + API `catalog.e2e-spec.ts` (MZ vê, KP não) |
| AC-05 | Upload inválido rejeitado | ✅ (EPUB/PDF/CBZ/imagem) | `catalog.e2e-spec.ts`. Antivírus (ClamAV) ainda por integrar |
| AC-06 | Pedido↔pagamento | ✅ | `commerce.e2e-spec.ts` (snapshot, checkout idempotente, valor/moeda divergentes → dead-letter) |
| AC-07 | Webhook duplicado | ✅ | `commerce.e2e-spec.ts` (duplicado, assinatura inválida, replay) |
| AC-08 | Direito único | ✅ | `commerce.e2e-spec.ts` (re-entrega, compras concorrentes) |
| AC-09 | Livro fora do catálogo continua acessível | ✅ | `commerce.e2e-spec.ts` (suspenso: biblioteca e leitura mantidas) |
| AC-10 | Sync de progresso | ✅ (API) | `reading.e2e-spec.ts` (dispositivo desactualizado → 409 sem sobrescrever; 4 escritas concorrentes → 1 vence). Falta teste com apps reais |
| AC-11 | Reembolso auditável | ✅ (total por artigo) | `commerce.e2e-spec.ts`. Parcial por valor ainda não suportado |
| AC-12 | Royalties por contrato | ✅ (bruto) | `commerce.e2e-spec.ts` (70% de 999 = 699; estorno no reembolso). Impostos/taxas PSP ainda não deduzidos |
| AC-13 | Bucket privado | 🟡 | Acesso a ficheiros só via API (direito revalidado) ou URL pré-assinada curta ✅ (`full-stack.infra-spec.ts`); falta IaC/política do bucket e teste de acesso anónimo |
| AC-14 | Sem vulnerabilidades altas | 🟡 | CI: SCA/SAST |
| AC-15 | Restauro de backup | 🟡 | tests/ops mensal |
| AC-16 | Aprovação nas lojas | ⛔ | revisão Apple/Google |
| AC-17 | Auditoria | ✅ (BD) + acções de catálogo/admin registadas | cadeia de hash imutável |
| AC-18 | Continuidade documentada | 🟡 | `docs/operations/CONTINUITY_POLICY.md` (revisão jurídica) |

Testes financeiros já cobertos: compras concorrentes, webhook repetido, pagamento após falha/timeout, broker indisponível (outbox), reconciliação, reembolso total, livro suspenso após compra. **Por cobrir:** reembolso parcial por valor, conversão cambial, alteração de preço durante o checkout, editora suspensa.

Testes financeiros obrigatórios (Fase 4): pedidos concorrentes do mesmo livro; webhook repetido; pagamento após timeout; worker indisponível; reembolso parcial/total; FX; alteração de preço durante checkout; livro retirado; editora suspensa.
