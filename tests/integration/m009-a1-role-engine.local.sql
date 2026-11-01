-- M009-A1 role engine (LOCAL, DISPOSABLE ONLY).
-- Run only after replaying repository migrations on a loopback disposable DB:
--   psql "postgresql://supabase_admin@127.0.0.1:<port>/postgres" \
--     -v ON_ERROR_STOP=1 -f tests/integration/m009-a1-role-engine.local.sql
-- The transaction is rolled back; no live database is used.
BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'M009-A1: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NOT NULL
     AND NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet)
     AND coalesce(current_setting('m009.allow_non_loopback', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'M009-A1: refusing non-loopback server address %', inet_server_addr();
  END IF;
  IF to_regprocedure('public.workspace_role_assignment_create(uuid,uuid,text,text,text,timestamptz,timestamptz,boolean,uuid,text[],text[])') IS NULL
     OR to_regprocedure('public.workspace_role_sod_assert(uuid,uuid)') IS NULL
     OR to_regclass('public.role_assignment_audit_events') IS NULL THEN
    RAISE EXCEPTION 'M009-A1: role-engine migration is not applied';
  END IF;
END
$guard$;

CREATE SCHEMA m009;
GRANT USAGE ON SCHEMA m009 TO authenticated;

CREATE FUNCTION m009.login(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION m009.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE 'RESET ROLE'; END $$;
CREATE FUNCTION m009.cnt(p_label text, p_sql text, p_expected bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO n;
  IF n IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'M009-A1 FAIL [%]: expected % rows, got %', p_label, p_expected, n;
  END IF;
END $$;
CREATE FUNCTION m009.denied(p_label text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN insufficient_privilege THEN RETURN;
  END;
  RAISE EXCEPTION 'M009-A1 FAIL [%]: statement was allowed but must be denied', p_label;
END $$;
CREATE TABLE m009.assignment_ids (label text PRIMARY KEY, id uuid NOT NULL);
CREATE TABLE m009.responsibility_ids (label text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT, INSERT ON m009.assignment_ids TO authenticated;
GRANT SELECT, INSERT ON m009.responsibility_ids TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA m009 TO authenticated;

INSERT INTO auth.users (id) VALUES
  ('a9000000-0000-4000-8000-000000000001'),
  ('a9000000-0000-4000-8000-000000000002'),
  ('a9000000-0000-4000-8000-000000000003'),
  ('a9000000-0000-4000-8000-000000000004'),
  ('b9000000-0000-4000-8000-000000000001'),
  ('b9000000-0000-4000-8000-000000000002');
INSERT INTO public.schools (id, name, slug) VALUES
  ('59000000-0000-4000-8000-0000000000a1', 'M009 Demo School A', 'm009-demo-school-a'),
  ('59000000-0000-4000-8000-0000000000b2', 'M009 Demo School B', 'm009-demo-school-b');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  ('a9000000-0000-4000-8000-000000000001','59000000-0000-4000-8000-0000000000a1','Demo HR A','m009-hr-a@example.invalid','admin',true),
  ('a9000000-0000-4000-8000-000000000002','59000000-0000-4000-8000-0000000000a1','Demo User A','m009-user-a@example.invalid','teacher',true),
  ('a9000000-0000-4000-8000-000000000003','59000000-0000-4000-8000-0000000000a1','Demo User B','m009-user-b@example.invalid','teacher',true),
  ('a9000000-0000-4000-8000-000000000004','59000000-0000-4000-8000-0000000000a1','Demo SoD User','m009-sod@example.invalid','teacher',true),
  ('b9000000-0000-4000-8000-000000000001','59000000-0000-4000-8000-0000000000b2','Demo HR B','m009-hr-b@example.invalid','admin',true),
  ('b9000000-0000-4000-8000-000000000002','59000000-0000-4000-8000-0000000000b2','Demo User B2','m009-user-b2@example.invalid','teacher',true);

INSERT INTO public.role_templates (code, default_scope, data_sensitivity, approval_limit_ngn, guardrails) VALUES
  ('m009_test_reader','org','internal',NULL,ARRAY['tenant_isolation']::text[]),
  ('m009_test_expired','org','internal',NULL,ARRAY['tenant_isolation']::text[]),
  ('m009_test_finance_create','org','internal',NULL,ARRAY['tenant_isolation']::text[]),
  ('m009_test_finance_approve','org','internal',NULL,ARRAY['tenant_isolation']::text[]),
  ('m009_test_result_entry','org','internal',NULL,ARRAY['tenant_isolation']::text[])
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.role_template_permissions (template_code, permission_code, kind, default_on) VALUES
  ('m009_test_reader','alumni.manage','mandatory',true),
  ('m009_test_expired','alumni.manage','mandatory',true),
  ('m009_test_finance_create','expenses.create','mandatory',true),
  ('m009_test_finance_approve','expenses.approve','mandatory',true),
  ('m009_test_result_entry','grades.enter','mandatory',true)
ON CONFLICT DO NOTHING;
INSERT INTO public.role_catalog (code, name, category, template_code, institution_types)
VALUES
  ('m009_test_reader','M009 Test Reader','test','m009_test_reader','{}'),
  ('m009_test_expired','M009 Test Expired','test','m009_test_expired','{}'),
  ('m009_test_finance_create','M009 Test Finance Create','test','m009_test_finance_create','{}'),
  ('m009_test_finance_approve','M009 Test Finance Approve','test','m009_test_finance_approve','{}'),
  ('m009_test_result_entry','M009 Test Result Entry','test','m009_test_result_entry','{}')
ON CONFLICT (code) DO NOTHING;

-- Assignments are created by an authorized tenant administrator.
SELECT m009.login('a9000000-0000-4000-8000-000000000001');
DO $assignments$
DECLARE v_id uuid;
BEGIN
  v_id := public.workspace_role_assignment_create(
    '59000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-000000000002',
    'ng.principal','institution',NULL,now() - interval '1 minute',NULL,false,NULL,'{}','{}'
  );
  INSERT INTO m009.assignment_ids VALUES ('user-a-head', v_id);
  v_id := public.workspace_role_assignment_create(
    '59000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-000000000002',
    'm009_test_expired','institution',NULL,now() - interval '2 minutes',now() - interval '1 minute',false,NULL,'{}','{}'
  );
  INSERT INTO m009.assignment_ids VALUES ('user-a-expired', v_id);
  v_id := public.workspace_role_assignment_create(
    '59000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-000000000003',
    'm009_test_reader','institution',NULL,now() - interval '1 minute',NULL,false,NULL,'{}','{}'
  );
  INSERT INTO m009.assignment_ids VALUES ('user-b-reader', v_id);
END
$assignments$;
SELECT m009.logout();

SELECT m009.login('b9000000-0000-4000-8000-000000000001');
DO $assignment_b$
DECLARE v_id uuid;
BEGIN
  v_id := public.workspace_role_assignment_create(
    '59000000-0000-4000-8000-0000000000b2','b9000000-0000-4000-8000-000000000002',
    'm009_test_reader','institution',NULL,now() - interval '1 minute',NULL,false,NULL,'{}','{}'
  );
  INSERT INTO m009.assignment_ids VALUES ('foreign-reader', v_id);
END
$assignment_b$;
SELECT m009.logout();

SELECT m009.login('a9000000-0000-4000-8000-000000000002');
SELECT m009.cnt('user sees only their own assignments',
  $$SELECT 1 FROM public.user_role_assignments WHERE org_id='59000000-0000-4000-8000-0000000000a1'$$, 2);
SELECT m009.cnt('user cannot read another tenant assignment',
  $$SELECT 1 FROM public.user_role_assignments WHERE org_id='59000000-0000-4000-8000-0000000000b2'$$, 0);
SELECT m009.cnt('expired role assignment loses permission',
  $$SELECT 1 FROM public.effective_permissions('59000000-0000-4000-8000-0000000000a1',auth.uid()) WHERE permission_code='alumni.manage'$$, 0);
SELECT m009.denied('cross-tenant role assignment is denied',
  $$SELECT public.workspace_role_assignment_create('59000000-0000-4000-8000-0000000000b2','b9000000-0000-4000-8000-000000000002','m009_test_reader','institution',NULL,now(),NULL,false,NULL,'{}','{}')$$);
SELECT m009.logout();

-- A deactivated identity loses its direct effective permissions.
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
UPDATE public.users SET is_active=false WHERE id='a9000000-0000-4000-8000-000000000002';
RESET ROLE;
SELECT m009.login('a9000000-0000-4000-8000-000000000002');
SELECT m009.cnt('deactivated user loses effective permissions',
  $$SELECT 1 FROM public.effective_permissions('59000000-0000-4000-8000-0000000000a1',auth.uid())$$, 0);
SELECT m009.logout();
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
UPDATE public.users SET is_active=true WHERE id='a9000000-0000-4000-8000-000000000002';
RESET ROLE;

-- Hard separation of duties applies across roles, not just within a role.
SELECT m009.login('a9000000-0000-4000-8000-000000000001');
SELECT m009.denied('tenant admin cannot assign a foreign tenant user',
  $$SELECT public.workspace_role_assignment_create('59000000-0000-4000-8000-0000000000a1','b9000000-0000-4000-8000-000000000002','m009_test_reader','institution',NULL,now(),NULL,false,NULL,'{}','{}')$$);
DO $finance_create$
DECLARE v_id uuid;
BEGIN
  v_id := public.workspace_role_assignment_create(
    '59000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-000000000004',
    'm009_test_finance_create','institution',NULL,now() - interval '1 minute',NULL,false,NULL,'{}','{}'
  );
  INSERT INTO m009.assignment_ids VALUES ('sod-finance-create', v_id);
END
$finance_create$;
SELECT m009.denied('same user cannot also receive finance approval',
  $$SELECT public.workspace_role_assignment_create('59000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-000000000004','m009_test_finance_approve','institution',NULL,now() + interval '1 hour',NULL,false,NULL,'{}','{}')$$);
SELECT m009.denied('future result author cannot receive publication approval',
  $$SELECT public.workspace_role_assignment_create('59000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-000000000002','m009_test_result_entry','institution',NULL,now() + interval '1 hour',NULL,false,NULL,'{}','{}')$$);
SELECT m009.denied('unverified authority scopes are denied',
  $$SELECT public.workspace_role_assignment_create('59000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-000000000002','m009_test_reader','authority','unverified',now(),NULL,false,NULL,'{}','{}')$$);
SELECT m009.logout();

-- Responsibility grants expire automatically and revocation immediately removes access.
INSERT INTO public.workspace_responsibility_catalog (
  code, label, kind, daily_priority, primary_nav_id, primary_nav_label
) VALUES (
  'm009_timed_support','M009 Timed Support','add_on',10,'support','Support'
);
INSERT INTO public.workspace_responsibility_permissions (responsibility_id, permission_code)
SELECT id, 'library.circulate' FROM public.workspace_responsibility_catalog WHERE code='m009_timed_support';
SELECT m009.login('a9000000-0000-4000-8000-000000000001');
DO $responsibility$
DECLARE v_responsibility uuid; v_assignment uuid; v_grant uuid;
BEGIN
  v_assignment := (SELECT id FROM m009.assignment_ids WHERE label = 'user-a-head');
  v_responsibility := (SELECT id FROM public.workspace_responsibility_catalog WHERE code='m009_timed_support');
  PERFORM public.workspace_role_responsibility_add(
    '59000000-0000-4000-8000-0000000000a1','ng.principal',v_responsibility
  );
  v_grant := public.workspace_responsibility_grant(
    v_assignment,v_responsibility,now() - interval '1 second',now() + interval '2 seconds'
  );
  INSERT INTO m009.assignment_ids VALUES ('short-grant',v_grant);
  INSERT INTO m009.responsibility_ids VALUES ('timed-support',v_responsibility);
END
$responsibility$;
SELECT m009.logout();

SELECT m009.login('a9000000-0000-4000-8000-000000000002');
SELECT m009.cnt('active add-on grant contributes its permission',
  $$SELECT 1 FROM public.effective_permissions('59000000-0000-4000-8000-0000000000a1',auth.uid()) WHERE permission_code='library.circulate'$$, 1);
SELECT m009.logout();
SELECT pg_sleep(3);
SELECT m009.cnt('expired add-on grant loses permission',
  $$SELECT 1 FROM public.workspace_effective_permission_rows_at(
    '59000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-000000000002',clock_timestamp()
  ) WHERE permission_code='library.circulate'$$, 0);

SELECT m009.login('a9000000-0000-4000-8000-000000000001');
DO $revoke_grant$
DECLARE v_grant uuid; v_assignment uuid; v_responsibility uuid;
BEGIN
  v_assignment := (SELECT id FROM m009.assignment_ids WHERE label='user-a-head');
  v_responsibility := (SELECT id FROM m009.responsibility_ids WHERE label='timed-support');
  v_grant := public.workspace_responsibility_grant(
    v_assignment,v_responsibility,now() - interval '1 minute',now() + interval '10 minutes'
  );
  INSERT INTO m009.assignment_ids VALUES ('revocable-grant',v_grant);
END
$revoke_grant$;
SELECT m009.logout();
SELECT m009.login('a9000000-0000-4000-8000-000000000002');
SELECT m009.cnt('second active grant becomes visible',
  $$SELECT 1 FROM public.effective_permissions('59000000-0000-4000-8000-0000000000a1',auth.uid()) WHERE permission_code='library.circulate'$$, 1);
SELECT m009.logout();
SELECT m009.login('a9000000-0000-4000-8000-000000000001');
SELECT public.workspace_responsibility_revoke((SELECT id FROM m009.assignment_ids WHERE label='revocable-grant'));
SELECT m009.logout();
SELECT m009.cnt('revoked add-on grant loses permission',
  $$SELECT 1 FROM public.workspace_effective_permission_rows_at(
    '59000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-000000000002',clock_timestamp()
  ) WHERE permission_code='library.circulate'$$, 0);

-- Delegation carries the source permission only for its effective window.
SELECT m009.login('a9000000-0000-4000-8000-000000000001');
DO $delegation$
DECLARE v_id uuid;
BEGIN
  v_id := public.workspace_role_delegate(
    (SELECT id FROM m009.assignment_ids WHERE label='user-a-head'),
    'a9000000-0000-4000-8000-000000000003',
    now() - interval '1 minute',now() + interval '10 minutes'
  );
  INSERT INTO m009.assignment_ids VALUES ('delegation',v_id);
END
$delegation$;
SELECT m009.logout();
SELECT m009.login('a9000000-0000-4000-8000-000000000003');
SELECT m009.cnt('delegate receives active permission',
  $$SELECT 1 FROM public.effective_permissions('59000000-0000-4000-8000-0000000000a1',auth.uid()) WHERE permission_code='results.publish'$$, 1);
SELECT m009.logout();
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
UPDATE public.users SET is_active=false WHERE id='a9000000-0000-4000-8000-000000000002';
RESET ROLE;
SELECT m009.login('a9000000-0000-4000-8000-000000000003');
SELECT m009.cnt('deactivated source member loses delegated permissions',
  $$SELECT 1 FROM public.effective_permissions('59000000-0000-4000-8000-0000000000a1',auth.uid()) WHERE permission_code='results.publish'$$, 0);
SELECT m009.logout();
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
UPDATE public.users SET is_active=true WHERE id='a9000000-0000-4000-8000-000000000002';
RESET ROLE;
SELECT m009.login('a9000000-0000-4000-8000-000000000001');
SELECT public.workspace_role_delegation_revoke((SELECT id FROM m009.assignment_ids WHERE label='delegation'));
SELECT m009.logout();
SELECT m009.login('a9000000-0000-4000-8000-000000000003');
SELECT m009.cnt('revoked delegation loses permission',
  $$SELECT 1 FROM public.effective_permissions('59000000-0000-4000-8000-0000000000a1',auth.uid()) WHERE permission_code='results.publish'$$, 0);
SELECT m009.logout();

-- The entry actor is stamped by the database and cannot publish their own result.
INSERT INTO public.students (id, school_id, user_id)
VALUES ('59000000-0000-4000-8000-0000000000c1','59000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-000000000002');
SELECT m009.login('a9000000-0000-4000-8000-000000000001');
INSERT INTO public.grades (school_id, student_id, subject, term, academic_year, teacher_id)
VALUES ('59000000-0000-4000-8000-0000000000a1','59000000-0000-4000-8000-0000000000c1','M009 synthetic subject','M009','2026','a9000000-0000-4000-8000-000000000001');
SELECT m009.denied('same actor cannot publish a result they entered',
  $$UPDATE public.grades SET is_published=true WHERE student_id='59000000-0000-4000-8000-0000000000c1'$$);
SELECT m009.logout();

SELECT m009.login('a9000000-0000-4000-8000-000000000001');
SELECT m009.cnt('assignment changes have an attributed audit event',
  $$SELECT 1 FROM public.role_assignment_audit_events WHERE org_id='59000000-0000-4000-8000-0000000000a1' AND actor_user_id=auth.uid() AND target_user_id='a9000000-0000-4000-8000-000000000002' AND target_type='user_role_assignments'$$, 2);
SELECT m009.cnt('add-on grant and revoke are audited',
  $$SELECT 1 FROM public.role_assignment_audit_events WHERE org_id='59000000-0000-4000-8000-0000000000a1' AND actor_user_id=auth.uid() AND target_user_id='a9000000-0000-4000-8000-000000000002' AND target_type='role_assignment_responsibility_grants'$$, 3);
SELECT m009.denied('audit events cannot be updated',
  $$UPDATE public.role_assignment_audit_events SET action='delete' WHERE org_id='59000000-0000-4000-8000-0000000000a1'$$);
SELECT m009.logout();

SELECT m009.login('a9000000-0000-4000-8000-000000000001');
SELECT public.role_unassign((SELECT id FROM m009.assignment_ids WHERE label='user-a-head'));
SELECT m009.logout();
SELECT m009.login('a9000000-0000-4000-8000-000000000002');
SELECT m009.cnt('revoked role assignment loses permission',
  $$SELECT 1 FROM public.effective_permissions('59000000-0000-4000-8000-0000000000a1',auth.uid()) WHERE permission_code='results.publish'$$, 0);
SELECT m009.logout();

DO $$ BEGIN RAISE NOTICE 'M009-A1 ALL PASS'; END $$;
ROLLBACK;
