-- =============================================================================
-- CoreGrid V1 — organization communication sender identity (PLATFORM-019)
-- =============================================================================
-- Status: AUTHORED for checksummed apply. Apply with:
--   node scripts/db-apply-one.mjs 20261007000050
-- Rollback:
--   database/supabase/rollbacks/20261007000050_coregrid_org_communication_sender.sql
--
-- Authority:
--   DECISIONS.md #210 (PLATFORM-019, 2026-10-07) — per-organization sender
--     identity so every organization that connects to CoreGrid can carry its
--     own outbound FROM identity per channel; the platform Twilio number
--     remains the default and Twilio credentials remain platform-level
--     environment facts (§19 minimization — shared secrets are never
--     per-tenant rows).
--   AGENTS.md §13 (multi-tenancy: tenant_id on every row),
--   AGENTS.md §17 (RLS mandatory, application code never the only layer),
--   AGENTS.md §30 (credential references, never values),
--   AGENTS.md §24 (provider-agnostic: provider is a column, not a design).
--
-- Scope:
--   cg_org_communication_sender — one org's sender identity per
--     (tenant, org, channel, provider): which E.164 FROM number outbound
--     messages use. Only ONE row per that key may be status='active' (partial
--     unique index), so resolution is deterministic; suspended and
--     pending_provision rows keep history without competing.
--
-- Domain-neutral: no domain vocabulary anywhere (V5.3 Part 46);
-- channel and provider are closed CHECK vocabularies mirroring
-- frontend/src/lib/communications/org-sender-config.ts
-- (ORG_SENDER_CHANNELS / ORG_SENDER_PROVIDERS / ORG_SENDER_STATUSES).
--
-- org_ref is an OPAQUE text ref. No FK to cg_org_unit: the universal org
-- model (20261001000000) is authored-not-applied and uses the same text
-- tenant convention; binding integrity is enforced at the application
-- resolver boundary. A follow-up migration may add the composite FK
-- (org_ref, tenant_id) once the org model is applied — never silently.
--
-- Security: deny-by-default strongest form (same posture as the mission-lease
-- substrate) — RLS ENABLED with ZERO policies and all anon/authenticated
-- privileges REVOKED. Sender identities are authority-adjacent configuration
-- (they determine what identity messages carry org-wide) and are read/written
-- exclusively through service-role server functions
-- (frontend/src/lib/communications/org-sender-store.server.ts), which
-- Zod-validate every row read back. Policies may be authored by a follow-up
-- migration under explicit authorization, never silently.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.cg_org_communication_sender (
  sender_ref     text PRIMARY KEY CHECK (length(sender_ref) BETWEEN 1 AND 160),
  tenant_id      text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  org_ref        text NOT NULL CHECK (length(org_ref) BETWEEN 1 AND 160),
  channel        text NOT NULL CHECK (channel IN ('sms')),
  provider       text NOT NULL CHECK (provider IN ('twilio')),
  from_number    text NOT NULL CHECK (from_number ~ '^\+[1-9][0-9]{1,14}$'),
  credential_ref text NOT NULL CHECK (credential_ref ~ '^env://[A-Z][A-Z0-9_]{2,127}$'),
  status         text NOT NULL CHECK (status IN ('active','suspended','pending_provision')),
  provenance     jsonb NOT NULL CHECK (
    jsonb_typeof(provenance) = 'object'
    AND provenance ? 'createdBy'
    AND provenance ? 'createdAt'
  ),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cg_org_communication_sender IS $comment$PLATFORM-019
organization sender identity: which E.164 FROM number an organization''s
outbound messages use per channel. credential_ref is an env:// POINTER —
secret values are never stored in tenant data (AGENTS.md §30). Only one row
per (tenant_id, org_ref, channel, provider) may be status=''active'' (partial
unique index). RLS enabled with zero policies; service-role server functions
are the only writer and reader.$comment$;

-- Deterministic resolution: at most one ACTIVE identity per key.
CREATE UNIQUE INDEX IF NOT EXISTS cg_org_communication_sender_active_unique
  ON public.cg_org_communication_sender (tenant_id, org_ref, channel, provider)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS cg_org_communication_sender_tenant_org_idx
  ON public.cg_org_communication_sender (tenant_id, org_ref, channel);

-- -----------------------------------------------------------------------------
-- Deny-by-default security posture
-- -----------------------------------------------------------------------------
ALTER TABLE public.cg_org_communication_sender ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cg_org_communication_sender FROM anon, authenticated;

-- =============================================================================
-- End of migration. Verification (run after apply):
--   • table exists with relrowsecurity = true and zero rows in pg_policies;
--   • anon/authenticated hold NO privileges;
--   • a from_number that is not E.164 is rejected (CHECK);
--   • a credential_ref that is not an env:// pointer is rejected (CHECK);
--   • a second ACTIVE row for the same (tenant, org, channel, provider) is
--     rejected (partial unique index).
-- =============================================================================