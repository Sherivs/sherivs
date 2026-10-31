-- Rollback of 20261028003000_sherivs_webauthn_credential_rp.sql.
BEGIN;
DROP INDEX IF EXISTS public.webauthn_credentials_user_rp_idx;
ALTER TABLE public.webauthn_credentials DROP CONSTRAINT IF EXISTS webauthn_credentials_rp_id_len;
ALTER TABLE public.webauthn_credentials DROP COLUMN IF EXISTS rp_id;
COMMIT;
