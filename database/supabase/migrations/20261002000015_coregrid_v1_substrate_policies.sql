-- =============================================================================
-- CoreGrid V1 — batch-A/B substrate RLS policy layer (MISSION H2-04)
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED. Do not treat this file as a live database.
-- Apply only with an explicit human authorization decision (governance law):
--   supabase db push --workdir database/supabase
-- Rollback (genuine inverse of this migration):
--   database/supabase/rollbacks/20261002000015_coregrid_v1_substrate_policies.sql
--
-- Authority:
--   MISSION H2-04 (first policy layer for the eight batch-A/B substrate
--   families 20261002000005..20261002000012).
--   Exemplar: 20261002000013_coregrid_v1_neutral_membership_policies.sql —
--   the neutral-primitives-only policy construction, FORCE RLS, exact policy
--   sets, grant posture, and COMMENT documentation pattern are all inherited
--   from it.
--   J-005 neutral tenant primitives (20261002000001): public.get_my_tenant_id()
--   / public.is_tenant_admin() / public.holds_tenant_role() are the ONLY
--   authorization building blocks referenced below.
--   AGENTS.md §13 (every request must have tenant context), §16 (layered
--   authorization), §17 (RLS mandatory; application code is never the only
--   security layer), §11/§12 (provenance is preserved — policies filter rows,
--   never provenance columns), §26 (never trust client-supplied identity,
--   tenant, or role), §28 (immutable audit records), §35 (realtime security).
--   RLS_ISOLATION_BATTERY.md (postures: zero-policy strongest form and
--   policy-backed tenant-scoped visibility; §4.4 cross-tenant probe law).
--
-- Expected posture (declarative, consumed by the battery steward):
--   scripts/verification/rls-table-postures-substrate.json
--
-- =============================================================================
-- SCOPE
-- =============================================================================
-- Policy-backed (tenant-scoped client access is legitimate; exact policy set
-- authored below — nothing more, nothing less):
--   cg_reconciliation_input      (20261002000005) — retained decision-bearing
--       reconciliation input facts (verdict explainability substrate).
--   cg_event_route_subscription  (20261002000007) — declared event
--       subscriptions (server-resolved truth, immutable while it exists).
--   cg_evidence_record           (20261002000008) — append-only captured
--       evidence records (the substrate of Verification).
--   cg_usage_attribution_bucket  (20261002000010) — usage-attribution
--       partition buckets (the audit partition of the roll-up).
--
-- Append-only audit — NO client INSERT/UPDATE/DELETE policy, deliberately:
--   cg_event_security_denial     (20261002000006)
--   cg_event_security_redaction  (20261002000006)
--   cg_event_route_outcome       (20261002000007)
--   cg_evidence_lifecycle_act    (20261002000008)
--   These four are immutable audit ledgers (Constitution §28): every row is a
--   recorded gate decision or lifecycle act that must never be rewritten,
--   re-attributed, or erased through a client path. This migration therefore
--   authors NO client INSERT/UPDATE/DELETE policy for them — there is no
--   legitimate client write, ever, and the exact zero-policy deny-by-default
--   posture of their source migrations stands unchanged (RLS enabled, zero
--   policies, anon/authenticated revoked). Client reads are likewise left
--   denied (audit trails are consumed through the service-role server-function
--   path that owns the gates); a future tenant-scoped SELECT policy for audit
--   visibility is a SEPARATE authorization decision, never an implied one.
--   The denial/redaction/outcome rows of the security gates are exactly the
--   records §35 demands stay observable — observability is served server-side
--   without ever handing a client a write or delete path against them.
--
-- Unchanged (out of scope; remain zero-policy deny-by-default exactly as
-- their source migrations authored them — policies for them, if ever
-- legitimate, are separate missions under explicit authorization):
--   cg_reconciliation_verdict, cg_event_security, cg_event_route_queue,
--   cg_event_route_cursor, cg_usage_attribution_rollup,
--   cg_reasoning_provenance_snapshot, cg_knowledge_source,
--   cg_knowledge_freshness_contract, cg_knowledge_invalidation,
--   cg_knowledge_downgrade, cg_tool_runtime_tool, cg_tool_runtime_invocation.
--
-- =============================================================================
-- POLICY CONSTRUCTION LAW (J-005/J-006 compliance, inherited from the exemplar)
-- =============================================================================
--   Every predicate below is built ONLY on the neutral primitives
--   public.get_my_tenant_id() / public.is_tenant_admin() — plus the platform
--   identity primitive auth.uid() for actor self-derivation. Never a legacy
--   domain helper, never a hard-coded tenant id, never a domain role name.
--   holds_tenant_role(p_tenant, p_role_ref) is available but intentionally
--   UNUSED here: no legitimate client path on these four substrates requires
--   a non-administrator role gate, and a predicate that named a role beyond
--   the neutral ADMINISTRATOR token would import policy vocabulary this
--   layer must not own (J-006: directional domain mapping stays in
--   DomainDefinition.roleMappings, never in the policy layer). The only role
--   reachable from these policies is the NEUTRAL 'role:administrator' token,
--   and it is reached exclusively inside public.is_tenant_admin().
--
--   Actor self-derivation (Constitution §26, mirroring the exemplar's
--   granted_by rule): where a table carries a natural ACTOR provenance
--   column, the INSERT policy pins it to auth.uid()::text so a client can
--   never assert an actor identity other than the acting identity:
--     cg_event_route_subscription.subscriber_id = auth.uid()::text
--       — a subscriber declares only its own subscription;
--     cg_evidence_record.captured_by = auth.uid()::text AND
--     cg_evidence_record.created_by = auth.uid()::text
--       — the capture actor and the envelope author are the acting identity;
--       anonymous or forged-attribution evidence can never be inserted
--       through a client path (J-034/J-001 no-anonymous-evidence law).
--   Tables without an actor column (cg_reconciliation_input,
--   cg_usage_attribution_bucket) are tenant-administrator-gated appends only;
--   their actor attribution is server-derived by the owning adapters.
--
-- FAIL-CLOSED SHAPE (why this migration cannot widen access)
-- -----------------------------------------------------------------------------
--   Before: RLS enabled, zero policies, no grants to anon/authenticated —
--   DENY for every client role (source migrations 20261002000005..12 §3).
--   After: RLS stays enabled and is additionally FORCED; authenticated
--   receives exactly SELECT + INSERT table privileges (no UPDATE, no DELETE —
--   least privilege); every policy predicate is a positive, per-row
--   authorization test against the neutral substrate:
--     SELECT  USING tenant-equality: row.tenant = public.get_my_tenant_id()
--             (NULL for an unbound actor filters every row; AMBIGUOUS_TENANCY
--             raises — fail-closed and observable, per NEUTRAL_TENANT_
--             PRIMITIVES §8 risk 4);
--     INSERT  WITH CHECK public.is_tenant_admin(row.tenant) (+ the actor
--             self-derivation pins where an actor column exists);
--     UPDATE  NO policy AND no privilege — denied twice over;
--     DELETE  NO policy AND no privilege — denied twice over.
--   The UPDATE/DELETE denial is not merely least privilege: every one of the
--   four substrates is append-only BY ITS OWN SOURCE LAW (reconciliation
--   append-only resolution; subscription declaration immutability — a scope
--   change is a retire plus a NEW subscription identity; evidence append-only
--   lifecycle — promotion/supersession/revocation are NEW records; bucket
--   partition immutability). History is corrected by appending, never by
--   mutating (Constitution §28); the state transitions that DO exist (e.g.
--   subscription suspension) run server-side through the gated service-role
--   path, never through a client UPDATE.
--   Everything not explicitly ALLOWED here remains DENY: anon still holds
--   zero privileges and receives zero policies; a predicate that fails hides
--   the row (or raises AMBIGUOUS_TENANCY); no client-supplied tenant,
--   identity, or role value can satisfy a predicate because every actor
--   reference is re-derived inside the primitives from auth.uid().
--
-- PROVENANCE LAW (AGENTS §11/§12)
-- -----------------------------------------------------------------------------
--   The predicates reference only authorization columns (tenant_id and, for
--   INSERT self-derivation, the actor columns subscriber_id / captured_by /
--   created_by — the same class of reference as the exemplar's granted_by
--   rule). Provenance and content columns — recorded_at, observed_at,
--   confidence, evidence_class, reliability, validity windows, totals,
--   declared_at, delivery, claim, lineage — are NEVER filtered out, mutated,
--   or hidden by any policy: a visible row returns every column, provenance
--   intact. No erasure or retention behavior is touched here.
--
-- SECURITY DEFINER INTERACTION (why FORCE RLS is safe here)
-- -----------------------------------------------------------------------------
--   FORCE ROW LEVEL SECURITY binds the table OWNER. The owner is the platform
--   role postgres, which holds the sanctioned BYPASSRLS attribute on the
--   Supabase platform (verified live in pg_roles during the exemplar's
--   authoring: rolbypassrls = true). BYPASSRLS holds even under FORCE, so the
--   SECURITY DEFINER paths — the neutral primitives and every gated RPC —
--   are unaffected. service_role is NOT the owner and receives NO policy; its
--   sanctioned server-only bypass path (20260907000800 §3 convention,
--   inherited by the exemplar) rests on the platform bypass attribute — if a
--   future platform lacks it, service_role simply sees zero rows (fail-closed,
--   never fail-open). Force-RLS exists to close the owner-bypass hole for any
--   FUTURE owner role that lacks the sanctioned bypass (RLS_ISOLATION_BATTERY
--   §2: force-RLS is re-evaluated exactly when tenant-scoped policies are
--   authored — which is now).
--
-- POSTURE INVARIANTS (asserted by tests/unit/mh-04-substrate-policies.test.ts
-- and by the battery steward via the declarative JSON):
--   1. exactly four tables are policy-backed; exactly eight policies exist;
--   2. every predicate references only the neutral primitives + auth.uid()
--      self-derivation — no domain helper, no domain role literal, no
--      hard-coded tenant;
--   3. zero policies and zero grants are authored for the four append-only
--      audit tables (no client INSERT/UPDATE/DELETE policy — §28) and for the
--      twelve out-of-scope tables;
--   4. authenticated holds exactly SELECT + INSERT on the four; anon holds
--      nothing; service_role holds ALL (bypass-path parity);
--   5. no provenance column appears in any policy predicate;
--   6. the rollback is the genuine inverse (exact policy drops, privilege
--      restoration, NO FORCE — RLS stays enabled, zero-policy deny-by-default
--      restored exactly).
--
-- Post-apply verification (AFTER explicit apply authorization; none run by
-- this authored artifact):
--   node scripts/verify-rls-isolation-battery.mjs   (Stage 3 extension: the
--     battery steward consumes the declarative posture JSON and extends the
--     genuine cross-tenant probes to these four policy-backed tables)
--   node scripts/verify-neutral-tenant-primitives.mjs
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. FORCE ROW LEVEL SECURITY (owner bound by RLS for non-bypass owners)
-- -----------------------------------------------------------------------------
ALTER TABLE public.cg_reconciliation_input     FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cg_event_route_subscription FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cg_evidence_record          FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cg_usage_attribution_bucket FORCE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 2. Table privileges — authenticated gains exactly the client access the
--    policies below gate (SELECT + INSERT; no UPDATE/DELETE privilege — the
--    substrates are append-only, §28); anon stays revoked (zero privileges,
--    zero policy grants); service_role receives the sanctioned bypass-path
--    parity grant (20260907000800 §3 convention).
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT ON TABLE public.cg_reconciliation_input     TO authenticated;
GRANT SELECT, INSERT ON TABLE public.cg_event_route_subscription TO authenticated;
GRANT SELECT, INSERT ON TABLE public.cg_evidence_record          TO authenticated;
GRANT SELECT, INSERT ON TABLE public.cg_usage_attribution_bucket TO authenticated;

GRANT ALL ON TABLE public.cg_reconciliation_input     TO service_role;
GRANT ALL ON TABLE public.cg_event_route_subscription TO service_role;
GRANT ALL ON TABLE public.cg_evidence_record          TO service_role;
GRANT ALL ON TABLE public.cg_usage_attribution_bucket TO service_role;

-- -----------------------------------------------------------------------------
-- 3. Policies — SELECT: tenant-equality via the neutral primitive;
--    INSERT: neutral tenant-admin predicate (+ actor self-derivation where an
--    actor column exists); UPDATE/DELETE: intentionally absent for ALL four
--    (append-only substrates — §28; also unprivileged for authenticated).
-- -----------------------------------------------------------------------------

-- ── cg_reconciliation_input ─────────────────────────────────────────────────
CREATE POLICY reconciliation_input_select_own_tenant
  ON public.cg_reconciliation_input
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id());

CREATE POLICY reconciliation_input_insert_tenant_admin
  ON public.cg_reconciliation_input
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_admin(tenant_id));

-- ── cg_event_route_subscription ─────────────────────────────────────────────
CREATE POLICY event_route_subscription_select_own_tenant
  ON public.cg_event_route_subscription
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id());

CREATE POLICY event_route_subscription_insert_tenant_admin
  ON public.cg_event_route_subscription
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_tenant_admin(tenant_id)
    AND subscriber_id = auth.uid()::text
  );

-- ── cg_evidence_record ──────────────────────────────────────────────────────
CREATE POLICY evidence_record_select_own_tenant
  ON public.cg_evidence_record
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id());

CREATE POLICY evidence_record_insert_tenant_admin
  ON public.cg_evidence_record
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_tenant_admin(tenant_id)
    AND captured_by = auth.uid()::text
    AND created_by = auth.uid()::text
  );

-- ── cg_usage_attribution_bucket ─────────────────────────────────────────────
CREATE POLICY usage_attribution_bucket_select_own_tenant
  ON public.cg_usage_attribution_bucket
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id());

CREATE POLICY usage_attribution_bucket_insert_tenant_admin
  ON public.cg_usage_attribution_bucket
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_admin(tenant_id));

-- -----------------------------------------------------------------------------
-- 4. Documented posture (machine-readable audit strings, dollar-quoted)
-- -----------------------------------------------------------------------------

COMMENT ON TABLE public.cg_reconciliation_input IS
  $comment$MISSION-R-14 / J-004 retained reconciliation inputs; RLS FORCED with
  tenant-scoped policies built only on the J-005 neutral primitives (H2-04,
  20261002000015): SELECT is tenant-equality via get_my_tenant_id(); INSERT
  requires the neutral ADMINISTRATOR binding (J-006 vocabulary
  'role:administrator' via is_tenant_admin); UPDATE and DELETE have no policy
  and authenticated holds no privilege — the input substrate is append-only by
  the reconciliation resolution law (history preserved, Constitution §28).
  Provenance columns (observed_at, recorded_at, confidence, evidence_class,
  reliability, bi-temporal validity) are never filtered or mutated by policy.
  Rollback: database/supabase/rollbacks/20261002000015_coregrid_v1_substrate_policies.sql.$comment$;

COMMENT ON TABLE public.cg_event_route_subscription IS
  $comment$MISSION-R-63 / J-021 declared event subscription; RLS FORCED with
  tenant-scoped policies (H2-04, 20261002000015): SELECT tenant-equality via
  get_my_tenant_id(); INSERT requires the neutral ADMINISTRATOR binding AND
  subscriber_id = auth.uid()::text — a client can never declare a subscription
  attributed to another subscriber; UPDATE and DELETE have no policy — the
  declaration is immutable while it exists (a scope change is a retire plus a
  NEW subscription identity; suspension lifts only on explicit identical
  re-subscription through the gated service-role path). Provenance columns
  (declared_at, event_types, visibility_scopes, max_sensitivity) are never
  filtered or mutated by policy. Rollback:
  database/supabase/rollbacks/20261002000015_coregrid_v1_substrate_policies.sql.$comment$;

COMMENT ON TABLE public.cg_evidence_record IS
  $comment$MISSION-R-90 / J-034 + MISSION-R-91 / J-033 append-only captured
  evidence; RLS FORCED with tenant-scoped policies (H2-04, 20261002000015):
  SELECT tenant-equality via get_my_tenant_id(); INSERT requires the neutral
  ADMINISTRATOR binding AND captured_by = auth.uid()::text AND created_by =
  auth.uid()::text — the capture actor and envelope author are always the
  acting identity (no anonymous or forged-attribution evidence through a
  client path); UPDATE and DELETE have no policy — promotion, supersession and
  revocation are NEW records, the original is retained verbatim (append-only
  lifecycle, Constitution §28; E-018). Provenance columns (evidence_class,
  prior_class, confidence, confidence_basis, lineage, promotion, revocation,
  recorded_at, captured_at) are never filtered or mutated by policy. Rollback:
  database/supabase/rollbacks/20261002000015_coregrid_v1_substrate_policies.sql.$comment$;

COMMENT ON TABLE public.cg_usage_attribution_bucket IS
  $comment$J-043 / V1CAP-078 (MISSION-R-70) roll-up partition buckets; RLS
  FORCED with tenant-scoped policies (H2-04, 20261002000015): SELECT
  tenant-equality via get_my_tenant_id(); INSERT requires the neutral
  ADMINISTRATOR binding (J-006 vocabulary); UPDATE and DELETE have no policy —
  the partition is immutable once persisted (reconciliation of a defect is a
  NEW roll-up, never a bucket rewrite). Provenance columns (dimension,
  bucket_key, totals) are never filtered or mutated by policy. Rollback:
  database/supabase/rollbacks/20261002000015_coregrid_v1_substrate_policies.sql.$comment$;

COMMENT ON POLICY reconciliation_input_select_own_tenant ON public.cg_reconciliation_input IS
  $comment$J-005 tenant-equality: an input fact is visible only when its
  tenant_id equals the actor's single active neutral binding resolved by
  get_my_tenant_id(). Unbound actor -> NULL -> zero rows; AMBIGUOUS_TENANCY
  raises (fail-closed, observable). The tenant ref comes from the neutral
  substrate, never from the client.$comment$;

COMMENT ON POLICY reconciliation_input_insert_tenant_admin ON public.cg_reconciliation_input IS
  $comment$J-005/J-006: only an actor holding the NEUTRAL ADMINISTRATOR binding
  IN the tenant under test may append input facts. No domain role name and no
  client-supplied tenant can satisfy this predicate.$comment$;

COMMENT ON POLICY event_route_subscription_select_own_tenant ON public.cg_event_route_subscription IS
  $comment$J-005 tenant-equality via get_my_tenant_id(); the declared scopes
  (event_types, visibility_scopes, max_sensitivity) are returned untouched for
  visible rows — declaration content is never filtered by policy (AGENTS §11).$comment$;

COMMENT ON POLICY event_route_subscription_insert_tenant_admin ON public.cg_event_route_subscription IS
  $comment$J-005/J-006: neutral ADMINISTRATOR binding in the tenant under test,
  AND subscriber_id must equal auth.uid()::text — a subscriber can only
  declare its own subscription (Constitution §26). The delivery gate re-derives
  identity and tenant per event (AGENTS §35); the declaration never bypasses
  it.$comment$;

COMMENT ON POLICY evidence_record_select_own_tenant ON public.cg_evidence_record IS
  $comment$J-005 tenant-equality via get_my_tenant_id(); the epistemic payload
  (evidence_class, confidence, confidence_basis, lineage, promotion,
  revocation, validity window) is returned untouched for visible rows —
  provenance is never filtered by policy (AGENTS §11).$comment$;

COMMENT ON POLICY evidence_record_insert_tenant_admin ON public.cg_evidence_record IS
  $comment$J-005/J-006: neutral ADMINISTRATOR binding in the tenant under test,
  AND captured_by AND created_by must equal auth.uid()::text — the capture
  actor and the envelope author are always the acting identity, never a
  client-supplied value (Constitution §26; J-034 no-anonymous-evidence).
  Revocation and promotion remain APPEND acts through the owning service-role
  path — never client mutations.$comment$;

COMMENT ON POLICY usage_attribution_bucket_select_own_tenant ON public.cg_usage_attribution_bucket IS
  $comment$J-005 tenant-equality via get_my_tenant_id(); the bucket totals and
  dimension keys are returned untouched for visible rows — the audit partition
  is never filtered by policy (AGENTS §11).$comment$;

COMMENT ON POLICY usage_attribution_bucket_insert_tenant_admin ON public.cg_usage_attribution_bucket IS
  $comment$J-005/J-006: only the neutral ADMINISTRATOR binding in the tenant
  under test may append buckets; the composite FK keeps every bucket bound to
  a same-tenant roll-up (database-enforced, Constitution §28).$comment$;

-- =============================================================================
-- End of migration. Post-apply verification (in this order, after explicit
-- apply authorization):
--   node scripts/verify-rls-isolation-battery.mjs   (posture JSON consumed by
--     the battery steward; cross-tenant probes for the four policy-backed
--     tables; zero-policy strongest form must still hold for every other
--     table of the eight batch-A/B families)
--   node scripts/verify-neutral-tenant-primitives.mjs
-- =============================================================================