-- SHERIVS-033 communications isolation (LOCAL, DISPOSABLE ONLY).
-- Run only after replaying repository migrations on a loopback disposable DB:
--   psql "postgresql://supabase_admin@127.0.0.1:<port>/postgres" \
--     -v ON_ERROR_STOP=1 -f tests/integration/sherivs-033-communication-isolation.local.sql
-- The transaction is rolled back; never run against a live database.
BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'SHERIVS-033: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NOT NULL
     AND NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet)
     AND coalesce(current_setting('comms033.allow_non_loopback', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'SHERIVS-033: refusing non-loopback server address %', inet_server_addr();
  END IF;
  IF to_regprocedure('public.comms_propose_send(uuid,text,jsonb,text,jsonb,text)') IS NULL
     OR to_regprocedure('public.comms_route_inbound(text,text,text,text)') IS NULL
     OR to_regprocedure('public.comms_outbound_recipient_guard()') IS NULL THEN
    RAISE EXCEPTION 'SHERIVS-033: communication scope-lock migration is not applied';
  END IF;
END
$guard$;

CREATE SCHEMA comms033;
GRANT USAGE ON SCHEMA comms033 TO authenticated, service_role;

CREATE FUNCTION comms033.login(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION comms033.as_service() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  EXECUTE 'SET LOCAL ROLE service_role';
END $$;
CREATE FUNCTION comms033.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE 'RESET ROLE'; END $$;
CREATE FUNCTION comms033.count_is(p_label text, p_sql text, p_expected bigint)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO n;
  IF n IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'SHERIVS-033 FAIL [%]: expected % rows, got %', p_label, p_expected, n;
  END IF;
END $$;
CREATE FUNCTION comms033.raises(p_label text, p_sql text, p_expected text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_error text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF position(p_expected IN v_error) > 0 THEN RETURN; END IF;
    RAISE EXCEPTION 'SHERIVS-033 FAIL [%]: unexpected error: %', p_label, v_error;
  END;
  RAISE EXCEPTION 'SHERIVS-033 FAIL [%]: statement unexpectedly succeeded', p_label;
END $$;
CREATE FUNCTION comms033.raises_check(p_label text, p_sql text, p_expected text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_error text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF position(p_expected IN v_error) > 0 THEN RETURN; END IF;
    RAISE EXCEPTION 'SHERIVS-033 FAIL [%]: unexpected check violation: %', p_label, v_error;
  END;
  RAISE EXCEPTION 'SHERIVS-033 FAIL [%]: statement did not raise check_violation', p_label;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA comms033 TO authenticated, service_role;

INSERT INTO auth.users (id, phone, phone_confirmed_at) VALUES
  ('a3300000-0000-4000-8000-000000000001', NULL, NULL),
  ('a3300000-0000-4000-8000-000000000002', '+2349013300002', now()),
  ('b3300000-0000-4000-8000-000000000001', NULL, NULL);
INSERT INTO public.schools (id, name, slug) VALUES
  ('53300000-0000-4000-8000-0000000000a1', 'Comms 033 A', 'comms033-school-a'),
  ('53300000-0000-4000-8000-0000000000b2', 'Comms 033 B', 'comms033-school-b');
INSERT INTO public.users (id, school_id, full_name, email, phone, role, is_active) VALUES
  ('a3300000-0000-4000-8000-000000000001','53300000-0000-4000-8000-0000000000a1','Comms Admin A','comms033-admin-a@example.invalid',NULL,'admin',true),
  ('a3300000-0000-4000-8000-000000000002','53300000-0000-4000-8000-0000000000a1','Shared Guardian','comms033-parent@example.invalid','+2349013300002','parent',true),
  ('b3300000-0000-4000-8000-000000000001','53300000-0000-4000-8000-0000000000b2','Comms Admin B','comms033-admin-b@example.invalid',NULL,'admin',true);
SELECT comms033.as_service();
INSERT INTO public.organization_memberships (user_id, school_id, role, is_primary, is_active)
VALUES ('a3300000-0000-4000-8000-000000000002','53300000-0000-4000-8000-0000000000b2','parent',false,true);
SELECT comms033.logout();
INSERT INTO public.students (id, school_id, admission_number, parent_id) VALUES
  ('5c330000-0000-4000-8000-0000000000b2','53300000-0000-4000-8000-0000000000b2','COMMS033-B-STUDENT','a3300000-0000-4000-8000-000000000002');
INSERT INTO public.comms_templates
  (school_id, org_id, code, channel, language, category, body, status)
VALUES ('53300000-0000-4000-8000-0000000000a1','53300000-0000-4000-8000-0000000000a1',
  'comms033_in_app','in_app','en','utility','{{school}}: {{student}}','approved');

INSERT INTO public.outbound_messages
  (school_id, org_id, recipient_user_id, channel, to_address, template_code, language,
   category, body, status, provider, reference, created_by)
VALUES
  ('53300000-0000-4000-8000-0000000000a1','53300000-0000-4000-8000-0000000000a1',
   'a3300000-0000-4000-8000-000000000002','in_app','a3300000-0000-4000-8000-000000000002',
   'comms033_in_app','en','utility','ORG_A_SHARED_PARENT_MESSAGE','sent_stub','stub','comms033-a','a3300000-0000-4000-8000-000000000001'),
  ('53300000-0000-4000-8000-0000000000b2','53300000-0000-4000-8000-0000000000b2',
   'a3300000-0000-4000-8000-000000000002','in_app','a3300000-0000-4000-8000-000000000002',
   'comms033_in_app','en','utility','ORG_B_SHARED_PARENT_SECRET','sent_stub','stub','comms033-b','b3300000-0000-4000-8000-000000000001');
INSERT INTO public.inbound_messages
  (school_id, org_id, sender_user_id, channel, from_address, body, provider_ref, action)
VALUES ('53300000-0000-4000-8000-0000000000b2','53300000-0000-4000-8000-0000000000b2',
  'a3300000-0000-4000-8000-000000000002','whatsapp','+2349013300002',
  'ORG_B_SHARED_PARENT_INBOUND_SECRET','comms033-inbound-b','logged');

SELECT comms033.login('a3300000-0000-4000-8000-000000000002');
SELECT comms033.count_is('shared guardian sees only org A outbound',
  $$SELECT id FROM public.outbound_messages WHERE recipient_user_id = auth.uid()$$, 1);
SELECT comms033.count_is('shared guardian cannot list org B outbound',
  $$SELECT id FROM public.outbound_messages WHERE body = 'ORG_B_SHARED_PARENT_SECRET'$$, 0);
SELECT comms033.count_is('shared guardian cannot search org B outbound',
  $$SELECT id FROM public.outbound_messages WHERE body ILIKE '%ORG_B_SHARED_PARENT_SECRET%'$$, 0);
SELECT comms033.count_is('shared guardian cannot list or search org B inbound',
  $$SELECT id FROM public.inbound_messages WHERE sender_user_id = auth.uid()
      AND body ILIKE '%ORG_B_SHARED_PARENT_INBOUND_SECRET%'$$, 0);
SELECT comms033.raises('authenticated user cannot call provider inbound router',
  $$SELECT public.comms_route_inbound('+2349015056201','+2349013300002','reply','comms033-forged')$$,
  'permission denied');
SELECT comms033.logout();

SELECT comms033.login('a3300000-0000-4000-8000-000000000001');
SELECT comms033.raises('AI audience cannot draft for a student in org B from org A',
  $$SELECT public.comms_propose_send(
    '53300000-0000-4000-8000-0000000000a1','in_app',
    '{"kind":"guardian_of_student","student_id":"5c330000-0000-4000-8000-0000000000b2"}',
    'comms033_in_app','{"student":"Org B secret"}','en')$$,
  'audience has no verified contacts in this organization');
SELECT comms033.logout();

SELECT comms033.as_service();
SELECT comms033.raises_check('outbox rejects a spoofed phone for the shared parent',
  $$INSERT INTO public.outbound_messages
    (school_id, org_id, recipient_user_id, channel, to_address, template_code, language,
     category, body, status, provider, reference, created_by)
    VALUES ('53300000-0000-4000-8000-0000000000a1','53300000-0000-4000-8000-0000000000a1',
      'a3300000-0000-4000-8000-000000000002','whatsapp','+2349013300001',
      'absence_alert','en','utility','spoofed destination','queued','meta_cloud',
      'comms033-spoof','a3300000-0000-4000-8000-000000000001')$$,
  'outbound address does not match the organization member');
DO $route$
DECLARE v_result jsonb; v_org_choice text;
BEGIN
  v_result := public.comms_route_inbound(
    '+2349015056201','+2349013300002','reply scoped to selected school','comms033-valid-inbound');
  IF v_result->>'action' <> 'select_org' THEN
    RAISE EXCEPTION 'SHERIVS-033 FAIL [shared guardian must choose organization]: %', v_result;
  END IF;
  SELECT array_position(candidate_org_ids, '53300000-0000-4000-8000-0000000000a1'::uuid)::text
    INTO v_org_choice
    FROM public.comms_conversation_context
   WHERE sender_phone = '2349013300002' AND state = 'select_org';
  v_result := public.comms_route_inbound(
    '+2349015056201','+2349013300002',v_org_choice,'comms033-org-choice');
  IF v_result->>'action' <> 'org_selected'
     OR v_result->>'org_id' <> '53300000-0000-4000-8000-0000000000a1' THEN
    RAISE EXCEPTION 'SHERIVS-033 FAIL [shared guardian reply is scoped to selected org A]: %', v_result;
  END IF;
END
$route$;
SELECT comms033.count_is('verified inbound reply is stored only under selected org A',
  $$SELECT id FROM public.inbound_messages WHERE provider_ref = 'comms033-valid-inbound'
      AND org_id = '53300000-0000-4000-8000-0000000000a1'$$, 1);
SELECT comms033.count_is('verified inbound reply is absent from org B',
  $$SELECT id FROM public.inbound_messages WHERE provider_ref = 'comms033-valid-inbound'
      AND org_id = '53300000-0000-4000-8000-0000000000b2'$$, 0);
SELECT comms033.logout();
UPDATE auth.users SET phone = '+2349013300099' WHERE id = 'a3300000-0000-4000-8000-000000000002';
UPDATE public.users SET phone = '+2349013300099' WHERE id = 'a3300000-0000-4000-8000-000000000002';
SELECT comms033.as_service();
DO $stale_context$
DECLARE v_result jsonb;
BEGIN
  v_result := public.comms_route_inbound(
    '+2349015056201','+2349013300002','stale phone reply','comms033-stale-inbound');
  IF v_result->>'action' <> 'support' THEN
    RAISE EXCEPTION 'SHERIVS-033 FAIL [stale phone context fails closed]: %', v_result;
  END IF;
END
$stale_context$;
SELECT comms033.count_is('stale phone cannot append an inbound message',
  $$SELECT id FROM public.inbound_messages WHERE provider_ref = 'comms033-stale-inbound'$$, 0);
SELECT comms033.logout();

ROLLBACK;
DO $$ BEGIN RAISE NOTICE 'SHERIVS-033 COMMUNICATION ISOLATION: ALL PASS'; END $$;
