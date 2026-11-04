-- SV1-SCHED RLS checks (LOCAL, DISPOSABLE ONLY); transaction is rolled back.
-- Run only against a loopback disposable database after replaying repository migrations:
--   psql "postgresql://supabase_admin@127.0.0.1:<port>/postgres" \
--     -v ON_ERROR_STOP=1 -f tests/integration/scheduling-rls.local.sql
BEGIN;

DO $guard$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'cg_schedule_bell_schedule',
    'cg_schedule_period',
    'cg_schedule_room',
    'cg_schedule_teaching_load',
    'cg_schedule_participant_qualification',
    'cg_schedule_participant_availability',
    'cg_schedule_constraint',
    'cg_schedule_version',
    'cg_schedule_placement'
  ];
  v_rls record;
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'SV1-SCHED: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NOT NULL
     AND NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'SV1-SCHED: refusing non-loopback server address %', inet_server_addr();
  END IF;
  IF to_regprocedure('public.get_my_tenant_id()') IS NULL THEN
    RAISE EXCEPTION 'SV1-SCHED: neutral tenant helper is not installed';
  END IF;
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION 'SV1-SCHED: public.% is missing', v_table;
    END IF;
    SELECT relrowsecurity, relforcerowsecurity
      INTO v_rls
      FROM pg_class
     WHERE oid = format('public.%I', v_table)::regclass;
    IF NOT v_rls.relrowsecurity OR NOT v_rls.relforcerowsecurity THEN
      RAISE EXCEPTION 'SV1-SCHED: public.% must have ENABLE and FORCE RLS', v_table;
    END IF;
    IF has_table_privilege('anon', format('public.%I', v_table), 'SELECT')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'UPDATE')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'DELETE') THEN
      RAISE EXCEPTION 'SV1-SCHED: public.% has excessive client privileges', v_table;
    END IF;
  END LOOP;
END
$guard$;

CREATE SCHEMA sched_rls;
GRANT USAGE ON SCHEMA sched_rls TO authenticated;
CREATE FUNCTION sched_rls.login(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION sched_rls.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE 'RESET ROLE'; END $$;
CREATE FUNCTION sched_rls.assert_count(p_label text, p_sql text, p_expected bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_count bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO v_count;
  IF v_count IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'SV1-SCHED FAIL [%]: expected % rows, got %', p_label, p_expected, v_count;
  END IF;
END $$;
CREATE FUNCTION sched_rls.denied(p_label text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN RETURN;
  END;
  RAISE EXCEPTION 'SV1-SCHED FAIL [%]: statement was allowed but must be denied', p_label;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA sched_rls TO authenticated;

INSERT INTO auth.users (id) VALUES
  ('a5600000-0000-4000-8000-000000000001'),
  ('b5600000-0000-4000-8000-000000000001');
INSERT INTO public.cg_org_unit (id, tenant_id, kind, created_by) VALUES
  ('sched-org-a', 'a5600000-0000-4000-8000-0000000000a1', 'organization', 'SV1-SCHED RLS fixture'),
  ('sched-org-b', 'b5600000-0000-4000-8000-0000000000b1', 'organization', 'SV1-SCHED RLS fixture');
INSERT INTO public.cg_org_membership
  (id, tenant_id, org_unit_id, principal_ref, role_ref, state, created_by)
VALUES
  ('sched-membership-a', 'a5600000-0000-4000-8000-0000000000a1', 'sched-org-a',
   'a5600000-0000-4000-8000-000000000001', 'role:administrator', 'active', 'SV1-SCHED RLS fixture'),
  ('sched-membership-b', 'b5600000-0000-4000-8000-0000000000b1', 'sched-org-b',
   'b5600000-0000-4000-8000-000000000001', 'role:administrator', 'active', 'SV1-SCHED RLS fixture');
INSERT INTO public.cg_schedule_room
  (id, tenant_id, org_unit_id, room_ref, name, room_type, capacity)
VALUES
  ('a5600000-0000-4000-8000-0000000000a2', 'a5600000-0000-4000-8000-0000000000a1',
   'sched-org-a', 'room-a', 'Synthetic room A', 'classroom', 30),
  ('b5600000-0000-4000-8000-0000000000b2', 'b5600000-0000-4000-8000-0000000000b1',
   'sched-org-b', 'room-b', 'Synthetic room B', 'classroom', 30);

SELECT sched_rls.login('a5600000-0000-4000-8000-000000000001');
SELECT sched_rls.assert_count(
  'tenant A reads its room',
  $$SELECT 1 FROM public.cg_schedule_room WHERE id = 'a5600000-0000-4000-8000-0000000000a2'$$,
  1
);
SELECT sched_rls.assert_count(
  'tenant A cannot read tenant B room',
  $$SELECT 1 FROM public.cg_schedule_room WHERE id = 'b5600000-0000-4000-8000-0000000000b2'$$,
  0
);
SELECT sched_rls.denied(
  'tenant A cannot write tenant B room',
  $$INSERT INTO public.cg_schedule_room
      (tenant_id, org_unit_id, room_ref, name, room_type, capacity)
    VALUES ('b5600000-0000-4000-8000-0000000000b1', 'sched-org-b',
      'room-cross-tenant', 'Cross-tenant room', 'classroom', 30)$$
);
SELECT sched_rls.logout();

SELECT sched_rls.login('b5600000-0000-4000-8000-000000000001');
SELECT sched_rls.assert_count(
  'tenant B cannot read tenant A room',
  $$SELECT 1 FROM public.cg_schedule_room WHERE id = 'a5600000-0000-4000-8000-0000000000a2'$$,
  0
);
SELECT sched_rls.denied(
  'tenant B cannot write tenant A room',
  $$INSERT INTO public.cg_schedule_room
      (tenant_id, org_unit_id, room_ref, name, room_type, capacity)
    VALUES ('a5600000-0000-4000-8000-0000000000a1', 'sched-org-a',
      'room-cross-tenant', 'Cross-tenant room', 'classroom', 30)$$
);
SELECT sched_rls.logout();

DO $$ BEGIN RAISE NOTICE 'SV1-SCHED RLS ALL PASS'; END $$;
ROLLBACK;
