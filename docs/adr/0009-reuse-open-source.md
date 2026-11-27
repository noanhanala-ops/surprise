# ADR-0009: Reutilização de projectos open-source e restrição ao BookOrbit

- **Estado:** Aceite
- **Data:** 2026-11-27

## Contexto
O objectivo é aproveitar projectos existentes, sem comprometer o produto comercial.

## Decisão
Reutilizar como dependências: Readium (leitor), PDF.js, NestJS, OpenSearch. BookOrbit (AGPL-3.0, API instável) é apenas referência de UX/funcionalidades — nenhum código copiado. Antes de qualquer reutilização verificar licença (SBOM/SCA em CI). Ver `docs/architecture/OPEN_SOURCE_REUSE.md`.

## Consequências
+ Menos código a escrever, sem contaminação AGPL. − Cada dependência nova passa por revisão de licença.
