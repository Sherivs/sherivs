-- Disposable proof for 20261117001300_sherivs_m5_onboarding_requests.sql (ADR-108).
-- A small production-shaped schema (the platform staff helpers and audit_logs the migration uses),
-- then positive and negative cases, a second run, and the rollback. It is a fixture, not a replay
-- of production. Run as a superuser against an EMPTY database, from the repository root:
--   psql -d m5b_test -v ON_ERROR_STOP=1 -f tests/sql/m5-onboarding-requests.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('sim.uid', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- Production shape (SEC-M0): new functions are not executable by PUBLIC.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE public.audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid, user_id uuid,
  action text NOT NULL, table_name text, record_id uuid, old_value jsonb, new_value jsonb, ip_address text,
  created_at timestamptz DEFAULT now());
CREATE TABLE public.super_admins (user_id uuid PRIMARY KEY);
CREATE TABLE public.platform_roles (code text PRIMARY KEY, capabilities text[] NOT NULL DEFAULT '{}');
CREATE TABLE public.platform_staff (id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'active');
CREATE TABLE public.platform_staff_roles (staff_id uuid NOT NULL REFERENCES public.platform_staff(id),
  role_code text NOT NULL REFERENCES public.platform_roles(code), PRIMARY KEY (staff_id, role_code));
CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = auth.uid()) $$;
CREATE FUNCTION public.has_platform_capability(p_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.is_super_admin()
      OR EXISTS (SELECT 1 FROM public.platform_staff s
                   JOIN public.platform_staff_roles sr ON sr.staff_id = s.id
                   JOIN public.platform_roles r ON r.code = sr.role_code
                  WHERE s.id = auth.uid() AND s.status = 'active' AND p_capability = ANY (r.capabilities));
$$;
REVOKE ALL ON FUNCTION public.has_platform_capability(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_platform_capability(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

INSERT INTO public.platform_roles VALUES ('onboarding', ARRAY['platform.onboarding.read', 'platform.onboarding.handle']),
  ('finance', ARRAY['platform.finance.read']);
INSERT INTO public.platform_staff VALUES ('00000000-0000-0000-0000-0000000000a1', 'active'),
  ('00000000-0000-0000-0000-0000000000a2', 'active'), ('00000000-0000-0000-0000-0000000000a3', 'suspended');
INSERT INTO public.platform_staff_roles VALUES ('00000000-0000-0000-0000-0000000000a1', 'onboarding'),
  ('00000000-0000-0000-0000-0000000000a2', 'finance'), ('00000000-0000-0000-0000-0000000000a3', 'onboarding');

CREATE FUNCTION pg_temp.expect(label text, got text, want text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN RAISE EXCEPTION 'FAIL %: got %, want %', label, got, want; END IF;
  RAISE NOTICE 'ok   %', label;
END $$;
-- Runs a statement as a role for a caller; returns 'ok:<rows>' or 'err:<SQLSTATE>'.
CREATE FUNCTION pg_temp.try(p_role text, p_uid text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint; result text;
BEGIN
  PERFORM set_config('sim.uid', p_uid, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; result := 'ok:' || n;
  EXCEPTION WHEN others THEN result := 'err:' || SQLSTATE;
  END;
  RESET ROLE;
  RETURN result;
END $$;
CREATE FUNCTION pg_temp.val_as(p_role text, p_uid text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('sim.uid', p_uid, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN EXECUTE p_sql INTO v; EXCEPTION WHEN others THEN RESET ROLE; RETURN 'err:' || SQLSTATE; END;
  RESET ROLE;
  RETURN coalesce(v, '<null>');
END $$;

\set hash_a aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
\set hash_b bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
\set hash_x cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc

\echo == apply the migration ==
\i database/supabase/migrations/20261117001300_sherivs_m5_onboarding_requests.sql

\echo == posture ==
SELECT pg_temp.expect('requests force RLS',
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.onboarding_requests'::regclass)::text, 'true');
SELECT pg_temp.expect('sessions force RLS',
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.reality_interview_sessions'::regclass)::text, 'true');
SELECT pg_temp.expect('no table has a tenant column',
  (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public'
     AND table_name IN ('onboarding_requests', 'reality_interview_sessions')
     AND column_name IN ('org_id', 'school_id', 'tenant_id')), '0');
SELECT pg_temp.expect('anon and authenticated hold no privilege on either table',
  (SELECT count(*)::text FROM (VALUES ('anon'), ('authenticated')) r(role),
     (VALUES ('public.onboarding_requests'), ('public.reality_interview_sessions')) t(tbl),
     (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
    WHERE has_table_privilege(r.role, t.tbl, p.priv)), '0');
SELECT pg_temp.expect('anon, authenticated and PUBLIC cannot execute any intake function',
  (SELECT count(*)::text FROM pg_proc f JOIN pg_namespace n ON n.oid = f.pronamespace,
     (VALUES ('anon'), ('authenticated')) r(role)
    WHERE n.nspname = 'public' AND f.proname LIKE 'onboarding_intake_%'
      AND has_function_privilege(r.role, f.oid, 'EXECUTE')), '0');
SELECT pg_temp.expect('the service role can execute the five server functions',
  (SELECT count(*)::text FROM pg_proc f JOIN pg_namespace n ON n.oid = f.pronamespace
    WHERE n.nspname = 'public' AND f.proname LIKE 'onboarding_intake_%' AND f.proname <> 'onboarding_intake_audit'
      AND has_function_privilege('service_role', f.oid, 'EXECUTE')), '5');
SELECT pg_temp.expect('every intake function pins search_path',
  (SELECT count(*)::text FROM pg_proc f JOIN pg_namespace n ON n.oid = f.pronamespace
    WHERE n.nspname = 'public' AND f.proname LIKE 'onboarding_intake_%'
      AND NOT coalesce(f.proconfig @> ARRAY['search_path=""'], false)), '0');

\echo == create (service role) ==
SELECT pg_temp.expect('the service role creates a request and its session',
  pg_temp.try('service_role', '', format($q$SELECT * FROM public.onboarding_intake_create('Northwind Academy', 'private_secondary',
    'Lagos', 'Ikeja', 'Ada Obi', 'Ada@Northwind.example', '+234 800 000 0000', 'Administrator', 'Two campuses.',
    'v1', 'public_onboarding', %L, 'g1')$q$, :'hash_a')), 'ok:1');
SELECT pg_temp.expect('a second request with the same email is accepted the same way',
  pg_temp.try('service_role', '', format($q$SELECT * FROM public.onboarding_intake_create('Northwind Two', 'private_primary',
    NULL, NULL, 'Ada Obi', 'ada@northwind.example', NULL, NULL, NULL, 'v1', 'public_demo', %L, 'g1')$q$, :'hash_b')), 'ok:1');
SELECT pg_temp.expect('email is stored lower-cased and consent is recorded with a server time',
  (SELECT string_agg(contact_email || ':' || consent_given || ':' || (consent_given_at IS NOT NULL), ',' ORDER BY org_name)
     FROM public.onboarding_requests), 'ada@northwind.example:true:true,ada@northwind.example:true:true');
SELECT pg_temp.expect('new requests start as new; sessions expire in 30 days',
  (SELECT string_agg(r.status || ':' || (s.expires_at - s.created_at)::text, ',')
     FROM public.onboarding_requests r JOIN public.reality_interview_sessions s ON s.request_id = r.id), 'new:30 days,new:30 days');
SELECT pg_temp.expect('a reused token hash is refused',
  pg_temp.try('service_role', '', format($q$SELECT * FROM public.onboarding_intake_create('Third', 'private_primary',
    NULL, NULL, 'Ben Eze', 'ben@example.org', NULL, NULL, NULL, 'v1', 'public_demo', %L, 'g1')$q$, :'hash_a')), 'err:23505');
SELECT pg_temp.expect('a token hash that is not sha-256 hex is refused',
  pg_temp.try('service_role', '', $q$SELECT * FROM public.onboarding_intake_create('Third', 'private_primary',
    NULL, NULL, 'Ben Eze', 'ben@example.org', NULL, NULL, NULL, 'v1', 'public_demo', 'raw-token', 'g1')$q$), 'err:23514');
SELECT pg_temp.expect('an over-long organization name is refused',
  pg_temp.try('service_role', '', format($q$SELECT * FROM public.onboarding_intake_create(repeat('x', 161), 'private_primary',
    NULL, NULL, 'Ben Eze', 'ben@example.org', NULL, NULL, NULL, 'v1', 'public_demo', %L, 'g1')$q$, :'hash_x')), 'err:23514');
SELECT pg_temp.expect('a malformed email is refused',
  pg_temp.try('service_role', '', format($q$SELECT * FROM public.onboarding_intake_create('Third', 'private_primary',
    NULL, NULL, 'Ben Eze', 'not-an-email', NULL, NULL, NULL, 'v1', 'public_demo', %L, 'g1')$q$, :'hash_x')), 'err:23514');
SELECT pg_temp.expect('a malformed phone is refused',
  pg_temp.try('service_role', '', format($q$SELECT * FROM public.onboarding_intake_create('Third', 'private_primary',
    NULL, NULL, 'Ben Eze', 'ben@example.org', 'call me', NULL, NULL, 'v1', 'public_demo', %L, 'g1')$q$, :'hash_x')), 'err:23514');
SELECT pg_temp.expect('a malformed institution type is refused',
  pg_temp.try('service_role', '', format($q$SELECT * FROM public.onboarding_intake_create('Third', 'Private Primary!',
    NULL, NULL, 'Ben Eze', 'ben@example.org', NULL, NULL, NULL, 'v1', 'public_demo', %L, 'g1')$q$, :'hash_x')), 'err:23514');
SELECT pg_temp.expect('an unknown source is refused',
  pg_temp.try('service_role', '', format($q$SELECT * FROM public.onboarding_intake_create('Third', 'private_primary',
    NULL, NULL, 'Ben Eze', 'ben@example.org', NULL, NULL, NULL, 'v1', 'web', %L, 'g1')$q$, :'hash_x')), 'err:23514');
SELECT pg_temp.expect('a note over 2000 characters is refused',
  pg_temp.try('service_role', '', format($q$SELECT * FROM public.onboarding_intake_create('Third', 'private_primary',
    NULL, NULL, 'Ben Eze', 'ben@example.org', NULL, NULL, repeat('n', 2001), 'v1', 'public_demo', %L, 'g1')$q$, :'hash_x')), 'err:23514');
SELECT pg_temp.expect('a request without consent cannot exist',
  pg_temp.try('service_role', '', $q$INSERT INTO public.onboarding_requests (org_name, institution_type, contact_name,
    contact_email, consent_given, consent_version, consent_given_at, source)
    VALUES ('Third', 'private_primary', 'Ben Eze', 'ben@example.org', false, 'v1', now(), 'public_demo')$q$), 'err:23514');
SELECT pg_temp.expect('an unknown status is refused',
  pg_temp.try('service_role', '', $q$UPDATE public.onboarding_requests SET status = 'won'$q$), 'err:23514');

\echo == anonymous and signed-in callers ==
SELECT pg_temp.expect('anon cannot read requests',
  pg_temp.val_as('anon', '', 'SELECT count(*) FROM public.onboarding_requests'), 'err:42501');
SELECT pg_temp.expect('anon cannot read sessions',
  pg_temp.val_as('anon', '', 'SELECT count(*) FROM public.reality_interview_sessions'), 'err:42501');
SELECT pg_temp.expect('anon cannot insert a request',
  pg_temp.try('anon', '', $q$INSERT INTO public.onboarding_requests (org_name, institution_type, contact_name,
    contact_email, consent_given, consent_version, consent_given_at, source)
    VALUES ('X Org', 'private_primary', 'Ben Eze', 'ben@example.org', true, 'v1', now(), 'public_demo')$q$), 'err:42501');
SELECT pg_temp.expect('anon cannot call create',
  pg_temp.try('anon', '', format($q$SELECT * FROM public.onboarding_intake_create('X Org', 'private_primary',
    NULL, NULL, 'Ben Eze', 'ben@example.org', NULL, NULL, NULL, 'v1', 'public_demo', %L, 'g1')$q$, :'hash_x')), 'err:42501');
SELECT pg_temp.expect('anon cannot load a session even with the right hash',
  pg_temp.val_as('anon', '', format('SELECT count(*) FROM public.onboarding_intake_load(%L)', :'hash_a')), 'err:42501');
SELECT pg_temp.expect('anon cannot save',
  pg_temp.try('anon', '', format($q$SELECT * FROM public.onboarding_intake_save(%L, 0, '{}'::jsonb, 10)$q$, :'hash_a')), 'err:42501');
SELECT pg_temp.expect('anon cannot complete',
  pg_temp.try('anon', '', format('SELECT * FROM public.onboarding_intake_complete(%L, 0)', :'hash_a')), 'err:42501');
SELECT pg_temp.expect('anon cannot purge',
  pg_temp.try('anon', '', 'SELECT public.onboarding_intake_purge_expired()'), 'err:42501');
SELECT pg_temp.expect('authenticated cannot read requests',
  pg_temp.val_as('authenticated', '00000000-0000-0000-0000-0000000000ff', 'SELECT count(*) FROM public.onboarding_requests'), 'err:42501');
SELECT pg_temp.expect('authenticated cannot read sessions',
  pg_temp.val_as('authenticated', '00000000-0000-0000-0000-0000000000ff', 'SELECT count(*) FROM public.reality_interview_sessions'), 'err:42501');
SELECT pg_temp.expect('authenticated cannot update a request',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000ff', $q$UPDATE public.onboarding_requests SET status = 'approved'$q$), 'err:42501');
SELECT pg_temp.expect('authenticated cannot delete a session',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000ff', 'DELETE FROM public.reality_interview_sessions'), 'err:42501');
SELECT pg_temp.expect('authenticated cannot call create',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000ff', format($q$SELECT * FROM public.onboarding_intake_create('X Org',
    'private_primary', NULL, NULL, 'Ben Eze', 'ben@example.org', NULL, NULL, NULL, 'v1', 'public_demo', %L, 'g1')$q$, :'hash_x')), 'err:42501');
SELECT pg_temp.expect('authenticated cannot load',
  pg_temp.val_as('authenticated', '00000000-0000-0000-0000-0000000000ff', format('SELECT count(*) FROM public.onboarding_intake_load(%L)', :'hash_a')), 'err:42501');
SELECT pg_temp.expect('authenticated cannot save',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000ff', format($q$SELECT * FROM public.onboarding_intake_save(%L, 0, '{}'::jsonb, 1)$q$, :'hash_a')), 'err:42501');
SELECT pg_temp.expect('authenticated cannot complete',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000ff', format('SELECT * FROM public.onboarding_intake_complete(%L, 0)', :'hash_a')), 'err:42501');
SELECT pg_temp.expect('authenticated cannot purge',
  pg_temp.try('authenticated', '00000000-0000-0000-0000-0000000000ff', 'SELECT public.onboarding_intake_purge_expired()'), 'err:42501');
SELECT pg_temp.expect('even capable platform staff hold no table privilege today',
  pg_temp.val_as('authenticated', '00000000-0000-0000-0000-0000000000a1', 'SELECT count(*) FROM public.onboarding_requests'), 'err:42501');

\echo == the dormant staff policy decides rows once a later migration grants SELECT ==
BEGIN;
GRANT SELECT ON public.onboarding_requests, public.reality_interview_sessions TO authenticated;
SELECT pg_temp.expect('staff with platform.onboarding.read see requests',
  pg_temp.val_as('authenticated', '00000000-0000-0000-0000-0000000000a1', 'SELECT count(*) FROM public.onboarding_requests'), '2');
SELECT pg_temp.expect('staff with platform.onboarding.read see sessions',
  pg_temp.val_as('authenticated', '00000000-0000-0000-0000-0000000000a1', 'SELECT count(*) FROM public.reality_interview_sessions'), '2');
SELECT pg_temp.expect('staff without the capability see nothing',
  pg_temp.val_as('authenticated', '00000000-0000-0000-0000-0000000000a2', 'SELECT count(*) FROM public.onboarding_requests'), '0');
SELECT pg_temp.expect('suspended staff see nothing',
  pg_temp.val_as('authenticated', '00000000-0000-0000-0000-0000000000a3', 'SELECT count(*) FROM public.reality_interview_sessions'), '0');
SELECT pg_temp.expect('a signed-in non-staff user sees nothing',
  pg_temp.val_as('authenticated', '00000000-0000-0000-0000-0000000000ff', 'SELECT count(*) FROM public.onboarding_requests'), '0');
ROLLBACK;

\echo == load by token hash ==
SELECT pg_temp.expect('the right hash loads exactly its own session',
  pg_temp.val_as('service_role', '', format($q$SELECT r.org_name FROM public.onboarding_intake_load(%L) l
    JOIN public.reality_interview_sessions s ON s.id = l.session_id JOIN public.onboarding_requests r ON r.id = s.request_id$q$, :'hash_a')),
  'Northwind Academy');
SELECT pg_temp.expect('session B''s hash never returns session A',
  pg_temp.val_as('service_role', '', format($q$SELECT count(*) FROM public.onboarding_intake_load(%L) l
    JOIN public.reality_interview_sessions s ON s.id = l.session_id WHERE s.resume_token_hash = %L$q$, :'hash_b', :'hash_a')), '0');
SELECT pg_temp.expect('an unknown hash returns nothing',
  pg_temp.val_as('service_role', '', format('SELECT count(*) FROM public.onboarding_intake_load(%L)', :'hash_x')), '0');
SELECT pg_temp.expect('a save with another session''s hash changes only that session',
  pg_temp.try('service_role', '', format($q$SELECT * FROM public.onboarding_intake_save(%L, 0, '{"q1":"b"}'::jsonb, 5)$q$, :'hash_b')), 'ok:1');
SELECT pg_temp.expect('session A is untouched by session B''s save',
  (SELECT answers::text || ':' || revision FROM public.reality_interview_sessions WHERE resume_token_hash = :'hash_a'), '{}:0');

\echo == save with optimistic concurrency ==
SELECT pg_temp.expect('a save at the current revision succeeds and bumps the revision',
  pg_temp.val_as('service_role', '', format($q$SELECT revision FROM public.onboarding_intake_save(%L, 0, '{"q1":"a"}'::jsonb, 20)$q$, :'hash_a')), '1');
SELECT pg_temp.expect('the first save moves the request into the interview',
  (SELECT r.status FROM public.onboarding_requests r JOIN public.reality_interview_sessions s ON s.request_id = r.id
    WHERE s.resume_token_hash = :'hash_a'), 'in_interview');
SELECT pg_temp.expect('a stale revision is refused',
  pg_temp.try('service_role', '', format($q$SELECT * FROM public.onboarding_intake_save(%L, 0, '{"q1":"late"}'::jsonb, 30)$q$, :'hash_a')), 'err:PT409');
SELECT pg_temp.expect('the refused save left the answers alone',
  (SELECT answers->>'q1' FROM public.reality_interview_sessions WHERE resume_token_hash = :'hash_a'), 'a');
SELECT pg_temp.expect('a save for an unknown hash is not found',
  pg_temp.try('service_role', '', format($q$SELECT * FROM public.onboarding_intake_save(%L, 0, '{}'::jsonb, 1)$q$, :'hash_x')), 'err:PT404');
SELECT pg_temp.expect('completion over 100 is refused',
  pg_temp.try('service_role', '', format($q$SELECT * FROM public.onboarding_intake_save(%L, 1, '{}'::jsonb, 101)$q$, :'hash_a')), 'err:23514');
SELECT pg_temp.expect('answers must be a JSON object',
  pg_temp.try('service_role', '', format($q$SELECT * FROM public.onboarding_intake_save(%L, 1, '[1,2]'::jsonb, 10)$q$, :'hash_a')), 'err:23514');
SELECT pg_temp.expect('answers over 64 KB are refused',
  pg_temp.try('service_role', '', format($q$SELECT * FROM public.onboarding_intake_save(%L, 1,
    jsonb_build_object('big', repeat('z', 65536)), 10)$q$, :'hash_a')), 'err:23514');
SELECT pg_temp.expect('answers just under the bound are accepted',
  pg_temp.val_as('service_role', '', format($q$SELECT revision FROM public.onboarding_intake_save(%L, 1,
    jsonb_build_object('big', repeat('z', 65000)), 40)$q$, :'hash_a')), '2');

\echo == complete ==
SELECT pg_temp.expect('a stale complete is refused',
  pg_temp.try('service_role', '', format('SELECT * FROM public.onboarding_intake_complete(%L, 1)', :'hash_a')), 'err:PT409');
SELECT pg_temp.expect('complete at the current revision succeeds',
  pg_temp.val_as('service_role', '', format('SELECT revision FROM public.onboarding_intake_complete(%L, 2)', :'hash_a')), '3');
SELECT pg_temp.expect('a completed session refuses further saves',
  pg_temp.try('service_role', '', format($q$SELECT * FROM public.onboarding_intake_save(%L, 3, '{}'::jsonb, 50)$q$, :'hash_a')), 'err:PT409');
SELECT pg_temp.expect('a completed session refuses a second complete',
  pg_temp.try('service_role', '', format('SELECT * FROM public.onboarding_intake_complete(%L, 3)', :'hash_a')), 'err:PT409');

\echo == expiry and purge ==
INSERT INTO public.reality_interview_sessions (request_id, resume_token_hash, graph_version, created_at, expires_at)
SELECT id, 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', 'g1', now() - interval '31 days', now() - interval '1 day'
  FROM public.onboarding_requests WHERE org_name = 'Northwind Two';
SELECT pg_temp.expect('an expired session is not returned',
  pg_temp.val_as('service_role', '', $q$SELECT count(*) FROM public.onboarding_intake_load('dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd')$q$), '0');
SELECT pg_temp.expect('an expired session cannot be saved',
  pg_temp.try('service_role', '', $q$SELECT * FROM public.onboarding_intake_save('dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', 0, '{}'::jsonb, 1)$q$), 'err:PT404');
SELECT pg_temp.expect('purge removes exactly the expired session',
  pg_temp.val_as('service_role', '', 'SELECT public.onboarding_intake_purge_expired()'), '1');
SELECT pg_temp.expect('live sessions and every request survive the purge',
  (SELECT (SELECT count(*) FROM public.reality_interview_sessions)::text || ':' || (SELECT count(*) FROM public.onboarding_requests)::text), '2:2');
SELECT pg_temp.expect('a second purge removes nothing',
  pg_temp.val_as('service_role', '', 'SELECT public.onboarding_intake_purge_expired()'), '0');

\echo == audit ==
SELECT pg_temp.expect('writes are audited with no organization',
  (SELECT (count(*) > 0 AND bool_and(school_id IS NULL))::text FROM public.audit_logs
    WHERE table_name IN ('onboarding_requests', 'reality_interview_sessions')), 'true');
SELECT pg_temp.expect('the purge delete is audited',
  (SELECT count(*)::text FROM public.audit_logs WHERE action = 'platform.reality_interview_sessions.delete'), '1');
SELECT pg_temp.expect('audit rows carry no personal data, answers or token hashes',
  (SELECT count(*)::text FROM public.audit_logs WHERE new_value::text ~* '(northwind|ada obi|@|\+234|aaaaaaaa|bbbbbbbb|zzzz)'), '0');

\echo == second run ==
\i database/supabase/migrations/20261117001300_sherivs_m5_onboarding_requests.sql
SELECT pg_temp.expect('a second run keeps the data',
  (SELECT count(*)::text FROM public.onboarding_requests), '2');
SELECT pg_temp.expect('a second run keeps anon and authenticated out',
  (SELECT (has_table_privilege('anon', 'public.onboarding_requests', 'SELECT')
        OR has_table_privilege('authenticated', 'public.reality_interview_sessions', 'SELECT')
        OR has_function_privilege('anon', 'public.onboarding_intake_load(text)', 'EXECUTE')
        OR has_function_privilege('authenticated', 'public.onboarding_intake_load(text)', 'EXECUTE'))::text), 'false');
SELECT pg_temp.expect('a second run leaves one audit trigger per table',
  (SELECT count(*)::text FROM pg_trigger WHERE tgname IN ('onboarding_requests_audit', 'reality_interview_sessions_audit')), '2');

\echo == rollback ==
\i database/supabase/rollbacks/20261117001300_sherivs_m5_onboarding_requests.sql
SELECT pg_temp.expect('the rollback removes both tables',
  (SELECT count(*)::text FROM pg_class WHERE relname IN ('onboarding_requests', 'reality_interview_sessions')), '0');
SELECT pg_temp.expect('the rollback removes every intake function',
  (SELECT count(*)::text FROM pg_proc WHERE proname LIKE 'onboarding_intake_%'), '0');
SELECT pg_temp.expect('the rollback keeps the audit trail',
  (SELECT (count(*) > 0)::text FROM public.audit_logs WHERE table_name = 'onboarding_requests'), 'true');
\i database/supabase/rollbacks/20261117001300_sherivs_m5_onboarding_requests.sql
\echo == rollback is repeatable; re-apply after rollback ==
\i database/supabase/migrations/20261117001300_sherivs_m5_onboarding_requests.sql
SELECT pg_temp.expect('re-apply after rollback recreates both tables',
  (SELECT count(*)::text FROM pg_class WHERE relname IN ('onboarding_requests', 'reality_interview_sessions') AND relkind = 'r'), '2');
\echo ALL M5B CHECKS PASSED
