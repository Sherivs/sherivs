-- CD-01: an approval can never lift a draft above its autonomy ceiling (ADR-131).
-- Reuses the WF-07 fixtures. Local disposable Postgres only. All synthetic records roll back.

BEGIN;

DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'WF07 FAIL: refusing to run outside the local disposable database';
  END IF;
  IF to_regclass('public.wf_approval_decision') IS NULL
     OR to_regclass('public.wf_approval_step_up') IS NULL
     OR to_regclass('public.wf_approval_policy') IS NULL
     OR to_regprocedure('public.wf_action_draft_ceiling_guard()') IS NULL
     OR to_regprocedure('public.wf_decide_approval(uuid,uuid,text,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'CD01 FAIL: WF-07 and CD-01 must be present';
  END IF;
END $guard$;

CREATE SCHEMA wf07t;
GRANT USAGE ON SCHEMA wf07t TO anon, authenticated, service_role;
CREATE TABLE wf07t.passed (n serial PRIMARY KEY, label text NOT NULL);
CREATE TABLE wf07t.ids (name text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT, INSERT, UPDATE ON wf07t.passed, wf07t.ids TO anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE wf07t.passed_n_seq TO anon, authenticated, service_role;
CREATE FUNCTION wf07t.pass(p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO wf07t.passed (label) VALUES (p_label);
  RAISE NOTICE 'WF07 PASS %', p_label;
END $$;
CREATE FUNCTION wf07t.expect_true(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'WF07 FAIL [%]', p_label; END IF;
  PERFORM wf07t.pass(p_label);
END $$;
CREATE FUNCTION wf07t.expect_error(p_label text, p_sql text, p_state text, p_msg text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state AND (p_msg IS NULL OR SQLERRM LIKE '%' || p_msg || '%') THEN
      PERFORM wf07t.pass(p_label);
      RETURN;
    END IF;
    RAISE EXCEPTION 'WF07 FAIL [%]: expected SQLSTATE % (%) got % (%)', p_label, p_state, p_msg, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'WF07 FAIL [%]: statement was allowed', p_label;
END $$;
CREATE FUNCTION wf07t.id(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM wf07t.ids WHERE name = p_name
$$;
CREATE FUNCTION wf07t.keep(p_name text, p_id uuid) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO wf07t.ids VALUES (p_name, p_id) ON CONFLICT (name) DO UPDATE SET id = EXCLUDED.id;
  RETURN p_id;
END $$;
CREATE FUNCTION wf07t.login(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION wf07t.login_as(p_role text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
END $$;
CREATE FUNCTION wf07t.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wf07t TO anon, authenticated, service_role;

INSERT INTO wf07t.ids (name, id) VALUES
  ('orgA', 'f0700000-0000-4000-8000-0000000000a1'),
  ('orgB', 'f0700000-0000-4000-8000-0000000000b2'),
  ('starter', 'f0700000-0000-4000-8000-000000000001'),
  ('author', 'f0700000-0000-4000-8000-000000000002'),
  ('publisher', 'f0700000-0000-4000-8000-000000000003'),
  ('ap1', 'f0700000-0000-4000-8000-000000000004'),
  ('ap2', 'f0700000-0000-4000-8000-000000000005'),
  ('ap3', 'f0700000-0000-4000-8000-000000000006'),
  ('bp1', 'f0700000-0000-4000-8000-000000000007'),
  ('bhead', 'f0700000-0000-4000-8000-000000000008'),
  ('teacher', 'f0700000-0000-4000-8000-000000000009');

-- ---------------------------------------------------------------------------------------------
-- 1. Structure, privileges and function hygiene
-- ---------------------------------------------------------------------------------------------
SELECT wf07t.expect_true('WF-07 stores force RLS',
  (SELECT count(*) = 3 FROM pg_class WHERE oid = ANY(ARRAY[
    'public.wf_approval_policy'::regclass, 'public.wf_approval_step_up'::regclass,
    'public.wf_approval_decision'::regclass])
    AND relrowsecurity AND relforcerowsecurity));
SELECT wf07t.expect_true('decisions and step-up evidence are written only by the definer functions',
  NOT has_table_privilege('service_role', 'public.wf_approval_decision', 'INSERT')
  AND NOT has_table_privilege('service_role', 'public.wf_approval_decision', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.wf_approval_decision', 'DELETE')
  AND NOT has_table_privilege('service_role', 'public.wf_approval_step_up', 'INSERT')
  AND NOT has_table_privilege('service_role', 'public.wf_approval_step_up', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.wf_approval_decision', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.wf_approval_step_up', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.wf_approval_decision', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.wf_approval_policy', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.wf_approval_policy', 'INSERT')
  AND has_table_privilege('authenticated', 'public.wf_approval_decision', 'SELECT'));
SELECT wf07t.expect_true('decision functions execute for the service role only',
  (SELECT bool_and(
      has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
     FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('wf_decide_approval', 'wf_record_step_up', 'wf_approval_view', 'wf_inbox_list',
                        'wf_request_draft_approval', 'wf_request_missing_draft_approvals',
                        'wf_audit_step_up_failed', 'wf_expire_approvals', 'wf_approved_drafts_ready',
                        'wf_resume_after_dispatch', 'wf_approver_candidates'))
  AND (SELECT count(*) = 11 FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname IN ('wf_decide_approval', 'wf_record_step_up', 'wf_approval_view', 'wf_inbox_list',
                            'wf_request_draft_approval', 'wf_request_missing_draft_approvals',
                            'wf_audit_step_up_failed', 'wf_expire_approvals', 'wf_approved_drafts_ready',
                            'wf_resume_after_dispatch', 'wf_approver_candidates')));
SELECT wf07t.expect_true('internal helpers and trigger functions execute for no client role',
  (SELECT bool_and(
      NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
     FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('wf_act_as', 'wf_act_restore', 'wf_decision_blockers', 'wf_approval_content_digest',
                        'wf_approval_category', 'wf_draft_template_sha', 'wf_draft_approval_gap',
                        'wf_approval_required_count', 'wf_is_capped_category', 'wf_end_run_for_approval',
                        'wf_action_draft_freeze', 'wf_action_draft_approval_guard',
                        'wf_action_sandbox_outbox_draft_guard', 'wf_approval_decision_gate',
                        'wf_approval_risk_floor', 'wf_run_close_approvals', 'wf_approval_step_up_guard',
                        'wf_approval_decision_guard', 'wf_approval_policy_guard'))
  AND NOT has_function_privilege('service_role', 'public.wf_action_sandbox_outbox_guard()', 'EXECUTE'));
SELECT wf07t.expect_true('every WF-07 function pins an empty search_path',
  (SELECT bool_and(p.proconfig @> ARRAY['search_path=""']) FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND (p.proname LIKE 'wf_approval_%' OR p.proname LIKE 'wf_draft_%' OR p.proname IN (
        'wf_decide_approval', 'wf_record_step_up', 'wf_inbox_list', 'wf_act_as', 'wf_act_restore',
        'wf_decision_blockers', 'wf_request_draft_approval', 'wf_request_missing_draft_approvals',
        'wf_audit_step_up_failed', 'wf_expire_approvals', 'wf_approved_drafts_ready',
        'wf_resume_after_dispatch', 'wf_approver_candidates', 'wf_end_run_for_approval',
        'wf_run_close_approvals', 'wf_is_capped_category', 'wf_action_draft_freeze',
        'wf_action_draft_approval_guard', 'wf_action_sandbox_outbox_draft_guard'))));
SELECT wf07t.expect_true('N1 freeze trigger is SECURITY INVOKER with an empty search_path',
  (SELECT NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
     FROM pg_proc p WHERE p.proname = 'wf_action_draft_freeze' AND p.pronamespace = 'public'::regnamespace)
  AND EXISTS (SELECT 1 FROM pg_trigger t
               WHERE t.tgrelid = 'public.wf_action_draft'::regclass AND t.tgname = 'wf_action_draft_10_freeze'
                 AND t.tgtype & 2 = 2 AND t.tgtype & 16 = 16));
SELECT wf07t.expect_true('required approver counts default to 1 normal, 1 high, 2 for money, safeguarding and mass',
  public.wf_approval_required_count('f0700000-0000-4000-8000-0000000000a1', 'normal', 'communication') = 1
  AND public.wf_approval_required_count('f0700000-0000-4000-8000-0000000000a1', 'high', 'credential_change') = 1
  AND public.wf_approval_required_count('f0700000-0000-4000-8000-0000000000a1', 'high', 'money_movement') = 2
  AND public.wf_approval_required_count('f0700000-0000-4000-8000-0000000000a1', 'high', 'safeguarding') = 2
  AND public.wf_approval_required_count('f0700000-0000-4000-8000-0000000000a1', 'high', 'mass_message') = 2);

-- ---------------------------------------------------------------------------------------------
-- 2. Fixtures: two organizations, approvers, an author, a starter, runs and drafts
-- ---------------------------------------------------------------------------------------------
INSERT INTO auth.users (id) SELECT id FROM wf07t.ids WHERE name NOT IN ('orgA', 'orgB');
INSERT INTO public.schools (id, name, slug) VALUES
  (wf07t.id('orgA'), 'WF07 Org A', 'wf07-org-a'),
  (wf07t.id('orgB'), 'WF07 Org B', 'wf07-org-b');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  (wf07t.id('starter'), wf07t.id('orgA'), 'WF07 Starter', 'starter@wf07.invalid', 'admin', true),
  (wf07t.id('author'), wf07t.id('orgA'), 'WF07 Author', 'author@wf07.invalid', 'admin', true),
  (wf07t.id('publisher'), wf07t.id('orgA'), 'WF07 Publisher', 'publisher@wf07.invalid', 'admin', true),
  (wf07t.id('ap1'), wf07t.id('orgA'), 'WF07 Approver One', 'ap1@wf07.invalid', 'teacher', true),
  (wf07t.id('ap2'), wf07t.id('orgA'), 'WF07 Approver Two', 'ap2@wf07.invalid', 'teacher', true),
  (wf07t.id('ap3'), wf07t.id('orgA'), 'WF07 Approver Three', 'ap3@wf07.invalid', 'teacher', true),
  (wf07t.id('bp1'), wf07t.id('orgB'), 'WF07 Approver B', 'bp1@wf07.invalid', 'teacher', true),
  (wf07t.id('bhead'), wf07t.id('orgB'), 'WF07 Head B', 'bhead@wf07.invalid', 'admin', true),
  (wf07t.id('teacher'), wf07t.id('orgA'), 'WF07 Classroom', 'teacher@wf07.invalid', 'teacher', true);

SELECT set_config('request.jwt.claim.sub', wf07t.id('author')::text, true);
SELECT set_config('request.jwt.claims', json_build_object('sub', wf07t.id('author'), 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
INSERT INTO public.user_role_assignments (org_id, user_id, role_code, scope_type, scope_ref, assigned_by)
SELECT u.org_id, u.user_id, r.code,
       CASE WHEN u.template_code IN ('teacher', 'parent') THEN 'self' ELSE t.default_scope END,
       CASE WHEN u.template_code IN ('teacher', 'parent') THEN u.user_id::text END,
       u.assigned_by
  FROM (VALUES
    (wf07t.id('orgA'), wf07t.id('starter'), wf07t.id('author'), 'head_of_institution'),
    (wf07t.id('orgA'), wf07t.id('author'), wf07t.id('starter'), 'head_of_institution'),
    (wf07t.id('orgA'), wf07t.id('publisher'), wf07t.id('starter'), 'head_of_institution'),
    (wf07t.id('orgA'), wf07t.id('ap1'), wf07t.id('starter'), 'auditor'),
    (wf07t.id('orgA'), wf07t.id('ap2'), wf07t.id('starter'), 'auditor'),
    (wf07t.id('orgA'), wf07t.id('ap3'), wf07t.id('starter'), 'auditor'),
    (wf07t.id('orgA'), wf07t.id('teacher'), wf07t.id('starter'), 'teacher'),
    (wf07t.id('orgB'), wf07t.id('bhead'), wf07t.id('author'), 'head_of_institution'),
    (wf07t.id('orgB'), wf07t.id('bp1'), wf07t.id('author'), 'auditor')
  ) u(org_id, user_id, assigned_by, template_code)
  JOIN public.role_catalog r ON r.template_code = u.template_code AND r.org_id IS NULL
   AND NOT coalesce(r.requires_verified_authority_link, false)
  JOIN public.role_templates t ON t.code = r.template_code
 WHERE r.code = (
   SELECT min(r2.code) FROM public.role_catalog r2
    WHERE r2.template_code = u.template_code AND r2.org_id IS NULL
      AND NOT coalesce(r2.requires_verified_authority_link, false)
 );
SELECT wf07t.logout();

INSERT INTO public.wf_org_settings (org_id, workflows_enabled, autonomy_ceiling) VALUES
  (wf07t.id('orgA'), true, 'act_and_report'),
  (wf07t.id('orgB'), true, 'act_and_report');
INSERT INTO public.wf_agent_autonomy (org_id, agent_ref, earned_level) VALUES
  (wf07t.id('orgA'), 'wf07-agent', 'act_and_report'),
  (wf07t.id('orgB'), 'wf07-agent', 'act_and_report');
INSERT INTO public.wf_definition (id, org_id, key, name) VALUES
  ('f0710000-0000-4000-8000-0000000000a1', wf07t.id('orgA'), 'wf07-a', 'WF07 A'),
  ('f0710000-0000-4000-8000-0000000000a2', wf07t.id('orgA'), 'wf07-a-author-ap3', 'WF07 A2'),
  ('f0710000-0000-4000-8000-0000000000b2', wf07t.id('orgB'), 'wf07-b', 'WF07 B');
INSERT INTO public.wf_version (id, org_id, definition_id, version, graph, created_by) VALUES
  ('f0720000-0000-4000-8000-0000000000a1', wf07t.id('orgA'), 'f0710000-0000-4000-8000-0000000000a1', 1, '{"steps":[]}', wf07t.id('author')),
  ('f0720000-0000-4000-8000-0000000000a2', wf07t.id('orgA'), 'f0710000-0000-4000-8000-0000000000a2', 1, '{"steps":[]}', wf07t.id('ap3')),
  ('f0720000-0000-4000-8000-0000000000b2', wf07t.id('orgB'), 'f0710000-0000-4000-8000-0000000000b2', 1, '{"steps":[]}', wf07t.id('bhead'));
UPDATE public.wf_version SET state = 'published', published_by = wf07t.id('publisher')
 WHERE id IN ('f0720000-0000-4000-8000-0000000000a1', 'f0720000-0000-4000-8000-0000000000a2');
UPDATE public.wf_version SET state = 'published', published_by = wf07t.id('publisher')
 WHERE id = 'f0720000-0000-4000-8000-0000000000b2';
SELECT wf07t.keep('verA', 'f0720000-0000-4000-8000-0000000000a1');
SELECT wf07t.keep('verAP3', 'f0720000-0000-4000-8000-0000000000a2');
SELECT wf07t.keep('verB', 'f0720000-0000-4000-8000-0000000000b2');

-- CD-01: a run's autonomy comes from its template; a template-less run is advice only (suggest).
-- The fixtures therefore run under a template that allows approval-gated action.
INSERT INTO public.wf_template (template_key, version, name, description, graph, autonomy_max)
VALUES ('wf07-fixture', 1, 'WF07 fixture', 'Fixture template for the approval harness.',
  '{"steps":[]}', 'act_and_report');
CREATE FUNCTION wf07t.mkrun(p_name text, p_version text, p_started_by text, p_agent text DEFAULT 'wf07-agent')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid(); v_ver public.wf_version%ROWTYPE;
BEGIN
  SELECT * INTO v_ver FROM public.wf_version WHERE id = wf07t.id(p_version);
  INSERT INTO public.wf_run (id, org_id, definition_id, version_id, idempotency_key, status, max_depth,
    max_steps, started_by, deadline_at, started_at, agent_ref, template_id)
  VALUES (v_id, v_ver.org_id, v_ver.definition_id, v_ver.id, 'wf07-run-' || p_name, 'running', 2, 20,
    CASE WHEN p_started_by IS NULL THEN NULL ELSE wf07t.id(p_started_by) END,
    now() + interval '1 hour', now(), p_agent,
    (SELECT id FROM public.wf_template WHERE template_key = 'wf07-fixture' AND version = 1));
  RETURN wf07t.keep('run_' || p_name, v_id);
END $$;
CREATE FUNCTION wf07t.mkstep(p_name text, p_run text, p_class text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid(); v_run public.wf_run%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.wf_run WHERE id = wf07t.id('run_' || p_run);
  INSERT INTO public.wf_step_run (id, org_id, run_id, step_key, kind, idempotency_key, action_class,
    autonomy_level, agent_ref, status, resume_at)
  VALUES (v_id, v_run.org_id, v_run.id, 'wf07-' || p_name, 'action', 'wf07-step-' || p_name, p_class,
    'act_and_report', 'wf07-agent', 'waiting', now() + interval '7 days');
  RETURN wf07t.keep('step_' || p_name, v_id);
END $$;
CREATE FUNCTION wf07t.rids(p_n integer) RETURNS uuid[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(('f0790000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid), '{}')
    FROM generate_series(1, p_n) g
$$;
CREATE FUNCTION wf07t.mkdraft(p_name text, p_run text, p_kind text, p_category text, p_template text,
  p_recipients integer DEFAULT 1, p_audience text DEFAULT NULL, p_data_class text DEFAULT 'internal',
  p_params jsonb DEFAULT '{}') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid(); v_run public.wf_run%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.wf_run WHERE id = wf07t.id('run_' || p_run);
  INSERT INTO public.wf_action_draft (id, org_id, run_id, step_run_id, kind, category, template_ref,
    template_params, recipient_ids, audience_selector, data_class, idempotency_key)
  VALUES (v_id, v_run.org_id, v_run.id, wf07t.id('step_' || p_name), p_kind, p_category, p_template,
    p_params, wf07t.rids(p_recipients), p_audience, p_data_class, 'wf07-draft-' || p_name);
  RETURN wf07t.keep('draft_' || p_name, v_id);
END $$;

CREATE FUNCTION wf07t.try_update(p_set text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE 'UPDATE public.wf_action_draft SET ' || p_set || ' WHERE id = wf07t.id(''draft_rj'')';
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN true;
  END;
  RETURN false;
END $$;
GRANT EXECUTE ON FUNCTION wf07t.try_update(text) TO anon, authenticated, service_role;

INSERT INTO public.wf_action_template (org_id, kind, template_ref, body_template, parameter_keys, status) VALUES
  (wf07t.id('orgA'), 'in_app', 'notice.a', 'Hello {{name}}, please review the notice.', ARRAY['name'], 'approved'),
  (wf07t.id('orgB'), 'in_app', 'notice.a', 'Hello {{name}}, org B text.', ARRAY['name'], 'approved');
INSERT INTO public.wf_action_template (org_id, kind, template_ref, body_template, parameter_keys, status)
VALUES (wf07t.id('orgA'), 'in_app', 'notice.dg', 'Digest fixture text.', ARRAY[]::text[], 'approved');

-- Scenarios (each has its own run so a rejection or an expiry never disturbs another):
--   m  money, two approvers      c   communication, one approver      rq  starter is an approver
--   au version author approves   rj  reject                             ex  expiry
--   rc run closes                cp  capped draft, normal approval      ms  26-recipient mass SMS, agent run
--   tm  template missing         cr  credential change (one approver)  ob  org B
--   dg  digest binding on an in-app template
SELECT wf07t.mkrun('m', 'verA', 'starter');
SELECT wf07t.mkrun('c', 'verA', 'starter');
SELECT wf07t.mkrun('rq', 'verA', 'ap2');
SELECT wf07t.mkrun('au', 'verAP3', 'starter');
SELECT wf07t.mkrun('rj', 'verA', 'starter');
SELECT wf07t.mkrun('ex', 'verA', 'starter');
SELECT wf07t.mkrun('rc', 'verA', 'starter');
SELECT wf07t.mkrun('cp', 'verA', 'starter');
SELECT wf07t.mkrun('ms', 'verA', NULL);
SELECT wf07t.mkrun('tm', 'verA', 'starter');
SELECT wf07t.mkrun('cr', 'verA', 'starter');
SELECT wf07t.mkrun('ob', 'verB', 'bhead');
SELECT wf07t.mkrun('dg', 'verA', 'starter');
SELECT wf07t.mkstep('m', 'm', 'money_movement');
SELECT wf07t.mkstep('c', 'c', 'communication');
SELECT wf07t.mkstep('rq', 'rq', 'communication');
SELECT wf07t.mkstep('au', 'au', 'communication');
SELECT wf07t.mkstep('rj', 'rj', 'safeguarding');
SELECT wf07t.mkstep('ex', 'ex', 'communication');
SELECT wf07t.mkstep('rc', 'rc', 'communication');
SELECT wf07t.mkstep('cp', 'cp', 'money_movement');
SELECT wf07t.mkstep('ms', 'ms', 'mass_message');
SELECT wf07t.mkstep('tm', 'tm', 'communication');
SELECT wf07t.mkstep('cr', 'cr', 'credential_change');
SELECT wf07t.mkstep('ob', 'ob', 'communication');
SELECT wf07t.mkstep('dg', 'dg', 'safeguarding');
SELECT wf07t.mkdraft('m', 'm', 'in_app', 'money_movement', 'notice.a', 1, NULL, 'internal', '{"name":"Ada"}');
SELECT wf07t.mkdraft('c', 'c', 'in_app', 'communication', 'notice.a', 1, NULL, 'internal', '{"name":"Bola"}');
SELECT wf07t.mkdraft('rq', 'rq', 'in_app', 'communication', 'notice.a');
SELECT wf07t.mkdraft('au', 'au', 'in_app', 'communication', 'notice.a');
SELECT wf07t.mkdraft('rj', 'rj', 'in_app', 'safeguarding', 'notice.a');
SELECT wf07t.mkdraft('ex', 'ex', 'in_app', 'communication', 'notice.a');
SELECT wf07t.mkdraft('rc', 'rc', 'in_app', 'communication', 'notice.a');
SELECT wf07t.mkdraft('cp', 'cp', 'in_app', 'money_movement', 'notice.a');
SELECT wf07t.mkdraft('ms', 'ms', 'sms', 'mass_message', 'attendance.notice', 26, NULL, 'minor_sensitive');
SELECT wf07t.mkdraft('tm', 'tm', 'in_app', 'communication', 'missing.tpl');
SELECT wf07t.mkdraft('cr', 'cr', 'in_app', 'credential_change', 'notice.a');
SELECT wf07t.mkdraft('ob', 'ob', 'in_app', 'communication', 'notice.a');
SELECT wf07t.mkdraft('dg', 'dg', 'in_app', 'safeguarding', 'notice.dg');

CREATE FUNCTION wf07t.vote(p_actor text, p_approval text, p_decision text DEFAULT 'approve',
  p_step_up boolean DEFAULT true, p_note text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_view jsonb; v_su uuid;
BEGIN
  v_view := public.wf_approval_view(wf07t.id(p_actor), wf07t.id(p_approval));
  IF p_step_up AND p_decision = 'approve' AND (v_view ->> 'step_up_required')::boolean THEN
    v_su := (public.wf_record_step_up(wf07t.id(p_actor), wf07t.id(p_approval), v_view ->> 'digest') ->> 'step_up_id')::uuid;
  END IF;
  RETURN public.wf_decide_approval(wf07t.id(p_actor), wf07t.id(p_approval), p_decision, p_note,
    v_view ->> 'digest', v_su);
END $$;
CREATE FUNCTION wf07t.digest(p_actor text, p_approval text) RETURNS text LANGUAGE sql AS $$
  SELECT public.wf_approval_view(wf07t.id(p_actor), wf07t.id(p_approval)) ->> 'digest'
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wf07t TO anon, authenticated, service_role;


-- ---------------------------------------------------------------------------------------------
-- CD-01 checks. Agents: cd01-low earns suggest, cd01-mid earns draft. The template allows more,
-- so the agent's earned level is the binding ceiling.
-- ---------------------------------------------------------------------------------------------
INSERT INTO public.wf_agent_autonomy (org_id, agent_ref, earned_level) VALUES
  (wf07t.id('orgA'), 'cd01-low', 'suggest'),
  (wf07t.id('orgA'), 'cd01-mid', 'draft');
INSERT INTO public.wf_org_settings (org_id, workflows_enabled, autonomy_ceiling)
  VALUES (wf07t.id('orgA'), true, 'act_and_report')
  ON CONFLICT (org_id) DO NOTHING;
SELECT wf07t.mkrun('lo', 'verA', 'starter', 'cd01-low');
SELECT wf07t.mkrun('md', 'verA', 'starter', 'cd01-mid');
SELECT wf07t.mkrun('hi', 'verA', 'starter');
CREATE FUNCTION wf07t.mkstep_as(p_name text, p_run text, p_class text, p_agent text) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid(); v_run public.wf_run%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.wf_run WHERE id = wf07t.id('run_' || p_run);
  INSERT INTO public.wf_step_run (id, org_id, run_id, step_key, kind, idempotency_key, action_class,
    autonomy_level, agent_ref, status, resume_at)
  VALUES (v_id, v_run.org_id, v_run.id, 'cd01-' || p_name, 'action', 'cd01-step-' || p_name, p_class,
    'act_and_report', p_agent, 'waiting', now() + interval '7 days');
  RETURN wf07t.keep('step_' || p_name, v_id);
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wf07t TO anon, authenticated, service_role;
SELECT wf07t.mkstep_as('lo', 'lo', 'communication', 'cd01-low');
SELECT wf07t.mkstep_as('md', 'md', 'communication', 'cd01-mid');
SELECT wf07t.mkstep_as('hi', 'hi', 'communication', 'wf07-agent');
SELECT wf07t.mkdraft('lo', 'lo', 'in_app', 'communication', 'notice.a', 1, NULL, 'internal', '{"name":"Low"}');
SELECT wf07t.mkdraft('md', 'md', 'in_app', 'communication', 'notice.a', 1, NULL, 'internal', '{"name":"Mid"}');
SELECT wf07t.mkdraft('hi', 'hi', 'in_app', 'communication', 'notice.a', 1, NULL, 'internal', '{"name":"High"}');

SELECT wf07t.expect_true('fixture levels: low agent is suggest, mid agent is draft, high agent acts',
  (SELECT autonomy_level = 'suggest' FROM public.wf_step_run WHERE id = wf07t.id('step_lo'))
  AND (SELECT autonomy_level = 'draft' FROM public.wf_step_run WHERE id = wf07t.id('step_md'))
  AND (SELECT autonomy_level = 'act_and_report' FROM public.wf_step_run WHERE id = wf07t.id('step_hi')));

SELECT wf07t.login_as('service_role');
SELECT wf07t.keep('apr_lo', public.wf_request_draft_approval(wf07t.id('orgA'), wf07t.id('draft_lo')));
SELECT wf07t.keep('apr_md', public.wf_request_draft_approval(wf07t.id('orgA'), wf07t.id('draft_md')));
SELECT wf07t.keep('apr_hi', public.wf_request_draft_approval(wf07t.id('orgA'), wf07t.id('draft_hi')));
SELECT wf07t.logout();

-- 1. The decision path refuses a suggest-level draft, and leaves everything as it was.
SELECT wf07t.login_as('service_role');
SELECT wf07t.expect_error('a human approval cannot approve a suggest-level draft',
  $q$SELECT wf07t.vote('ap1', 'apr_lo', 'approve', false)$q$, '42501', 'wf07:ceiling_suggest');
SELECT wf07t.logout();
SELECT wf07t.expect_true('the refused approval changes nothing: approval pending, draft still draft, no vote kept',
  (SELECT status = 'pending' FROM public.wf_approval WHERE id = wf07t.id('apr_lo'))
  AND (SELECT status = 'draft' FROM public.wf_action_draft WHERE id = wf07t.id('draft_lo'))
  AND NOT EXISTS (SELECT 1 FROM public.wf_approval_decision WHERE approval_id = wf07t.id('apr_lo')));

-- 2. No other route works either: a direct status change is refused (WF-07's own guard fires first).
SELECT wf07t.login_as('service_role');
SELECT wf07t.expect_error('direct update to approved on a suggest-level draft is refused (existing approval guard)',
  $q$UPDATE public.wf_action_draft SET status = 'approved' WHERE id = wf07t.id('draft_lo')$q$, '23514');
SELECT wf07t.logout();

-- 3. Within the ceiling, approval still works: a draft-level agent and an acting agent are approvable.
SELECT wf07t.login_as('service_role');
SELECT (wf07t.vote('ap1', 'apr_md', 'approve', false) ->> 'status') AS mid_status \gset
SELECT (wf07t.vote('ap1', 'apr_hi', 'approve', false) ->> 'status') AS hi_status \gset
SELECT wf07t.logout();
SELECT wf07t.expect_true('approval within the ceiling still works (draft-level and acting agents)',
  :'mid_status' = 'approved' AND :'hi_status' = 'approved'
  AND (SELECT status = 'approved' FROM public.wf_action_draft WHERE id = wf07t.id('draft_md'))
  AND (SELECT status = 'approved' FROM public.wf_action_draft WHERE id = wf07t.id('draft_hi')));

-- 4. Rejecting a suggest-level draft is still possible, and expiry still works.
SELECT wf07t.login_as('service_role');
SELECT (wf07t.vote('ap1', 'apr_lo', 'reject', false, 'advice only') ->> 'status') AS rej_status \gset
SELECT wf07t.logout();
SELECT wf07t.expect_true('a suggest-level draft can still be rejected',
  :'rej_status' = 'rejected'
  AND (SELECT status = 'rejected' FROM public.wf_action_draft WHERE id = wf07t.id('draft_lo')));

-- 5. Hygiene: the guard function is not callable by any API role.
SELECT wf07t.expect_true('the guard function has no EXECUTE for API roles',
  NOT has_function_privilege('anon', 'public.wf_action_draft_ceiling_guard()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.wf_action_draft_ceiling_guard()', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.wf_action_draft_ceiling_guard()', 'EXECUTE'));
SELECT wf07t.expect_true('the guard runs with an empty search_path as SECURITY DEFINER',
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc
    WHERE oid = 'public.wf_action_draft_ceiling_guard()'::regprocedure));

DO $summary$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM wf07t.passed;
  IF v_count < 8 THEN RAISE EXCEPTION 'CD01 FAIL: expected at least 8 checks, got %', v_count; END IF;
  RAISE NOTICE 'CD01 ALL PASS: % checks', v_count;
END $summary$;

ROLLBACK;
