# Object storage (S3 / Cloudflare R2 / MinIO)
- **Bucket privado**, sem listagem pública. Capas/previews públicas vão por CDN com chaves próprias (`book_assets.is_public`).
- Chaves: `uploads/<edição>/<uuid>` = *staging* (carregamento directo do cliente); `editions/<edição>/<formato>/<sha256>` = conteúdo final endereçado por hash.
- **Lifecycle obrigatório:** expirar o prefixo `uploads/` ao fim de 1 dia (limpa carregamentos abandonados).
- CORS (para o PUT directo do browser): permitir `PUT` do(s) domínio(s) da loja/portal, cabeçalho `Content-Type`.
- Versionamento activo + cópia noutra região/fornecedor (ver `docs/operations/CONTINUITY_POLICY.md`).
- Dev: `docker compose up -d minio minio-init`.
