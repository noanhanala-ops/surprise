# READER_SPEC — leitor web (estado actual)

## Arquitectura
```
Browser ──(cookies httpOnly)──▶ Next.js (BFF) ──(Bearer)──▶ API
   │  iframe(blob) ◀── Readium ts-toolkit (EpubNavigator)
   └─ /v1/read/<token>/manifest.json | positions.json | <recurso>   (rewrite → API, mesmo origin)
```
- **Manifesto e posições** são gerados pela API a partir do EPUB (`apps/api/src/reader`): metadados, readingOrder, resources, TOC (nav EPUB3 ou NCX), capa, layout fixo e lista de posições (≈1 por 1024 bytes comprimidos, algoritmo do Readium). Substitui, no MVP, o `go-toolkit`; este fica como evolução (CBZ, desempenho).
- **Só se servem os recursos declarados no manifesto.** `META-INF/*`, `mimetype`, etc. → 404. Caminhos com `..` → 403/404.
- **Direito revalidado em cada pedido** (token `read` de 1 h + consulta a `entitlements`): revogar corta a leitura de imediato.
- XHTML sem `<head>` é normalizado na entrega (o Readium assume-o).

## Progresso e conflitos (AC-10)
- Servidor = estado canónico, `version` por (utilizador, edição). `PUT progress` leva `base_version`; divergência → **409 com o estado do servidor**.
- Gravação idêntica ao estado actual é *no-op* (não sobe versão).
- O cliente **só grava depois de uma acção do utilizador** (página, índice, teclado, toque, scroll, tamanho de letra); o `positionChanged` inicial do Readium (restauro/reflow) não conta.
- Em 409 o leitor **não sobrescreve**: mostra «Outro dispositivo avançou para X% — Ir para lá / Ficar aqui» e passa a partir da versão do servidor. Gravação com `keepalive` ao esconder/fechar a página; recarrega a sessão aos 55 min (expiração do token).

## Funcionalidades
Índice, marcadores (criar/listar/navegar/apagar), tema claro/sépia/escuro e tamanho de letra (persistidos na conta), teclado (←/→, PgUp/PgDn, Esc), sessões de leitura.

## Fora de âmbito (ainda)
Destaques e notas na UI (a API já existe; usar a Decorator API do Readium) · pesquisa no livro · PDF (PDF.js), comics e audiobooks · offline (Service Worker) · watermarking · Readium LCP (apps nativas, após certificação) · i18n do leitor.

## Testes
`tests/e2e/reader-flow.test.mjs` (Chromium real, pilha completa): abertura, retoma, índice, marcadores, preferências, **dois dispositivos com conflito**, acesso sem sessão.
