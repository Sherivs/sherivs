-- =============================================================================
-- CoreGrid V1 — per-event security contract persistence (MISSION-R-81)
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED. Do not treat this file as a live database.
-- Apply only with an explicit human authorization decision (governance law):
--   supabase db push --workdir database/supabase
-- Rollback (not applied by this migration):
--   database/supabase/rollbacks/20261002000006_coregrid_v1_event_security.sql
--
-- Authority:
--   Contract: frontend/src/lib/kernel/event-security.ts (V1CAP-044 / J-022 /
--   MISSION-R-81) — the per-event security contract and the consumption gate.
--   Chain: G-044 states event security per-event but no stream carried it;
--   E-017 demands authentic, provenance-bearing events for Verification;
--   J-001 the kernel envelope at the event plane; J-011 the sensitivity
--   vocabulary (pinned mechanically to lib/context-assembly); the
--   Constitution §16–§21 authorization vocabulary (ALLOW | DENY | REDACT
--   delivery subset) and §19 minimization law; AGENTS §35 realtime security
--   ("never broadcast unauthorized events" — every denial is a first-class
--   auditable record). ObservationKind (kernel truth hierarchy, phase-01 §56)
--   is reused, never redefined.
--   Style exemplar: 20261002000004_coregrid_v1_memory_tier.sql.
--
-- Scope:
--   cg_event_security            — the security contract EVERY deliverable
--                                  event carries, persisted per event per
--                                  tenant: authenticity (issuer identity,
--                                  time-authority issuance coordinates,
--                                  tamper-evident SHA-256 digest chain
--                                  linkage), authorization (visibility
--                                  scope, emission authority), privacy
--                                  (sensitivity, subject refs, redactable
--                                  fields), provenance (evidence class,
--                                  source).
--   cg_event_security_denial     — append-only denial audit: one row per
--                                  gate DENY (fail-closed, never silently
--                                  dropped), reason from the closed
--                                  8-value EventDenialReason vocabulary.
--   cg_event_security_redaction  — append-only redaction audit: one row per
--                                  gate REDACT, naming the withheld fields
--                                  and subject refs (withheld, not deleted —
--                                  the original event is untouched).
--
-- Provenance law at rest: a generated event (reported / inferred / predicted
--   / simulated) can NEVER claim direct-observation visibility — enforced by
--   the contract at emission AND pinned as a CHECK so a laundered contract
--   row can never exist in the substrate either (Constitution §9 canonical
--   truth).
--
-- Tenant posture (COND-003 parameterization, UNRESOLVED):
--   tenant_id is `text NOT NULL CHECK (length 1..128)` per applied reality
--   (cg_identity.tenant_id and the worker-definitions exemplar). If COND-003
--   rules uuid (MISSION-R-02), a follow-up migration converts the substrate.
--   The contract table requires a tenant: the digest chain is per-tenant, and
--   a tenant-less event is anonymous at the tenancy boundary and undeliverable
--   to everyone. The denial table admits a NULL tenant only when the denial
--   occurred BEFORE tenant resolution (the failed attempt is still audited).
--
-- Envelope posture:
--   These tables are contract/audit rows bound to kernel events, NOT
--   canonical CoreObjects: the event itself is the canonical object and its
--   envelope lives on the event substrate. No envelope columns are authored
--   here (mirrors cg_memory_access_log, which is audit, not object).
--
-- Deliberately NOT in scope:
--   • RLS policies: ZERO policies authored (deny-by-default strongest form;
--     policies come later from the policy team and the RLS battery).
--   • Event persistence itself — the cg_event substrate and event-semantics
--     issuance provenance are owned by the event-kernel phase; this migration
--     persists only the security contract and the gate's audit records.
--   • Subscription routing state (queues, cursors, outcomes) — owned by the
--     event-routing migration 20261002000007.
--   • Digest-chain REPAIR tooling — a broken chain is surfaced, never healed
--     silently; chain verification lives in the pure contract.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. cg_event_security — the per-event security contract (persisted)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_event_security (
  id                  text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  tenant_id           text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  -- The event this contract secures (the contract's event identity:
  -- persistent id, or the digest stand-in when the event carries none).
  event_ref           text NOT NULL CHECK (length(event_ref) BETWEEN 1 AND 200),
  -- AUTHENTICITY (Constitution §43: WHO).
  issuer_id           text NOT NULL CHECK (length(issuer_id) BETWEEN 1 AND 200),
  issuance_at         timestamptz NOT NULL,
  issuance_at_ms      bigint NOT NULL,
  issuance_sequence   bigint NOT NULL,
  issuance_issuer     text NOT NULL CHECK (length(issuance_issuer) BETWEEN 1 AND 200),
  -- Tamper-evident digest: SHA-256 over the event's content+cause digest,
  -- the entire contract, and the previous tenant-chain digest. Any tampered
  -- payload byte or contract field breaks it.
  digest              text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  -- The previous digest in the tenant's hash chain (null at a chain anchor).
  previous_digest     text CHECK (previous_digest IS NULL OR previous_digest ~ '^[0-9a-f]{64}$'),
  -- AUTHORIZATION: the declared audience and the authority under which the
  -- event was emitted (the audit answer to UNDER WHICH POLICY).
  visibility          text NOT NULL CHECK (visibility IN
                        ('public','tenant','restricted','direct-observation')),
  emission_authority  text NOT NULL CHECK (length(emission_authority) BETWEEN 1 AND 200),
  -- PRIVACY (J-011 sensitivity vocabulary; subject refs are redaction
  -- candidates; redactable fields are what may be WITHHELD, never deleted).
  sensitivity         text NOT NULL CHECK (sensitivity IN ('public','internal','restricted')),
  subject_refs        jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(subject_refs) = 'array'),
  redactable_fields   jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(redactable_fields) = 'array'),
  -- PROVENANCE: the evidence class of the event's source (kernel truth
  -- hierarchy — never collapsed) and its provenance source.
  evidence_class      text NOT NULL CHECK (evidence_class IN
                        ('observed','reported','inferred','predicted','simulated')),
  source              text NOT NULL CHECK (length(source) BETWEEN 1 AND 200),
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event_ref),
  -- PROVENANCE LAW at rest (Constitution §9): a generated event can never
  -- claim direct-observation visibility — inference never launders itself
  -- into canonical observation, in the contract AND in the substrate.
  CONSTRAINT cg_event_security_observation_scope CHECK (
    visibility <> 'direct-observation' OR evidence_class = 'observed'
  )
);

COMMENT ON TABLE public.cg_event_security IS
  $comment$MISSION-R-81 / J-022 (V1CAP-044) per-event security contract: the
  authenticity (issuer identity, time-authority issuance coordinates, SHA-256
  digest chain linkage), authorization (visibility scope, emission authority),
  privacy (sensitivity, subject refs, redactable fields) and provenance
  (evidence class, source) EVERY deliverable event carries. An event without
  its contract is UNDELIVERABLE — never broadcast with defaults (AGENTS §35).
  A generated event can never claim direct-observation visibility (canonical
  truth law, CHECK-enforced).$comment$;

CREATE INDEX IF NOT EXISTS cg_event_security_tenant_idx
  ON public.cg_event_security (tenant_id, recorded_at);

CREATE INDEX IF NOT EXISTS cg_event_security_digest_idx
  ON public.cg_event_security (tenant_id, digest);

-- -----------------------------------------------------------------------------
-- 2. cg_event_security_denial — append-only gate denial audit
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_event_security_denial (
  id              text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  -- Nullable only when a denial occurred BEFORE tenant resolution (e.g. no
  -- tenant on the event at all): the failed attempt is still audited.
  tenant_id       text CHECK (tenant_id IS NULL OR length(tenant_id) BETWEEN 1 AND 128),
  event_ref       text NOT NULL CHECK (length(event_ref) BETWEEN 1 AND 200),
  subscriber_id   text CHECK (subscriber_id IS NULL OR length(subscriber_id) BETWEEN 1 AND 200),
  -- The closed EventDenialReason vocabulary: missing_security_contract |
  -- invalid_security_contract | unverifiable_issuance | tampered_digest |
  -- generated_event_claims_observation | tenant_mismatch |
  -- visibility_not_authorized | sensitivity_not_authorized.
  reason          text NOT NULL CHECK (reason IN
                    ('missing_security_contract','invalid_security_contract',
                     'unverifiable_issuance','tampered_digest',
                     'generated_event_claims_observation','tenant_mismatch',
                     'visibility_not_authorized','sensitivity_not_authorized')),
  detail          text NOT NULL DEFAULT '',
  recorded_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cg_event_security_denial IS
  $comment$MISSION-R-81 / J-022 append-only consumption-gate denial audit: one
  row per DENY decision, with the closed EventDenialReason vocabulary and the
  audit instant. Denials are recorded, never discarded — an event without its
  security contract is denied to EVERY subscriber and every denial leaves
  evidence (fail-closed, Constitution §29). Immutable audit record
  (Constitution §28); no UPDATE or DELETE path is authored.$comment$;

CREATE INDEX IF NOT EXISTS cg_event_security_denial_tenant_idx
  ON public.cg_event_security_denial (tenant_id, recorded_at);

CREATE INDEX IF NOT EXISTS cg_event_security_denial_event_idx
  ON public.cg_event_security_denial (event_ref, recorded_at);

-- -----------------------------------------------------------------------------
-- 3. cg_event_security_redaction — append-only gate redaction audit
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_event_security_redaction (
  id                      text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  tenant_id               text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  event_ref               text NOT NULL CHECK (length(event_ref) BETWEEN 1 AND 200),
  subscriber_id           text NOT NULL CHECK (length(subscriber_id) BETWEEN 1 AND 200),
  -- Closed reason vocabulary of the gate's REDACT path.
  reason                  text NOT NULL CHECK (reason = 'sensitivity_above_ceiling'),
  withheld_fields         jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(withheld_fields) = 'array'),
  withheld_subject_refs   jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(withheld_subject_refs) = 'array'),
  detail                  text NOT NULL DEFAULT '',
  recorded_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cg_event_security_redaction IS
  $comment$MISSION-R-81 / J-022 append-only consumption-gate redaction audit:
  one row per REDACT decision, naming the payload fields and subject refs
  WITHHELD from the delivered view (withheld, never deleted — the original
  event is untouched in the store), so minimization is auditable after the
  fact (Constitution §19). Immutable audit record (Constitution §28); no
  UPDATE or DELETE path is authored.$comment$;

CREATE INDEX IF NOT EXISTS cg_event_security_redaction_tenant_idx
  ON public.cg_event_security_redaction (tenant_id, recorded_at);

CREATE INDEX IF NOT EXISTS cg_event_security_redaction_event_idx
  ON public.cg_event_security_redaction (event_ref, recorded_at);

-- -----------------------------------------------------------------------------
-- 4. Deny-by-default security posture
-- -----------------------------------------------------------------------------
-- RLS ENABLED with ZERO policies and all anon/authenticated privileges
-- REVOKED (mirrors the memory-tier / worker-definitions substrate posture).
-- Zero policies are deliberate: security contracts and gate audit records are
-- tenant-sensitive platform security data (Constitution §17/§35) and no
-- tenant-scoped policy yet exists that provably cannot widen reads beyond a
-- subscriber's declared ceiling — access runs through service-role server
-- functions that enforce the consumption gate (identity AND tenant AND scope
-- AND sensitivity) through the adapter. Policies may be authored by a
-- follow-up migration under explicit authorization, never silently.
-- =============================================================================

ALTER TABLE public.cg_event_security ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_event_security_denial ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_event_security_redaction ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cg_event_security FROM anon, authenticated;
REVOKE ALL ON public.cg_event_security_denial FROM anon, authenticated;
REVOKE ALL ON public.cg_event_security_redaction FROM anon, authenticated;

-- =============================================================================
-- End of migration. Verification (run after apply authorization):
--   • all three tables exist with rowsecurity = true and zero policies in
--     pg_policies;
--   • anon/authenticated hold NO privileges on any of the three tables;
--   • contract rows reject non-SHA-256 digests, chain links that are not
--     null-or-digest, and generated events claiming direct-observation
--     visibility (provenance law at rest);
--   • denial and redaction tables record their decisions with closed
--     vocabularies and audit instants.
-- The TypeScript adapter (frontend/src/lib/adapters/event-security-store.adapter.ts)
-- and its suite pin the migration text mechanically until live verification
-- is authorized.
-- =============================================================================