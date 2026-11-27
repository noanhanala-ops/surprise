-- 0006 — MFA: protecção contra replay de TOTP e "MFA recente" por sessão
ALTER TABLE mfa_credentials ADD COLUMN last_used_step bigint;               -- último passo TOTP aceite (anti-replay)
ALTER TABLE mfa_credentials ADD CONSTRAINT mfa_one_totp_per_user EXCLUDE USING btree (user_id WITH =) WHERE (kind = 'TOTP');
ALTER TABLE refresh_sessions ADD COLUMN mfa_at timestamptz;                  -- NULL = sessão sem MFA; senão, quando foi verificada
CREATE INDEX mfa_credentials_user_idx ON mfa_credentials (user_id, kind);
