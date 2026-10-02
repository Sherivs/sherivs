-- =============================================================================
-- CoreGrid V1 — neutral tenant-membership RLS policies (TEAM 3 / J-005 + J-006)
-- =============================================================================
-- Status: AUTHORED-then-APPLIED (2026-10-02, canonical project
--   nwrflbpbhyiqdptmlccm) via the checksummed apply pattern
--   scripts/apply-canonical-hardening.mjs (Management API query channel).
--   Do not re-apply: re-runs are detected as ALREADY_APPLIED by policy name.
--
-- Rollback (genuine inverse):
--   database/supabase/rollbacks/20261002000013_coregrid_v1_neutral_membership_policies.sql
--
-- Authority:
--   J-005 (neutral tenant-membership primitives: get_my_tenant_id() +
--     tenant-admin predicate replace the legacy domain helpers as the gates for
--     every universal cg_ substrate surface);
--   J-006 / CTO RULING-4 (closed domain-neutral role vocabulary
--     ACTOR, MEMBER, OWNER, ADMINISTRATOR, OPERATOR, MANAGER, SUPERVISOR,
--     CONTRIBUTOR, REVIEWER, APPROVER, AUDITOR, WORKER, AGENT, SERVICE,
--     SYSTEM; directional domain->neutral mapping lives in
--     DomainDefinition.roleMappings — NEVER in the policy layer);
--   AGENTS.md §13 (multi-tenancy: every request must have tenant context),
--   §16 (layered authorization), §17 (RLS mandatory; application code is
--   never the only security layer), §11 (knowledge-graph provenance is
--   preserved — policies filter rows, never provenance columns);
--   RLS_ISOLATION_BATTERY.md §4.4 (this migration is the trigger for the
--   battery's genuine cross-tenant probe extension).
--
-- Scope — exactly the three neutral tenant-membership tables:
--   cg_role_assignment (20260907000800) — time-bounded appointment substrate
--   cg_role_grant      (20260907000800) — capability-grant substrate
--   cg_org_membership  (20261001000000) — the neutral tenant-membership
--     table the primitives migration (20261002000001) resolves tenancy from
--     (cited by name in its header; it is redefinition-only and defines no
--     new table). cg_org_unit is org-structure, not membership — out of
--     scope here; it remains zero-policy deny-by-default until its owner
--     mission authors policies.
--
-- Policy construction law (J-005/J-006 compliance):
--   Every predicate is built ONLY on the neutral primitives
--   public.get_my_tenant_id() / public.is_tenant_admin() /
--   public.holds_tenant_role() — never legacy domain helpers
--   (legacy admin / institution-id readers), never hard-coded tenant ids, and
--   never a domain role name. The only role ref in any predicate is the
--   NEUTRAL 'role:administrator' token, reached through
--   public.is_tenant_admin(); directional domain mapping stays out of the
--   policy layer by construction.
--
-- Fail-closed shape (why these policies cannot widen access):
--   Before this migration: RLS enabled, zero policies, no grants to
--   anon/authenticated — DENY for every client role. After: RLS stays
--   enabled and now also FORCED; authenticated receives table privileges,
--   but every policy predicate is a positive, per-row authorization test
--   evaluated against the neutral substrate:
--     SELECT  USING tenant-equality: row.tenant = public.get_my_tenant_id()
--             (resolved from active neutral bindings; NULL for an unbound
--             actor filters every row; AMBIGUOUS_TENANCY raises — fail-closed
--             and observable, per NEUTRAL_TENANT_PRIMITIVES.md §8 risk 4);
--     INSERT  WITH CHECK public.is_tenant_admin(row.tenant) — only a holder
--             of the neutral ADMINISTRATOR binding IN the tenant under test
--             can create rows;
--     UPDATE  USING + WITH CHECK public.is_tenant_admin(row.tenant);
--     DELETE  NO policy — denied (history preservation: revocation is a
--             status/revoked_on transition, never a delete; AGENTS §28
--             immutable audit records).
--   Everything not explicitly ALLOWED here remains DENY: a query that does
--   not satisfy a predicate sees zero rows (or an error for
--   AMBIGUOUS_TENANCY), anon still holds zero table privileges, and no
--   policy grants anon anything. The set of visible rows can only shrink
--   relative to the actor's neutral bindings; no client-supplied tenant,
--   identity, role or grantor value can satisfy a predicate because every
--   actor reference is re-derived inside the primitives from auth.uid()
--   (Constitution §26).
--
-- Grantor identity rule (no client-supplied grantor):
--   cg_role_grant.granted_by is NOT NULL and carries provenance (who
--   granted). The INSERT policy's WITH CHECK requires
--   granted_by = auth.uid()::text, so a direct INSERT can never assert a
--   grantor other than the acting identity; the RPC surface
--   (grant_role_capability) captures it server-side from auth.uid() the
--   same way (20261002000001 §2c). UPDATE likewise cannot re-attribute a
--   grant to a different grantor.
--
-- Provenance + confidence (AGENTS §11 / §12):
--   The policies reference only authorization columns (tenant, identity,
--   role, status/state, granted_by). Provenance columns — created_at,
--   updated_at, granted_on, revoked_on, started_on, ended_on — are never
--   filtered out, mutated, or hidden by any policy, and no erasure or
--   retention behavior is touched here.
--
-- SECURITY DEFINER interaction (why FORCE RLS is safe here):
--   FORCE ROW LEVEL SECURITY binds the table OWNER. The owner (and the
--   SECURITY DEFINER owner of the neutral primitives and every role-assignment
--   RPC) is the platform role `postgres`, which holds the sanctioned
--   BYPASSRLS attribute on the Supabase platform (verified live in pg_roles
--   during authoring: rolbypassrls = true). BYPASSRLS holds even under
--   FORCE, so the definer path — the neutral helpers and the six
--   role-assignment RPCs — is unaffected; this was re-proven after apply by
--   scripts/verify-role-assignment-substrate.mjs (live mode) and by the
--   battery's own definer contrast. Force-RLS exists to close the
--   owner-bypass hole for any FUTURE owner role that lacks the sanctioned
--   bypass (RLS_ISOLATION_BATTERY.md §2 note: force-RLS is re-evaluated
--   exactly when tenant-scoped policies are authored — which is now).
--
-- Verification after apply:
--   node scripts/verify-role-assignment-substrate.mjs      (live; DATABASE_URL)
--   node scripts/verify-neutral-tenant-primitives.mjs
--   node scripts/verify-rls-isolation-battery.mjs          (Stage 3 extension:
--     genuine cross-tenant probes for these policy-backed tables)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. FORCE ROW LEVEL SECURITY (owner bound by RLS for non-bypass owners)
-- -----------------------------------------------------------------------------
ALTER TABLE public.cg_role_assignment FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cg_role_grant      FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cg_org_membership  FORCE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 2. Table privileges — authenticated gains client access so the policies
--    below are the operative row gate (previously deny-by-privilege);
--    anon stays revoked (zero privileges, zero policy grants).
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cg_role_assignment TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cg_role_grant      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cg_org_membership  TO authenticated;
-- service_role convention parity with the substrate exemplar
-- (20260907000800 §3): the sanctioned server-only bypass path holds full
-- table privilege; cg_org_membership lacked it.
GRANT ALL ON TABLE public.cg_org_membership TO service_role;

-- -----------------------------------------------------------------------------
-- 3. Policies — SELECT: tenant-equality via the neutral primitive;
--    INSERT/UPDATE: neutral tenant-admin predicate + grantor self-derivation;
--    DELETE: intentionally absent (denied; history preserved).
-- -----------------------------------------------------------------------------

-- ── cg_role_assignment ──────────────────────────────────────────────────────
CREATE POLICY role_assignment_select_own_tenant
  ON public.cg_role_assignment
  FOR SELECT TO authenticated
  USING (tenant_ref = public.get_my_tenant_id());

CREATE POLICY role_assignment_insert_tenant_admin
  ON public.cg_role_assignment
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_admin(tenant_ref));

CREATE POLICY role_assignment_update_tenant_admin
  ON public.cg_role_assignment
  FOR UPDATE TO authenticated
  USING (public.is_tenant_admin(tenant_ref))
  WITH CHECK (public.is_tenant_admin(tenant_ref));

-- ── cg_role_grant ───────────────────────────────────────────────────────────
CREATE POLICY role_grant_select_own_tenant
  ON public.cg_role_grant
  FOR SELECT TO authenticated
  USING (tenant_ref = public.get_my_tenant_id());

CREATE POLICY role_grant_insert_tenant_admin
  ON public.cg_role_grant
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_tenant_admin(tenant_ref)
    AND granted_by = auth.uid()::text
  );

CREATE POLICY role_grant_update_tenant_admin
  ON public.cg_role_grant
  FOR UPDATE TO authenticated
  USING (public.is_tenant_admin(tenant_ref) AND granted_by = auth.uid()::text)
  WITH CHECK (public.is_tenant_admin(tenant_ref) AND granted_by = auth.uid()::text);

-- ── cg_org_membership ───────────────────────────────────────────────────────
CREATE POLICY org_membership_select_own_tenant
  ON public.cg_org_membership
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id());

CREATE POLICY org_membership_insert_tenant_admin
  ON public.cg_org_membership
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY org_membership_update_tenant_admin
  ON public.cg_org_membership
  FOR UPDATE TO authenticated
  USING (public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_tenant_admin(tenant_id));

-- -----------------------------------------------------------------------------
-- 4. Documented posture (machine-readable audit strings, dollar-quoted)
-- -----------------------------------------------------------------------------
COMMENT ON TABLE public.cg_role_assignment IS
  $comment$Neutral role-assignment substrate. RLS FORCED with tenant-scoped
  policies built only on the J-005 neutral primitives
  (get_my_tenant_id / is_tenant_admin; 20261002000013): SELECT is
  tenant-equality via get_my_tenant_id(), INSERT/UPDATE require the neutral
  ADMINISTRATOR binding (J-006 vocabulary 'role:administrator'), DELETE has
  no policy (denied — history preserved). Provenance columns are never
  filtered or mutated by policy. Actor references are re-derived from
  auth.uid() inside the SECURITY DEFINER helpers (owner postgres holds the
  sanctioned BYPASSRLS; verified live). Rollback:
  database/supabase/rollbacks/20261002000013_coregrid_v1_neutral_membership_policies.sql.$comment$;

COMMENT ON TABLE public.cg_role_grant IS
  $comment$Neutral capability-grant substrate. RLS FORCED with tenant-scoped
  policies (20261002000013): SELECT tenant-equality via get_my_tenant_id();
  INSERT/UPDATE require the neutral ADMINISTRATOR binding AND
  granted_by = auth.uid()::text — a client can never assert or re-attribute
  a grantor; DELETE has no policy (revocation is a revoked_on transition,
  history preserved). Provenance columns (granted_by, granted_on,
  revoked_on) are never filtered or mutated by policy beyond the
  authorization predicate itself. Rollback:
  database/supabase/rollbacks/20261002000013_coregrid_v1_neutral_membership_policies.sql.$comment$;

COMMENT ON TABLE public.cg_org_membership IS
  $comment$Neutral tenant-membership substrate (the table the J-005 primitives
  resolve tenancy from). RLS FORCED with tenant-scoped policies
  (20261002000013): SELECT tenant-equality via get_my_tenant_id();
  INSERT/UPDATE require the neutral ADMINISTRATOR binding (J-006 vocabulary);
  DELETE has no policy (denied — membership state transitions instead).
  Provenance columns are never filtered or mutated by policy. Rollback:
  database/supabase/rollbacks/20261002000013_coregrid_v1_neutral_membership_policies.sql.$comment$;

COMMENT ON POLICY role_assignment_select_own_tenant ON public.cg_role_assignment IS
  $comment$J-005 tenant-equality: row visible only when tenant_ref equals the
  actor's single active neutral binding resolved by get_my_tenant_id().
  Unbound actor -> NULL -> zero rows; AMBIGUOUS_TENANCY raises (fail-closed,
  observable). Cannot widen access: the tenant ref comes from the neutral
  substrate, never from the client.$comment$;

COMMENT ON POLICY role_assignment_insert_tenant_admin ON public.cg_role_assignment IS
  $comment$J-005/J-006: only an actor holding the NEUTRAL ADMINISTRATOR binding
  ('role:administrator' via is_tenant_admin) IN the tenant under test may
  create assignments. No domain role name and no client-supplied tenant can
  satisfy this predicate.$comment$;

COMMENT ON POLICY role_assignment_update_tenant_admin ON public.cg_role_assignment IS
  $comment$J-005/J-006: UPDATE both filters (USING) and re-validates (WITH
  CHECK) against the neutral ADMINISTRATOR binding in the row's tenant — a
  row cannot be moved into a tenant the actor does not administer.$comment$;

COMMENT ON POLICY role_grant_select_own_tenant ON public.cg_role_grant IS
  $comment$J-005 tenant-equality via get_my_tenant_id(); provenance columns
  (granted_by/granted_on/revoked_on) are returned untouched for visible
  rows (AGENTS §11).$comment$;

COMMENT ON POLICY role_grant_insert_tenant_admin ON public.cg_role_grant IS
  $comment$J-005/J-006: neutral ADMINISTRATOR binding in the tenant under test,
  AND granted_by must equal auth.uid()::text — the grantor identity is
  always the acting identity, never a client-supplied value (Constitution
  §26).$comment$;

COMMENT ON POLICY role_grant_update_tenant_admin ON public.cg_role_grant IS
  $comment$J-005/J-006: UPDATE restricted to the neutral ADMINISTRATOR binding
  and pinned to granted_by = auth.uid()::text on both USING and WITH CHECK —
  grants cannot be re-attributed to another grantor. Revocation history is
  preserved (revoked_on transition; no DELETE policy).$comment$;

COMMENT ON POLICY org_membership_select_own_tenant ON public.cg_org_membership IS
  $comment$J-005 tenant-equality via get_my_tenant_id() — the actor sees only
  the membership fabric of their own resolved tenant. Unbound actor sees
  zero rows; AMBIGUOUS_TENANCY raises (fail-closed).$comment$;

COMMENT ON POLICY org_membership_insert_tenant_admin ON public.cg_org_membership IS
  $comment$J-005/J-006: only the neutral ADMINISTRATOR binding in the tenant
  under test may create memberships; the actor is re-derived from
  auth.uid() inside the primitive, never taken from the client.$comment$;

COMMENT ON POLICY org_membership_update_tenant_admin ON public.cg_org_membership IS
  $comment$J-005/J-006: UPDATE both filters and re-validates against the
  neutral ADMINISTRATOR binding in the row's tenant — a membership cannot
  be moved into a tenant the actor does not administer.$comment$;

-- =============================================================================
-- End of migration. Post-apply verification (in this order):
--   node scripts/verify-role-assignment-substrate.mjs   (live; definer path)
--   node scripts/verify-neutral-tenant-primitives.mjs
--   node scripts/verify-rls-isolation-battery.mjs       (cross-tenant probes)
-- =============================================================================
