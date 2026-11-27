# ADR-0006: Aplicações móveis nativas (Kotlin/Swift) como reader apps

- **Estado:** Aceite
- **Data:** 2026-11-27

## Contexto
Readium Mobile é Kotlin/Swift; integração com LCP, armazenamento seguro e offline é melhor nativa. As lojas condicionam vendas in-app.

## Decisão
Android (Kotlin/Compose + Readium Kotlin) e iOS (Swift/SwiftUI + Readium Swift). Lançamento como *reader apps*: login com conta web, biblioteca e leitura; compra apenas no website. Contratos partilhados via OpenAPI (clientes gerados), não via React Native.

## Consequências
+ Melhor DRM/offline. − Duas bases de código mobile; validar políticas Apple/Google antes de cada submissão.
