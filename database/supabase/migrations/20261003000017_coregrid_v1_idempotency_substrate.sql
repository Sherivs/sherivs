-- =============================================================================
-- CoreGrid V1 — durable idempotency substrate (MISSION H3-028 / L-T-012)
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED. Do not treat this file as a live database.
-- Apply only with an explicit human authorization decision (governance law):
--   supabase db push --workdir database/supabase
-- Rollback (genuine inverse of this migration):
--   database/supabase/rollbacks/20261003000017_coregrid_v1_idempotency_substrate.sql
--
-- Authority:
--   H3-WAVE-CAMPAIGN mission C-028 (role: Durable Idempotency Engineer,
--   L-T-012): author the durable substrate behind the platform command
--   idempotency contract (J-030 / V1CAP-054, frontend/src/lib/command/
--   idempotency.ts). G-063: mandatory idempotency keys on consequential
--   commands are "the difference between a demo and a production platform" —
--   the in-memory reference store is process-local, so exactly-once replay
--   dies with the process. This migration makes the recorded outcome DURABLE:
--   a retry after a process restart replays the recorded outcome instead of
--   re-executing.
--   Exemplars: 20261002000015_coregrid_v1_substrate_policies.sql (the
--   neutral-primitives-only policy construction, FORCE RLS posture, grant
--   grant rules and COMMENT pattern) and 20261002000004_coregrid_v1_memory_
--   tier.sql (table-authoring style, COND-003 tenant text parameterization).
--   AGENTS.md §9 (recorded outcome is canonical truth for its TTL window),
--   §13 (every request has tenant context), §16 (layered authorization),
--   §17 (RLS mandatory; application code is never the only security layer),
--   §26 (never trust client-supplied identity, tenant or role), §28 (records
--   are never rewritten within their lifetime), §29 (no secret values in
--   stored content — the record holds digests and outcome references only).
--
-- =============================================================================
-- EXPECTED POSTURE (declarative — header comment per campaign law; the
-- posture JSON files are NOT edited by this mission)
-- =============================================================================
--   table:      public.cg_idempotency_record
--   posture:    policy-backed, tenant-scoped, FORCE ROW LEVEL SECURITY
--   policies:   idempotency_record_select_own_tenant  (SELECT TO authenticated
--               USING tenant_id = public.get_my_tenant_id())
--               idempotency_record_insert_tenant_admin (INSERT TO
--               authenticated WITH CHECK public.is_tenant_admin(tenant_id)
--               AND actor_id = auth.uid()::text)
--               idempotency_record_replace_expired (UPDATE TO authenticated:
--               USING tenant-scoped AND expires_at <= now() — an EXPIRED row
--               is untrusted (== absent) by the contract's fail-safe law and
--               may be replaced; WITH CHECK re-satisfies the full INSERT
--               rules. A LIVE recorded outcome can NEVER be rewritten:
--               the USING clause filters to expired rows only.)
--   zero-policy surfaces: none — but the UPDATE policy admits ONLY
--               already-expired rows (immutability within TTL, §28); there is
--               no client DELETE and no client path to erase a live record;
--               TTL hygiene runs through the SECURITY DEFINER service-role
--               prune function below.
--   grants:     authenticated = SELECT + INSERT + UPDATE (policy-scoped to
--               expired rows); anon = none;
--               service_role = ALL (+ EXECUTE on the prune function —
--               sanctioned bypass-path parity, 20260907000800 §3 convention).
--   primitives: J-005 neutral primitives only (get_my_tenant_id /
--               is_tenant_admin). holds_tenant_role(p_tenant, p_role_ref) is
--               available but intentionally UNUSED directly: the only role
--               this substrate needs is the neutral ADMINISTRATOR binding,
--               reached exclusively inside public.is_tenant_admin()
--               ('role:administrator'), matching the H2-04 exemplar law that
--               no domain role literal may appear in the policy layer.
--
-- =============================================================================
-- SCOPE
-- =============================================================================
-- 1. public.cg_idempotency_record — one row per RECORDED idempotent
--    execution: the derived idempotency key, the command envelope (scope,
--    actor, intent, payload digest), the recorded outcome (status, reason,
--    external effect), the response reference, and the TTL window
--    (created_at / expires_at). The record is WHAT A RETRY MUST FIND.
-- 2. TTL / cleanup support: an expires_at-driven index plus the
--    SECURITY DEFINER service-role prune function
--    public.cg_prune_expired_idempotency_records(p_batch_limit). Expired
--    records are deleted server-side in bounded batches; deletion through a
--    client path does not exist.
--
-- EXACTLY-ONCE LAW (why the substrate is shaped this way)
-- -----------------------------------------------------------------------------
--   - UNIQUE (tenant_id, idempotency_key) is the durable arbiter of
--     exactly-once: under a concurrent race, exactly one INSERT wins and the
--     loser's ON CONFLICT DO NOTHING is a no-op — the recorded outcome of the
--     winner is the canonical truth for the key's lifetime (Constitution §9).
--   - No path rewrites a LIVE record: no UPDATE policy admits one, no RPC
--     exists, and the UNIQUE (tenant_id, idempotency_key) constraint plus
--     ON CONFLICT semantics make the first record for a live key the winner
--     under any concurrent race. A key collision (same key, different payload
--     digest) is detected by the consuming contract layer BEFORE any write;
--     the substrate additionally refuses to overwrite by construction.
--     An EXPIRED row is replaceable atomically (it is already untrusted ==
--     absent, §9 fail-safe), and the replace-expired UPDATE policy re-checks
--     the full INSERT rules on the new row — nothing else is updatable.
--   - Expired record == absent record (fail-safe, mirroring the contract
--     layer): the outcome is no longer trusted past expires_at, the key is
--     freed, and a fresh execution re-records. Expiry is bounded by the TTL
--     the caller declared; prune is operational hygiene, never the trust
--     boundary (reads filter expires_at themselves).
--   - Payloads are never stored. Only the SHA-256 payload digest is stored,
--     sufficient for collision detection without persisting command content
--     (data minimization, §19; responseRef is an opaque reference, §29).
--
-- TENANT POSTURE (COND-003 parameterization, UNRESOLVED):
--   tenant_id is `text NOT NULL CHECK (length 1..128)` per applied reality
--   (exemplar 20261002000004 §"Tenant posture"). If COND-003 rules uuid
--   (MISSION-R-02), a follow-up migration converts the substrate; uuid::text
--   renders canonically so the text comparisons keep working unchanged.
--
-- SECURITY DEFINER INTERACTION (why FORCE RLS is safe here):
--   Identical to the H2-04 exemplar analysis: FORCE ROW LEVEL SECURITY binds
--   the table OWNER; the platform owner holds the sanctioned BYPASSRLS
--   attribute, so the SECURITY DEFINER neutral primitives and the prune
--   function are unaffected; service_role is not the owner, receives no
--   policy, and its sanctioned bypass rests on the platform attribute — a
--   platform without it degrades fail-closed (zero rows), never fail-open.
--
-- Deliberately NOT in scope:
--   • Posture JSON files (campaign law: posture entry lives in the header
--     comment above; the JSON files are owned by another team).
--   • Any change to frontend/src/lib/command/idempotency.ts (read-only
--     contract module; the DB-backed store is authored beside it).
--   • Cron scheduling of the prune function (operations wiring is a separate
--     authorization decision; the function is the substrate's entire duty).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. cg_idempotency_record — the durable exactly-once substrate
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_idempotency_record (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  -- The derived idempotency key (contract form: 'idem:<scope>:<intent>:<digest>';
  -- opaque neutral token — length bound accommodates long scope/intent verbs).
  idempotency_key  text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 512),
  -- Command envelope (contract: IdempotencyEnvelope).
  scope            text NOT NULL CHECK (length(scope) BETWEEN 1 AND 128),
  actor_id         text NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 160),
  intent           text NOT NULL CHECK (length(intent) BETWEEN 1 AND 128),
  -- SHA-256 hex digest of the canonical payload — never the payload itself.
  payload_digest   text NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  -- Recorded outcome (contract: IdempotencyOutcome).
  status           text NOT NULL CHECK (status IN ('succeeded','failed')),
  reason           text CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 512),
  external_effect  text NOT NULL CHECK (external_effect IN ('none','recorded_intent','compensation_required')),
  -- Opaque reference to the persisted response of the original execution.
  response_ref     text NOT NULL CHECK (length(response_ref) BETWEEN 1 AND 512),
  -- TTL window (bounded retention; contract: recordTtlMs).
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  -- The durable exactly-once arbiter (mission law): one recorded outcome per
  -- key per tenant — enforced by the database, never only by application code.
  CONSTRAINT cg_idempotency_record_tenant_key_uniq UNIQUE (tenant_id, idempotency_key),
  -- A record is born expired or it is not: the TTL window must be positive.
  CONSTRAINT cg_idempotency_record_ttl_positive CHECK (expires_at > created_at)
);

COMMENT ON TABLE public.cg_idempotency_record IS
  $comment$H3-028 / L-T-012 / J-030 (V1CAP-054) durable idempotency substrate:
  one row per recorded idempotent command execution. A retry of the same key +
  payload digest replays the RECORDED outcome with no new external effect; a
  same-key/different-digest collision is rejected by the consuming contract
  layer and can never overwrite the row (no path rewrites a LIVE record).
  Payloads are
  never stored — only the SHA-256 digest (data minimization, AGENTS §19); the
  response_ref is an opaque reference, never logged content (§29).
  RLS FORCED with tenant-scoped policies built only on the J-005 neutral
  primitives (H2-04 exemplar): SELECT is tenant-equality via
  get_my_tenant_id(); INSERT requires the neutral ADMINISTRATOR binding AND
  actor_id = auth.uid()::text — a client can never record under another
  actor's identity. UPDATE exists ONLY as replace-expired (USING filters to
  already-expired rows — the recorded outcome is immutable within its TTL,
  §28) and there is NO client DELETE — expiry hygiene runs server-side via
  cg_prune_expired_idempotency_records.
  Rollback: database/supabase/rollbacks/20261003000017_coregrid_v1_idempotency_substrate.sql.$comment$;

-- TTL support: expiry-driven lookups (reads already filter expires_at) and
-- bounded-batch pruning both scan this index.
CREATE INDEX IF NOT EXISTS cg_idempotency_record_expires_idx
  ON public.cg_idempotency_record (expires_at);

CREATE INDEX IF NOT EXISTS cg_idempotency_record_tenant_idx
  ON public.cg_idempotency_record (tenant_id);

-- -----------------------------------------------------------------------------
-- 2. TTL / cleanup function — SECURITY DEFINER, service-role only
-- -----------------------------------------------------------------------------
-- The prune path is the ONLY deletion surface for this table. It is granted
-- to service_role exclusively; authenticated/anon hold no EXECUTE and no
-- DELETE privilege, so no client path can erase a recorded outcome (the
-- exactly-once substrate cannot be sabotaged through the client boundary).

CREATE OR REPLACE FUNCTION public.cg_prune_expired_idempotency_records(
  p_before      timestamptz,
  p_batch_limit integer DEFAULT 10000
)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF p_before IS NULL THEN
    RAISE EXCEPTION 'cg_prune_expired_idempotency_records: p_before is required';
  END IF;
  IF p_batch_limit IS NULL OR p_batch_limit < 1 THEN
    RAISE EXCEPTION 'cg_prune_expired_idempotency_records: p_batch_limit must be a positive integer';
  END IF;

  WITH doomed AS (
    SELECT id
      FROM public.cg_idempotency_record
     WHERE expires_at <= p_before
     ORDER BY expires_at
     LIMIT p_batch_limit
       FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.cg_idempotency_record r
   USING doomed d
   WHERE r.id = d.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.cg_prune_expired_idempotency_records(timestamptz, integer) IS
  $comment$H3-028 TTL/cleanup support: deletes expired idempotency records in
  bounded batches (oldest expiry first, SKIP LOCKED for concurrent safety) and
  returns the count. SECURITY DEFINER, granted to service_role only — there is
  no client DELETE path against the substrate (recorded outcomes are immutable
  within their TTL, AGENTS §28). Expired-record == absent-record is the
  fail-safe trust rule and is enforced by reads, not by prune timing.$comment$;

REVOKE ALL ON FUNCTION public.cg_prune_expired_idempotency_records(timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cg_prune_expired_idempotency_records(timestamptz, integer) FROM anon;
REVOKE ALL ON FUNCTION public.cg_prune_expired_idempotency_records(timestamptz, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cg_prune_expired_idempotency_records(timestamptz, integer) TO service_role;

-- -----------------------------------------------------------------------------
-- 3. FORCE ROW LEVEL SECURITY (owner bound by RLS for non-bypass owners)
-- -----------------------------------------------------------------------------
ALTER TABLE public.cg_idempotency_record FORCE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 4. Table privileges — authenticated gains exactly the client access the
--    policies below gate (SELECT + INSERT + UPDATE, the last policy-scoped to
--    already-expired rows only — no client DELETE privilege, no client path
--    to erase or rewrite a live recorded outcome, §28); anon stays revoked
--    (zero privileges, zero policy grants); service_role receives the
--    sanctioned bypass-path parity grant (20260907000800 §3 convention).
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON TABLE public.cg_idempotency_record TO authenticated;

GRANT ALL ON TABLE public.cg_idempotency_record TO service_role;

-- -----------------------------------------------------------------------------
-- 5. Policies — SELECT: tenant-equality via the neutral primitive;
--    INSERT: neutral tenant-admin predicate + actor self-derivation;
--    UPDATE: replace-expired ONLY (USING filters to already-expired rows —
--    a live recorded outcome can never be rewritten, §28); DELETE: absent.
-- -----------------------------------------------------------------------------

CREATE POLICY idempotency_record_select_own_tenant
  ON public.cg_idempotency_record
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id());

CREATE POLICY idempotency_record_insert_tenant_admin
  ON public.cg_idempotency_record
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_tenant_admin(tenant_id)
    AND actor_id = auth.uid()::text
  );

CREATE POLICY idempotency_record_replace_expired
  ON public.cg_idempotency_record
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND expires_at <= now()
  )
  WITH CHECK (
    tenant_id = public.get_my_tenant_id()
    AND public.is_tenant_admin(tenant_id)
    AND actor_id = auth.uid()::text
  );

COMMENT ON POLICY idempotency_record_select_own_tenant ON public.cg_idempotency_record IS
  $comment$J-005 tenant-equality: a recorded outcome is visible only when its
  tenant_id equals the actor's single active neutral binding resolved by
  get_my_tenant_id(). Unbound actor -> NULL -> zero rows; AMBIGUOUS_TENANCY
  raises (fail-closed, observable). Tenant A can never replay Tenant B's
  outcome — the cross-tenant idempotency-replay channel is closed by RLS, not
  by application code. The envelope digest and outcome columns are returned
  untouched for visible rows — nothing is filtered beyond tenancy (AGENTS §11).$comment$;

COMMENT ON POLICY idempotency_record_insert_tenant_admin ON public.cg_idempotency_record IS
  $comment$J-005/J-006: the neutral ADMINISTRATOR binding in the tenant under
  test, AND actor_id must equal auth.uid()::text — a recorded outcome is always
  attributed to the acting identity, never a client-supplied actor
  (Constitution §26). The UNIQUE (tenant_id, idempotency_key) constraint makes
  the write atomic per key: under a retry race exactly one INSERT wins and the
  duplicate is a no-op — the durable exactly-once arbiter (§28).$comment$;

COMMENT ON POLICY idempotency_record_replace_expired ON public.cg_idempotency_record IS
  $comment$H3-028 replace-expired-only UPDATE law: the USING clause admits
  rows that are ALREADY expired (untrusted == absent by the contract's
  fail-safe rule), so a LIVE recorded outcome can never be rewritten through
  any client path (AGENTS §28). The WITH CHECK re-satisfies the full INSERT
  rules — neutral ADMINISTRATOR binding in the tenant under test AND
  actor_id = auth.uid()::text — so a replacement carries the same guarantees
  as a first record. The consuming store narrows this further to
  expires_at <= the replacing record's created_at, atomically.$comment$;

-- =============================================================================
-- End of migration. Post-apply verification (AFTER explicit apply
-- authorization; none run by this authored artifact):
--   node scripts/verify-rls-isolation-battery.mjs   (policy-backed tenant-
--     scoped posture for cg_idempotency_record; cross-tenant probes must show
--     Tenant A cannot read or replay Tenant B's records)
--   node scripts/verify-neutral-tenant-primitives.mjs
-- =============================================================================