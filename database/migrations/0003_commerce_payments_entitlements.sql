-- 0003 — Commerce, Payments, Entitlements e mensageria fiável (outbox/inbox)
CREATE TYPE order_status AS ENUM ('DRAFT','PENDING_PAYMENT','PAID','FULFILLED','PARTIALLY_REFUNDED','REFUNDED','CANCELLED','FAILED');
CREATE TYPE payment_status AS ENUM ('INITIATED','PENDING','REQUIRES_ACTION','CAPTURED','FAILED','CANCELLED','REFUNDED','PARTIALLY_REFUNDED','DISPUTED');
CREATE TYPE refund_status AS ENUM ('REQUESTED','APPROVED','REJECTED','PROCESSING','COMPLETED','FAILED');
CREATE TYPE entitlement_type AS ENUM ('PURCHASE');
CREATE TYPE entitlement_status AS ENUM ('ACTIVE','SUSPENDED','REVOKED');

CREATE TABLE carts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency   currency_code NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
CREATE TABLE cart_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id         uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  book_edition_id uuid NOT NULL REFERENCES book_editions(id),
  added_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cart_id, book_edition_id)
);

CREATE TABLE orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id),
  currency         currency_code NOT NULL,
  subtotal_minor   money_minor NOT NULL,
  tax_minor        money_minor NOT NULL DEFAULT 0,
  total_minor      money_minor NOT NULL,
  status           order_status NOT NULL DEFAULT 'DRAFT',
  billing_country  country_code NOT NULL,
  idempotency_key  text NOT NULL,                     -- do cliente; evita pedidos duplicados
  pricing_snapshot jsonb NOT NULL,                    -- preços, impostos, condições no momento da compra
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),
  CONSTRAINT order_total_consistent CHECK (total_minor = subtotal_minor + tax_minor)
);
CREATE TRIGGER orders_updated BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX orders_user_idx ON orders (user_id, created_at DESC);
CREATE INDEX orders_status_idx ON orders (status) WHERE status IN ('PENDING_PAYMENT','PAID');
CREATE TRIGGER orders_no_delete BEFORE DELETE ON orders FOR EACH ROW EXECUTE FUNCTION forbid_delete();

CREATE TABLE order_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             uuid NOT NULL REFERENCES orders(id),
  edition_id           uuid NOT NULL REFERENCES book_editions(id),
  publisher_id         uuid NOT NULL REFERENCES publishers(id),
  contract_id          uuid REFERENCES rights_contracts(id),
  unit_price_minor     money_minor NOT NULL,
  discount_minor       money_minor NOT NULL DEFAULT 0,
  tax_minor            money_minor NOT NULL DEFAULT 0,
  commission_bps       int NOT NULL CHECK (commission_bps BETWEEN 0 AND 10000),  -- snapshot do contrato
  UNIQUE (order_id, edition_id),
  CONSTRAINT discount_le_price CHECK (discount_minor <= unit_price_minor)
);
CREATE INDEX order_items_edition_idx ON order_items (edition_id);
CREATE INDEX order_items_publisher_idx ON order_items (publisher_id);
CREATE TRIGGER order_items_no_delete BEFORE DELETE ON order_items FOR EACH ROW EXECUTE FUNCTION forbid_delete();

CREATE TABLE payment_attempts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid NOT NULL REFERENCES orders(id),
  provider           text NOT NULL,                   -- 'mpesa','emola','paystack',...
  provider_reference text,
  amount_minor       money_minor NOT NULL,
  currency           currency_code NOT NULL,
  settlement_currency currency_code,
  fx_rate            numeric(18,8),
  fees_minor         money_minor,
  status             payment_status NOT NULL DEFAULT 'INITIATED',
  captured_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_reference),
  CONSTRAINT captured_has_ts CHECK (status NOT IN ('CAPTURED','PARTIALLY_REFUNDED','REFUNDED') OR captured_at IS NOT NULL)
);
CREATE TRIGGER payment_attempts_updated BEFORE UPDATE ON payment_attempts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX payment_attempts_order_idx ON payment_attempts (order_id);
CREATE INDEX payment_attempts_pending_idx ON payment_attempts (created_at) WHERE status IN ('INITIATED','PENDING','REQUIRES_ACTION');  -- reconciliação

CREATE TABLE payment_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          text NOT NULL,
  external_event_id text NOT NULL,
  payload_hash      bytea NOT NULL,
  payload           jsonb NOT NULL,
  signature_valid   boolean NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  UNIQUE (provider, external_event_id)                -- AC-07: webhook repetido não duplica efeitos
);
CREATE TRIGGER payment_events_no_delete BEFORE DELETE ON payment_events FOR EACH ROW EXECUTE FUNCTION forbid_delete();

CREATE TABLE refunds (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_attempt_id uuid NOT NULL REFERENCES payment_attempts(id),
  order_item_id      uuid REFERENCES order_items(id),
  amount_minor       money_minor NOT NULL CHECK (amount_minor > 0),
  reason             text NOT NULL,
  status             refund_status NOT NULL DEFAULT 'REQUESTED',
  decided_by         uuid REFERENCES users(id),
  provider_reference text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER refunds_updated BEFORE UPDATE ON refunds FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER refunds_no_delete BEFORE DELETE ON refunds FOR EACH ROW EXECUTE FUNCTION forbid_delete();

CREATE TABLE tax_calculations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES orders(id),
  country_code     country_code NOT NULL,
  tax_amount_minor money_minor NOT NULL,
  tax_rate_bps     int,
  tax_rule_version text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------- Entitlements: direito permanente à EDIÇÃO adquirida ----------
CREATE TABLE entitlements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id),
  book_edition_id   uuid NOT NULL REFERENCES book_editions(id),
  order_item_id     uuid NOT NULL UNIQUE REFERENCES order_items(id),   -- idempotência: 1 direito por item
  entitlement_type  entitlement_type NOT NULL DEFAULT 'PURCHASE',
  status            entitlement_status NOT NULL DEFAULT 'ACTIVE',
  granted_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz,                                       -- NULL = permanente
  source            text NOT NULL DEFAULT 'ORDER' CHECK (source IN ('ORDER','ADMIN_GRANT','MIGRATION')),
  revoked_at        timestamptz,
  revocation_reason text,
  revoked_by        uuid REFERENCES users(id),
  CONSTRAINT purchase_is_permanent CHECK (entitlement_type <> 'PURCHASE' OR expires_at IS NULL),
  CONSTRAINT revoked_needs_reason CHECK (status <> 'REVOKED' OR (revoked_at IS NOT NULL AND revocation_reason IS NOT NULL AND revoked_by IS NOT NULL))
);
-- Um único direito activo por (utilizador, edição) => bloqueia compra duplicada concorrente (AC-08)
CREATE UNIQUE INDEX entitlements_one_active_per_edition
  ON entitlements (user_id, book_edition_id) WHERE status IN ('ACTIVE','SUSPENDED');
CREATE INDEX entitlements_user_idx ON entitlements (user_id, status);
CREATE TRIGGER entitlements_no_delete BEFORE DELETE ON entitlements FOR EACH ROW EXECUTE FUNCTION forbid_delete();

-- Histórico imutável de transições de estado do direito
CREATE TABLE entitlement_events (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entitlement_id uuid NOT NULL REFERENCES entitlements(id),
  event_type     text NOT NULL CHECK (event_type IN ('GRANTED','SUSPENDED','REINSTATED','REVOKED')),
  reason         text,
  actor_id       uuid REFERENCES users(id),
  legal_basis    text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER entitlement_events_immutable BEFORE UPDATE OR DELETE ON entitlement_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------- Transactional Outbox / Inbox / Idempotência ----------
CREATE TABLE outbox_events (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id       uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  aggregate_type text NOT NULL,
  aggregate_id   uuid NOT NULL,
  event_type     text NOT NULL,                      -- ex.: PaymentCaptured
  payload        jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz,
  attempts       int NOT NULL DEFAULT 0
);
CREATE INDEX outbox_unpublished_idx ON outbox_events (id) WHERE published_at IS NULL;

CREATE TABLE inbox_events (
  consumer     text NOT NULL,
  event_id     uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)                   -- consumidor idempotente
);

CREATE TABLE idempotency_keys (
  scope           text NOT NULL,
  key             text NOT NULL,
  request_hash    bytea NOT NULL,
  response_status int,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  PRIMARY KEY (scope, key)
);

CREATE TABLE dead_letter_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source      text NOT NULL,
  event_id    uuid,
  event_type  text NOT NULL,
  payload     jsonb NOT NULL,
  error       text NOT NULL,
  failed_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

-- Marca de água por exemplar distribuído (pseudonimizada: sem PII)
CREATE TABLE distribution_watermarks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entitlement_id  uuid NOT NULL REFERENCES entitlements(id),
  format_version_id uuid NOT NULL REFERENCES book_format_versions(id),
  trace_code      text NOT NULL UNIQUE,
  user_pseudonym  text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
