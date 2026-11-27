# ADR-0010: Upload directo ao bucket e adaptadores RabbitMQ/S3

- **Estado:** Aceite · **Data:** 2026-11-27

## Contexto
O modo "proxy" (a API recebe os bytes) obriga a carregar o ficheiro inteiro em memória da API (limite 512 MB) e não escala. O barramento em processo não sobrevive a reinícios nem permite workers separados.

## Decisão
1. **Upload directo:** com `S3_BUCKET`, `POST /publisher/books/:id/assets` devolve `mode: "direct"` com URL pré-assinada (PUT, `Content-Type` e `Content-Length` assinados, validade 15 min) para um *staging key* (`uploads/…`). O cliente envia ao bucket e chama `POST /uploads/complete` com o `upload_token`. A API verifica tamanho, SHA-256 e conteúdo, grava a chave final endereçada por hash e **apaga sempre o staging** (sucesso ou falha). Sem S3, mantém-se o modo `proxy` para desenvolvimento.
2. **Idempotência por conteúdo:** a chave final inclui o SHA-256; reenviar o mesmo conteúdo devolve a versão existente (`duplicate: true`).
3. **RabbitMQ:** publisher confirms; fila por (consumidor, tipo); retry com TTL; dead-letter após N falhas; reconexão automática; `BrokerUnavailableError` não consome tentativas do outbox.

## Consequências
+ Memória da API independente do tamanho do ficheiro enviado; sobrevive a quedas do broker sem perder eventos.
− A validação ainda lê o ficheiro inteiro para memória (JSZip). Para áudio/ficheiros muito grandes será preciso validação em *streaming* num worker (`book-processor`) — pendente.
− A assinatura de `Content-Length` é imposta por S3/R2/MinIO reais; a API revalida de qualquer forma o tamanho e o hash.
