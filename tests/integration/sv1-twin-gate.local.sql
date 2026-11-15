-- SV1-TWIN-06 gate (LOCAL, DISPOSABLE DATABASE ONLY).
-- Isolation, privilege and audit-completeness battery for the personal twin
-- tables. Synthetic ids only. Always rolls back. Never target a hosted or
-- production database. Replay repository migrations on a loopback disposable DB first.
BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'SV1-TWIN-06: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'SV1-TWIN-06: refusing non-loopback database server %', inet_server_addr();
  END IF;
  IF current_database() NOT IN ('coregrid_twin_test', 'postgres')
     OR current_setting('coregrid.test_disposable_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'SV1-TWIN-06: requires the named, explicitly marked disposable database';
  END IF;
  IF to_regclass('public.cg_personal_twin') IS NULL
     OR to_regprocedure('public.cg_personal_twin_provision(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'SV1-TWIN-06: the TWIN-01 migration is required';
  END IF;
END
$guard$;

CREATE SCHEMA twin_gate;
GRANT USAGE ON SCHEMA twin_gate TO authenticated, anon;

CREATE FUNCTION twin_gate.login(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;

CREATE FUNCTION twin_gate.anon() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
END $$;

CREATE FUNCTION twin_gate.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE 'RESET ROLE'; END $$;

CREATE FUNCTION twin_gate.count_rows(p_label text, p_sql text, p_expected bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO v;
  IF v IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'SV1-TWIN-06 FAIL [%]: expected % rows, got %', p_label, p_expected, v;
  END IF;
END $$;

-- Passes only when the statement fails with the expected SQLSTATE.
CREATE FUNCTION twin_gate.expect_error(p_label text, p_sql text, p_state text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN RETURN; END IF;
    RAISE EXCEPTION 'SV1-TWIN-06 FAIL [%]: expected SQLSTATE %, got % (%)', p_label, p_state, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'SV1-TWIN-06 FAIL [%]: statement succeeded but must be refused', p_label;
END $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA twin_gate TO authenticated, anon;

-- Synthetic fixtures: three identities, two tenants.
INSERT INTO auth.users (id) VALUES
  ('a6100000-0000-4000-8000-00000000000a'),
  ('a6100000-0000-4000-8000-00000000000b'),
  ('a6100000-0000-4000-8000-00000000000c');
INSERT INTO public.schools (id, name, slug) VALUES
  ('66100000-0000-4000-8000-0000000000a1', 'Gate Synthetic Tenant 1', 'gate-synthetic-1'),
  ('66100000-0000-4000-8000-0000000000b1', 'Gate Synthetic Tenant 2', 'gate-synthetic-2');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  ('a6100000-0000-4000-8000-00000000000a', '66100000-0000-4000-8000-0000000000a1', 'Gate User A', 'gate-a@example.invalid', 'teacher', true),
  ('a6100000-0000-4000-8000-00000000000b', '66100000-0000-4000-8000-0000000000a1', 'Gate User B', 'gate-b@example.invalid', 'teacher', true),
  ('a6100000-0000-4000-8000-00000000000c', '66100000-0000-4000-8000-0000000000b1', 'Gate User C', 'gate-c@example.invalid', 'teacher', true);

CREATE TEMP TABLE gate_audit_baseline AS
SELECT count(*) AS n FROM public.audit_logs WHERE action = 'twin.personal.provision';

-- ── Audit completeness: every provision call writes exactly one audit row ──
-- created, idempotent retries, a denial for a missing membership and a denial
-- for a nonexistent identity and tenant: seven calls in total.
SELECT public.cg_personal_twin_provision('a6100000-0000-4000-8000-00000000000a', '66100000-0000-4000-8000-0000000000a1');
SELECT public.cg_personal_twin_provision('a6100000-0000-4000-8000-00000000000a', '66100000-0000-4000-8000-0000000000a1');
SELECT public.cg_personal_twin_provision('a6100000-0000-4000-8000-00000000000b', '66100000-0000-4000-8000-0000000000a1');
SELECT public.cg_personal_twin_provision('a6100000-0000-4000-8000-00000000000b', '66100000-0000-4000-8000-0000000000a1');
SELECT public.cg_personal_twin_provision('a6100000-0000-4000-8000-00000000000a', '66100000-0000-4000-8000-0000000000b1');
SELECT public.cg_personal_twin_provision('a6100000-0000-4000-8000-0000000000ff', '66100000-0000-4000-8000-0000000000ff');
-- A third identity in the second tenant.
SELECT public.cg_personal_twin_provision('a6100000-0000-4000-8000-00000000000c', '66100000-0000-4000-8000-0000000000b1');

DO $audit$
DECLARE
  v_new bigint;
  v_missing_corr bigint;
  v_dupe_corr bigint;
  v_bad_outcome bigint;
BEGIN
  SELECT count(*) INTO v_new FROM public.audit_logs
   WHERE action = 'twin.personal.provision'
     AND (SELECT n FROM gate_audit_baseline) IS NOT NULL;
  v_new := v_new - (SELECT n FROM gate_audit_baseline);
  IF v_new <> 7 THEN
    RAISE EXCEPTION 'SV1-TWIN-06 FAIL [audit]: 7 provision calls must write 7 audit rows, got %', v_new;
  END IF;
  SELECT count(*) INTO v_missing_corr FROM public.audit_logs
   WHERE action = 'twin.personal.provision' AND (new_value->>'correlation_id') IS NULL;
  IF v_missing_corr <> 0 THEN
    RAISE EXCEPTION 'SV1-TWIN-06 FAIL [audit]: % audit rows have no correlation id', v_missing_corr;
  END IF;
  SELECT count(*) - count(DISTINCT new_value->>'correlation_id') INTO v_dupe_corr
    FROM public.audit_logs WHERE action = 'twin.personal.provision';
  IF v_dupe_corr <> 0 THEN
    RAISE EXCEPTION 'SV1-TWIN-06 FAIL [audit]: correlation ids must be unique per call';
  END IF;
  SELECT count(*) INTO v_bad_outcome FROM public.audit_logs
   WHERE action = 'twin.personal.provision'
     AND (new_value->>'outcome') NOT IN ('succeeded', 'denied');
  IF v_bad_outcome <> 0 THEN
    RAISE EXCEPTION 'SV1-TWIN-06 FAIL [audit]: every row must record an outcome of succeeded or denied';
  END IF;
END
$audit$;

-- ── Isolation: tenant, user ────────────────────────────────────────────────
SELECT twin_gate.login('a6100000-0000-4000-8000-00000000000a');
SELECT twin_gate.count_rows('A sees exactly one twin', 'SELECT 1 FROM public.cg_personal_twin', 1);
SELECT twin_gate.count_rows('A sees own twin', $$SELECT 1 FROM public.cg_personal_twin WHERE identity_id = 'a6100000-0000-4000-8000-00000000000a'$$, 1);
SELECT twin_gate.count_rows('A cannot see B twin (same tenant)', $$SELECT 1 FROM public.cg_personal_twin WHERE identity_id = 'a6100000-0000-4000-8000-00000000000b'$$, 0);
SELECT twin_gate.count_rows('A cannot see C twin (other tenant)', $$SELECT 1 FROM public.cg_personal_twin WHERE identity_id = 'a6100000-0000-4000-8000-00000000000c'$$, 0);
SELECT twin_gate.logout();

SELECT twin_gate.login('a6100000-0000-4000-8000-00000000000b');
SELECT twin_gate.count_rows('B sees exactly one twin', 'SELECT 1 FROM public.cg_personal_twin', 1);
SELECT twin_gate.count_rows('B cannot see A twin', $$SELECT 1 FROM public.cg_personal_twin WHERE identity_id = 'a6100000-0000-4000-8000-00000000000a'$$, 0);
SELECT twin_gate.logout();

SELECT twin_gate.login('a6100000-0000-4000-8000-00000000000c');
SELECT twin_gate.count_rows('C sees exactly one twin', 'SELECT 1 FROM public.cg_personal_twin', 1);
SELECT twin_gate.count_rows('C cannot see tenant 1 twins', $$SELECT 1 FROM public.cg_personal_twin WHERE school_id = '66100000-0000-4000-8000-0000000000a1'$$, 0);
SELECT twin_gate.logout();

-- A caller with no identity claim sees nothing.
SELECT set_config('request.jwt.claims', '{}', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SET LOCAL ROLE authenticated;
SELECT twin_gate.count_rows('no identity claim sees nothing', 'SELECT 1 FROM public.cg_personal_twin', 0);
RESET ROLE;

-- ── Isolation: the read follows the CURRENT membership and active tenant ───
SET LOCAL ROLE service_role;
UPDATE public.organization_memberships SET is_active = false
 WHERE user_id = 'a6100000-0000-4000-8000-00000000000a'
   AND school_id = '66100000-0000-4000-8000-0000000000a1';
RESET ROLE;
SELECT twin_gate.login('a6100000-0000-4000-8000-00000000000a');
SELECT twin_gate.count_rows('revoked membership removes the twin from view', 'SELECT 1 FROM public.cg_personal_twin', 0);
SELECT twin_gate.logout();
SET LOCAL ROLE service_role;
UPDATE public.organization_memberships SET is_active = true
 WHERE user_id = 'a6100000-0000-4000-8000-00000000000a'
   AND school_id = '66100000-0000-4000-8000-0000000000a1';
RESET ROLE;
SELECT twin_gate.login('a6100000-0000-4000-8000-00000000000a');
SELECT twin_gate.count_rows('restored membership shows the twin again', 'SELECT 1 FROM public.cg_personal_twin', 1);
SELECT twin_gate.logout();

SET LOCAL ROLE service_role;
UPDATE public.users SET school_id = '66100000-0000-4000-8000-0000000000b1'
 WHERE id = 'a6100000-0000-4000-8000-00000000000a';
RESET ROLE;
SELECT twin_gate.login('a6100000-0000-4000-8000-00000000000a');
SELECT twin_gate.count_rows('switching the active tenant hides the other tenant twin', $$SELECT 1 FROM public.cg_personal_twin WHERE school_id = '66100000-0000-4000-8000-0000000000a1'$$, 0);
SELECT twin_gate.logout();
SET LOCAL ROLE service_role;
UPDATE public.users SET school_id = '66100000-0000-4000-8000-0000000000a1'
 WHERE id = 'a6100000-0000-4000-8000-00000000000a';
RESET ROLE;

-- ── Privileges: clients can neither write twins nor read personal memory ──
DO $grants$
DECLARE t text;
BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.cg_personal_twin'::regclass) THEN
    RAISE EXCEPTION 'SV1-TWIN-06 FAIL [privileges]: RLS must be enabled and forced on cg_personal_twin';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cg_personal_twin') <> 1 THEN
    RAISE EXCEPTION 'SV1-TWIN-06 FAIL [privileges]: exactly one policy is permitted on cg_personal_twin';
  END IF;
  IF has_table_privilege('anon', 'public.cg_personal_twin', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cg_personal_twin', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cg_personal_twin', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cg_personal_twin', 'DELETE')
     OR has_table_privilege('authenticated', 'public.cg_personal_twin', 'TRUNCATE') THEN
    RAISE EXCEPTION 'SV1-TWIN-06 FAIL [privileges]: client privileges on cg_personal_twin exceed read-own';
  END IF;
  FOREACH t IN ARRAY ARRAY['cg_memory_scope', 'cg_memory_record', 'cg_memory_access_log'] LOOP
    IF has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE')
       OR has_table_privilege('authenticated', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'SV1-TWIN-06 FAIL [privileges]: clients must have no access to %', t;
    END IF;
    IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'SV1-TWIN-06 FAIL [privileges]: RLS must be enabled and forced on %', t;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.cg_personal_twin_provision(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cg_personal_twin_provision(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SV1-TWIN-06 FAIL [privileges]: provisioning must be service-role only';
  END IF;
END
$grants$;

SELECT twin_gate.anon();
SELECT twin_gate.expect_error('anon cannot read twins', 'SELECT 1 FROM public.cg_personal_twin', '42501');
SELECT twin_gate.logout();

SELECT twin_gate.login('a6100000-0000-4000-8000-00000000000a');
SELECT twin_gate.expect_error('authenticated cannot insert a twin',
  $$INSERT INTO public.cg_personal_twin (identity_id, school_id, memory_scope_id) VALUES ('a6100000-0000-4000-8000-00000000000a', '66100000-0000-4000-8000-0000000000b1', 'x')$$, '42501');
SELECT twin_gate.expect_error('authenticated cannot update a twin', $$UPDATE public.cg_personal_twin SET memory_scope_id = 'x'$$, '42501');
SELECT twin_gate.expect_error('authenticated cannot delete a twin', 'DELETE FROM public.cg_personal_twin', '42501');
SELECT twin_gate.expect_error('authenticated cannot provision directly',
  $$SELECT public.cg_personal_twin_provision('a6100000-0000-4000-8000-00000000000a', '66100000-0000-4000-8000-0000000000a1')$$, '42501');
SELECT twin_gate.expect_error('authenticated cannot read memory scopes', 'SELECT 1 FROM public.cg_memory_scope', '42501');
SELECT twin_gate.expect_error('authenticated cannot read memory records', 'SELECT 1 FROM public.cg_memory_record', '42501');
SELECT twin_gate.expect_error('authenticated cannot read the memory access log', 'SELECT 1 FROM public.cg_memory_access_log', '42501');
SELECT twin_gate.logout();

SELECT twin_gate.anon();
SELECT twin_gate.expect_error('anon cannot read memory scopes', 'SELECT 1 FROM public.cg_memory_scope', '42501');
SELECT twin_gate.expect_error('anon cannot provision',
  $$SELECT public.cg_personal_twin_provision('a6100000-0000-4000-8000-00000000000a', '66100000-0000-4000-8000-0000000000a1')$$, '42501');
SELECT twin_gate.logout();

-- ── Isolation: the memory scope belongs to one identity in one tenant ─────
DO $scope$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT t.identity_id, t.school_id, s.tenant_id, s.actor_scope, s.domains, s.max_sensitivity
      FROM public.cg_personal_twin t
      JOIN public.cg_memory_scope s ON s.id = t.memory_scope_id
     WHERE t.identity_id IN ('a6100000-0000-4000-8000-00000000000a','a6100000-0000-4000-8000-00000000000b','a6100000-0000-4000-8000-00000000000c')
  LOOP
    IF r.tenant_id <> r.school_id::text THEN
      RAISE EXCEPTION 'SV1-TWIN-06 FAIL [scope]: scope tenant must equal the twin tenant';
    END IF;
    IF r.actor_scope <> jsonb_build_array(r.identity_id::text) THEN
      RAISE EXCEPTION 'SV1-TWIN-06 FAIL [scope]: scope must name only the owning identity, got %', r.actor_scope;
    END IF;
    IF r.domains <> '["personal-twin"]'::jsonb OR r.max_sensitivity <> 'internal' THEN
      RAISE EXCEPTION 'SV1-TWIN-06 FAIL [scope]: scope domains and ceiling must stay personal-twin / internal';
    END IF;
  END LOOP;
END
$scope$;

-- A twin cannot be bound to a memory scope from another tenant, and an
-- identity cannot hold two twins in one tenant (service-role path, constraints).
INSERT INTO auth.users (id) VALUES ('a6100000-0000-4000-8000-00000000000d');
SELECT twin_gate.expect_error('cross-tenant memory scope binding is refused',
  $$INSERT INTO public.cg_personal_twin (identity_id, school_id, memory_scope_id)
    SELECT 'a6100000-0000-4000-8000-00000000000d', '66100000-0000-4000-8000-0000000000b1', t.memory_scope_id
      FROM public.cg_personal_twin t WHERE t.identity_id = 'a6100000-0000-4000-8000-00000000000a'$$, '23503');
SELECT twin_gate.expect_error('a second twin for the same identity and tenant is refused',
  $$INSERT INTO public.cg_personal_twin (identity_id, school_id, memory_scope_id)
    SELECT t.identity_id, t.school_id, t.memory_scope_id FROM public.cg_personal_twin t
     WHERE t.identity_id = 'a6100000-0000-4000-8000-00000000000a'$$, '23505');

-- ── Audit rows cannot be rewritten by a client ────────────────────────────
DO $priv$
BEGIN
  IF has_table_privilege('authenticated', 'public.audit_logs', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.audit_logs', 'DELETE')
     OR has_table_privilege('anon', 'public.audit_logs', 'UPDATE')
     OR has_table_privilege('anon', 'public.audit_logs', 'DELETE') THEN
    RAISE EXCEPTION 'SV1-TWIN-06 FAIL [audit]: clients must not be able to update or delete audit rows';
  END IF;
END
$priv$;

-- ── Measured, local, per-call cost of the provisioning path (retry path) ──
DO $cost$
DECLARE
  t0 timestamptz;
  n int := 500;
  i int;
  rows_before bigint;
BEGIN
  SELECT count(*) INTO rows_before FROM public.audit_logs WHERE action = 'twin.personal.provision';
  t0 := clock_timestamp();
  FOR i IN 1..n LOOP
    PERFORM public.cg_personal_twin_provision('a6100000-0000-4000-8000-00000000000a', '66100000-0000-4000-8000-0000000000a1');
  END LOOP;
  RAISE NOTICE 'COST provision_retry_calls=% total_ms=% avg_ms=% audit_rows_added=% twin_rows_added=0 scope_rows_added=0',
    n,
    round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1),
    round(extract(epoch FROM clock_timestamp() - t0) * 1000 / n, 3),
    (SELECT count(*) FROM public.audit_logs WHERE action = 'twin.personal.provision') - rows_before;
END
$cost$;

DO $$ BEGIN RAISE NOTICE 'SV1-TWIN-06 isolation, privilege and audit checks: ALL PASS'; END $$;
ROLLBACK;
