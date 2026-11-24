-- PUSH-01b staging checks (synthetic only). STAGING/LOCAL ONLY. NEVER PRODUCTION.
-- Preconditions:
--   1) Apply PUSH-01 migration 20261124000000_sherivs_push01_mobile_push_devices.sql
--   2) Apply PUSH-01b migration 20261124170000_sherivs_push01b_rls_initplan.sql
--   3) Run this script as a privileged SQL role in staging or local disposable DB
--   4) For rollback rehearsal: run PUSH-01b rollback, then re-apply PUSH-01b, then run this again
BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.mobile_push_devices') IS NULL
     OR to_regprocedure('public.register_push_device(text,text,text,text)') IS NULL
     OR to_regprocedure('public.unregister_push_device(text)') IS NULL THEN
    RAISE EXCEPTION 'PUSH01B FAIL: PUSH-01 migration is not applied';
  END IF;
END $guard$;

CREATE SCHEMA push01bt;
GRANT USAGE ON SCHEMA push01bt TO anon, authenticated, service_role;

CREATE TABLE push01bt.ids (name text PRIMARY KEY, id uuid NOT NULL);
CREATE TABLE push01bt.passed (n serial PRIMARY KEY, label text NOT NULL);
GRANT SELECT, INSERT ON push01bt.ids TO anon, authenticated, service_role;
GRANT SELECT, INSERT ON push01bt.passed TO anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE push01bt.passed_n_seq TO anon, authenticated, service_role;

CREATE FUNCTION push01bt.id(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM push01bt.ids WHERE name = p_name
$$;
CREATE FUNCTION push01bt.login(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION push01bt.login_as(p_role text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
END $$;
CREATE FUNCTION push01bt.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;
CREATE FUNCTION push01bt.pass(p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO push01bt.passed(label) VALUES (p_label);
  RAISE NOTICE 'PUSH01B PASS %', p_label;
END $$;
CREATE FUNCTION push01bt.expect_true(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'PUSH01B FAIL [%]', p_label;
  END IF;
  PERFORM push01bt.pass(p_label);
END $$;
CREATE FUNCTION push01bt.expect_count(p_label text, p_sql text, p_expected bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO v;
  IF v IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'PUSH01B FAIL [%]: expected %, got %', p_label, p_expected, v;
  END IF;
  PERFORM push01bt.pass(p_label);
END $$;
CREATE FUNCTION push01bt.expect_error(p_label text, p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN
      PERFORM push01bt.pass(p_label);
      RETURN;
    END IF;
    RAISE EXCEPTION 'PUSH01B FAIL [%]: expected SQLSTATE % got % (%)', p_label, p_state, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'PUSH01B FAIL [%]: statement was allowed', p_label;
END $$;
CREATE FUNCTION push01bt.check_policy_definition(p_table text, p_policy text, p_expected_using text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT policydef LIKE p_expected_using
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = p_table
    AND policyname = p_policy
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA push01bt TO anon, authenticated, service_role;

-- Insert test IDs.
INSERT INTO push01bt.ids VALUES
  ('schoolA', 'f3010000-0000-4000-8000-0000000000a1'),
  ('schoolB', 'f3010000-0000-4000-8000-0000000000b2'),
  ('userA',   'f3010000-0000-4000-8000-000000000001'),
  ('userB',   'f3010000-0000-4000-8000-000000000002');

INSERT INTO auth.users (id) VALUES (push01bt.id('userA')), (push01bt.id('userB'));
INSERT INTO public.schools (id, name, slug) VALUES
  (push01bt.id('schoolA'), 'PUSH01B Synthetic A', 'push01b-synthetic-a'),
  (push01bt.id('schoolB'), 'PUSH01B Synthetic B', 'push01b-synthetic-b');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  (push01bt.id('userA'), push01bt.id('schoolA'), 'Push01b User A', 'user-a@push01b.invalid', 'admin', true),
  (push01bt.id('userB'), push01bt.id('schoolB'), 'Push01b User B', 'user-b@push01b.invalid', 'admin', true);

-- PUSH-01b specific checks:

-- 1. Check that mobile_push_devices_read_own uses (select auth.uid()) not bare auth.uid()
SELECT push01bt.expect_true('mobile_push_devices_read_own uses (select auth.uid())',
  push01bt.check_policy_definition('mobile_push_devices', 'mobile_push_devices_read_own', '%select auth.uid()%'));

-- 2. Register a device for userA to test later.
SELECT push01bt.login(push01bt.id('userA'));
SELECT public.register_push_device('ExponentPushToken[push01b-prune1]', 'ios', '1.0.0', '100');
SELECT push01bt.logout();

-- 3. Verify authenticated users still cannot UPDATE or DELETE (even their own rows).
SELECT push01bt.login(push01bt.id('userA'));
SELECT push01bt.expect_error('authenticated cannot UPDATE own row',
  $$UPDATE public.mobile_push_devices SET enabled = false WHERE expo_push_token = 'ExponentPushToken[push01b-prune1]'$$, '42501');
SELECT push01bt.expect_error('authenticated cannot DELETE own row',
  $$DELETE FROM public.mobile_push_devices WHERE expo_push_token = 'ExponentPushToken[push01b-prune1]'$$, '42501');
SELECT push01bt.logout();

-- 4. Verify authenticated users still cannot UPDATE or DELETE other users' rows.
SELECT push01bt.login(push01bt.id('userB'));
SELECT push01bt.expect_error('authenticated cannot UPDATE other user row',
  $$UPDATE public.mobile_push_devices SET enabled = false WHERE expo_push_token = 'ExponentPushToken[push01b-prune1]'$$, '42501');
SELECT push01bt.expect_error('authenticated cannot DELETE other user row',
  $$DELETE FROM public.mobile_push_devices WHERE expo_push_token = 'ExponentPushToken[push01b-prune1]'$$, '42501');
SELECT push01bt.logout();

-- 5. Verify anon still has no UPDATE/DELETE (and no SELECT).
SELECT push01bt.login_as('anon');
SELECT push01bt.expect_error('anon cannot UPDATE',
  $$UPDATE public.mobile_push_devices SET enabled = false WHERE expo_push_token = 'ExponentPushToken[push01b-prune1]'$$, '42501');
SELECT push01bt.expect_error('anon cannot DELETE',
  $$DELETE FROM public.mobile_push_devices WHERE expo_push_token = 'ExponentPushToken[push01b-prune1]'$$, '42501');
SELECT push01bt.logout();

-- 6. Verify service_role CAN UPDATE (prune).
SELECT push01bt.login_as('service_role');
SELECT push01bt.expect_count('service_role can UPDATE to set revoked_at',
  $$UPDATE public.mobile_push_devices SET revoked_at = now(), updated_at = now()
      WHERE expo_push_token = 'ExponentPushToken[push01b-prune1]'
     RETURNING id$$, 1);
SELECT push01bt.logout();

-- 7. Verify service_role CAN DELETE (after revoke).
SELECT push01bt.login_as('service_role');
SELECT push01bt.expect_count('service_role can DELETE pruned row',
  $$DELETE FROM public.mobile_push_devices
      WHERE expo_push_token = 'ExponentPushToken[push01b-prune1]'
     RETURNING id$$, 1);
SELECT push01bt.logout();

-- 8. Verify service_role still CANNOT INSERT.
SELECT push01bt.login_as('service_role');
SELECT push01bt.expect_error('service_role cannot INSERT',
  $$INSERT INTO public.mobile_push_devices (user_id, org_id, expo_push_token, platform, app_version, build_number)
      VALUES (push01bt.id('userA'), push01bt.id('schoolA'), 'ExponentPushToken[service-forged]', 'ios', '1.0.0', '999')$$, '42501');
SELECT push01bt.logout();

-- 9. Verify service_role still CANNOT execute client RPCs.
SELECT push01bt.login_as('service_role');
SELECT push01bt.expect_error('service_role cannot call register_push_device RPC',
  $$SELECT public.register_push_device('ExponentPushToken[service-rpc]', 'ios', '1.0.0', '888')$$, '42501');
SELECT push01bt.expect_error('service_role cannot call unregister_push_device RPC',
  $$SELECT public.unregister_push_device('ExponentPushToken[some-token]')$$, '42501');
SELECT push01bt.logout();

-- 10. Verify service_role can still SELECT (unchanged from PUSH-01).
SELECT push01bt.login_as('service_role');
SELECT push01bt.expect_true('service_role can SELECT after DELETE',
  (SELECT count(*) >= 0 FROM public.mobile_push_devices LIMIT 1) = true);
SELECT push01bt.logout();

-- 11. Verify authenticated users still cannot read other users' rows.
SELECT push01bt.login(push01bt.id('userA'));
SELECT push01bt.login(push01bt.id('userB'));
SELECT public.register_push_device('ExponentPushToken[push01b-prune2]', 'android', '1.0.0', '200');
SELECT push01bt.logout();
SELECT push01bt.login(push01bt.id('userA'));
SELECT push01bt.expect_count('userA still cannot read userB rows',
  $$SELECT 1 FROM public.mobile_push_devices WHERE user_id = push01bt.id('userB')$$, 0);
SELECT push01bt.logout();

DO $finish$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM push01bt.passed;
  RAISE NOTICE 'PUSH01B STAGING CHECKS PASS: % checks', v_count;
END $finish$;

ROLLBACK;
