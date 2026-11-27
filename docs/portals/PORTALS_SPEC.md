# PORTALS_SPEC — portais de Editoras e de Administração (estado actual)

Implementados na mesma app Next.js (`apps/web/storefront`, rotas `/publisher/*` e `/admin/*`), com o mesmo BFF/cookies httpOnly. A separação em apps distintas (`apps/admin`, `apps/publisher-portal`) prevista no monorepo fica para quando houver equipas/deploys independentes.

## Portal da editora (`/publisher`)
| Página | O que faz |
|---|---|
| `/publisher` | Registo da editora/autor independente (fica **PENDING** até aprovação) · lista de livros e estados |
| `/publisher/books/new` | Criar rascunho: título, descrição, idioma, ISBN, preços USD/MZN/EUR |
| `/publisher/books/[id]` | Editar (só em rascunho) · **upload no browser** de EPUB e capa (SHA-256 calculado no cliente; directo ao bucket em produção, pelo mesmo origin em dev) · lista de versões com estado e **motivo de rejeição** · motivo da última devolução editorial · submeter para revisão |
| `/publisher/sales` | Unidades, reembolsos e receita bruta por livro/moeda |
| `/publisher/royalties` | Saldo acumulado por moeda e ledger com ajustes — **só OWNER/FINANCE** |
| `/publisher/contracts` | Contratos, comissão e territórios (SELL/DENY) |
Regras: editora não aprovada não cria livros (a **API** recusa, não só a UI); cada editora só vê os seus dados (404/403 caso contrário).

## Administração (`/admin`) — exige MFA
| Página | O que faz |
|---|---|
| `/admin` | Contadores: editoras por aprovar, livros em revisão, reembolsos por decidir |
| `/admin/publishers` | Aprovar editoras (mostra o e-mail do responsável) |
| `/admin/reviews` · `[id]` | Fila por estado · detalhe com metadados extraídos do EPUB, preços, contrato, histórico · **registar contrato** (comissão, territórios de venda/exclusão) · **aprovar/publicar** (exige contrato, preço e ficheiro válido) · **devolver com motivo** · **suspender** (não revoga acessos) |
| `/admin/refunds` | Pedidos por decidir com cliente, livro, valor, motivo, direito · aprovar/rejeitar com motivo e, opcionalmente, **revogar o direito** (exige base legal) · **step-up de MFA** integrado |
Sem MFA a administração mostra o aviso para o ativar; utilizadores sem papel admin recebem «Sem permissões» e nem vêem a ligação no menu.

## Fora de âmbito (ainda)
Gestão de utilizadores e de contratos existentes (editar/terminar) · lotes de pagamento a editoras (`payout_batches`) · painel de monitorização de jobs de conteúdo · pesquisa/filtros avançados · página «as minhas encomendas» e pedido de reembolso pelo cliente na UI · edição de nova versão de um livro já publicado.

## Testes
`tests/e2e/portals-flow.test.mjs` (10 testes, Chromium real): registo → pendente → MFA do admin → aprovação → criação de livro → upload inválido recusado e válido aceite → submissão → contrato e publicação → loja → devolução com motivo → isolamento → compra → vendas/royalties → reembolso com step-up e estorno.
API: `apps/api/test/portals-api.e2e-spec.ts` (7 testes).
