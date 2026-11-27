# ARCHITECTURE

Livraria digital global com marketplace de editoras/autores, compra individual, direito de leitura permanente e leitor integrado. Monólito modular + workers independentes ([ADR-0001](../adr/0001-modular-monolith.md)).

## C4 — Contentores
```mermaid
flowchart LR
  subgraph Clients
    Web[Next.js Web<br/>storefront · reader · account]
    And[Android · Kotlin + Readium]
    Ios[iOS · Swift + Readium]
    Adm[Admin · Next.js]
    Pub[Publisher Portal · Next.js]
  end
  Web & And & Ios & Adm & Pub -->|REST /v1| API[NestJS API<br/>14 módulos]
  API --> PG[(PostgreSQL)]
  API --> RD[(Redis)]
  API --> MQ{{RabbitMQ}}
  API --> S3[(Object Storage privado)]
  MQ --> W1[book-processor]
  MQ --> W2[payment-worker]
  MQ --> W3[entitlement-worker]
  MQ --> W4[royalty-worker]
  MQ --> W5[notification-worker]
  MQ --> W6[search-worker] --> OS[(OpenSearch)]
  W1 --> S3
  PSP[Payment providers] -->|webhooks| API
  CDN[Cloudflare CDN] --> S3
```

## Módulos e dependências permitidas
`Identity` ← todos · `Catalog` ← Commerce, Reading, Search · `Content` → Storage · `Publisher` → Catalog, Royalty · `Commerce` → Catalog, Payments (porta) · `Payments` → *eventos* → `Commerce`/`Entitlements` · `Entitlements` ← Reading, Content (autorização) · `Royalty` ← eventos de Commerce · `Audit` ← todos (só escrita).
Regra: **nenhum módulo escreve em tabelas de outro**; integração por interface pública ou evento.

## Fluxo de compra (resumo; detalhe em `docs/commerce/COMMERCE_SPEC.md`)
```mermaid
sequenceDiagram
  actor U as Utilizador
  participant API as Commerce/Payments
  participant PSP as Provider
  participant DB as PostgreSQL
  participant MQ as RabbitMQ
  participant ENT as Entitlements
  U->>API: POST /orders (Idempotency-Key)
  API->>DB: valida direitos territoriais + snapshot de preço
  U->>API: POST /payments/checkout
  API->>PSP: createCheckout
  PSP-->>API: webhook payment.succeeded
  API->>DB: [TX] payment_events + payment_attempts + order PAID + outbox PaymentCaptured
  DB-->>MQ: relay publica (at-least-once)
  MQ->>ENT: PaymentCaptured
  ENT->>DB: [TX] inbox + entitlement (UNIQUE order_item_id) + order FULFILLED + outbox
  U->>API: GET /library
```

## Leitura e sincronização
Progresso por (utilizador, edição) com `version`. `PUT /reading/:id/progress` com `base_version`; se ≠ versão do servidor → **409** com estado canónico, e o cliente decide (por defeito: mantém o mais avançado de forma explícita, nunca sobrescreve em silêncio).

## Publicação de livro
Publisher cria edição (DRAFT) → pede upload pré-assinado → `book-processor` (antivírus → validação → metadados) → admin aprova (verifica contrato/territórios) → PUBLISHED → indexação em OpenSearch.
