# SECURITY — decisões e modelo de ameaças (estado actual)

| Ameaça | Controlo | Verificado por |
|---|---|---|
| Roubo de tokens por XSS | Sessão em **cookies httpOnly + SameSite=Lax** (BFF); o JS nunca vê tokens; nada em localStorage | `web-flow.test.mjs` |
| CSRF nas mutações do BFF | Lista de permissões fechada + cabeçalho `X-Requested-With: drp` (não-simples) | `web-flow.test.mjs` |
| **EPUB malicioso com scripts** (os iframes do Readium usam `allow-same-origin allow-scripts`) | Upload **rejeita** `<script>`, handlers `on*`, `javascript:` e `properties="scripted"`; CSP do Readium nos frames (`connect-src 'none'`, `form-action 'none'`) | `catalog.e2e-spec.ts` |
| Acesso a conteúdo sem compra / após reembolso | Token curto + **direito revalidado em cada pedido** | `reader.e2e-spec.ts`, `commerce.e2e-spec.ts` |
| Uma editora a ver dados de outra / editora não aprovada a publicar | Todas as consultas e escritas filtram pela pertença à editora (`publisher_users`); papéis (OWNER/EDITOR/FINANCE/VIEWER) — royalties e pagamentos só OWNER/FINANCE; editora PENDING é recusada pela API | `portals-api.e2e-spec.ts`, `portals-flow.test.mjs` |
| Leitura de ficheiros internos do EPUB / path traversal | Só recursos do manifesto; `..` bloqueado | `reader.e2e-spec.ts` |
| Token de leitura no URL (logs, Referer) | Validade 1 h, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`; **não registar URLs `/v1/read/*` nos logs** (pendente: filtro de logs) | — |
| Pagamento simulado em produção | `SANDBOX_MODE` explícito; a API **recusa arrancar** com `NODE_ENV=production`+`SANDBOX_MODE=true`; endpoints `dev/*` 404 | `sandbox.e2e-spec.ts` |
| Webhooks forjados / repetidos | HMAC + janela anti-replay + `UNIQUE(provider, external_event_id)` | `commerce.e2e-spec.ts` |
| Open redirect (`?next=`) | `safeNext` só aceita caminhos locais | `web-flow.test.mjs` |
| Credenciais / sessões | Argon2id, refresh com rotação e detecção de reutilização | `identity.e2e-spec.ts` |
| **Credential stuffing / força bruta** | Bloqueio **por conta** (5 falhas/15 min, também para e-mails inexistentes: não revela contas) + limite **por IP** (30/min) + registo (10/h/IP) + tentativas de código MFA (5/5 min). Redis partilhado em produção; `Retry-After`; `TRUST_PROXY` para o IP real atrás de CDN (um `X-Forwarded-For` forjado não contorna) | `security.e2e-spec.ts`, `redis.infra-spec.ts` |
| **Contas privilegiadas sem 2.º factor** | **MFA TOTP** (RFC 6238, vetores oficiais testados), segredo cifrado AES-256-GCM, 10 códigos de recuperação só em hash e de uso único, anti-replay por passo. **Administradores** (`admin_*`/`super_admin`) só operam com sessão MFA (403 `MFA_REQUIRED`) e **não podem desativar o MFA**; operações sensíveis (decidir reembolsos) exigem **MFA recente ≤ 15 min** (403 `STEP_UP_REQUIRED` → `/auth/mfa/step-up`) | `security.e2e-spec.ts`, `totp.unit-spec.ts`, `mfa-flow.test.mjs` |

## Pendente (não implementado)
WebAuthn/passkeys · recuperação de palavra-passe (`/auth/forgot-password`) · gestão da chave `MFA_ENC_KEY` num KMS (rotação) · CSP com *nonce* na app · filtro de URLs com token nos logs · antivírus (ClamAV) nos uploads · watermarking · SAST/SCA no CI · pentest · gestão de chaves (KMS) · verificação de assinatura real de fornecedores de pagamento.

> Aviso: o `allow-same-origin` nos iframes do Readium significa que **qualquer** conteúdo activo num EPUB teria acesso ao DOM da app. A rejeição de scripts no upload é, por isso, uma barreira de segurança e não só de qualidade — não a relaxar sem isolar o leitor noutro origin.

## Notas operacionais
- **Rate limiter falha-aberta**: se o Redis cair os pedidos passam (disponibilidade) e o erro fica registado — alertar sobre `rate limiter indisponível`.
- `MFA_ENC_KEY` (32 bytes, base64) é **obrigatória em produção**; sem ela a API não consegue cifrar/decifrar segredos MFA. Perder a chave = todos os utilizadores com MFA ficam bloqueados (usar códigos de recuperação/processo de suporte).
- Os registos `[Mfa] … recusado user=<id>` permitem detetar abuso; nunca incluem o código.

## Adenda: recuperação de palavra-passe e revogação de sessões

- `POST /auth/forgot-password` responde sempre 202 (sem enumeração de contas); limites por IP e por e-mail. O token é um JWT de uso único (impressão digital do hash actual da palavra-passe) com 1 h de validade.
- `POST /auth/reset-password` troca a palavra-passe (argon2id), revoga todas as sessões e regista auditoria; o MFA continua exigido no login seguinte.
- O `JwtAuthGuard` verifica que a família de sessões do token ainda tem refresh activo, pelo que logout e reset invalidam também os access tokens em curso (cache curta `SESSION_CHECK_TTL_MS`).
