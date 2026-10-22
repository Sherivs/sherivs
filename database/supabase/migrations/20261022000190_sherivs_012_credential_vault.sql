-- =============================================================================
-- SHERIVS-012 — Sherivs Vault: per-organization credential vault + agent broker.
--
-- NOT APPLIED. Review only (draft PR). Apply after owner approval.
--
-- org_credentials       envelope-encrypted per-organization provider credentials.
--                       Ciphertext + KMS-wrapped data key only; no plaintext.
--                       No client access at all: service_role only.
-- credential_grants     short-lived (<= 5 min), single-use agent grants.
--                       Service_role only; token stored as a SHA-256 hash.
-- credential_access_log append-only audit of every request / approval /
--                       issue / redeem / expiry. Tenant admins may READ their
--                       own organization's rows (the "see who touched my keys"
--                       view). UPDATE / DELETE blocked by trigger for everyone.
-- Rollback: database/supabase/rollbacks/20261022000190_sherivs_012_credential_vault.sql
-- =============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.org_credentials (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL, -- organization id (validated by the server function)
  provider     text NOT NULL CHECK (provider ~ '^[a-z0-9][a-z0-9_.-]{0,62}$'),
  name         text NOT NULL CHECK (name ~ '^[a-z0-9][a-z0-9_.-]{0,62}$'),
  ciphertext   text NOT NULL CHECK (length(ciphertext) > 28),
  wrapped_dek  text NOT NULL,
  key_version  text NOT NULL,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  rotated_at   timestamptz,
  UNIQUE (org_id, provider, name)
);

ALTER TABLE public.org_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_credentials FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.org_credentials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.org_credentials TO service_role;
-- No policies for anon/authenticated: RLS denies every client read and write.

-- Non-secret view so tenant admins can see WHICH credentials exist (never values).
CREATE OR REPLACE VIEW public.org_credential_inventory
WITH (security_invoker = false) AS
  SELECT id, org_id, provider, name, key_version, created_at, rotated_at
    FROM public.org_credentials
   WHERE public.is_super_admin() OR public.is_tenant_admin(org_id::text);
REVOKE ALL ON public.org_credential_inventory FROM PUBLIC, anon;
GRANT SELECT ON public.org_credential_inventory TO authenticated;

CREATE TABLE IF NOT EXISTS public.credential_grants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  agent_id      text NOT NULL CHECK (length(agent_id) BETWEEN 1 AND 200),
  provider      text NOT NULL,
  credential    text NOT NULL,
  action        text NOT NULL,
  purpose       text NOT NULL CHECK (length(btrim(purpose)) BETWEEN 10 AND 500),
  critical      boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'pending_approval'
                CHECK (status IN ('pending_approval','approved','denied','redeemed','expired')),
  ttl_seconds   integer NOT NULL CHECK (ttl_seconds BETWEEN 1 AND 300),
  token_hash    text, -- sha256 hex; cleared on redeem / expiry
  approved_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  issued_at     timestamptz,
  expires_at    timestamptz,
  redeemed_at   timestamptz,
  CONSTRAINT credential_grants_ttl CHECK (
    expires_at IS NULL OR (issued_at IS NOT NULL AND expires_at <= issued_at + interval '5 minutes')),
  CONSTRAINT credential_grants_critical_approved CHECK (
    NOT critical OR status IN ('pending_approval','denied','expired') OR approved_by IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS credential_grants_open_idx
  ON public.credential_grants (status, expires_at) WHERE status IN ('pending_approval','approved');

ALTER TABLE public.credential_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credential_grants FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.credential_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.credential_grants TO service_role;

CREATE TABLE IF NOT EXISTS public.credential_access_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  event      text NOT NULL CHECK (event IN ('requested','denied_policy','approval_requested','approved',
                                            'denied','issued','redeemed','redeem_rejected','expired')),
  grant_id   uuid,
  org_id     uuid NOT NULL,
  agent_id   text NOT NULL,
  provider   text NOT NULL,
  action     text NOT NULL,
  purpose    text NOT NULL,
  actor      text,
  detail     text CHECK (detail IS NULL OR length(detail) <= 500)
);
CREATE INDEX IF NOT EXISTS credential_access_log_org_idx ON public.credential_access_log (org_id, at DESC);

CREATE OR REPLACE FUNCTION public.credential_access_log_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'credential_access_log is append-only';
END;
$$;
DROP TRIGGER IF EXISTS credential_access_log_no_mutation ON public.credential_access_log;
CREATE TRIGGER credential_access_log_no_mutation
  BEFORE UPDATE OR DELETE ON public.credential_access_log
  FOR EACH ROW EXECUTE FUNCTION public.credential_access_log_append_only();
DROP TRIGGER IF EXISTS credential_access_log_no_truncate ON public.credential_access_log;
CREATE TRIGGER credential_access_log_no_truncate
  BEFORE TRUNCATE ON public.credential_access_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.credential_access_log_append_only();

ALTER TABLE public.credential_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credential_access_log FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.credential_access_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.credential_access_log TO authenticated;
GRANT SELECT, INSERT ON TABLE public.credential_access_log TO service_role;

DROP POLICY IF EXISTS credential_access_log_tenant_read ON public.credential_access_log;
CREATE POLICY credential_access_log_tenant_read ON public.credential_access_log
  FOR SELECT TO authenticated
  USING (public.is_tenant_admin(org_id::text) OR public.has_platform_capability('platform.audit.read'));

COMMIT;
