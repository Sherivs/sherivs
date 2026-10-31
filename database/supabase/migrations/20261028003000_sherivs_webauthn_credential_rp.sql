-- =============================================================================
-- Bind passkey credentials to the relying-party ID they were registered under.
-- Existing sherivs.com credentials keep rp_id = 'sherivs.com' and are not
-- rewritten onto custom tenant domains. A verified custom domain registers a
-- new passkey for that RP ID.
-- Rollback: database/supabase/rollbacks/20261028003000_sherivs_webauthn_credential_rp.sql
-- =============================================================================
BEGIN;

ALTER TABLE public.webauthn_credentials
  ADD COLUMN IF NOT EXISTS rp_id text NOT NULL DEFAULT 'sherivs.com';

ALTER TABLE public.webauthn_credentials
  DROP CONSTRAINT IF EXISTS webauthn_credentials_rp_id_len;
ALTER TABLE public.webauthn_credentials
  ADD CONSTRAINT webauthn_credentials_rp_id_len CHECK (length(rp_id) BETWEEN 1 AND 253);

CREATE INDEX IF NOT EXISTS webauthn_credentials_user_rp_idx
  ON public.webauthn_credentials (user_id, rp_id, created_at DESC);

COMMENT ON COLUMN public.webauthn_credentials.rp_id IS
  'WebAuthn relying-party ID used at registration. Credentials are not portable across unrelated RP IDs.';

COMMIT;
