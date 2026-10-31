-- =============================================================================
-- SHERIVS-032 — Control-plane operations store (Plane D).
--
-- Tickets and incidents for Internal Console operators. These are not tenant
-- SIS records and not platform_complaints (tenant-submitted complaints).
-- Billing continues to use public.subscriptions / school_platform_pricing.
-- Log search continues to use public.audit_logs.
--
-- Clients have SELECT only. Writes go through service-role server functions
-- after capability checks.
-- Rollback: database/supabase/rollbacks/20261027003000_sherivs_032_control_plane_operations.sql
-- =============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.platform_ticket (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid REFERENCES public.platform_organization(id) ON DELETE SET NULL,
  subject           text NOT NULL CHECK (length(btrim(subject)) BETWEEN 3 AND 160),
  body              text NOT NULL CHECK (length(btrim(body)) BETWEEN 3 AND 4000),
  status            text NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','pending','resolved','closed')),
  priority          text NOT NULL DEFAULT 'normal'
                      CHECK (priority IN ('low','normal','high','urgent')),
  opened_by         uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  assigned_to       uuid REFERENCES public.platform_staff(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz
);

COMMENT ON TABLE public.platform_ticket IS
  'Internal Console support tickets about organization cases. Not learner, invoice, or biometric tenant records.';

CREATE INDEX IF NOT EXISTS platform_ticket_status_idx
  ON public.platform_ticket (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS platform_ticket_org_idx
  ON public.platform_ticket (organization_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.platform_incident (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid REFERENCES public.platform_organization(id) ON DELETE SET NULL,
  title             text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 160),
  details           text NOT NULL DEFAULT '' CHECK (length(details) <= 4000),
  severity          text NOT NULL DEFAULT 'medium'
                      CHECK (severity IN ('low','medium','high','critical')),
  status            text NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','acknowledged','mitigating','resolved','closed')),
  opened_by         uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz
);

COMMENT ON TABLE public.platform_incident IS
  'Internal Console operational incidents. Not a security operations centre and not tenant learner data.';

CREATE INDEX IF NOT EXISTS platform_incident_status_idx
  ON public.platform_incident (status, severity, updated_at DESC);
CREATE INDEX IF NOT EXISTS platform_incident_org_idx
  ON public.platform_incident (organization_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS audit_logs_action_created_idx
  ON public.audit_logs (action, created_at DESC);

ALTER TABLE public.platform_ticket ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_ticket FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_incident ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_incident FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.platform_ticket, public.platform_incident
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.platform_ticket, public.platform_incident
  TO authenticated;
GRANT ALL ON TABLE public.platform_ticket, public.platform_incident
  TO service_role;

DROP POLICY IF EXISTS platform_ticket_read ON public.platform_ticket;
CREATE POLICY platform_ticket_read ON public.platform_ticket
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR public.has_platform_capability('platform.tenants.read')
    OR public.has_platform_capability('platform.support.handle')
  );

DROP POLICY IF EXISTS platform_incident_read ON public.platform_incident;
CREATE POLICY platform_incident_read ON public.platform_incident
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR public.has_platform_capability('platform.engineering.read')
    OR public.has_platform_capability('platform.operations.read')
    OR public.has_platform_capability('platform.tenants.read')
    OR public.has_platform_capability('platform.audit.read')
  );

COMMIT;
