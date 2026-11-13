-- SV1-SCHED RLS checks (LOCAL, DISPOSABLE ONLY); transaction is rolled back.
-- Run only against a loopback disposable database after replaying repository migrations:
--   psql "postgresql://postgres@127.0.0.1:<port>/postgres" \
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
       OR has_table_privilege('anon', format('public.%I', v_table), 'INSERT')
       OR has_table_privilege('anon', format('public.%I', v_table), 'UPDATE')
       OR has_table_privilege('anon', format('public.%I', v_table), 'DELETE')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'UPDATE')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'DELETE') THEN
      RAISE EXCEPTION 'SV1-SCHED: public.% has excessive client privileges', v_table;
    END IF;
  END LOOP;
END
$guard$;

CREATE SCHEMA sched_rls;
GRANT USAGE ON SCHEMA sched_rls TO authenticated, anon;
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
CREATE FUNCTION sched_rls.rejected(p_label text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN check_violation THEN RETURN;
  END;
  RAISE EXCEPTION 'SV1-SCHED FAIL [%]: invalid placement was accepted', p_label;
END $$;
CREATE FUNCTION sched_rls.check_other_tenant_reads(p_tenant text) RETURNS void LANGUAGE plpgsql AS $$
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
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    PERFORM sched_rls.assert_count(
      'cross-tenant read denied for ' || v_table,
      format('SELECT 1 FROM public.%I WHERE tenant_id = %L', v_table, p_tenant),
      0
    );
  END LOOP;
END $$;
CREATE FUNCTION sched_rls.check_cross_tenant_writes(
  p_tenant text,
  p_org text,
  p_bell uuid,
  p_period uuid,
  p_version uuid,
  p_room uuid,
  p_schedule text,
  p_class text
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM sched_rls.denied(
    'cross-tenant write denied for teaching load',
    format(
      'INSERT INTO public.cg_schedule_teaching_load (tenant_id, org_unit_id, schedule_ref, class_arm_ref, subject_ref, periods_per_week, required_capacity) VALUES (%L, %L, %L, %L, %L, 1, 1)',
      p_tenant, p_org, p_schedule, p_class, 'cross-subject'
    )
  );
  PERFORM sched_rls.denied(
    'cross-tenant write denied for participant availability',
    format(
      'INSERT INTO public.cg_schedule_participant_availability (tenant_id, org_unit_id, participant_ref, period_id, availability_state, source_ref) VALUES (%L, %L, %L, %L, %L, %L)',
      p_tenant, p_org, 'cross-participant', p_period, 'allowed', 'cross-tenant-test'
    )
  );
  PERFORM sched_rls.denied(
    'cross-tenant write denied for schedule version',
    format(
      'INSERT INTO public.cg_schedule_version (tenant_id, org_unit_id, schedule_ref, version_number, bell_schedule_id, created_by) VALUES (%L, %L, %L, 99, %L, %L)',
      p_tenant, p_org, p_schedule, p_bell, 'cross-tenant-test'
    )
  );
  PERFORM sched_rls.denied(
    'cross-tenant write denied for schedule placement',
    format(
      'INSERT INTO public.cg_schedule_placement (tenant_id, org_unit_id, schedule_version_id, schedule_ref, bell_schedule_id, period_id, class_arm_ref, subject_ref, participant_ref, room_id) VALUES (%L, %L, %L, %L, %L, %L, %L, %L, %L, %L)',
      p_tenant, p_org, p_version, p_schedule, p_bell, p_period, p_class, 'math', 'cross-participant', p_room
    )
  );
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA sched_rls TO authenticated, anon;

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
INSERT INTO public.cg_schedule_bell_schedule
  (id, tenant_id, org_unit_id, name, effective_from, created_by)
VALUES
  ('a5600000-0000-4000-8000-0000000000a3', 'a5600000-0000-4000-8000-0000000000a1',
   'sched-org-a', 'Synthetic bell A', CURRENT_DATE, 'SV1-SCHED RLS fixture'),
  ('b5600000-0000-4000-8000-0000000000b3', 'b5600000-0000-4000-8000-0000000000b1',
   'sched-org-b', 'Synthetic bell B', CURRENT_DATE, 'SV1-SCHED RLS fixture');
INSERT INTO public.cg_schedule_period
  (id, tenant_id, org_unit_id, bell_schedule_id, day_of_week, period_number, period_kind, label, starts_at, ends_at)
VALUES
  ('a5600000-0000-4000-8000-0000000000a4', 'a5600000-0000-4000-8000-0000000000a1',
   'sched-org-a', 'a5600000-0000-4000-8000-0000000000a3', 1, 1, 'activity', 'Synthetic period A', '08:00', '08:40'),
  ('b5600000-0000-4000-8000-0000000000b4', 'b5600000-0000-4000-8000-0000000000b1',
   'sched-org-b', 'b5600000-0000-4000-8000-0000000000b3', 1, 1, 'activity', 'Synthetic period B', '08:00', '08:40');
INSERT INTO public.cg_schedule_room
  (id, tenant_id, org_unit_id, room_ref, name, room_type, capacity)
VALUES
  ('a5600000-0000-4000-8000-0000000000a2', 'a5600000-0000-4000-8000-0000000000a1',
   'sched-org-a', 'room-a', 'Synthetic room A', 'classroom', 30),
  ('b5600000-0000-4000-8000-0000000000b2', 'b5600000-0000-4000-8000-0000000000b1',
   'sched-org-b', 'room-b', 'Synthetic room B', 'classroom', 30),
  ('a5600000-0000-4000-8000-0000000000a7', 'a5600000-0000-4000-8000-0000000000a1',
   'sched-org-a', 'lab-a', 'Synthetic lab A', 'laboratory', 30);
INSERT INTO public.cg_schedule_teaching_load
  (tenant_id, org_unit_id, schedule_ref, class_arm_ref, subject_ref, periods_per_week, required_capacity, required_room_type)
VALUES
  ('a5600000-0000-4000-8000-0000000000a1', 'sched-org-a', 'schedule-a', 'class-a', 'math', 1, 20, 'classroom'),
  ('a5600000-0000-4000-8000-0000000000a1', 'sched-org-a', 'schedule-a-alt', 'class-a', 'math', 1, 20, 'laboratory'),
  ('b5600000-0000-4000-8000-0000000000b1', 'sched-org-b', 'schedule-b', 'class-b', 'math', 1, 20, 'classroom');
INSERT INTO public.cg_schedule_participant_qualification
  (tenant_id, org_unit_id, participant_ref, subject_ref, qualification_ref, valid_until)
VALUES
  ('a5600000-0000-4000-8000-0000000000a1', 'sched-org-a', 'participant-a', 'math', 'qualification-a', NULL),
  ('a5600000-0000-4000-8000-0000000000a1', 'sched-org-a', 'participant-expired', 'math', 'qualification-expired', CURRENT_DATE - 1),
  ('b5600000-0000-4000-8000-0000000000b1', 'sched-org-b', 'participant-b', 'math', 'qualification-b', NULL);
INSERT INTO public.cg_schedule_participant_availability
  (tenant_id, org_unit_id, participant_ref, period_id, availability_state, source_ref)
VALUES
  ('a5600000-0000-4000-8000-0000000000a1', 'sched-org-a', 'participant-a', 'a5600000-0000-4000-8000-0000000000a4', 'allowed', 'fixture-a'),
  ('b5600000-0000-4000-8000-0000000000b1', 'sched-org-b', 'participant-b', 'b5600000-0000-4000-8000-0000000000b4', 'allowed', 'fixture-b');
INSERT INTO public.cg_schedule_constraint
  (tenant_id, org_unit_id, constraint_ref, constraint_kind, constraint_type, scope_kind, priority)
VALUES
  ('a5600000-0000-4000-8000-0000000000a1', 'sched-org-a', 'constraint-a', 'hard', 'fixture', 'organization', 1),
  ('b5600000-0000-4000-8000-0000000000b1', 'sched-org-b', 'constraint-b', 'hard', 'fixture', 'organization', 1);
INSERT INTO public.cg_schedule_version
  (id, tenant_id, org_unit_id, schedule_ref, version_number, bell_schedule_id, created_by)
VALUES
  ('a5600000-0000-4000-8000-0000000000a5', 'a5600000-0000-4000-8000-0000000000a1', 'sched-org-a',
   'schedule-a', 1, 'a5600000-0000-4000-8000-0000000000a3', 'SV1-SCHED RLS fixture'),
  ('a5600000-0000-4000-8000-0000000000a8', 'a5600000-0000-4000-8000-0000000000a1', 'sched-org-a',
   'schedule-a-alt', 1, 'a5600000-0000-4000-8000-0000000000a3', 'SV1-SCHED RLS fixture'),
  ('b5600000-0000-4000-8000-0000000000b5', 'b5600000-0000-4000-8000-0000000000b1', 'sched-org-b',
   'schedule-b', 1, 'b5600000-0000-4000-8000-0000000000b3', 'SV1-SCHED RLS fixture');
INSERT INTO public.cg_schedule_placement
  (tenant_id, org_unit_id, schedule_version_id, schedule_ref, bell_schedule_id, period_id,
   class_arm_ref, subject_ref, participant_ref, room_id)
VALUES
  ('a5600000-0000-4000-8000-0000000000a1', 'sched-org-a', 'a5600000-0000-4000-8000-0000000000a5',
   'schedule-a', 'a5600000-0000-4000-8000-0000000000a3', 'a5600000-0000-4000-8000-0000000000a4',
   'class-a', 'math', 'participant-a', 'a5600000-0000-4000-8000-0000000000a2'),
  ('a5600000-0000-4000-8000-0000000000a1', 'sched-org-a', 'a5600000-0000-4000-8000-0000000000a8',
   'schedule-a-alt', 'a5600000-0000-4000-8000-0000000000a3', 'a5600000-0000-4000-8000-0000000000a4',
   'class-a', 'math', 'participant-a', 'a5600000-0000-4000-8000-0000000000a7'),
  ('b5600000-0000-4000-8000-0000000000b1', 'sched-org-b', 'b5600000-0000-4000-8000-0000000000b5',
   'schedule-b', 'b5600000-0000-4000-8000-0000000000b3', 'b5600000-0000-4000-8000-0000000000b4',
   'class-b', 'math', 'participant-b', 'b5600000-0000-4000-8000-0000000000b2');

SELECT sched_rls.rejected(
  'expired qualification cannot be placed',
  $$INSERT INTO public.cg_schedule_placement
      (tenant_id, org_unit_id, schedule_version_id, schedule_ref, bell_schedule_id, period_id,
       class_arm_ref, subject_ref, participant_ref, room_id)
    VALUES ('a5600000-0000-4000-8000-0000000000a1', 'sched-org-a',
      'a5600000-0000-4000-8000-0000000000a5', 'schedule-a',
      'a5600000-0000-4000-8000-0000000000a3', 'a5600000-0000-4000-8000-0000000000a4',
      'class-a', 'math', 'participant-expired', 'a5600000-0000-4000-8000-0000000000a2')$$
);

SELECT sched_rls.login('a5600000-0000-4000-8000-000000000001');
SELECT sched_rls.check_other_tenant_reads('b5600000-0000-4000-8000-0000000000b1');
SELECT sched_rls.check_cross_tenant_writes(
  'b5600000-0000-4000-8000-0000000000b1', 'sched-org-b',
  'b5600000-0000-4000-8000-0000000000b3', 'b5600000-0000-4000-8000-0000000000b4',
  'b5600000-0000-4000-8000-0000000000b5', 'b5600000-0000-4000-8000-0000000000b2',
  'cross-schedule-a', 'cross-class-a'
);
SELECT sched_rls.logout();

SELECT sched_rls.login('b5600000-0000-4000-8000-000000000001');
SELECT sched_rls.check_other_tenant_reads('a5600000-0000-4000-8000-0000000000a1');
SELECT sched_rls.check_cross_tenant_writes(
  'a5600000-0000-4000-8000-0000000000a1', 'sched-org-a',
  'a5600000-0000-4000-8000-0000000000a3', 'a5600000-0000-4000-8000-0000000000a4',
  'a5600000-0000-4000-8000-0000000000a5', 'a5600000-0000-4000-8000-0000000000a2',
  'cross-schedule-b', 'cross-class-b'
);
SELECT sched_rls.logout();

SET LOCAL ROLE anon;
DO $anon$
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
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    PERFORM sched_rls.denied(
      'anon cannot read ' || v_table,
      format('SELECT * FROM public.%I', v_table)
    );
  END LOOP;
END
$anon$;
RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'SV1-SCHED RLS ALL PASS'; END $$;
ROLLBACK;
