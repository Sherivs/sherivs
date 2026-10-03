-- =============================================================================
-- CoreGrid — transport fleet driver bus-read policy (TEAM T-D, post-R-wave)
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED. Do not treat this file as a live database.
-- Apply only through the coordinator's checksummed apply channel
--   (scripts/apply-canonical-hardening.mjs registration / governance law).
-- Rollback (genuine exact inverse, authored alongside):
--   database/supabase/rollbacks/20261003000041_coregrid_transport_bus_reads.sql
--
-- Authority:
--   Operator direction (post-R-wave follow-up wave): the remaining
--     credential-free work is authorized, including this posture change under
--     least-privilege conditions;
--   AGENTS.md §13 (multi-tenancy: every request must have tenant context),
--     §16 (layered authorization), §17 (RLS mandatory; application code is
--     never the only security layer), §26 (never trust client-supplied
--     identity), §28 (database law), §31 (testing standard),
--     §34 (the UI is not security — backend enforcement);
--   J-005/J-006 predicate law (20261002000001 + 20261002000013): no legacy
--     domain helper, no domain role name, no client-trusted value ever enters
--     a policy predicate; actor references are re-derived from auth.uid();
--   RULING-2 (deny-by-default is the approved default posture);
--   RLS_ISOLATION_BATTERY.md §2 (force-RLS is re-evaluated exactly when
--     policies are authored), §4.4, §7 (dual-posture model);
--   H3-040 adjudication + 20261002000014 (the zero-policy substrate era this
--     migration supersedes for the driver read surface only);
--   R1 e2e finding (progress/v1-wave/R1-report.md): the driver assigned-bus
--     surface is unreachable for every client session under zero-policy.
--
-- Scope — exactly ONE statement class on exactly ONE table:
--   public.transport_buses  →  a single SELECT policy for authenticated
--     (the driver self-assignment read) + the SELECT-only privilege that
--     makes the policy the operative row gate + FORCE RLS (exemplar §1).
--   No INSERT/UPDATE/DELETE policy or privilege is granted. No anon or PUBLIC
--   privilege is granted. service_role is untouched (the sanctioned
--   server-only path already holds full table privilege from 20261002000014).
--
-- WHY identity-scoped, and why the J-005 tenant-equality shape is NOT
-- expressible here (discovery evidence, verified read-only against the
-- canonical project 2026-10-03 — never guesswork):
--   1. The read this mission re-provisions is exactly one query:
--      getMyDriverBus (frontend/src/lib/runtime/*-portal.functions.ts)
--      selects the fleet row WHERE driver_id = auth.uid() AND is_active,
--      through requireSupabaseAuth — a client built with the publishable key
--      plus the USER's bearer JWT, i.e. the authenticated role. RLS applies;
--      this is NOT a service-role-mediated surface, so the honesty valve
--      "no client policy at all" does not fire: without a policy the read
--      denies and the surface stays dead (the R1 finding).
--   2. The legacy substrate carries no neutral tenant reference: its only
--      row-scoping key is the legacy campus uuid column (the 20260626150625
--      definition; H3-040 recorded this as the basis of the zero-policy
--      adjudication). No bridge exists between that key and neutral tenant
--      refs: the live neutral membership substrate holds ZERO rows for every
--      real tenant (cg_org_membership = 0, cg_role_assignment = 0 live), and
--      no app or onboarding path writes them. A tenant-equality predicate
--      shaped tenant_ref = public.get_my_tenant_id() would resolve NULL for
--      every real session and deny EVERY row — it would restore nothing.
--   3. The only historically available scoping predicates are the legacy
--      domain helpers (20260904010000) — exactly the predicate class the
--      J-005/J-006 law bans from the policy layer, and the class the
--      shrink-only domain-neutrality guard can never re-admit.
--   4. Therefore the least-privilege predicate that IS expressible and
--      matches the actual flow is the assignment-identity binding:
--        USING (driver_id = auth.uid())
--      The actor is re-derived inside the predicate from auth.uid() — the
--      same sanctioned self-derivation the 20261002000013 grantor pin uses
--      (granted_by = auth.uid()::text). No client-supplied value can enter:
--      the REST read's driver_id filter is narrowed further by the app, but
--      the POLICY predicate only ever compares the row's own assignment
--      column against the server-derived identity (Constitution §26).
--      No domain role name, no legacy helper, no hard-coded tenant appears.
--
-- Isolation argument (what this policy can and cannot leak):
--   A row becomes visible to an actor only when the row itself names that
--   actor as its assigned operator. Assignments are administered by campus
--   administrators through their own surfaces; a foreign-campus row cannot
--   name this actor unless an administrator of THAT campus assigned them —
--   a data-integrity concern of the admin surface, out of scope for this
--   read gate. Every non-assigned row (including all rows of every other
--   campus) stays invisible; unauthenticated actors hold zero privileges;
--   zero client-visible realtime events follow for non-assigned rows.
--   Battery §4.4 honesty note: the data-declared cross-tenant probe recipe
--   CANNOT be declared for this table (its campus key is a uuid FK into a
--   legacy domain table, and probe aux tables are restricted to the cg_
--   namespace), so the battery's cross-tenant stage will report undeclared
--   for this entry — recorded as such in the posture file. The post-apply
--   proof paths are: the battery catalog/privilege/anon-deny sections, the
--   driver e2e case (typed-skip lifts to a real pass once applied), and the
--   predicate above. A runnable §4.4-class probe requires the neutral
--   substrate conversion already recorded in the posture file's
--   conversionPath (owned by a future mission).
--
-- No schema invented: the assignment linkage is the existing driver_id
--   column (uuid, FK to the users table, ON DELETE SET NULL). No linkage
--   table is created; no column is added; no backfill is performed.
--
-- Provenance (AGENTS §12): this migration touches authorization state only.
--   It invents no data, mutates no row, filters no provenance column, and
--   touches no audit record. Erasure and retention behavior are untouched.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. FORCE ROW LEVEL SECURITY — the battery's §2 convention: force is
--    re-evaluated exactly when policies are authored (the 20261002000013
--    exemplar force-binds its tables in the same migration). The table owner
--    (platform role postgres) holds the sanctioned BYPASSRLS attribute, so
--    definer paths are unaffected; force closes the owner-bypass hole for any
--    FUTURE owner role lacking the sanctioned bypass.
-- -----------------------------------------------------------------------------
ALTER TABLE public.transport_buses FORCE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 2. SELECT-only privilege: authenticated gains exactly one privilege so the
--    policy below is the operative row gate (previously deny-by-privilege
--    since 20261002000014). anon / PUBLIC stay at zero privileges; no write
--    privilege of any kind is granted to any client role.
-- -----------------------------------------------------------------------------
GRANT SELECT ON TABLE public.transport_buses TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. The policy — the driver self-assignment read (SELECT-only).
-- -----------------------------------------------------------------------------
CREATE POLICY transport_buses_select_driver_assigned
  ON public.transport_buses
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 4. Verification guard: the apply FAILS LOUDLY unless the landed posture is
--    exactly the declared one — one SELECT policy with the declared name,
--    RLS enabled AND forced, authenticated holding SELECT and nothing else,
--    and zero anon/PUBLIC privileges.
-- -----------------------------------------------------------------------------
DO $verify$
DECLARE
  v_policy_count  integer;
  v_named_selects integer;
  v_auth_privs    text;
  v_anon_privs    integer;
  v_force_ok      boolean;
BEGIN
  SELECT count(*) INTO v_policy_count
    FROM pg_catalog.pg_policies
   WHERE schemaname = 'public' AND tablename = 'transport_buses';

  SELECT count(*) INTO v_named_selects
    FROM pg_catalog.pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'transport_buses'
     AND policyname = 'transport_buses_select_driver_assigned'
     AND cmd = 'SELECT'
     AND permissive = 'PERMISSIVE';

  SELECT coalesce(string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type), '')
    INTO v_auth_privs
    FROM information_schema.table_privileges
   WHERE table_schema = 'public'
     AND table_name = 'transport_buses'
     AND grantee = 'authenticated';

  SELECT count(*) INTO v_anon_privs
    FROM information_schema.table_privileges
   WHERE table_schema = 'public'
     AND table_name = 'transport_buses'
     AND grantee IN ('anon', 'public');

  SELECT c.relrowsecurity AND c.relforcerowsecurity INTO v_force_ok
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'transport_buses';

  IF v_policy_count <> 1 OR v_named_selects <> 1
     OR v_auth_privs IS DISTINCT FROM 'SELECT'
     OR v_anon_privs <> 0
     OR v_force_ok IS NOT TRUE THEN
    RAISE EXCEPTION
      'POSTURE VIOLATION: public.transport_buses must land 20261003000041 with exactly one policy (transport_buses_select_driver_assigned, SELECT), authenticated=SELECT-only, zero anon/PUBLIC privileges, and FORCE RLS enabled; observed policies=% named=% authenticated=[%] anon/public=% force_ok=% — investigate before proceeding',
      v_policy_count, v_named_selects, v_auth_privs, v_anon_privs, v_force_ok;
  END IF;
END
$verify$;

-- -----------------------------------------------------------------------------
-- 5. Declared posture (machine-readable audit strings, dollar-quoted; the
--    exemplar shape of 20261002000013 §4 — this COMMENT supersedes the
--    zero-policy comment 20261002000014 §6 wrote; the rollback restores that
--    comment verbatim).
-- -----------------------------------------------------------------------------
COMMENT ON TABLE public.transport_buses IS
  $comment$Posture declared by 20261003000041 (TEAM T-D, post-R-wave):
  policy-backed SELECT-only for the driver self-assignment read — row level
  security ENABLED and FORCED, exactly one policy
  (transport_buses_select_driver_assigned: FOR SELECT TO authenticated
  USING (driver_id = auth.uid())), authenticated holding SELECT and nothing
  else, anon/PUBLIC at zero privileges, service_role unchanged as the
  sanctioned server-only path. The predicate is the J-005/J-006-compliant
  least-privilege form the legacy substrate can express: the actor is
  re-derived from auth.uid() inside the predicate (no legacy domain helper,
  no domain role name, no client-trusted value); the J-005 tenant-equality
  shape is NOT expressible on this table because it carries no neutral
  tenant reference and the live neutral substrate holds no bindings for
  real sessions (verified read-only 2026-10-03) — recorded honestly in
  scripts/verification/rls-table-postures-transport.json, which also records
  why the battery §4.4 cross-tenant recipe cannot be declared for this
  legacy FK-bound table. Writes for every client role and every other read
  family (caregiver tracking, admin fleet surfaces) remain denied pending
  their own least-privilege authoring. Rollback (restores the 20261002000014
  zero-policy posture exactly):
  database/supabase/rollbacks/20261003000041_coregrid_transport_bus_reads.sql.$comment$;

COMMENT ON POLICY transport_buses_select_driver_assigned ON public.transport_buses IS
  $comment$TEAM T-D driver bus-read gate: a row is visible only when the row
  itself names the acting identity as its assigned operator (driver_id =
  auth.uid()). The actor is re-derived inside the predicate from auth.uid()
  (Constitution §26) — the app-level .eq(driver_id, ...) filter can narrow
  the query further but can never widen the visible set, and no
  client-supplied identity, role, or scope value can satisfy the predicate.
  An unauthenticated actor holds no table privilege at all; a non-assigned
  actor sees zero rows. Cannot widen access: the assignment column is
  maintained by campus-admin surfaces, never by the reader.$comment$;

-- =============================================================================
-- End of migration. Post-apply verification (owned by the coordinator):
--   node scripts/verify-rls-isolation-battery.mjs
--     adopting scripts/verification/rls-table-postures-transport.json as the
--     declarative expected state for public.transport_buses (policy-backed,
--     SELECT-only, force expected; the §4.4 cross-tenant stage is declared
--     undeclared by the posture file with its recorded reason).
--   npx playwright test tests/e2e/preview-public-site-card.spec.ts
--     (the driver case lifts from its typed skip to a real pass).
-- =============================================================================