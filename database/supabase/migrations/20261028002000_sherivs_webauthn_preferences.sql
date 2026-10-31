-- =============================================================================
-- SHERIVS WebAuthn preferences (V1 identity)
--
-- Distinct from public.webauthn_credentials: a preference never proves that a
-- passkey exists, and a credential never implies the user wants passkey-first
-- login. Onboarding status is pending | dismissed | enrolled.
--
-- Identity FK is auth.users(id) so control-plane identities are included.
-- Rollback: database/supabase/rollbacks/20261028002000_sherivs_webauthn_preferences.sql
-- =============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.webauthn_preferences (
  user_id             uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  onboarding_status   text NOT NULL DEFAULT 'pending'
                        CHECK (onboarding_status IN ('pending', 'dismissed', 'enrolled')),
  passkey_first       boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.webauthn_preferences IS
  'Passkey onboarding and passkey-first UX preference. Not proof of a registered credential.';
COMMENT ON COLUMN public.webauthn_preferences.passkey_first IS
  'UX preference only. Server credential rows remain the source of truth for registration.';
COMMENT ON COLUMN public.webauthn_preferences.onboarding_status IS
  'pending: eligible to prompt. dismissed: user skipped. enrolled: set only after verified registration.';

CREATE INDEX IF NOT EXISTS webauthn_preferences_status_idx
  ON public.webauthn_preferences (onboarding_status);

DROP TRIGGER IF EXISTS webauthn_preferences_touch ON public.webauthn_preferences;
CREATE TRIGGER webauthn_preferences_touch
  BEFORE UPDATE ON public.webauthn_preferences
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.webauthn_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webauthn_preferences FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.webauthn_preferences
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.webauthn_preferences
  TO service_role;

COMMIT;
