# ADR-0011: MFA TOTP, políticas de privilégio e rate limiting em Redis

- **Estado:** Aceite · **Data:** 2026-11-27

## Contexto
A especificação exige MFA obrigatório para administradores/operações privilegiadas e proteção contra credential stuffing. Sem estes controlos a plataforma não pode ir a produção (contas admin controlam preços, contratos e reembolsos).

## Decisão
1. **TOTP (RFC 6238)** implementado sem dependências (testado com os vetores oficiais); segredo cifrado em repouso (AES-256-GCM, `MFA_ENC_KEY`); 10 códigos de recuperação guardados só como SHA-256 e de uso único; **anti-replay** guardando o último passo aceite.
2. **Sessão com MFA**: `refresh_sessions.mfa_at` (copiado pela rotação) e claim `mfa_at` no access token. `PermissionsGuard` exige MFA a quem tem papel `admin_*`/`super_admin` (403 `MFA_REQUIRED`) e `@RequireRecentMfa(n)` exige MFA nos últimos n min (403 `STEP_UP_REQUIRED` → `POST /auth/mfa/step-up`). Administradores não podem desativar o MFA.
3. **Rate limiting** por conta (falhas, incluindo e-mails inexistentes), por IP, por registo e por tentativas de MFA; **Redis** em produção (SET NX PX + INCR, atómico), memória em dev. **Falha-aberta** se o Redis cair (disponibilidade), com registo de erro.

## Consequências
+ Contas privilegiadas protegidas; abuso de credenciais limitado; sem dependências novas para TOTP.
− Perder `MFA_ENC_KEY` bloqueia todos os utilizadores com MFA (guardar no KMS, com cópia). Falha-aberta significa que uma falha do Redis enfraquece temporariamente o bloqueio (alertar). WebAuthn/passkeys ficam para depois.
− Fixed-window permite rajadas na fronteira da janela (aceitável para estes limites; sliding-window se necessário).
