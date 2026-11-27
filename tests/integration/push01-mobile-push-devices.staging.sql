-- PUSH-01 staging checks (synthetic only). STAGING/LOCAL ONLY. NEVER PRODUCTION.
-- Preconditions:
--   1) Apply migration 20261124000000_sherivs_push01_mobile_push_devices.sql
--   2) Run this script as a privileged SQL role in staging or local disposable DB
--   3) For rollback rehearsal: run rollback SQL, then re-apply migration SQL, then run this again
BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.mobile_push_devices') IS NULL
     OR to_regprocedure('public.register_push_device(text,text,text,text)') IS NULL
     OR to_regprocedure('public.unregister_push_device(text)') IS NULL THEN
    RAISE EXCEPTION 'PUSH01 FAIL: migration is not applied';
  END IF;
END $guard$;

CREATE SCHEMA push01t;
GRANT USAGE ON SCHEMA push01t TO anon, authenticated, service_role;

CREATE TABLE push01t.ids (name text PRIMARY KEY, id uuid NOT NULL);
CREATE TABLE push01t.passed (n serial PRIMARY KEY, label text NOT NULL);
GRANT SELECT, INSERT ON push01t.ids TO anon, authenticated, service_role;
GRANT SELECT, INSERT ON push01t.passed TO anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE push01t.passed_n_seq TO anon, authenticated, service_role;

CREATE FUNCTION push01t.id(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM push01t.ids WHERE name = p_name
$$;
CREATE FUNCTION push01t.login(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION push01t.login_as(p_role text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
END $$;
CREATE FUNCTION push01t.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;
CREATE FUNCTION push01t.pass(p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO push01t.passed(label) VALUES (p_label);
  RAISE NOTICE 'PUSH01 PASS %', p_label;
END $$;
CREATE FUNCTION push01t.expect_true(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'PUSH01 FAIL [%]', p_label;
  END IF;
  PERFORM push01t.pass(p_label);
END $$;
CREATE FUNCTION push01t.expect_count(p_label text, p_sql text, p_expected bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO v;
  IF v IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'PUSH01 FAIL [%]: expected %, got %', p_label, p_expected, v;
  END IF;
  PERFORM push01t.pass(p_label);
END $$;
CREATE FUNCTION push01t.expect_error(p_label text, p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN
      PERFORM push01t.pass(p_label);
      RETURN;
    END IF;
    RAISE EXCEPTION 'PUSH01 FAIL [%]: expected SQLSTATE % got % (%)', p_label, p_state, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'PUSH01 FAIL [%]: statement was allowed', p_label;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA push01t TO anon, authenticated, service_role;

SELECT push01t.expect_true('table uses forced RLS',
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.mobile_push_devices'::regclass));
SELECT push01t.expect_true('anon has no table privileges',
  NOT has_table_privilege('anon', 'public.mobile_push_devices', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.mobile_push_devices', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.mobile_push_devices', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.mobile_push_devices', 'DELETE'));
SELECT push01t.expect_true('authenticated has read only and RPC execute',
  has_table_privilege('authenticated', 'public.mobile_push_devices', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.mobile_push_devices', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.mobile_push_devices', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.mobile_push_devices', 'DELETE')
  AND has_function_privilege('authenticated', 'public.register_push_device(text,text,text,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.unregister_push_device(text)', 'EXECUTE'));
SELECT push01t.expect_true('service role can read but not execute client RPCs',
  has_table_privilege('service_role', 'public.mobile_push_devices', 'SELECT')
  AND NOT has_function_privilege('service_role', 'public.register_push_device(text,text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.unregister_push_device(text)', 'EXECUTE'));

INSERT INTO push01t.ids VALUES
  ('schoolA', 'f3010000-0000-4000-8000-0000000000a1'),
  ('schoolB', 'f3010000-0000-4000-8000-0000000000b2'),
  ('userA',   'f3010000-0000-4000-8000-000000000001'),
  ('userB',   'f3010000-0000-4000-8000-000000000002');

INSERT INTO auth.users (id) VALUES (push01t.id('userA')), (push01t.id('userB'));
INSERT INTO public.schools (id, name, slug) VALUES
  (push01t.id('schoolA'), 'PUSH01 Synthetic A', 'push01-synthetic-a'),
  (push01t.id('schoolB'), 'PUSH01 Synthetic B', 'push01-synthetic-b');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  (push01t.id('userA'), push01t.id('schoolA'), 'Push01 User A', 'user-a@push01.invalid', 'admin', true),
  (push01t.id('userB'), push01t.id('schoolB'), 'Push01 User B', 'user-b@push01.invalid', 'admin', true);

SELECT push01t.login(push01t.id('userA'));
SELECT public.register_push_device('ExponentPushToken[push01-a1]', 'ios', '1.0.0', '100');
SELECT public.register_push_device('ExponentPushToken[push01-a2]', 'android', '1.0.0', '101');
SELECT public.register_push_device('ExponentPushToken[push01-a3]', 'ios', '1.0.0', '102');
SELECT public.register_push_device('ExponentPushToken[push01-a4]', 'android', '1.0.0', '103');
SELECT public.register_push_device('ExponentPushToken[push01-a5]', 'ios', '1.0.0', '104');
SELECT public.register_push_device('ExponentPushToken[push01-a6]', 'android', '1.0.0', '105');
SELECT public.register_push_device('ExponentPushToken[push01-a7]', 'ios', '1.0.0', '106');
SELECT public.register_push_device('ExponentPushToken[push01-a8]', 'android', '1.0.0', '107');
SELECT public.register_push_device('ExponentPushToken[push01-a9]', 'ios', '1.0.0', '108');
SELECT public.register_push_device('ExponentPushToken[push01-a10]', 'android', '1.0.0', '109');
SELECT push01t.expect_count('userA has 10 active devices',
  $$SELECT 1 FROM public.mobile_push_devices WHERE user_id = push01t.id('userA') AND revoked_at IS NULL$$, 10);
SELECT push01t.expect_error('11th device is rejected by cap',
  $$SELECT public.register_push_device('ExponentPushToken[push01-a11]', 'ios', '1.0.0', '110')$$, '22023');
SELECT push01t.expect_error('direct insert is denied for authenticated user',
  $$INSERT INTO public.mobile_push_devices (user_id, org_id, expo_push_token, platform, app_version, build_number)
    VALUES (push01t.id('userA'), push01t.id('schoolA'), 'ExponentPushToken[forged-a]', 'ios', '1.0.0', '900')$$, '42501');
INSERT INTO public.notification_preferences (user_id, school_id)
VALUES (push01t.id('userA'), push01t.id('schoolA'));
SELECT push01t.expect_true('new push preference defaults are true and timezone is Africa/Lagos',
  (SELECT push_messages AND push_announcements AND push_grades AND push_attendance AND push_fees
          AND timezone = 'Africa/Lagos'
     FROM public.notification_preferences
    WHERE user_id = push01t.id('userA')));
SELECT push01t.logout();

SELECT push01t.login(push01t.id('userB'));
SELECT push01t.expect_count('userB cannot read userA rows',
  $$SELECT 1 FROM public.mobile_push_devices WHERE user_id = push01t.id('userA')$$, 0);
SELECT public.register_push_device('ExponentPushToken[push01-a1]', 'android', '2.0.0', '200');
SELECT push01t.expect_count('userB now owns transferred token',
  $$SELECT 1 FROM public.mobile_push_devices WHERE user_id = push01t.id('userB') AND expo_push_token = 'ExponentPushToken[push01-a1]' AND revoked_at IS NULL$$, 1);
SELECT push01t.logout();

SELECT push01t.login(push01t.id('userA'));
SELECT push01t.expect_count('userA now has nine active devices after transfer',
  $$SELECT 1 FROM public.mobile_push_devices WHERE user_id = push01t.id('userA') AND revoked_at IS NULL$$, 9);
SELECT push01t.expect_true('userA cannot unregister token moved to userB',
  public.unregister_push_device('ExponentPushToken[push01-a1]') = false);
SELECT push01t.logout();

SELECT push01t.login(push01t.id('userB'));
SELECT push01t.expect_true('userB can unregister owned token',
  public.unregister_push_device('ExponentPushToken[push01-a1]') = true);
SELECT push01t.logout();

SELECT push01t.login_as('anon');
SELECT push01t.expect_error('anon cannot call register RPC',
  $$SELECT public.register_push_device('ExponentPushToken[anon]', 'ios', '1.0.0', '1')$$, '42501');
SELECT push01t.expect_error('anon cannot read table',
  $$SELECT count(*) FROM public.mobile_push_devices$$, '42501');
SELECT push01t.logout();

DO $finish$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM push01t.passed;
  RAISE NOTICE 'PUSH01 STAGING CHECKS PASS: % checks', v_count;
END $finish$;

ROLLBACK;
