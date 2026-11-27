# ADR-0002: PostgreSQL como fonte de verdade; DDL SQL versionado

- **Estado:** Aceite
- **Data:** 2026-11-27

## Contexto
O modelo exige constraints avançadas (índices parciais, exclusion constraints, triggers de imutabilidade, citext) que o Prisma não expressa nativamente.

## Decisão
As migrações SQL em `database/migrations` são a fonte de verdade do esquema. O Prisma é usado como cliente de acesso (`prisma db pull` gera o `schema.prisma` a partir do esquema real). Dinheiro em `bigint` de unidades menores; UUIDs; `timestamptz` UTC.

## Consequências
+ Invariantes garantidas pela BD (não só pela aplicação). − Revisão de migrações SQL manual; o `schema.prisma` é derivado, não editado à mão.

## Adenda (2026-11-27) — acesso a dados SQL-first
Na implementação do módulo Identity optou-se por `pg` com SQL explícito (classe `DbService`, transacções via `tx()`), em vez de Prisma: as operações críticas dependem de `ON CONFLICT`, `FOR UPDATE`, índices parciais e `UPDATE … WHERE version = :n`, que ficam mais claras e testáveis em SQL. Prisma pode ser reintroduzido de forma pontual (leituras de catálogo) sem alterar o esquema, que continua a ser definido em `database/migrations`.
