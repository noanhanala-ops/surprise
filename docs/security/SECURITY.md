# SECURITY — decisões e modelo de ameaças (estado actual)

| Ameaça | Controlo | Verificado por |
|---|---|---|
| Roubo de tokens por XSS | Sessão em **cookies httpOnly + SameSite=Lax** (BFF); o JS nunca vê tokens; nada em localStorage | `web-flow.test.mjs` |
| CSRF nas mutações do BFF | Lista de permissões fechada + cabeçalho `X-Requested-With: drp` (não-simples) | `web-flow.test.mjs` |
| **EPUB malicioso com scripts** (os iframes do Readium usam `allow-same-origin allow-scripts`) | Upload **rejeita** `<script>`, handlers `on*`, `javascript:` e `properties="scripted"`; CSP do Readium nos frames (`connect-src 'none'`, `form-action 'none'`) | `catalog.e2e-spec.ts` |
| Acesso a conteúdo sem compra / após reembolso | Token curto + **direito revalidado em cada pedido** | `reader.e2e-spec.ts`, `commerce.e2e-spec.ts` |
| Leitura de ficheiros internos do EPUB / path traversal | Só recursos do manifesto; `..` bloqueado | `reader.e2e-spec.ts` |
| Token de leitura no URL (logs, Referer) | Validade 1 h, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`; **não registar URLs `/v1/read/*` nos logs** (pendente: filtro de logs) | — |
| Pagamento simulado em produção | `SANDBOX_MODE` explícito; a API **recusa arrancar** com `NODE_ENV=production`+`SANDBOX_MODE=true`; endpoints `dev/*` 404 | `sandbox.e2e-spec.ts` |
| Webhooks forjados / repetidos | HMAC + janela anti-replay + `UNIQUE(provider, external_event_id)` | `commerce.e2e-spec.ts` |
| Open redirect (`?next=`) | `safeNext` só aceita caminhos locais | `web-flow.test.mjs` |
| Credenciais / sessões | Argon2id, refresh com rotação e detecção de reutilização | `identity.e2e-spec.ts` |

## Pendente (não implementado)
MFA · rate limiting / credential stuffing · CSP com *nonce* na app · filtro de URLs com token nos logs · antivírus (ClamAV) nos uploads · watermarking · SAST/SCA no CI · pentest · gestão de chaves (KMS) · verificação de assinatura real de fornecedores de pagamento.

> Aviso: o `allow-same-origin` nos iframes do Readium significa que **qualquer** conteúdo activo num EPUB teria acesso ao DOM da app. A rejeição de scripts no upload é, por isso, uma barreira de segurança e não só de qualidade — não a relaxar sem isolar o leitor noutro origin.
