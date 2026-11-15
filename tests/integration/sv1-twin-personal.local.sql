-- SV1-TWIN-01 (LOCAL, DISPOSABLE DATABASE ONLY).
-- Replay repository migrations on a loopback disposable Supabase DB first.
-- Never target a hosted or production database. This test always rolls back.
BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'SV1-TWIN-01: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'SV1-TWIN-01: refusing non-loopback database server %', inet_server_addr();
  END IF;
  IF current_database() NOT IN ('coregrid_twin_test', 'postgres')
     OR current_setting('coregrid.test_disposable_database', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'SV1-TWIN-01: requires the named, explicitly marked disposable database';
  END IF;
  IF to_regclass('public.cg_personal_twin') IS NULL
     OR to_regclass('public.cg_memory_scope') IS NULL
     OR to_regprocedure('public.cg_personal_twin_provision(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'SV1-TWIN-01: twin and existing memory scope migrations are required';
  END IF;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
          FROM pg_class WHERE oid = 'public.cg_personal_twin'::regclass) THEN
    RAISE EXCEPTION 'SV1-TWIN-01: personal twin table must have RLS enabled and forced';
  END IF;
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'cg_personal_twin') <> 1 THEN
    RAISE EXCEPTION 'SV1-TWIN-01: only the self/active-tenant read policy is permitted';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.audit_logs'::regclass
      AND attname IN ('school_id', 'user_id')
      AND attnotnull
  ) OR (
    SELECT count(*)
    FROM pg_attribute
    WHERE attrelid = 'public.audit_logs'::regclass
      AND attname IN ('school_id', 'user_id')
      AND NOT attnotnull
  ) <> 2 THEN
    RAISE EXCEPTION 'SV1-TWIN-01: denial audit requires nullable school_id and user_id';
  END IF;
  IF has_table_privilege('anon', 'public.cg_personal_twin', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.cg_personal_twin', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cg_personal_twin', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cg_personal_twin', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cg_personal_twin', 'DELETE') THEN
    RAISE EXCEPTION 'SV1-TWIN-01: client privileges do not match the read-only self-service posture';
  END IF;
  IF has_function_privilege('anon', 'public.cg_personal_twin_provision(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cg_personal_twin_provision(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.cg_personal_twin_provision(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SV1-TWIN-01: provisioning RPC must be service-role-only';
  END IF;
END
$guard$;

CREATE SCHEMA sv1_twin_test;
GRANT USAGE ON SCHEMA sv1_twin_test TO authenticated;

CREATE FUNCTION sv1_twin_test.login(p_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text,
    true
  );
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END
$$;

CREATE FUNCTION sv1_twin_test.logout() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
END
$$;

CREATE FUNCTION sv1_twin_test.assert_count(p_label text, p_sql text, p_expected bigint)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_count bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO v_count;
  IF v_count IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'SV1-TWIN-01 FAIL [%]: expected % rows, got %',
      p_label, p_expected, v_count;
  END IF;
END
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA sv1_twin_test TO authenticated;

INSERT INTO auth.users (id) VALUES
  ('a5100000-0000-4000-8000-000000000001'),
  ('a5100000-0000-4000-8000-000000000002');

INSERT INTO public.schools (id, name, slug) VALUES
  ('55100000-0000-4000-8000-0000000000a1', 'TWIN Synthetic Tenant A', 'twin-synthetic-a'),
  ('55100000-0000-4000-8000-0000000000b1', 'TWIN Synthetic Tenant B', 'twin-synthetic-b'),
  ('55100000-0000-4000-8000-0000000000c1', 'TWIN Synthetic Tenant C', 'twin-synthetic-c');

INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  ('a5100000-0000-4000-8000-000000000001',
   '55100000-0000-4000-8000-0000000000a1',
   'TWIN Synthetic User A', 'twin-a@example.invalid', 'teacher', true),
  ('a5100000-0000-4000-8000-000000000002',
   '55100000-0000-4000-8000-0000000000b1',
   'TWIN Synthetic User B', 'twin-b@example.invalid', 'teacher', true);

SET LOCAL ROLE service_role;
INSERT INTO public.organization_memberships (user_id, school_id, role, is_primary, is_active) VALUES
  ('a5100000-0000-4000-8000-000000000001',
   '55100000-0000-4000-8000-0000000000b1', 'teacher', false, true),
  ('a5100000-0000-4000-8000-000000000002',
   '55100000-0000-4000-8000-0000000000a1', 'teacher', false, true);
RESET ROLE;

CREATE TEMP TABLE sv1_twin_provision_results (
  identity_id uuid NOT NULL,
  school_id uuid NOT NULL,
  result jsonb NOT NULL
);

INSERT INTO sv1_twin_provision_results
SELECT 'a5100000-0000-4000-8000-000000000001'::uuid,
       '55100000-0000-4000-8000-0000000000a1'::uuid,
       public.cg_personal_twin_provision(
         'a5100000-0000-4000-8000-000000000001',
         '55100000-0000-4000-8000-0000000000a1'
       )
UNION ALL
SELECT 'a5100000-0000-4000-8000-000000000001'::uuid,
       '55100000-0000-4000-8000-0000000000b1'::uuid,
       public.cg_personal_twin_provision(
         'a5100000-0000-4000-8000-000000000001',
         '55100000-0000-4000-8000-0000000000b1'
       )
UNION ALL
SELECT 'a5100000-0000-4000-8000-000000000002'::uuid,
       '55100000-0000-4000-8000-0000000000a1'::uuid,
       public.cg_personal_twin_provision(
         'a5100000-0000-4000-8000-000000000002',
         '55100000-0000-4000-8000-0000000000a1'
       )
UNION ALL
SELECT 'a5100000-0000-4000-8000-000000000002'::uuid,
       '55100000-0000-4000-8000-0000000000b1'::uuid,
       public.cg_personal_twin_provision(
         'a5100000-0000-4000-8000-000000000002',
         '55100000-0000-4000-8000-0000000000b1'
       );

DO $assertions$
DECLARE
  v_first jsonb;
  v_retry jsonb;
  v_scope public.cg_memory_scope%ROWTYPE;
BEGIN
  SELECT result INTO v_first
  FROM sv1_twin_provision_results
  WHERE identity_id = 'a5100000-0000-4000-8000-000000000001'
    AND school_id = '55100000-0000-4000-8000-0000000000a1';

  v_retry := public.cg_personal_twin_provision(
    'a5100000-0000-4000-8000-000000000001',
    '55100000-0000-4000-8000-0000000000a1'
  );
  IF v_retry->>'twin_id' IS DISTINCT FROM v_first->>'twin_id'
     OR v_retry->>'memory_scope_id' IS DISTINCT FROM v_first->>'memory_scope_id'
     OR v_retry->>'created' IS DISTINCT FROM 'false'
     OR v_first->>'created' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'SV1-TWIN-01 FAIL: retry must return the original twin and scope';
  END IF;

  SELECT * INTO v_scope
  FROM public.cg_memory_scope
  WHERE id = v_first->>'memory_scope_id';
  IF NOT FOUND
     OR v_scope.tenant_id <> '55100000-0000-4000-8000-0000000000a1'
     OR v_scope.actor_scope <> '["a5100000-0000-4000-8000-000000000001"]'::jsonb THEN
    RAISE EXCEPTION 'SV1-TWIN-01 FAIL: twin scope must remain identity- and tenant-bound';
  END IF;

  IF public.cg_personal_twin_provision(
    'a5100000-0000-4000-8000-000000000001',
    '55100000-0000-4000-8000-0000000000c1'
  )->>'outcome' IS DISTINCT FROM 'denied' THEN
    RAISE EXCEPTION 'SV1-TWIN-01 FAIL: provisioning without a tenant membership must deny';
  END IF;

  IF public.cg_personal_twin_provision(
    'a5100000-0000-4000-8000-0000000000ff',
    '55100000-0000-4000-8000-0000000000ff'
  )->>'outcome' IS DISTINCT FROM 'denied' THEN
    RAISE EXCEPTION 'SV1-TWIN-01 FAIL: nonexistent identity and tenant must deny';
  END IF;
END
$assertions$;

DO $unique$
BEGIN
  BEGIN
    INSERT INTO public.cg_personal_twin (identity_id, school_id, memory_scope_id)
    SELECT identity_id, school_id, memory_scope_id
    FROM public.cg_personal_twin
    WHERE identity_id = 'a5100000-0000-4000-8000-000000000001'
      AND school_id = '55100000-0000-4000-8000-0000000000a1';
  EXCEPTION WHEN unique_violation THEN
    RETURN;
  END;
  RAISE EXCEPTION 'SV1-TWIN-01 FAIL: duplicate identity/tenant twin was inserted';
END
$unique$;

SELECT sv1_twin_test.login('a5100000-0000-4000-8000-000000000001');
SELECT sv1_twin_test.assert_count(
  'identity reads own twin in active tenant',
  $$SELECT 1 FROM public.cg_personal_twin
    WHERE identity_id = 'a5100000-0000-4000-8000-000000000001'
      AND school_id = '55100000-0000-4000-8000-0000000000a1'$$,
  1
);
SELECT sv1_twin_test.assert_count(
  'identity cannot read their twin in another tenant',
  $$SELECT 1 FROM public.cg_personal_twin
    WHERE identity_id = 'a5100000-0000-4000-8000-000000000001'
      AND school_id = '55100000-0000-4000-8000-0000000000b1'$$,
  0
);
SELECT sv1_twin_test.assert_count(
  'identity cannot read another user twin in the same tenant',
  $$SELECT 1 FROM public.cg_personal_twin
    WHERE identity_id = 'a5100000-0000-4000-8000-000000000002'
      AND school_id = '55100000-0000-4000-8000-0000000000a1'$$,
  0
);
SELECT sv1_twin_test.logout();

DO $audit$
BEGIN
  IF (SELECT count(*) FROM public.audit_logs
      WHERE action = 'twin.personal.provision'
        AND school_id IN (
          '55100000-0000-4000-8000-0000000000a1',
          '55100000-0000-4000-8000-0000000000b1',
          '55100000-0000-4000-8000-0000000000c1'
        )) <> 6 THEN
    RAISE EXCEPTION 'SV1-TWIN-01 FAIL: every provision attempt must be audited';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE action = 'twin.personal.provision'
      AND school_id = '55100000-0000-4000-8000-0000000000c1'
      AND new_value->>'outcome' = 'denied'
  ) THEN
    RAISE EXCEPTION 'SV1-TWIN-01 FAIL: denied provision attempt must be audited';
  END IF;
  IF (SELECT count(*) FROM public.audit_logs
      WHERE action = 'twin.personal.provision'
        AND school_id IS NULL
        AND user_id IS NULL
        AND new_value->>'outcome' = 'denied'
        AND new_value->>'actor_id' = 'a5100000-0000-4000-8000-0000000000ff'
        AND new_value->>'tenant_id' = '55100000-0000-4000-8000-0000000000ff') <> 1 THEN
    RAISE EXCEPTION 'SV1-TWIN-01 FAIL: nonexistent identity/tenant denial must be audited with nullable references';
  END IF;
END
$audit$;

DO $$ BEGIN RAISE NOTICE 'SV1-TWIN-01 provisioning and isolation checks: ALL PASS'; END $$;
ROLLBACK;
