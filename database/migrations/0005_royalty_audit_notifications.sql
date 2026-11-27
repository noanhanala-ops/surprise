-- 0005 — Royalty (ledger append-only), Audit, Notifications
CREATE TYPE payout_status AS ENUM ('DRAFT','APPROVED','PROCESSING','PAID','FAILED','CANCELLED');

CREATE TABLE publisher_payout_accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher_id        uuid NOT NULL REFERENCES publishers(id),
  provider            text NOT NULL,
  external_account_id text NOT NULL,
  kyc_verified_at     timestamptz,
  is_default          boolean NOT NULL DEFAULT false,
  UNIQUE (provider, external_account_id)
);

CREATE TABLE royalty_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher_id uuid NOT NULL REFERENCES publishers(id),
  edition_id   uuid REFERENCES book_editions(id),      -- NULL = regra por defeito da editora
  percentage_bps int NOT NULL CHECK (percentage_bps BETWEEN 0 AND 10000),
  valid_from   timestamptz NOT NULL,
  valid_to     timestamptz,
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

-- Ledger imutável. Nunca recalculado com o preço actual; correcções via royalty_adjustments.
CREATE TABLE royalty_ledger (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher_id      uuid NOT NULL REFERENCES publishers(id),
  order_item_id     uuid NOT NULL REFERENCES order_items(id),
  entry_type        text NOT NULL DEFAULT 'SALE' CHECK (entry_type IN ('SALE')),
  eligible_amount_minor money_minor NOT NULL,           -- após impostos, descontos, taxas
  percentage_bps    int NOT NULL,                       -- snapshot
  amount_minor      money_minor NOT NULL,
  currency          currency_code NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_item_id, entry_type)                    -- idempotência
);
CREATE TRIGGER royalty_ledger_immutable BEFORE UPDATE OR DELETE ON royalty_ledger FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE royalty_adjustments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  royalty_ledger_id uuid NOT NULL REFERENCES royalty_ledger(id),
  amount_minor      bigint NOT NULL CHECK (amount_minor <> 0),   -- positivo ou negativo (reembolso/chargeback)
  reason            text NOT NULL,
  refund_id         uuid REFERENCES refunds(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER royalty_adjustments_immutable BEFORE UPDATE OR DELETE ON royalty_adjustments FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE payout_batches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher_id uuid NOT NULL REFERENCES publishers(id),
  currency     currency_code NOT NULL,
  total_minor  bigint NOT NULL,
  status       payout_status NOT NULL DEFAULT 'DRAFT',
  period_start timestamptz NOT NULL,
  period_end   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payout_items (
  payout_batch_id   uuid NOT NULL REFERENCES payout_batches(id),
  royalty_ledger_id uuid NOT NULL UNIQUE REFERENCES royalty_ledger(id),   -- cada linha paga uma só vez
  PRIMARY KEY (payout_batch_id, royalty_ledger_id)
);
CREATE TABLE payout_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payout_batch_id uuid NOT NULL REFERENCES payout_batches(id),
  event_type      text NOT NULL,
  detail          jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Saldo contabilístico por editora/moeda (derivado do ledger + ajustes - pagamentos)
CREATE VIEW publisher_balances AS
SELECT l.publisher_id, l.currency,
       SUM(l.amount_minor) + COALESCE(SUM(a.adj), 0) AS accrued_minor
  FROM royalty_ledger l
  LEFT JOIN (SELECT royalty_ledger_id, SUM(amount_minor) AS adj FROM royalty_adjustments GROUP BY 1) a
         ON a.royalty_ledger_id = l.id
 GROUP BY l.publisher_id, l.currency;

-- ---------- Audit (append-only, encadeado por hash) ----------
CREATE TABLE audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id    uuid,
  actor_type  text NOT NULL CHECK (actor_type IN ('USER','ADMIN','PUBLISHER','SYSTEM','WORKER')),
  action      text NOT NULL,                       -- ex.: entitlement.revoke
  target_type text NOT NULL,
  target_id   text NOT NULL,
  before_data jsonb,
  after_data  jsonb,
  reason      text,
  ip          inet,
  request_id  text,
  prev_hash   bytea,
  row_hash    bytea,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_target_idx ON audit_log (target_type, target_id);
CREATE INDEX audit_actor_idx ON audit_log (actor_id, created_at DESC);
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE OR REPLACE FUNCTION audit_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev bytea;
BEGIN
  PERFORM pg_advisory_xact_lock(727001);               -- serializa a cadeia
  SELECT row_hash INTO prev FROM audit_log ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := prev;
  NEW.row_hash := digest(
    coalesce(encode(prev,'hex'),'') || NEW.actor_type || NEW.action || NEW.target_type || NEW.target_id ||
    coalesce(NEW.after_data::text,'') || NEW.created_at::text, 'sha256');
  RETURN NEW;
END $$;
CREATE TRIGGER audit_chain_trg BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_chain();

-- ---------- Notifications ----------
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel    text NOT NULL CHECK (channel IN ('EMAIL','PUSH','IN_APP')),
  template   text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}',
  status     text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz
);
CREATE INDEX notifications_pending_idx ON notifications (created_at) WHERE status = 'PENDING';
