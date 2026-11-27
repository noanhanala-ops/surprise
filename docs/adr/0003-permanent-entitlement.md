# ADR-0003: Direito permanente ligado à edição, imutável e auditável

- **Estado:** Aceite
- **Data:** 2026-11-27

## Contexto
A promessa comercial é compra individual com acesso permanente. Tem de sobreviver a mudanças de preço, saída do catálogo e suspensão da editora.

## Decisão
`entitlements` aponta para `book_edition_id` e `order_item_id` (UNIQUE). `expires_at` é NULL para PURCHASE (CHECK). Índice único parcial impede dois direitos activos para (utilizador, edição). Revogação exige motivo, autor e base legal; `entitlements` nunca é apagado (trigger) e as transições ficam em `entitlement_events` (append-only). Delist/suspensão de edição NÃO altera entitlements.

## Consequências
+ AC-08/AC-09 garantidos na BD. − Revogações excepcionais (fraude, ordem legal) exigem fluxo administrativo com MFA e auditoria.
