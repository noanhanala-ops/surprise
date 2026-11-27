# Digital Reading Platform

Livraria digital global com marketplace de editoras/autores, **compra individual**, **direito de leitura permanente** e leitor integrado (Web, Android, iOS).
Monólito modular (NestJS) + workers · PostgreSQL · Redis · RabbitMQ · S3 · OpenSearch · Readium + PDF.js.

## Estado
Pacote de engenharia da **Fase 0** (preparação) — sem código de aplicação ainda. Já validado:

| Artefacto | Local | Validação |
|---|---|---|
| DDL PostgreSQL (5 migrações, 80+ tabelas) + seeds RBAC | `database/migrations`, `database/seeds` | aplicado em PostgreSQL 16 |
| Invariantes de BD (24 testes) | `database/tests/invariants.sql` | passam |
| Contrato OpenAPI 3 (55 operações) | `docs/api/openapi.yaml` | `scripts/check_openapi.py` |
| 9 ADRs | `docs/adr` | — |
| Arquitectura, comércio, entitlements, continuidade, ERD, rastreio AC-01…18 | `docs/` | — |
| Contratos TS (PaymentProvider, eventos) | `packages/contracts` | — |
| Docker Compose de dev, CI | `docker-compose.yml`, `.github/workflows` | — |

## Começar
```bash
docker compose up -d postgres
export DATABASE_URL=postgres://drp:drp_dev_only@localhost:5432/drp
database/migrate.sh --seed
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/invariants.sql
```

## Próxima milestone (demo vertical)
Admin publica um EPUB licenciado → utilizador regista-se → compra em sandbox (`FakeProvider`) → webhook → entitlement permanente → lê no browser (Readium Web).
Ordem sugerida: Identity → Catalog/Content (upload+validação EPUB) → Commerce/Payments(+outbox) → Entitlements → Reader web.

## Notas
- `index.html` na raiz é uma página pessoal pré-existente, alheia à plataforma; não foi alterada.
- Reutilização de open-source e restrição ao BookOrbit (AGPL): `docs/architecture/OPEN_SOURCE_REUSE.md`.
