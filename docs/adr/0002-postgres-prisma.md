# ADR-0002: PostgreSQL como fonte de verdade; DDL SQL versionado

- **Estado:** Aceite
- **Data:** 2026-11-27

## Contexto
O modelo exige constraints avançadas (índices parciais, exclusion constraints, triggers de imutabilidade, citext) que o Prisma não expressa nativamente.

## Decisão
As migrações SQL em `database/migrations` são a fonte de verdade do esquema. O Prisma é usado como cliente de acesso (`prisma db pull` gera o `schema.prisma` a partir do esquema real). Dinheiro em `bigint` de unidades menores; UUIDs; `timestamptz` UTC.

## Consequências
+ Invariantes garantidas pela BD (não só pela aplicação). − Revisão de migrações SQL manual; o `schema.prisma` é derivado, não editado à mão.
