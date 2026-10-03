-- =============================================================================
-- CoreGrid V1 — governed worker mission-lease substrate (MISSION V1-003)
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED. Do not treat this file as a live database.
-- Apply only with an explicit human authorization decision (governance law):
--   supabase db push --workdir database/supabase
-- Rollback (NOT authored as a file — mission V1-003 file ownership is one
-- migration file; statements for the coordinator):
--   DROP TABLE IF EXISTS public.cg_worker_quarantine;
--   DROP TABLE IF EXISTS public.cg_worker_delegation_grant;
--   DROP TABLE IF EXISTS public.cg_mission_lease;
--
-- Authority (V1 authorization):
--   Mission V1-003 (team WORKFORCE, wave 3) — the governed worker execution
--   host (WAKE -> EXECUTE -> PERSIST -> VERIFY -> SLEEP). This migration
--   CLOSES the lease-substrate gap REPORTED by mission V1-004
--   (`MISSION_LEASE_SUBSTRATE_GAP` in
--   frontend/src/lib/missions/mission-execution-db.server.ts): the cg_* mission
--   tables author no worker-lease substrate, so the V1-004 DB adapter fails
--   closed on every MissionLeasePort operation. V1-004's report explicitly
--   deferred the follow-up migration "under explicit authorization"; THIS file
--   is that authorized follow-up. Style exemplars:
--   20261002000002_coregrid_v1_worker_definitions.sql (worker substrate) and
--   20260929000000_coregrid_foundation_mission_001.sql (mission records).
--
-- Scope:
--   cg_mission_lease            — the lease substrate: one row per lease
--                                 grant on a cg_execution_record execution
--                                 (lease id, execution FK, worker id, tenant
--                                 scope, acquired_at, heartbeat_at, expires_at,
--                                 attempt, state), plus the completion/retry
--                                 bookkeeping the bounded-retry semantics
--                                 require (outcome, completed_at,
--                                 retry_not_before).
--   cg_worker_delegation_grant  — the LIVE delegation-grant state surface:
--                                 cg_worker_delegation (MISSION-R-40) is
--                                 append-only history and authors no state
--                                 column, so a revocation could never take
--                                 effect. Grant rows here are the runtime-
--                                 resolution surface the host gate reads at
--                                 WAKE; a revocation (state -> 'revoked')
--                                 takes effect immediately at the next gate
--                                 check. The history row in cg_worker_delegation
--                                 is still written for RULING-3 attribution.
--   cg_worker_quarantine        — the quarantine ledger: a worker whose
--                                 failure count crosses a configured bound is
--                                 recorded here and is no longer leased to
--                                 (the host gate denies at WAKE).
--
-- Deliberately NOT in scope:
--   • RLS policies: ZERO policies authored (same posture as the worker-
--     definitions and foundation-mission substrates): worker leases, live
--     delegation state and quarantine records are governance-critical
--     authority rows; no tenant-scoped policy exists yet that provably cannot
--     widen worker authority. Service-role server functions are the only
--     intended writer, with the authorization contract (neutral RBAC core,
--     mission-authorization.ts) enforced BEFORE any row is read or written.
--   • Runtime processes, budgets, ephemeral lifecycle (owned by
--     agent-runtime/ephemeral-lifecycle.ts, unchanged).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. cg_mission_lease — the worker-lease substrate (closes V1-004's gap)
-- -----------------------------------------------------------------------------

-- (id, tenant_id, mission_id) uniqueness on cg_execution_record backing the
-- same-tenant composite FK below (id is already the PK; this index makes the
-- tenant/mission coherence a database-enforced fact, mirroring the composite
-- FK pattern of cg_worker_capability).
CREATE UNIQUE INDEX IF NOT EXISTS cg_execution_record_id_tenant_mission_idx
  ON public.cg_execution_record (id, tenant_id, mission_id);

CREATE TABLE IF NOT EXISTS public.cg_mission_lease (
  lease_id        text PRIMARY KEY CHECK (length(lease_id) BETWEEN 1 AND 160),
  execution_id    text NOT NULL,
  tenant_id       text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  mission_id      text NOT NULL CHECK (length(mission_id) BETWEEN 1 AND 160),
  worker_id       text NOT NULL CHECK (length(worker_id) BETWEEN 1 AND 160),
  acquired_at     timestamptz NOT NULL,
  heartbeat_at    timestamptz NOT NULL,
  expires_at      timestamptz NOT NULL,
  attempt         integer NOT NULL CHECK (attempt >= 1),
  -- active: lease held. released: handed back via completion/failure.
  -- recovered: orphan sweep requeued an unheartbeated lease.
  state           text NOT NULL CHECK (state IN ('active','released','recovered')),
  outcome         text CHECK (outcome IN ('succeeded','failed')),
  completed_at    timestamptz,
  retry_not_before timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at >= acquired_at),
  CHECK (heartbeat_at >= acquired_at),
  -- One lease per attempt per execution per tenant (exactly-once leasing).
  UNIQUE (tenant_id, execution_id, attempt),
  -- Same-tenant, same-mission integrity: a lease can never point at another
  -- tenant's (or another mission's) execution record.
  CONSTRAINT cg_mission_lease_execution_fk
    FOREIGN KEY (execution_id, tenant_id, mission_id)
    REFERENCES public.cg_execution_record (id, tenant_id, mission_id)
    ON DELETE RESTRICT,
  -- State coherence (fail closed, database-enforced):
  --   active        <=> no completion recorded, no outcome, no retry stamp;
  --   released      <=> completed with a recorded outcome; a failed release
  --                     carries the bounded-retry gate, a succeeded one does not;
  --   recovered     <=> completion recorded (sweep instant), no outcome,
  --                     immediately re-leasable (no retry gate).
  CONSTRAINT cg_mission_lease_state_coherence CHECK (
    (
      state = 'active'
      AND completed_at IS NULL AND outcome IS NULL AND retry_not_before IS NULL
    ) OR (
      state = 'released'
      AND completed_at IS NOT NULL
      AND outcome IS NOT NULL
      AND ((outcome = 'failed' AND retry_not_before IS NOT NULL)
        OR (outcome = 'succeeded' AND retry_not_before IS NULL))
    ) OR (
      state = 'recovered'
      AND completed_at IS NOT NULL
      AND outcome IS NULL
      AND retry_not_before IS NULL
    )
  )
);

COMMENT ON TABLE public.cg_mission_lease IS
  $comment$MISSION V1-003 worker-lease substrate — AUTHORIZES the lease
  persistence gap reported by mission V1-004 (MISSION_LEASE_SUBSTRATE_GAP):
  the cg_* mission tables author no lease table, so the V1-004 DB adapter
  failed closed on every MissionLeasePort operation. One row per lease grant
  on a cg_execution_record execution: lease owner (worker_id), heartbeat and
  expiry instants (heartbeat_at / expires_at, the TTL-orphan-recovery pair),
  attempt number (bounded retries) and lifecycle state, plus the
  completion/retry bookkeeping (outcome, completed_at, retry_not_before) the
  bounded-backoff semantics require. Grants nothing by itself: every
  operation is authorized through the neutral RBAC core
  (mission-authorization.ts) BEFORE any row is read or written; quarantine
  (cg_worker_quarantine) and live delegation state
  (cg_worker_delegation_grant) gate leasing at WAKE. RLS enabled with zero
  policies; service-role server functions are the only writer.$comment$;

CREATE INDEX IF NOT EXISTS cg_mission_lease_tenant_state_idx
  ON public.cg_mission_lease (tenant_id, state);

CREATE INDEX IF NOT EXISTS cg_mission_lease_execution_idx
  ON public.cg_mission_lease (execution_id, attempt);

CREATE INDEX IF NOT EXISTS cg_mission_lease_worker_idx
  ON public.cg_mission_lease (worker_id, state);

DROP TRIGGER IF EXISTS cg_mission_lease_touch ON public.cg_mission_lease;
CREATE TRIGGER cg_mission_lease_touch
  BEFORE UPDATE ON public.cg_mission_lease
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- 2. cg_worker_delegation_grant — LIVE delegation state (revocation surface)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_worker_delegation_grant (
  id                     text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  tenant_id              text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  definition_id          text NOT NULL,
  delegation_ref         text NOT NULL CHECK (length(delegation_ref) BETWEEN 1 AND 200),
  delegated_capabilities jsonb NOT NULL DEFAULT '[]'::jsonb
                           CHECK (jsonb_typeof(delegated_capabilities) = 'array'),
  max_granted_risk_class text NOT NULL CHECK (max_granted_risk_class IN ('low','medium','high','critical')),
  -- active | revoked. The gate check at WAKE reads this state: a revocation
  -- takes effect IMMEDIATELY at the next gate check (no cache, no grace).
  state                  text NOT NULL CHECK (state IN ('active','revoked')),
  granted_by             text NOT NULL CHECK (length(granted_by) BETWEEN 1 AND 160),
  granted_at             timestamptz NOT NULL DEFAULT now(),
  revoked_by             text CHECK (length(revoked_by) BETWEEN 1 AND 160),
  revoked_at             timestamptz,
  revoked_reason         text,
  UNIQUE (id, tenant_id),
  UNIQUE (definition_id, delegation_ref),
  -- Revocation coherence: a revoked grant is revoked with who/when/why; an
  -- active grant carries no revocation stamp (fail closed, database-enforced).
  CONSTRAINT cg_worker_delegation_grant_revocation_coherence CHECK (
    (
      state = 'active'
      AND revoked_by IS NULL AND revoked_at IS NULL AND revoked_reason IS NULL
    ) OR (
      state = 'revoked'
      AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL
      AND revoked_reason IS NOT NULL
    )
  ),
  CONSTRAINT cg_worker_delegation_grant_definition_fk
    FOREIGN KEY (definition_id, tenant_id)
    REFERENCES public.cg_worker_definition (id, tenant_id)
    ON DELETE CASCADE
);

COMMENT ON TABLE public.cg_worker_delegation_grant IS
  $comment$MISSION V1-003 live delegation-grant state for persistent worker
  definitions (CTO RULING-3 chain: Definition -> Delegation -> Execution).
  cg_worker_delegation (MISSION-R-40) is append-only history and carries no
  state column — a revocation could never take effect there. This table is
  the runtime-resolution surface the worker-host gate reads at WAKE:
  authority flows ONLY through state='active' rows here, mapped onto the
  neutral RBAC core and the mission domain's authorization contribution
  (Invariant 12). state='revoked' takes effect immediately at the next gate
  check. RLS enabled with zero policies; service-role server functions are
  the only writer.$comment$;

CREATE INDEX IF NOT EXISTS cg_worker_delegation_grant_tenant_idx
  ON public.cg_worker_delegation_grant (tenant_id, definition_id, state);

-- -----------------------------------------------------------------------------
-- 3. cg_worker_quarantine — the quarantine ledger
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_worker_quarantine (
  id                text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  tenant_id         text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  definition_id     text NOT NULL,
  reason            text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  failure_count     integer NOT NULL CHECK (failure_count >= 0),
  failure_threshold integer NOT NULL CHECK (failure_threshold >= 1),
  -- quarantined | released. While a quarantined row exists for the
  -- definition, the host gate denies leasing to that worker.
  state             text NOT NULL CHECK (state IN ('quarantined','released')),
  quarantined_by    text NOT NULL CHECK (length(quarantined_by) BETWEEN 1 AND 160),
  quarantined_at    timestamptz NOT NULL DEFAULT now(),
  released_at       timestamptz,
  released_by       text CHECK (length(released_by) BETWEEN 1 AND 160),
  UNIQUE (id, tenant_id),
  CONSTRAINT cg_worker_quarantine_release_coherence CHECK (
    (
      state = 'quarantined' AND released_at IS NULL AND released_by IS NULL
    ) OR (
      state = 'released'
      AND released_at IS NOT NULL AND released_by IS NOT NULL
    )
  ),
  CONSTRAINT cg_worker_quarantine_definition_fk
    FOREIGN KEY (definition_id, tenant_id)
    REFERENCES public.cg_worker_definition (id, tenant_id)
    ON DELETE CASCADE
);

COMMENT ON TABLE public.cg_worker_quarantine IS
  $comment$MISSION V1-003 quarantine ledger: a worker whose failure count
  crosses its configured bound is RECORDED here and is no longer leased to —
  the worker-host gate denies at WAKE while a state='quarantined' row exists
  for the definition. Quarantine is an authority-freezing act (fail closed),
  never a deletion; release (state='released') is an explicit operator act
  with who/when provenance. RLS enabled with zero policies; service-role
  server functions are the only writer.$comment$;

CREATE INDEX IF NOT EXISTS cg_worker_quarantine_tenant_idx
  ON public.cg_worker_quarantine (tenant_id, definition_id, state);

-- -----------------------------------------------------------------------------
-- 4. Deny-by-default security posture
-- -----------------------------------------------------------------------------
-- RLS ENABLED with ZERO policies and all anon/authenticated privileges
-- REVOKED (mirrors the worker-definitions / foundation-mission posture):
-- leases, live delegation state and quarantine records are governance-
-- critical authority rows and worker administration runs through
-- service-role server functions only. Policies may be authored by a
-- follow-up migration under explicit authorization, never silently.
-- =============================================================================

ALTER TABLE public.cg_mission_lease ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_worker_delegation_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_worker_quarantine ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cg_mission_lease FROM anon, authenticated;
REVOKE ALL ON public.cg_worker_delegation_grant FROM anon, authenticated;
REVOKE ALL ON public.cg_worker_quarantine FROM anon, authenticated;

-- =============================================================================
-- End of migration. Verification (run after apply authorization):
--   • all three tables exist with rowsecurity = true and zero policies in
--     pg_policies;
--   • anon/authenticated hold NO privileges on any of the three tables;
--   • a cg_mission_lease row cannot reference another tenant's (or another
--     mission's) execution record (composite FK);
--   • a released cg_mission_lease row without a coherent outcome/retry stamp
--     is rejected (state-coherence CHECK);
--   • a revoked delegation grant without who/when/why is rejected;
--   • a quarantined row without release provenance cannot claim 'released'.
-- =============================================================================

-- Component: database/supabase/migrations/20261003000019_coregrid_v1_mission_lease.sql
-- Owner: mission V1-003 (team WORKFORCE) — governed worker execution host
