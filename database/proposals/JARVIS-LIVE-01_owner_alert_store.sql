-- PROPOSAL ONLY. NOT APPLIED. NOT IN THE MIGRATIONS DIRECTORY.
-- Authority: Owner (instruction of 2026-11-16 to build the durable alert store and switch the
-- delivery gateway on). Origin: JARVIS-LIVE-01. Creator: Claude. Created: 2026-11-16.
-- Status: Proposed. Apply as migration 20261116000100_sherivs_jarvis_live01_owner_alert_store.
--
-- Durable store for the owner-alert runtime (ADR-082, ENGINE-04, ENGINE-09):
--   owner_alerts            one row per alert, deduplicated while open
--   owner_alert_deliveries  one row per channel attempt, unique by idempotency key
--   owner_alert_channels    the per-channel switch (the delivery-gateway toggle)
--   owner_alert_settings    one row: test or live mode, quiet hours, recorded live authorization
--   platform_service_identities  the governed service principal svc:jarvis (status and permissions)
--
-- Rules:
--  * Deny by default. FORCE RLS on every table. Authenticated users may only SELECT, and only
--    with platform.audit.read. Every write is service-role only (the runtime tick, and the
--    console server function after it has verified the passkey step-up).
--  * No contact detail (phone number, WhatsApp number, email address) is ever stored here. They
--    are read from server configuration at send time. A row may name a channel, never a person.
--  * The migration ships the gateway OFF in practice: all four channels start enabled for TEST
--    mode only, and the settings row starts in mode 'test'. Nothing can reach a real contact
--    until the owner records a live authorization (approval_ref, approved_by, channels,
--    expires_at) AND the server has the contact and provider secrets.
--  * No function is created, so no search_path exposure.

BEGIN;

CREATE TABLE IF NOT EXISTS public.owner_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key      text NOT NULL CHECK (dedupe_key ~ '^[A-Za-z0-9._:/-]{1,160}$'),
  severity        text NOT NULL CHECK (severity IN ('S1', 'S2', 'S3', 'S4')),
  title           text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  console_path    text NOT NULL CHECK (console_path ~ '^/[A-Za-z0-9._~!$&''()*+,;=:@/-]{0,200}$'),
  source          text NOT NULL CHECK (source ~ '^[a-z][a-z0-9_.-]{1,60}$'),
  status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'acknowledged', 'resolved')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  resolved_at     timestamptz,
  CONSTRAINT owner_alerts_ack_consistent CHECK
    ((status = 'open') OR (acknowledged_at IS NOT NULL) OR (status = 'resolved'))
);
CREATE UNIQUE INDEX IF NOT EXISTS owner_alerts_one_open_per_key
  ON public.owner_alerts (dedupe_key) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS owner_alerts_recent_idx
  ON public.owner_alerts (created_at DESC);

CREATE TABLE IF NOT EXISTS public.owner_alert_deliveries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id         uuid NOT NULL REFERENCES public.owner_alerts(id) ON DELETE CASCADE,
  channel          text NOT NULL CHECK (channel IN ('voice', 'whatsapp', 'sms', 'email', 'console')),
  destination_kind text NOT NULL
                     CHECK (destination_kind IN ('in_app', 'test_sink', 'registered_contact')),
  status           text NOT NULL CHECK (status IN ('claimed', 'sent', 'failed', 'skipped')),
  reason_code      text CHECK (reason_code IS NULL OR reason_code ~ '^[a-z][a-z0-9_]{1,60}$'),
  provider_ref     text CHECK (provider_ref IS NULL OR char_length(provider_ref) <= 120),
  idempotency_key  text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 3 AND 200),
  created_at       timestamptz NOT NULL DEFAULT now(),
  attempted_at     timestamptz,
  CONSTRAINT owner_alert_deliveries_idempotent UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS owner_alert_deliveries_alert_idx
  ON public.owner_alert_deliveries (alert_id, channel);

CREATE TABLE IF NOT EXISTS public.owner_alert_channels (
  channel     text PRIMARY KEY CHECK (channel IN ('voice', 'whatsapp', 'sms', 'email')),
  enabled     boolean NOT NULL DEFAULT false,
  updated_by  text NOT NULL DEFAULT 'migration',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.owner_alert_settings (
  singleton            boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  mode                 text NOT NULL DEFAULT 'test' CHECK (mode IN ('test', 'live')),
  quiet_start_hour     integer CHECK (quiet_start_hour BETWEEN 0 AND 23),
  quiet_end_hour       integer CHECK (quiet_end_hour BETWEEN 0 AND 23),
  utc_offset_minutes   integer NOT NULL DEFAULT 60 CHECK (utc_offset_minutes BETWEEN -720 AND 840),
  live_approval_ref    text,
  live_approved_by     text,
  live_channels        text[] NOT NULL DEFAULT '{}'
                         CHECK (live_channels <@ ARRAY['voice', 'whatsapp', 'sms', 'email']),
  live_expires_at      timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owner_alert_live_needs_authorization CHECK
    (mode = 'test' OR (live_approval_ref IS NOT NULL AND live_approved_by IS NOT NULL
                       AND live_expires_at IS NOT NULL AND cardinality(live_channels) > 0))
);

CREATE TABLE IF NOT EXISTS public.platform_service_identities (
  code               text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9-]{1,40}$'),
  display_name       text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  permissions        text[] NOT NULL DEFAULT '{}',
  credential_policy  text NOT NULL DEFAULT 'short_lived'
                       CHECK (credential_policy IN ('short_lived', 'rotated', 'static_restricted')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  status_changed_at  timestamptz,
  status_changed_by  text,
  -- A service identity can never be granted these, whatever a row says.
  CONSTRAINT service_identity_no_forbidden_permission CHECK (
    NOT (permissions && ARRAY['approval.decide', 'secrets.read', 'finance.write',
      'credentials.create', 'identity.create', 'policy.change', 'migration.apply',
      'production.deploy'])
  )
);

INSERT INTO public.platform_service_identities (code, display_name, status, permissions) VALUES
  ('jarvis', 'JARVIS executive', 'active',
   ARRAY['signals.read', 'owner_alert.write', 'owner_alert.deliver', 'approval.request',
         'tool_ledger.read'])
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.owner_alert_channels (channel, enabled, updated_by) VALUES
  ('voice', true, 'owner-instruction-2026-11-16'),
  ('whatsapp', true, 'owner-instruction-2026-11-16'),
  ('sms', true, 'owner-instruction-2026-11-16'),
  ('email', true, 'owner-instruction-2026-11-16')
ON CONFLICT (channel) DO NOTHING;

INSERT INTO public.owner_alert_settings (singleton, mode) VALUES (true, 'test')
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.owner_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_alerts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.owner_alert_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_alert_deliveries FORCE ROW LEVEL SECURITY;
ALTER TABLE public.owner_alert_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_alert_channels FORCE ROW LEVEL SECURITY;
ALTER TABLE public.owner_alert_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_alert_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_service_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_service_identities FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.owner_alerts, public.owner_alert_deliveries,
  public.owner_alert_channels, public.owner_alert_settings, public.platform_service_identities
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.owner_alerts, public.owner_alert_deliveries,
  public.owner_alert_channels, public.owner_alert_settings, public.platform_service_identities
  TO authenticated;
GRANT ALL ON TABLE public.owner_alerts, public.owner_alert_deliveries,
  public.owner_alert_channels, public.owner_alert_settings, public.platform_service_identities
  TO service_role;

DROP POLICY IF EXISTS owner_alerts_audit_read ON public.owner_alerts;
CREATE POLICY owner_alerts_audit_read ON public.owner_alerts FOR SELECT TO authenticated
  USING ((SELECT public.has_platform_capability('platform.audit.read')));
DROP POLICY IF EXISTS owner_alert_deliveries_audit_read ON public.owner_alert_deliveries;
CREATE POLICY owner_alert_deliveries_audit_read ON public.owner_alert_deliveries
  FOR SELECT TO authenticated
  USING ((SELECT public.has_platform_capability('platform.audit.read')));
DROP POLICY IF EXISTS owner_alert_channels_audit_read ON public.owner_alert_channels;
CREATE POLICY owner_alert_channels_audit_read ON public.owner_alert_channels
  FOR SELECT TO authenticated
  USING ((SELECT public.has_platform_capability('platform.audit.read')));
DROP POLICY IF EXISTS owner_alert_settings_audit_read ON public.owner_alert_settings;
CREATE POLICY owner_alert_settings_audit_read ON public.owner_alert_settings
  FOR SELECT TO authenticated
  USING ((SELECT public.has_platform_capability('platform.audit.read')));

DROP POLICY IF EXISTS platform_service_identities_audit_read ON public.platform_service_identities;
CREATE POLICY platform_service_identities_audit_read ON public.platform_service_identities
  FOR SELECT TO authenticated
  USING ((SELECT public.has_platform_capability('platform.audit.read')));

COMMENT ON TABLE public.owner_alert_deliveries IS
  'One row per owner-alert channel attempt. Never holds a contact detail or message body.';

COMMIT;

-- ROLLBACK (also in database/supabase/rollbacks/20261116000100_sherivs_jarvis_live01_owner_alert_store.sql):
--   DROP TABLE IF EXISTS public.owner_alert_deliveries, public.owner_alerts,
--     public.owner_alert_channels, public.owner_alert_settings, public.platform_service_identities;
