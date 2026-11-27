# Digital Reading Platform

Livraria digital global com marketplace de editoras/autores, **compra individual**, **direito de leitura permanente** e leitor integrado (Web, Android, iOS).
Monólito modular (NestJS) + workers · PostgreSQL · Redis · RabbitMQ · S3 · OpenSearch · Readium + PDF.js.

## Estado
**CI verificado no GitHub Actions** (run #6, 6/6 jobs verdes): base de dados, contratos OpenAPI, API (99 testes), web (typecheck+build), infra real (RabbitMQ, Redis, S3 emulado: 20 testes) e E2E no Chromium (30 testes). Corre em `pull_request`, `push` para `main`/`claude/**` e manualmente.

Fase 0 concluída; **Fase 1 iniciada** (módulo Identity). Já validado:

| Artefacto | Local | Validação |
|---|---|---|
| DDL PostgreSQL (6 migrações, 58 tabelas + 1 vista) + seeds RBAC | `database/migrations`, `database/seeds` | aplicado em PostgreSQL 16 |
| Invariantes de BD (24 testes) | `database/tests/invariants.sql` | passam |
| Contrato OpenAPI 3 (55 operações) | `docs/api/openapi.yaml` | `scripts/check_openapi.py` |
| 9 ADRs | `docs/adr` | — |
| Arquitectura, comércio, entitlements, continuidade, ERD, rastreio AC-01…18 | `docs/` | — |
| **API NestJS — módulo Identity** (registo, verificação de e-mail via outbox, login Argon2id, refresh com rotação e deteção de reutilização, dispositivos) | `apps/api` | 10 testes e2e em PostgreSQL real |
| **Catalog, Publisher, Content (validação EPUB/PDF/CBZ), Admin (aprovação, contratos, territórios, suspensão), RBAC e auditoria** | `apps/api` | +15 testes e2e |
| **Commerce, Payments (porta + FakeProvider), Outbox/Inbox, Entitlements, biblioteca/acesso, reembolsos, Royalty ledger, reconciliação** | `apps/api` | 47 testes e2e |
| **Reading API** (progresso versionado multi-dispositivo, marcadores, destaques+notas, sync incremental, preferências) | `apps/api` | 99 testes em PostgreSQL real |
| **Servidor de publicação Readium** (manifesto, lista de posições e recursos do EPUB, com direito revalidado em cada pedido) + pagamento sandbox | `apps/api/src/reader` | 6 testes |
| **App web Next.js** (loja, detalhe, registo/login, checkout sandbox, biblioteca; sessão em cookies httpOnly via BFF) + capas públicas + seed de demonstração | `apps/web/storefront`, `apps/api/scripts` | 8 testes E2E em Chromium contra a pilha completa (`tests/e2e`) |
| **Leitor web Readium** (EPUB, índice, marcadores, temas/tamanho, retoma, sincronização com deteção de conflito entre dispositivos) | `apps/web/storefront/components/Reader.tsx`, `docs/reader/READER_SPEC.md` | 7 testes E2E em Chromium (total 30 E2E) |
| **Segurança P0: MFA TOTP** (obrigatório a administradores, «MFA recente» em reembolsos, códigos de recuperação), **rate limiting em Redis** (conta/IP/registo/MFA), UI de MFA com QR | `apps/api/src/{identity,security}`, `docs/adr/0011-*` | 24 testes novos (RFC 6238, anti-replay, step-up) + 6 Redis real + 5 E2E MFA |
| **Portais Editora e Administração** (registo/aprovação, livros, upload no browser, revisão com contrato/territórios, publicação/devolução/suspensão, vendas, royalties, contratos, reembolsos com step-up MFA) | `apps/web/storefront/app/{publisher,admin}`, `docs/portals/PORTALS_SPEC.md` | 10 E2E Chromium + 7 API |
| Modelo de segurança e ameaças | `docs/security/SECURITY.md` | — |
| **Adaptadores de produção: RabbitMQ** (confirmações, retry, dead-letter, reconexão) **e S3/R2/MinIO** (upload directo por URL pré-assinada) | `apps/api`, ADR-0010 | 14 testes contra RabbitMQ e S3 reais (`npm run test:infra`) |
| Análise de licenças dos 5 repositórios indicados | `docs/architecture/OPEN_SOURCE_REUSE.md` | licenças lidas dos LICENSE |
| Contratos TS (PaymentProvider, eventos) | `packages/contracts` | — |
| Docker Compose de dev, CI | `docker-compose.yml`, `.github/workflows` | — |

## Começar
```bash
docker compose up -d postgres
export DATABASE_URL=postgres://drp:drp_dev_only@localhost:5432/drp
database/migrate.sh --seed
npm ci && npm run build -w @drp/contracts && npm test -w @drp/api
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/invariants.sql
```

## Próxima milestone (demo vertical)
Admin publica um EPUB licenciado → utilizador regista-se → compra em sandbox (`FakeProvider`) → webhook → entitlement permanente → lê no browser (Readium Web).
Ordem sugerida: ~~Identity~~ ✅ → ~~Catalog/Content~~ ✅ ~~→ Commerce/Payments(+outbox) → Entitlements~~ ✅ ~~→ Reading API~~ ✅ → ~~Loja web~~ ✅ → ~~Leitor web (Readium)~~ ✅ → ~~Segurança P0 (MFA + rate limit)~~ ✅ → ~~Portais Admin/Editoras~~ ✅ → encomendas e pedido de reembolso do cliente na UI, destaques/notas na UI, PDF.js, recuperação de palavra-passe, impostos, apps nativas.

## Notas
- `index.html` na raiz é uma página pessoal pré-existente, alheia à plataforma; não foi alterada.
- Reutilização de open-source e restrição ao BookOrbit (AGPL): `docs/architecture/OPEN_SOURCE_REUSE.md`.
