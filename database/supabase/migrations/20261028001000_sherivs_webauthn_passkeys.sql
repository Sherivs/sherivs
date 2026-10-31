-- =============================================================================
-- SHERIVS WebAuthn / passkeys (V1 identity)
--
-- Stores only verified public-key credential metadata required to authenticate.
-- Never stores biometric scans, fingerprint images, facial templates, or
-- private keys. The authenticator keeps those on-device.
--
-- Identity FK is auth.users(id): public.users is a tenant membership overlay
-- and is absent for control-plane / super-admin identities. Do not FK this
-- table to public.users.
--
-- Challenges are server-issued, single-use, and expired by
-- webauthn_consume_challenge (service_role only). Clients have no table access.
-- Rollback: database/supabase/rollbacks/20261028001000_sherivs_webauthn_passkeys.sql
-- =============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.webauthn_credentials (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id   text NOT NULL,
  public_key      text NOT NULL,
  counter         bigint NOT NULL DEFAULT 0 CHECK (counter >= 0),
  device_type     text NOT NULL DEFAULT 'singleDevice'
                    CHECK (device_type IN ('singleDevice', 'multiDevice')),
  backed_up       boolean NOT NULL DEFAULT false,
  transports      text[] NOT NULL DEFAULT '{}',
  aaguid          text,
  label           text NOT NULL DEFAULT 'Passkey'
                    CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz,
  CONSTRAINT webauthn_credentials_credential_id_key UNIQUE (credential_id),
  CONSTRAINT webauthn_credentials_public_key_len CHECK (length(public_key) BETWEEN 16 AND 4096),
  CONSTRAINT webauthn_credentials_credential_id_len CHECK (length(credential_id) BETWEEN 16 AND 1024)
);

COMMENT ON TABLE public.webauthn_credentials IS
  'WebAuthn public-key credentials for Sherivs passkey sign-in. Public keys only; never biometrics or private keys.';
COMMENT ON COLUMN public.webauthn_credentials.public_key IS
  'Base64url-encoded COSE public key from attestation. Not a private key and not a biometric template.';
COMMENT ON COLUMN public.webauthn_credentials.credential_id IS
  'Base64url credential ID returned by the authenticator.';
COMMENT ON COLUMN public.webauthn_credentials.counter IS
  'Authenticator signature counter. 0 is valid for authenticators that do not increment.';

CREATE INDEX IF NOT EXISTS webauthn_credentials_user_id_idx
  ON public.webauthn_credentials (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.webauthn_challenges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge    text NOT NULL,
  ceremony     text NOT NULL CHECK (ceremony IN ('registration', 'authentication')),
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  rp_id        text NOT NULL,
  origin       text NOT NULL,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webauthn_challenges_challenge_key UNIQUE (challenge),
  CONSTRAINT webauthn_challenges_challenge_len CHECK (length(challenge) BETWEEN 16 AND 512),
  CONSTRAINT webauthn_challenges_origin_len CHECK (length(origin) BETWEEN 8 AND 300)
);

COMMENT ON TABLE public.webauthn_challenges IS
  'One-time WebAuthn ceremony challenges. Consumed atomically; never reused.';
COMMENT ON COLUMN public.webauthn_challenges.user_id IS
  'Set for registration (authenticated user). Null for discoverable authentication until assertion.';

CREATE INDEX IF NOT EXISTS webauthn_challenges_expires_idx
  ON public.webauthn_challenges (expires_at)
  WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS webauthn_challenges_user_idx
  ON public.webauthn_challenges (user_id, ceremony)
  WHERE consumed_at IS NULL;

CREATE OR REPLACE FUNCTION public.webauthn_consume_challenge(
  p_challenge text,
  p_ceremony text
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  ceremony text,
  rp_id text,
  origin text,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_challenge IS NULL OR length(p_challenge) < 16 OR length(p_challenge) > 512 THEN
    RETURN;
  END IF;
  IF p_ceremony NOT IN ('registration', 'authentication') THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.webauthn_challenges AS c
     SET consumed_at = now()
   WHERE c.challenge = p_challenge
     AND c.ceremony = p_ceremony
     AND c.consumed_at IS NULL
     AND c.expires_at > now()
  RETURNING c.id, c.user_id, c.ceremony, c.rp_id, c.origin, c.expires_at;
END;
$$;

COMMENT ON FUNCTION public.webauthn_consume_challenge(text, text) IS
  'Atomically consume a single unused, unexpired WebAuthn challenge. Empty result means expired, replayed, or unknown.';

CREATE OR REPLACE FUNCTION public.webauthn_purge_expired_challenges()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM public.webauthn_challenges
   WHERE expires_at < now() - interval '1 day'
      OR (consumed_at IS NOT NULL AND consumed_at < now() - interval '1 day');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

ALTER TABLE public.webauthn_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webauthn_credentials FORCE ROW LEVEL SECURITY;
ALTER TABLE public.webauthn_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webauthn_challenges FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.webauthn_credentials, public.webauthn_challenges
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.webauthn_credentials, public.webauthn_challenges
  TO service_role;

REVOKE ALL ON FUNCTION public.webauthn_consume_challenge(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.webauthn_consume_challenge(text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.webauthn_purge_expired_challenges()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.webauthn_purge_expired_challenges()
  TO service_role;

-- No authenticated/anon policies: listing, rename, and removal go through
-- authenticated server functions that use the service role after binding the
-- row to the session user. Challenges are never client-readable.

COMMIT;
