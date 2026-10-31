-- Rollback of 20261028001000_sherivs_webauthn_passkeys.sql.
BEGIN;
DROP FUNCTION IF EXISTS public.webauthn_purge_expired_challenges();
DROP FUNCTION IF EXISTS public.webauthn_consume_challenge(text, text);
DROP TABLE IF EXISTS public.webauthn_challenges;
DROP TABLE IF EXISTS public.webauthn_credentials;
COMMIT;
