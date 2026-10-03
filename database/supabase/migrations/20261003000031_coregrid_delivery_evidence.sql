-- =============================================================================
-- CoreGrid — outbound delivery-evidence substrate (R6 follow-up to V1-009)
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED. Do not treat this file as a live database.
-- Apply only with an explicit human authorization decision (governance law):
--   supabase db push --workdir database/supabase
-- Rollback:
--   database/supabase/rollbacks/20261003000031_coregrid_delivery_evidence.sql
--
-- Authority:
--   V1-009 (team COMMS) recorded the follow-up; this is the R6 (COMMS-EVIDENCE)
--   implementation. Constitution §12 (data provenance — every outbound attempt
--   answers where it came from, who/what triggered it, whether AI produced it,
--   and whether it can be trusted), §28 (database law — immutable audit
--   records over application-only guarantees) and §29 (observability — a send
--   that leaves no evidence is unobservable). The evidence that a send was
--   BLOCKED (fail-closed, e.g. BLOCKED_NO_CREDENTIAL) is itself evidence: the
--   table records ATTEMPTS, not only successes.
--   Style exemplars: 20261003000019_coregrid_v1_mission_lease.sql (deny-by-
--   default posture: RLS enabled, ZERO policies, client privileges revoked,
--   service-role only) and 20261002000008_coregrid_v1_evidence_lifecycle.sql
--   (append-only evidence law).
--
-- Scope:
--   cg_delivery_evidence — one row per outbound delivery ATTEMPT: the channel
--       (email | voice), the adapter (registry provider id, e.g. "resend"),
--       the REDACTED recipient (full addresses/numbers NEVER enter evidence —
--       redaction is enforced in the adapter layer, delivery-evidence.server.ts,
--       and the row shape exists only for redacted values), the provider
--       message/call id when the provider confirmed (null otherwise — never
--       fabricated), the attempt outcome (delivered | failed | undeliverable),
--       the typed outcome code and a bounded secret-free reason, the
--       provenance of the trigger (triggered_by, trigger_source), the §12
--       AI-generated flag (false by default — pinned false by the adapter
--       layer; adapters are deterministic infrastructure, not intelligence)
--       and the record instant.
--
-- Append-only law (§12, §28):
--   Evidence is never overwritten: a BEFORE UPDATE OR DELETE trigger rejects
--   every mutation at the database boundary (no application-side guarantee
--   alone). There is no UPDATE path, no DELETE path, and no updated_at — a
--   correction is a NEW row. Retention/purge is a separate, explicitly
--   authorized concern (a future migration may replace the trigger for a
--   supervised purge job; it may never quietly widen this one).
--
-- Tenant posture:
--   tenant_id is `text NOT NULL CHECK (length 1..128)` per the applied
--   convention of the V1 substrate family (cg_evidence_record,
--   cg_worker_definition). No tenant uuid conversion is authored here.
--
-- Deliberately NOT in scope:
--   • RLS policies: ZERO policies authored (deny-by-default strongest form,
--     same posture as the mission-lease and evidence-lifecycle substrates).
--     Delivery evidence is tenant-sensitive audit material; policies may be
--     authored by a follow-up migration under explicit authorization, never
--     silently. Service-role server functions (the adapters' evidence sink,
--     frontend/src/lib/communications/delivery-evidence.server.ts) are the
--     only intended writer.
--   • Inbound message records, delivery-status webhooks (provider callbacks),
--     retention EXECUTION (deletion schedules) — separate concerns, separate
--     authority.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. cg_delivery_evidence — the append-only attempt ledger
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_delivery_evidence (
  id                  text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  tenant_id           text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  -- email | voice. New channels (sms, push) extend this CHECK in a follow-up
  -- migration — never silently.
  channel             text NOT NULL CHECK (channel IN ('email','voice')),
  -- The adapter that performed the attempt (registry provider id).
  adapter             text NOT NULL CHECK (length(adapter) BETWEEN 1 AND 80),
  -- Correlation to the originating notification (email) or trigger event
  -- (voice); null when the attempt carries no such correlation.
  notification_ref    text CHECK (notification_ref IS NULL OR length(notification_ref) BETWEEN 1 AND 160),
  -- REDACTED recipient (e.g. "p***@example.edu", "+15***67"). The full
  -- address or number NEVER enters evidence (§19 minimization); the adapter
  -- layer redacts before the row exists.
  recipient_redacted  text NOT NULL CHECK (length(recipient_redacted) BETWEEN 3 AND 254),
  -- Provider-confirmed message/call id; NULL exactly when the provider did
  -- not confirm (blocked, failed, or queued without an id) — never fabricated.
  provider_message_id text CHECK (provider_message_id IS NULL OR length(provider_message_id) BETWEEN 1 AND 160),
  -- Terminal posture of THIS attempt. A credential-blocked send is
  -- 'undeliverable' — the block is evidence too.
  outcome             text NOT NULL CHECK (outcome IN ('delivered','failed','undeliverable')),
  outcome_code        text NOT NULL CHECK (length(outcome_code) BETWEEN 1 AND 80),
  -- Bounded, secret-free provenance of the attempt outcome.
  reason              text NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  -- §12 provenance: who/what triggered the attempt.
  triggered_by        text NOT NULL CHECK (length(triggered_by) BETWEEN 1 AND 160),
  trigger_source      text NOT NULL CHECK (length(trigger_source) BETWEEN 1 AND 120),
  -- §12 provenance: AI-generated evidence is false by default. The adapter
  -- layer pins this to false; widening it requires an explicit authorization
  -- decision, never a silent default.
  ai_generated        boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- Outcome coherence (fail closed, database-enforced): a provider-confirmed
  -- id belongs to a delivered attempt; blocked/failed attempts carry none.
  CONSTRAINT cg_delivery_evidence_outcome_coherence CHECK (
    (outcome = 'delivered' AND provider_message_id IS NOT NULL)
    OR (outcome <> 'delivered' AND provider_message_id IS NULL)
  )
);

COMMENT ON TABLE public.cg_delivery_evidence IS
  $comment$Outbound delivery-evidence ledger (R6 follow-up to V1-009): one
  APPEND-ONLY row per outbound delivery attempt on the email and voice
  channels — including attempts that were fail-closed BLOCKED (e.g.
  BLOCKED_NO_CREDENTIAL), because proof that a send was stopped is itself
  evidence. Records the channel, the owning adapter (provider id), the
  REDACTED recipient (full addresses/numbers never enter evidence), the
  provider message/call id when the provider confirmed (never fabricated),
  the attempt outcome with its typed code and bounded secret-free reason,
  the trigger provenance (who/what, from where in the system) and the
  AI-generated flag (false by default). Constitution §12 data provenance and
  §28 database law: rows are immutable — a BEFORE UPDATE OR DELETE trigger
  rejects every mutation at the database boundary; a correction is a new row,
  never an overwrite. RLS enabled with ZERO policies; service-role server
  functions (the adapters' evidence sink,
  frontend/src/lib/communications/delivery-evidence.server.ts) are the only
  writer.$comment$;

CREATE INDEX IF NOT EXISTS cg_delivery_evidence_tenant_created_idx
  ON public.cg_delivery_evidence (tenant_id, created_at);

CREATE INDEX IF NOT EXISTS cg_delivery_evidence_tenant_channel_outcome_idx
  ON public.cg_delivery_evidence (tenant_id, channel, outcome);

CREATE INDEX IF NOT EXISTS cg_delivery_evidence_notification_idx
  ON public.cg_delivery_evidence (notification_ref)
  WHERE notification_ref IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. Append-only enforcement (§12, §28 — immutable audit records)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cg_delivery_evidence_forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'cg_delivery_evidence is append-only evidence (Constitution §12/§28): % on % is forbidden; record a new row instead',
    TG_OP, TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS cg_delivery_evidence_append_only ON public.cg_delivery_evidence;
CREATE TRIGGER cg_delivery_evidence_append_only
  BEFORE UPDATE OR DELETE ON public.cg_delivery_evidence
  FOR EACH ROW EXECUTE FUNCTION public.cg_delivery_evidence_forbid_mutation();

-- -----------------------------------------------------------------------------
-- 3. Deny-by-default security posture
-- -----------------------------------------------------------------------------
-- RLS ENABLED with ZERO policies and all anon/authenticated privileges
-- REVOKED (mirrors the mission-lease / evidence-lifecycle posture): delivery
-- evidence is tenant-sensitive audit material and the adapters' evidence
-- sink runs under service-role server functions only. Policies may be
-- authored by a follow-up migration under explicit authorization, never
-- silently.
-- =============================================================================

ALTER TABLE public.cg_delivery_evidence ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cg_delivery_evidence FROM anon, authenticated;

GRANT ALL ON public.cg_delivery_evidence TO service_role;

-- =============================================================================
-- End of migration. Verification (run after apply authorization):
--   • the table exists with rowsecurity = true and zero policies in
--     pg_policies;
--   • anon/authenticated hold NO privileges on the table;
--   • INSERT through the service role succeeds with a redacted recipient;
--   • UPDATE and DELETE through the service role are rejected by the
--     append-only trigger;
--   • a 'delivered' row without provider_message_id (or a failed/undeliverable
--     row WITH one) is rejected (outcome-coherence CHECK);
--   • a row with channel/outcome outside the CHECK vocabularies is rejected.
-- =============================================================================

-- Component: database/supabase/migrations/20261003000031_coregrid_delivery_evidence.sql
-- Owner: R6 (team COMMS-EVIDENCE) — V1-009 delivery-evidence follow-up
