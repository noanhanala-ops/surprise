-- 0001 — Extensões, tipos comuns e módulo Identity
-- Convenções: UUID PK, timestamptz (UTC), dinheiro em unidades menores (bigint), ISO-4217/3166.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE DOMAIN currency_code AS char(3) CHECK (VALUE ~ '^[A-Z]{3}$');
CREATE DOMAIN country_code  AS char(2) CHECK (VALUE ~ '^[A-Z]{2}$');
CREATE DOMAIN language_code AS text     CHECK (VALUE ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$');
CREATE DOMAIN money_minor   AS bigint   CHECK (VALUE >= 0);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- Bloqueia UPDATE/DELETE em tabelas de histórico (append-only).
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is forbidden: table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

-- Bloqueia apenas DELETE (registos financeiros/direitos nunca se apagam).
CREATE OR REPLACE FUNCTION forbid_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'DELETE on % is forbidden: retain history', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE TYPE user_status AS ENUM ('PENDING_VERIFICATION','ACTIVE','SUSPENDED','DELETION_REQUESTED','DELETED');
CREATE TYPE device_platform AS ENUM ('WEB','ANDROID','IOS');

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            citext NOT NULL UNIQUE,            -- normalizado (case-insensitive) e único
  password_hash    text,                              -- Argon2id; NULL se login só federado
  status           user_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
  country_code     country_code,
  email_verified_at timestamptz,
  mfa_enabled      boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  CONSTRAINT users_email_format CHECK (email ~ '^[^@\s]+@[^@\s]+$'),
  CONSTRAINT users_active_requires_verified CHECK (status <> 'ACTIVE' OR email_verified_at IS NOT NULL)
);
CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_profiles (
  user_id      uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  locale       text NOT NULL DEFAULT 'en',
  timezone     text NOT NULL DEFAULT 'UTC',
  currency     currency_code,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_devices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_fingerprint text NOT NULL,
  platform           device_platform NOT NULL,
  label              text,
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_fingerprint)
);

CREATE TABLE roles (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE
);
CREATE TABLE permissions (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE                 -- ex.: catalog.book.approve
);
CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);
CREATE TABLE role_permissions (
  role_id       uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE refresh_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id   uuid REFERENCES user_devices(id) ON DELETE SET NULL,
  family_id   uuid NOT NULL,                        -- rotação: reutilização revoga a família
  token_hash  bytea NOT NULL UNIQUE,                -- nunca o token em claro
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  replaced_by uuid REFERENCES refresh_sessions(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_sessions_user_idx ON refresh_sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX refresh_sessions_family_idx ON refresh_sessions (family_id);

CREATE TABLE mfa_credentials (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('TOTP','WEBAUTHN','RECOVERY_CODE')),
  secret_enc  bytea NOT NULL,                       -- cifrado via KMS (envelope)
  confirmed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_addresses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  country     country_code NOT NULL,
  region      text,
  postal_code text,
  is_billing  boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_addresses_user_idx ON user_addresses (user_id);
