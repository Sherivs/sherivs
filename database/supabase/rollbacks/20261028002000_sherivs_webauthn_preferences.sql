-- Rollback of 20261028002000_sherivs_webauthn_preferences.sql.
BEGIN;
DROP TABLE IF EXISTS public.webauthn_preferences;
COMMIT;
