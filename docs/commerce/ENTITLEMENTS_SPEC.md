# ENTITLEMENTS_SPEC
- Direito à **edição** adquirida, `expires_at = NULL`, ligado a `order_item_id` (UNIQUE).
- Sem API para o utilizador criar/activar direitos. Só o consumidor de `PaymentCaptured`, `ADMIN_GRANT` (auditado) ou `MIGRATION`.
- Estados: ACTIVE ↔ SUSPENDED (cautelar) → REVOKED (terminal, exige motivo+autor+base legal).
- Registos nunca apagados; histórico em `entitlement_events`.
- Acesso a conteúdo = `entitlement ACTIVE` ∧ dispositivo não revogado ∧ formato `READY`. Edição DELISTED/SUSPENDED no catálogo **não** remove acesso a quem comprou.
- Continuidade: política em `docs/operations/CONTINUITY_POLICY.md`.
