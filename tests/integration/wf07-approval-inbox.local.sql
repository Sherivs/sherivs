-- WF-07 approval inbox: per-approver decisions, passkey step-up evidence, two-person rule,
-- draft immutability (N1), the approved-draft outbox link and the service-only decision path.
-- Local disposable Postgres only. All synthetic records roll back.
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
     OR to_regprocedure('public.wf_decide_approval(uuid,uuid,text,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'WF07 FAIL: WF-07 migration must be present';
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

CREATE FUNCTION wf07t.mkrun(p_name text, p_version text, p_started_by text, p_agent text DEFAULT 'wf07-agent')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid(); v_ver public.wf_version%ROWTYPE;
BEGIN
  SELECT * INTO v_ver FROM public.wf_version WHERE id = wf07t.id(p_version);
  INSERT INTO public.wf_run (id, org_id, definition_id, version_id, idempotency_key, status, max_depth,
    max_steps, started_by, deadline_at, started_at, agent_ref)
  VALUES (v_id, v_ver.org_id, v_ver.definition_id, v_ver.id, 'wf07-run-' || p_name, 'running', 2, 20,
    CASE WHEN p_started_by IS NULL THEN NULL ELSE wf07t.id(p_started_by) END,
    now() + interval '1 hour', now(), p_agent);
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
-- 3. Per-organization policy: service role writes, members read, every change is audited
-- ---------------------------------------------------------------------------------------------
SELECT wf07t.login(wf07t.id('author'));
SELECT wf07t.expect_error('a client cannot change approval policy',
  $q$INSERT INTO public.wf_approval_policy (org_id, two_person_required) VALUES (wf07t.id('orgA'), 2)$q$,
  '42501');
SELECT wf07t.logout();
INSERT INTO public.wf_approval_policy (org_id, two_person_required) VALUES (wf07t.id('orgA'), 3);
SELECT wf07t.expect_true('a per-organization policy overrides the default and is audited',
  public.wf_approval_required_count(wf07t.id('orgA'), 'high', 'money_movement') = 3
  AND public.wf_approval_required_count(wf07t.id('orgB'), 'high', 'money_movement') = 2
  AND EXISTS (SELECT 1 FROM public.audit_chain
               WHERE org_id = wf07t.id('orgA') AND action = 'workflow.wf_approval_policy.changed'));
SELECT wf07t.expect_error('two-person policy cannot be set below two',
  $q$UPDATE public.wf_approval_policy SET two_person_required = 1 WHERE org_id = wf07t.id('orgA')$q$, '23514');
SELECT wf07t.expect_error('policy categories are limited to the protected set',
  $q$UPDATE public.wf_approval_policy SET two_person_categories = ARRAY['communication']
      WHERE org_id = wf07t.id('orgA')$q$, '23514');
SELECT wf07t.expect_error('money movement and safeguarding cannot be removed from the two-person list',
  $q$UPDATE public.wf_approval_policy SET two_person_categories = ARRAY['mass_message']
      WHERE org_id = wf07t.id('orgA')$q$, '23514');
SELECT wf07t.expect_error('an empty two-person list is refused',
  $q$UPDATE public.wf_approval_policy SET two_person_categories = '{}'::text[]
      WHERE org_id = wf07t.id('orgA')$q$, '23514');
UPDATE public.wf_approval_policy
   SET two_person_required = 2,
       two_person_categories = ARRAY['money_movement', 'safeguarding', 'mass_message', 'credential_change']
 WHERE org_id = wf07t.id('orgA');
SELECT wf07t.expect_true('an organization may add a category to the two-person list',
  public.wf_approval_required_count(wf07t.id('orgA'), 'high', 'credential_change') = 2
  AND public.wf_approval_required_count(wf07t.id('orgB'), 'high', 'credential_change') = 1);
UPDATE public.wf_approval_policy
   SET two_person_categories = ARRAY['money_movement', 'safeguarding', 'mass_message']
 WHERE org_id = wf07t.id('orgA');
SELECT wf07t.expect_true('policy defaults are restored to two approvers',
  public.wf_approval_required_count(wf07t.id('orgA'), 'high', 'money_movement') = 2);

-- ---------------------------------------------------------------------------------------------
-- 4. Draft immutability (N1) and the capped-draft approval rule
-- ---------------------------------------------------------------------------------------------
SELECT wf07t.expect_error('N1: a drafted safeguarding action cannot be relabelled and approved by the service role',
  $q$UPDATE public.wf_action_draft SET category = 'communication', status = 'approved'
      WHERE id = wf07t.id('draft_rj')$q$, '42501', 'immutable');
SELECT wf07t.expect_true('N1: every frozen draft column is refused one by one',
  (SELECT bool_and(refused) FROM (
    SELECT wf07t.try_update($u$kind = 'sms'$u$) AS refused UNION ALL
    SELECT wf07t.try_update($u$category = 'communication'$u$) UNION ALL
    SELECT wf07t.try_update($u$template_ref = 'other.ref'$u$) UNION ALL
    SELECT wf07t.try_update($u$template_params = '{"name":"Eve"}'$u$) UNION ALL
    SELECT wf07t.try_update($u$recipient_ids = ARRAY[gen_random_uuid()]$u$) UNION ALL
    SELECT wf07t.try_update($u$audience_selector = 'all_staff'$u$) UNION ALL
    SELECT wf07t.try_update($u$data_class = 'public'$u$) UNION ALL
    SELECT wf07t.try_update($u$idempotency_key = 'wf07-relabelled-key'$u$) UNION ALL
    SELECT wf07t.try_update($u$run_id = wf07t.id('run_c')$u$) UNION ALL
    SELECT wf07t.try_update($u$step_run_id = wf07t.id('step_c')$u$) UNION ALL
    SELECT wf07t.try_update($u$created_at = now() - interval '1 day'$u$)
  ) q));
SELECT wf07t.expect_error('a draft cannot be approved without an approval',
  $q$UPDATE public.wf_action_draft SET status = 'approved' WHERE id = wf07t.id('draft_c')$q$, '23514');
SELECT wf07t.expect_error('a new draft cannot arrive approved or pre-linked',
  $q$INSERT INTO public.wf_action_draft (org_id, run_id, step_run_id, kind, category, template_ref, status, idempotency_key)
     VALUES (wf07t.id('orgA'), wf07t.id('run_c'), wf07t.id('step_c'), 'in_app', 'communication', 'notice.a',
             'approved', 'wf07-insert-approved')$q$, '42501');

-- ---------------------------------------------------------------------------------------------
-- 5. Approval requests for drafts (service role) and the risk floor
-- ---------------------------------------------------------------------------------------------
SELECT wf07t.login_as('service_role');
SELECT wf07t.keep('apr_m', public.wf_request_draft_approval(wf07t.id('orgA'), wf07t.id('draft_m')));
SELECT wf07t.keep('apr_c', public.wf_request_draft_approval(wf07t.id('orgA'), wf07t.id('draft_c')));
SELECT wf07t.keep('apr_rq', public.wf_request_draft_approval(wf07t.id('orgA'), wf07t.id('draft_rq')));
SELECT wf07t.keep('apr_au', public.wf_request_draft_approval(wf07t.id('orgA'), wf07t.id('draft_au')));
SELECT wf07t.keep('apr_rj', public.wf_request_draft_approval(wf07t.id('orgA'), wf07t.id('draft_rj')));
SELECT wf07t.keep('apr_ex', public.wf_request_draft_approval(wf07t.id('orgA'), wf07t.id('draft_ex')));
SELECT wf07t.keep('apr_rc', public.wf_request_draft_approval(wf07t.id('orgA'), wf07t.id('draft_rc')));
SELECT wf07t.keep('apr_ms', public.wf_request_draft_approval(wf07t.id('orgA'), wf07t.id('draft_ms')));
SELECT wf07t.keep('apr_tm', public.wf_request_draft_approval(wf07t.id('orgA'), wf07t.id('draft_tm')));
SELECT wf07t.keep('apr_cr', public.wf_request_draft_approval(wf07t.id('orgA'), wf07t.id('draft_cr')));
SELECT wf07t.keep('apr_ob', public.wf_request_draft_approval(wf07t.id('orgB'), wf07t.id('draft_ob')));
SELECT wf07t.keep('apr_dg', public.wf_request_draft_approval(wf07t.id('orgA'), wf07t.id('draft_dg')));
SELECT wf07t.logout();

SELECT wf07t.expect_true('each draft gets one pending approval with its own review step, risk by category',
  (SELECT count(*) = 12 FROM public.wf_approval a JOIN public.wf_action_draft d ON d.approval_id = a.id
     WHERE a.status = 'pending' AND a.org_id IN (wf07t.id('orgA'), wf07t.id('orgB')))
  AND (SELECT risk = 'high' FROM public.wf_approval WHERE id = wf07t.id('apr_m'))
  AND (SELECT risk = 'high' FROM public.wf_approval WHERE id = wf07t.id('apr_rj'))
  AND (SELECT risk = 'high' FROM public.wf_approval WHERE id = wf07t.id('apr_ms'))
  AND (SELECT risk = 'high' FROM public.wf_approval WHERE id = wf07t.id('apr_cr'))
  AND (SELECT risk = 'normal' FROM public.wf_approval WHERE id = wf07t.id('apr_c'))
  AND (SELECT s.kind = 'approval' AND s.status = 'waiting' FROM public.wf_approval a
         JOIN public.wf_step_run s ON s.id = a.step_run_id WHERE a.id = wf07t.id('apr_m'))
  AND (SELECT required_permission = 'workflows.approve' FROM public.wf_approval WHERE id = wf07t.id('apr_m')));
SELECT wf07t.login_as('service_role');
SELECT wf07t.expect_true('requesting an approval twice returns the same approval',
  public.wf_request_draft_approval(wf07t.id('orgA'), wf07t.id('draft_m')) = wf07t.id('apr_m'));
SELECT wf07t.logout();
SELECT wf07t.expect_true('the requester recorded on the approval is the person who started the run, or the agent',
  (SELECT requested_by_kind = 'user' AND requested_by_ref = wf07t.id('starter')::text
     FROM public.wf_approval WHERE id = wf07t.id('apr_m'))
  AND (SELECT requested_by_kind = 'agent' AND requested_by_ref = 'wf07-agent'
         FROM public.wf_approval WHERE id = wf07t.id('apr_ms')));
SELECT wf07t.expect_error('the approval link is set once and cannot be moved',
  $q$UPDATE public.wf_action_draft SET approval_id = wf07t.id('apr_c') WHERE id = wf07t.id('draft_m')$q$, '42501');
SELECT wf07t.expect_error('a draft cannot be linked to an approval of another run',
  $q$UPDATE public.wf_action_draft SET approval_id = wf07t.id('apr_c') WHERE id = wf07t.id('draft_cp')$q$, '23514');
SELECT wf07t.expect_error('a high-risk approval cannot be approved directly by the service role',
  $q$UPDATE public.wf_approval SET status = 'approved', decided_by = wf07t.id('ap1'), decided_at = now(),
            decision_channel = 'console' WHERE id = wf07t.id('apr_m')$q$, '42501', 'step-up votes');

-- ---------------------------------------------------------------------------------------------
-- 6. Who may decide: permission, requester, author, organization
-- ---------------------------------------------------------------------------------------------
SELECT wf07t.login_as('service_role');
SELECT wf07t.expect_error('a classroom user without the approve permission cannot decide',
  $q$SELECT public.wf_decide_approval(wf07t.id('teacher'), wf07t.id('apr_c'), 'approve', NULL, repeat('0', 64), NULL)$q$,
  '42501', 'wf07:not_authorized');
SELECT wf07t.expect_error('the person who started the run cannot decide even with the permission',
  $q$SELECT wf07t.vote('ap2', 'apr_rq')$q$, '42501', 'wf07:requester');
SELECT wf07t.expect_error('the version author cannot decide on their own version',
  $q$SELECT wf07t.vote('ap3', 'apr_au')$q$, '42501', 'wf07:author');
SELECT wf07t.expect_error('an approver of another organization sees nothing to decide',
  $q$SELECT public.wf_decide_approval(wf07t.id('bp1'), wf07t.id('apr_c'), 'approve', NULL, repeat('0', 64), NULL)$q$,
  '42501', 'wf07:not_found');
SELECT wf07t.expect_error('a decision without an identified actor is refused',
  $q$SELECT public.wf_decide_approval(NULL, wf07t.id('apr_c'), 'approve', NULL, repeat('0', 64), NULL)$q$,
  '42501', 'wf07:actor_required');
SELECT wf07t.expect_error('an unknown decision value is refused',
  $q$SELECT public.wf_decide_approval(wf07t.id('ap1'), wf07t.id('apr_c'), 'maybe', NULL, repeat('0', 64), NULL)$q$,
  '22023');
SELECT wf07t.logout();
SELECT wf07t.login(wf07t.id('ap1'));
SELECT wf07t.expect_error('a signed-in client cannot call the decision function directly',
  $q$SELECT public.wf_decide_approval(wf07t.id('ap1'), wf07t.id('apr_c'), 'approve', NULL, repeat('0', 64), NULL)$q$,
  '42501', 'permission denied');
SELECT wf07t.expect_error('a signed-in client cannot write a decision row',
  $q$INSERT INTO public.wf_approval_decision (org_id, approval_id, approver_id, decision, high_risk, content_digest)
     VALUES (wf07t.id('orgA'), wf07t.id('apr_c'), wf07t.id('ap1'), 'approve', false, repeat('a', 64))$q$, '42501');
SELECT wf07t.logout();
SELECT wf07t.expect_error('an approver cannot be written as the requester even by direct insert',
  $q$INSERT INTO public.wf_approval_decision (org_id, approval_id, approver_id, decision, high_risk, content_digest)
     VALUES (wf07t.id('orgA'), wf07t.id('apr_c'), wf07t.id('starter'), 'reject', false, repeat('a', 64))$q$,
  '42501', 'requester');

-- ---------------------------------------------------------------------------------------------
-- 7. Step-up evidence: bound to the approval and the content, single use, five minutes
-- ---------------------------------------------------------------------------------------------
SELECT wf07t.login_as('service_role');
SELECT wf07t.expect_error('a high-risk approval needs a step-up',
  $q$SELECT public.wf_decide_approval(wf07t.id('ap1'), wf07t.id('apr_m'), 'approve', NULL,
       wf07t.digest('ap1', 'apr_m'), NULL)$q$, '42501', 'wf07:step_up_invalid');
SELECT wf07t.expect_error('a step-up for stale content is refused',
  $q$SELECT public.wf_record_step_up(wf07t.id('ap1'), wf07t.id('apr_m'), repeat('b', 64))$q$, '42501', 'wf07:stale_content');
SELECT wf07t.expect_error('a normal-risk approval takes no step-up',
  $q$SELECT public.wf_record_step_up(wf07t.id('ap1'), wf07t.id('apr_c'), wf07t.digest('ap1', 'apr_c'))$q$,
  '22023', 'wf07:step_up_not_required');
SELECT wf07t.keep('su_ap1_m', (public.wf_record_step_up(wf07t.id('ap1'), wf07t.id('apr_m'),
  wf07t.digest('ap1', 'apr_m')) ->> 'step_up_id')::uuid);
SELECT wf07t.keep('su_ap2_cr', (public.wf_record_step_up(wf07t.id('ap2'), wf07t.id('apr_cr'),
  wf07t.digest('ap2', 'apr_cr')) ->> 'step_up_id')::uuid);
SELECT wf07t.keep('su_ap2_cr_2', (public.wf_record_step_up(wf07t.id('ap2'), wf07t.id('apr_cr'),
  wf07t.digest('ap2', 'apr_cr')) ->> 'step_up_id')::uuid);
SELECT wf07t.expect_error('a newer step-up revokes the older unused one',
  $q$SELECT public.wf_decide_approval(wf07t.id('ap2'), wf07t.id('apr_cr'), 'approve', NULL,
       wf07t.digest('ap2', 'apr_cr'), wf07t.id('su_ap2_cr'))$q$, '42501', 'wf07:step_up_invalid');
SELECT wf07t.expect_error('a step-up bound to another approval cannot be used',
  $q$SELECT public.wf_decide_approval(wf07t.id('ap2'), wf07t.id('apr_m'), 'approve', NULL,
       wf07t.digest('ap2', 'apr_m'), wf07t.id('su_ap2_cr'))$q$, '42501', 'wf07:step_up_invalid');
SELECT wf07t.expect_error('a step-up issued to one person cannot be used by another',
  $q$SELECT public.wf_decide_approval(wf07t.id('ap2'), wf07t.id('apr_m'), 'approve', NULL,
       wf07t.digest('ap2', 'apr_m'), wf07t.id('su_ap1_m'))$q$, '42501', 'wf07:step_up_invalid');
SELECT wf07t.logout();
SELECT wf07t.expect_true('the step-up lasts at most five minutes and starts unused',
  (SELECT expires_at - verified_at = interval '5 minutes' AND used_at IS NULL AND revoked_at IS NULL
     AND user_id = wf07t.id('ap1') AND approval_id = wf07t.id('apr_m')
     AND content_digest = (SELECT public.wf_approval_content_digest(org_id, id) FROM public.wf_approval
                            WHERE id = wf07t.id('apr_m'))
     FROM public.wf_approval_step_up WHERE id = wf07t.id('su_ap1_m')));
SELECT wf07t.expect_error('step-up evidence fields cannot be edited',
  $q$UPDATE public.wf_approval_step_up SET expires_at = expires_at + interval '1 hour'
      WHERE id = wf07t.id('su_ap1_m')$q$, '42501');
SELECT wf07t.expect_error('step-up evidence cannot be deleted',
  $q$DELETE FROM public.wf_approval_step_up WHERE id = wf07t.id('su_ap1_m')$q$, '42501');
-- An expired step-up (verified ten minutes ago) is refused.
INSERT INTO public.wf_approval_step_up (id, org_id, approval_id, user_id, content_digest, verified_at, expires_at)
SELECT gen_random_uuid(), a.org_id, a.id, wf07t.id('ap3'), public.wf_approval_content_digest(a.org_id, a.id),
       now() - interval '10 minutes', now() - interval '5 minutes'
  FROM public.wf_approval a WHERE a.id = wf07t.id('apr_m');
SELECT wf07t.keep('su_ap3_expired', (SELECT id FROM public.wf_approval_step_up
                                      WHERE user_id = wf07t.id('ap3') AND approval_id = wf07t.id('apr_m')));
SELECT wf07t.login_as('service_role');
SELECT wf07t.expect_error('an expired step-up is refused',
  $q$SELECT public.wf_decide_approval(wf07t.id('ap3'), wf07t.id('apr_m'), 'approve', NULL,
       wf07t.digest('ap3', 'apr_m'), wf07t.id('su_ap3_expired'))$q$, '42501', 'wf07:step_up_invalid');
SELECT wf07t.logout();

-- ---------------------------------------------------------------------------------------------
-- 8. Two-person rule: money needs two different approvers, each with their own step-up
-- ---------------------------------------------------------------------------------------------
SELECT wf07t.login_as('service_role');
SELECT (public.wf_decide_approval(wf07t.id('ap1'), wf07t.id('apr_m'), 'approve', NULL,
          wf07t.digest('ap1', 'apr_m'), wf07t.id('su_ap1_m')) ->> 'status') AS first_vote_status \gset
SELECT wf07t.logout();
SELECT wf07t.expect_true('the first approval leaves a two-person item waiting for the second approver',
  :'first_vote_status' = 'pending'
  AND (SELECT status = 'pending' FROM public.wf_approval WHERE id = wf07t.id('apr_m'))
  AND (SELECT status = 'draft' FROM public.wf_action_draft WHERE id = wf07t.id('draft_m'))
  AND (SELECT count(*) = 1 FROM public.wf_approval_decision WHERE approval_id = wf07t.id('apr_m'))
  AND (SELECT used_at IS NOT NULL FROM public.wf_approval_step_up WHERE id = wf07t.id('su_ap1_m')));
SELECT wf07t.login_as('service_role');
SELECT wf07t.expect_error('the same person cannot approve twice',
  $q$SELECT wf07t.vote('ap1', 'apr_m')$q$, '42501', 'wf07:already_voted');
SELECT wf07t.expect_error('a used step-up cannot be replayed by someone else',
  $q$SELECT public.wf_decide_approval(wf07t.id('ap2'), wf07t.id('apr_m'), 'approve', NULL,
       wf07t.digest('ap2', 'apr_m'), wf07t.id('su_ap1_m'))$q$, '42501', 'wf07:step_up_invalid');
SELECT wf07t.logout();
SELECT wf07t.expect_error('a used step-up cannot be reset to unused',
  $q$UPDATE public.wf_approval_step_up SET used_at = NULL WHERE id = wf07t.id('su_ap1_m')$q$, '42501', 'single use');
SELECT wf07t.expect_error('a single approval cannot approve the draft by a direct service write',
  $q$UPDATE public.wf_action_draft SET status = 'approved' WHERE id = wf07t.id('draft_m')$q$, '23514');
SELECT wf07t.login_as('service_role');
SELECT (wf07t.vote('ap2', 'apr_m') ->> 'status') AS second_vote_status \gset
SELECT wf07t.logout();
SELECT wf07t.expect_true('the second approver completes the approval and the draft becomes approved',
  :'second_vote_status' = 'approved'
  AND (SELECT status = 'approved' AND decided_by = wf07t.id('ap2') AND decision_channel = 'console'
         FROM public.wf_approval WHERE id = wf07t.id('apr_m'))
  AND (SELECT status = 'approved' FROM public.wf_action_draft WHERE id = wf07t.id('draft_m'))
  AND (SELECT count(DISTINCT approver_id) = 2 FROM public.wf_approval_decision
        WHERE approval_id = wf07t.id('apr_m') AND decision = 'approve' AND step_up_id IS NOT NULL)
  AND (SELECT s.status = 'succeeded' FROM public.wf_step_run s JOIN public.wf_approval a ON a.step_run_id = s.id
        WHERE a.id = wf07t.id('apr_m'))
  AND public.wf_draft_approval_gap(wf07t.id('orgA'), wf07t.id('draft_m')) IS NULL);
SELECT wf07t.expect_true('each vote and the final decision are audited against the approver, not the service',
  (SELECT count(*) = 1 FROM public.audit_chain WHERE action = 'workflow.approval.vote_approve'
     AND target_id = wf07t.id('apr_m')::text AND actor_id = wf07t.id('ap1')::text AND actor_kind = 'user')
  AND (SELECT count(*) = 1 FROM public.audit_chain WHERE action = 'workflow.approval.vote_approve'
        AND target_id = wf07t.id('apr_m')::text AND actor_id = wf07t.id('ap2')::text AND actor_kind = 'user')
  AND (SELECT count(*) = 2 FROM public.audit_chain WHERE action = 'workflow.approval.step_up_verified'
        AND target_id = wf07t.id('apr_m')::text AND actor_kind = 'user')
  AND (SELECT count(*) = 1 FROM public.audit_chain WHERE action = 'workflow.approval.approved'
        AND target_id = wf07t.id('apr_m')::text AND actor_id = wf07t.id('ap2')::text)
  AND NOT EXISTS (SELECT 1 FROM public.audit_chain WHERE action LIKE 'workflow.approval.%'
                   AND target_id = wf07t.id('apr_m')::text AND actor_id = 'service'
                   AND action <> 'workflow.approval.requested'));
SELECT wf07t.expect_true('the decision functions restore the caller''s claims',
  coalesce(current_setting('request.jwt.claims', true), '') = ''
  AND coalesce(current_setting('request.jwt.claim.sub', true), '') = ''
  AND auth.uid() IS NULL);
SELECT wf07t.login_as('service_role');
SELECT wf07t.expect_error('a decided approval cannot be decided again',
  $q$SELECT wf07t.vote('ap3', 'apr_m')$q$, '42501', 'wf07:not_pending');
SELECT wf07t.logout();
SELECT wf07t.expect_error('a decided draft is final',
  $q$UPDATE public.wf_action_draft SET status = 'draft' WHERE id = wf07t.id('draft_m')$q$, '42501', 'final');
SELECT wf07t.expect_error('decision rows are append-only',
  $q$UPDATE public.wf_approval_decision SET note = 'x' WHERE approval_id = wf07t.id('apr_m')$q$, '42501');
SELECT wf07t.expect_error('decision rows cannot be deleted',
  $q$DELETE FROM public.wf_approval_decision WHERE approval_id = wf07t.id('apr_m')$q$, '42501');

-- ---------------------------------------------------------------------------------------------
-- 9. One approver for normal risk and for non-two-person high-risk categories
-- ---------------------------------------------------------------------------------------------
SELECT wf07t.login_as('service_role');
SELECT (wf07t.vote('ap1', 'apr_c', 'approve', false, 'ok') ->> 'status') AS normal_status \gset
SELECT (wf07t.vote('ap2', 'apr_cr') ->> 'status') AS cred_status \gset
SELECT wf07t.logout();
SELECT wf07t.expect_true('one approver is enough for a normal-risk draft, with no step-up',
  :'normal_status' = 'approved'
  AND (SELECT status = 'approved' FROM public.wf_action_draft WHERE id = wf07t.id('draft_c'))
  AND (SELECT step_up_id IS NULL AND NOT high_risk AND note = 'ok' FROM public.wf_approval_decision
        WHERE approval_id = wf07t.id('apr_c')));
SELECT wf07t.expect_true('one approver with a step-up is enough for a credential change',
  :'cred_status' = 'approved'
  AND (SELECT status = 'approved' FROM public.wf_action_draft WHERE id = wf07t.id('draft_cr'))
  AND (SELECT step_up_id IS NOT NULL AND high_risk FROM public.wf_approval_decision
        WHERE approval_id = wf07t.id('apr_cr')));

-- ---------------------------------------------------------------------------------------------
-- 10. Capped drafts are approvable only through a high-risk, console-decided approval
-- ---------------------------------------------------------------------------------------------
INSERT INTO public.wf_step_run (id, org_id, run_id, step_key, kind, idempotency_key, action_class, status)
VALUES (gen_random_uuid(), wf07t.id('orgA'), wf07t.id('run_cp'), 'wf07-plain-review', 'approval',
        'wf07-step-plain-review', 'internal', 'waiting');
INSERT INTO public.wf_approval (id, org_id, run_id, step_run_id, risk, summary, requested_by_kind, requested_by_ref, expires_at)
SELECT gen_random_uuid(), wf07t.id('orgA'), wf07t.id('run_cp'), s.id, 'normal', 'Plain review',
       'agent', 'wf07-agent', now() + interval '1 day'
  FROM public.wf_step_run s WHERE s.idempotency_key = 'wf07-step-plain-review';
SELECT wf07t.keep('apr_plain', (SELECT a.id FROM public.wf_approval a JOIN public.wf_step_run s ON s.id = a.step_run_id
                                 WHERE s.idempotency_key = 'wf07-step-plain-review'));
INSERT INTO public.wf_step_run (id, org_id, run_id, step_key, kind, idempotency_key, action_class, status)
VALUES (gen_random_uuid(), wf07t.id('orgA'), wf07t.id('run_cp'), 'wf07-capped-review', 'approval',
        'wf07-step-capped-review', 'money_movement', 'waiting');
INSERT INTO public.wf_approval (id, org_id, run_id, step_run_id, risk, summary, requested_by_kind, requested_by_ref, expires_at)
SELECT gen_random_uuid(), wf07t.id('orgA'), wf07t.id('run_cp'), s.id, 'normal', 'Capped review',
       'agent', 'wf07-agent', now() + interval '1 day'
  FROM public.wf_step_run s WHERE s.idempotency_key = 'wf07-step-capped-review';
SELECT wf07t.expect_true('a plain approval stays normal risk on an unclassified step and is forced high on a capped step',
  (SELECT risk = 'normal' FROM public.wf_approval WHERE id = wf07t.id('apr_plain'))
  AND (SELECT a.risk = 'high' FROM public.wf_approval a JOIN public.wf_step_run s ON s.id = a.step_run_id
        WHERE s.idempotency_key = 'wf07-step-capped-review'));
UPDATE public.wf_action_draft SET approval_id = wf07t.id('apr_plain') WHERE id = wf07t.id('draft_cp');
UPDATE public.wf_approval SET status = 'approved', decided_by = wf07t.id('ap1'), decided_at = now(),
       decision_channel = 'console' WHERE id = wf07t.id('apr_plain');
SELECT wf07t.expect_error('a capped draft cannot ride on a normal-risk console approval',
  $q$UPDATE public.wf_action_draft SET status = 'approved' WHERE id = wf07t.id('draft_cp')$q$, '23514',
  'capped_needs_high_risk');

SELECT wf07t.mkrun('wh', 'verA', 'starter');
SELECT wf07t.mkstep('wh', 'wh', 'communication');
INSERT INTO public.wf_action_draft (id, org_id, run_id, step_run_id, kind, category, idempotency_key)
VALUES (gen_random_uuid(), wf07t.id('orgA'), wf07t.id('run_wh'), wf07t.id('step_wh'), 'webhook',
        'unregistered_webhook', 'wf07-draft-wh');
SELECT wf07t.keep('draft_wh', (SELECT id FROM public.wf_action_draft WHERE idempotency_key = 'wf07-draft-wh'));
SELECT wf07t.login_as('service_role');
SELECT wf07t.keep('apr_wh', public.wf_request_draft_approval(wf07t.id('orgA'), wf07t.id('draft_wh')));
SELECT wf07t.expect_error('an unregistered-webhook draft cannot be approved through the inbox',
  $q$SELECT wf07t.vote('ap1', 'apr_wh')$q$, '42501', 'wf07:draft_not_approvable');
SELECT wf07t.logout();
SELECT wf07t.expect_error('an unregistered-webhook draft cannot be approved by a direct write either',
  $q$UPDATE public.wf_action_draft SET status = 'approved' WHERE id = wf07t.id('draft_wh')$q$, '23514');

-- ---------------------------------------------------------------------------------------------
-- 11. Reject, expiry and run closure
-- ---------------------------------------------------------------------------------------------
SELECT wf07t.login_as('service_role');
SELECT (wf07t.vote('ap1', 'apr_rj', 'reject', false, 'not appropriate') ->> 'status') AS reject_status \gset
SELECT wf07t.logout();
SELECT wf07t.expect_true('one rejection ends the item, the draft and the run, with no step-up needed',
  :'reject_status' = 'rejected'
  AND (SELECT status = 'rejected' AND decided_by = wf07t.id('ap1') FROM public.wf_approval WHERE id = wf07t.id('apr_rj'))
  AND (SELECT status = 'rejected' FROM public.wf_action_draft WHERE id = wf07t.id('draft_rj'))
  AND (SELECT status = 'cancelled' AND error_code = 'approval.rejected' FROM public.wf_run WHERE id = wf07t.id('run_rj'))
  AND (SELECT count(*) = 1 FROM public.audit_chain WHERE action = 'workflow.approval.vote_reject'
        AND target_id = wf07t.id('apr_rj')::text AND actor_id = wf07t.id('ap1')::text));
SELECT wf07t.login_as('service_role');
SELECT wf07t.expect_error('a rejected item cannot be approved afterwards',
  $q$SELECT wf07t.vote('ap2', 'apr_rj')$q$, '42501', 'wf07:not_pending');
SELECT wf07t.logout();

SET LOCAL session_replication_role = replica;
UPDATE public.wf_approval SET requested_at = now() - interval '8 days', expires_at = now() - interval '1 minute'
 WHERE id = wf07t.id('apr_ex');
SET LOCAL session_replication_role = origin;
SELECT wf07t.login_as('service_role');
SELECT wf07t.expect_error('an expired item cannot be decided',
  $q$SELECT wf07t.vote('ap1', 'apr_ex')$q$, '42501', 'wf07:expired');
SELECT public.wf_expire_approvals(100) AS expire_result \gset
SELECT wf07t.logout();
SELECT wf07t.expect_true('the expiry sweep closes the item, its draft and its run',
  (SELECT status = 'expired' FROM public.wf_approval WHERE id = wf07t.id('apr_ex'))
  AND (SELECT status = 'expired' FROM public.wf_action_draft WHERE id = wf07t.id('draft_ex'))
  AND (SELECT status = 'cancelled' AND error_code = 'approval.expired' FROM public.wf_run WHERE id = wf07t.id('run_ex'))
  AND (:'expire_result'::jsonb ->> 'approvals_expired')::int >= 1);

UPDATE public.wf_run SET status = 'cancelled', finished_at = now(), error_code = 'operator.cancelled'
 WHERE id = wf07t.id('run_rc');
SELECT wf07t.expect_true('cancelling a run closes its open approvals and drafts',
  (SELECT status = 'cancelled' FROM public.wf_approval WHERE id = wf07t.id('apr_rc'))
  AND (SELECT status = 'cancelled' FROM public.wf_action_draft WHERE id = wf07t.id('draft_rc')));

SELECT wf07t.login_as('service_role');
SELECT wf07t.expect_error('approving a draft whose template is not approved is refused',
  $q$SELECT wf07t.vote('ap1', 'apr_tm')$q$, '42501', 'wf07:template_unavailable');
SELECT wf07t.logout();

-- ---------------------------------------------------------------------------------------------
-- 12. Content digest binding: changed content invalidates earlier votes and step-ups
-- ---------------------------------------------------------------------------------------------
SELECT wf07t.login_as('service_role');
SELECT wf07t.keep('su_ap1_dg', (public.wf_record_step_up(wf07t.id('ap1'), wf07t.id('apr_dg'),
  wf07t.digest('ap1', 'apr_dg')) ->> 'step_up_id')::uuid);
SELECT wf07t.digest('ap1', 'apr_dg') AS digest_before \gset
SELECT wf07t.logout();
UPDATE public.wf_action_template SET body_template = 'Digest fixture text, edited.'
 WHERE org_id = wf07t.id('orgA') AND template_ref = 'notice.dg';
SELECT wf07t.login_as('service_role');
SELECT wf07t.digest('ap1', 'apr_dg') AS digest_after \gset
SELECT wf07t.expect_true('the content digest is a stable sha-256 that changes when the approved text changes',
  :'digest_before' ~ '^[0-9a-f]{64}$' AND :'digest_after' ~ '^[0-9a-f]{64}$' AND :'digest_before' <> :'digest_after'
  AND :'digest_after' = wf07t.digest('ap2', 'apr_dg'));
SELECT wf07t.expect_error('a decision on the old digest is refused as stale',
  format($q$SELECT public.wf_decide_approval(wf07t.id('ap1'), wf07t.id('apr_dg'), 'approve', NULL,
       %L, wf07t.id('su_ap1_dg'))$q$, :'digest_before'), '42501', 'wf07:stale_content');
SELECT wf07t.expect_error('a step-up taken on the old digest cannot approve the new content',
  format($q$SELECT public.wf_decide_approval(wf07t.id('ap1'), wf07t.id('apr_dg'), 'approve', NULL,
       %L, wf07t.id('su_ap1_dg'))$q$, :'digest_after'), '42501', 'wf07:step_up_invalid');
SELECT wf07t.logout();
UPDATE public.wf_action_template SET body_template = 'Digest fixture text.'
 WHERE org_id = wf07t.id('orgA') AND template_ref = 'notice.dg';
-- A vote cast on the old text no longer counts once the text changes: vote, edit, check the tally.
SELECT wf07t.login_as('service_role');
SELECT (wf07t.vote('ap1', 'apr_dg') ->> 'status') AS dg1 \gset
SELECT wf07t.logout();
UPDATE public.wf_action_template SET body_template = 'Digest fixture text, edited again.'
 WHERE org_id = wf07t.id('orgA') AND template_ref = 'notice.dg';
SELECT wf07t.login_as('service_role');
SELECT (wf07t.vote('ap2', 'apr_dg') ->> 'status') AS dg2 \gset
SELECT public.wf_approval_view(wf07t.id('ap3'), wf07t.id('apr_dg')) AS dg_view \gset
SELECT wf07t.logout();
SELECT wf07t.expect_true('after the text changed, the earlier vote no longer counts and the item stays pending',
  :'dg1' = 'pending' AND :'dg2' = 'pending'
  AND (SELECT status = 'pending' FROM public.wf_approval WHERE id = wf07t.id('apr_dg'))
  AND (SELECT status = 'draft' FROM public.wf_action_draft WHERE id = wf07t.id('draft_dg'))
  AND (SELECT count(*) = 1 FROM jsonb_array_elements(:'dg_view'::jsonb -> 'votes') v WHERE (v ->> 'current')::boolean)
  AND (SELECT count(*) = 1 FROM jsonb_array_elements(:'dg_view'::jsonb -> 'votes') v WHERE NOT (v ->> 'current')::boolean));

-- Two-person approval for the 26-recipient mass draft from an agent run (no human starter).
SELECT wf07t.login_as('service_role');
SELECT (wf07t.vote('ap1', 'apr_ms') ->> 'status') AS ms1 \gset
SELECT (wf07t.vote('ap3', 'apr_ms') ->> 'status') AS ms2 \gset
SELECT wf07t.logout();
SELECT wf07t.expect_true('a mass draft from an agent run needs and gets two approvers',
  :'ms1' = 'pending' AND :'ms2' = 'approved'
  AND (SELECT status = 'approved' AND cardinality(recipient_ids) = 26 FROM public.wf_action_draft
        WHERE id = wf07t.id('draft_ms')));

-- ---------------------------------------------------------------------------------------------
-- 13. The approved draft reaches the sandbox outbox, and only that way (N2, N8)
-- ---------------------------------------------------------------------------------------------
INSERT INTO public.cg_role_pack (code, version, kind, applies_to, status, definition) VALUES
 ('wf07-pack','1.0.0','tenant_role',ARRAY['wf07-role'],'published',
  jsonb_build_object(
    'schema','sherivs.role-pack.v1','code','wf07-pack','version','1.0.0','kind','tenant_role',
    'title','WF07 synthetic pack','permissions',jsonb_build_array('workflows.run'),
    'capabilities',jsonb_build_array(jsonb_build_object('id','workflow.in-app','title','In-app',
      'tier','T1','autonomy','act_autonomously','requiresPermission','workflows.run','connector','in-app')),
    'playbooks','[]'::jsonb,
    'memory',jsonb_build_object('domains',jsonb_build_array('work'),'maxSensitivity','internal','retentionDays',90,'crossTenant',false),
    'budget',jsonb_build_object('dailyActions',50,'dailyModelCalls',20,'dailyCostCapMinor',1000),
    'escalation',jsonb_build_object('defaultApprover','role_owner','t3Approver','sheriff'),
    'startsInShadow',true));
SELECT public.cg_twin_ensure_context(wf07t.id('starter'),'tenant_membership',
  wf07t.id('orgA')::text,'wf07-role','wf07-src-a',true);
CREATE FUNCTION wf07t.decision(p_org uuid, p_kind text, p_key text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.cg_tool_call_ledger
    (kind,twin_context_id,tenant_ref,tool_id,tool_version,tier,verdict,args_digest,idempotency_key)
  SELECT 'decision', c.id, p_org::text, 'workflow.action.' || p_kind, '1.0.0', r.tier, 'execute',
         repeat('a',64), p_key
    FROM public.cg_twin_context c
    JOIN public.cg_tool_registry r ON r.tool_id = 'workflow.action.' || p_kind AND r.version = '1.0.0'
   WHERE c.tenant_ref = p_org::text AND c.role_code = 'wf07-role'
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'WF07 FAIL: fixture decision missing'; END IF;
  RETURN v_id;
END $$;
CREATE FUNCTION wf07t.outbox_for(p_draft text, p_key text DEFAULT NULL, p_params jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_d public.wf_action_draft%ROWTYPE;
BEGIN
  SELECT * INTO v_d FROM public.wf_action_draft WHERE id = wf07t.id(p_draft);
  INSERT INTO public.wf_action_sandbox_outbox (org_id, run_id, step_run_id, kind, category, template_ref,
    template_params, recipient_ids, audience_selector, data_class, broker_decision_id, idempotency_key, draft_id)
  VALUES (v_d.org_id, v_d.run_id, v_d.step_run_id, v_d.kind, v_d.category, v_d.template_ref,
    coalesce(p_params, v_d.template_params), v_d.recipient_ids, v_d.audience_selector, v_d.data_class,
    wf07t.decision(v_d.org_id, v_d.kind, coalesce(p_key, 'wf-approved:' || v_d.id::text)),
    v_d.idempotency_key, v_d.id);
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wf07t TO anon, authenticated, service_role;

SELECT wf07t.expect_error('a draft that is still pending cannot be written to the outbox',
  $q$SELECT wf07t.outbox_for('draft_ex')$q$, '42501');
SELECT wf07t.expect_error('a draft that was rejected cannot be written to the outbox',
  $q$SELECT wf07t.outbox_for('draft_rj')$q$, '42501');
SELECT wf07t.expect_error('the outbox record must equal the approved draft',
  $q$SELECT wf07t.outbox_for('draft_m', NULL, '{"name":"Mallory"}')$q$, '42501', 'differs from the approved draft');
SELECT wf07t.expect_error('the outbox record must be cleared by the approved draft''s own broker decision',
  $q$SELECT wf07t.outbox_for('draft_m', 'some-other-key')$q$, '42501', 'broker decision');
SELECT wf07t.expect_error('without a draft link a capped category is still refused by the WF-06 check',
  $q$INSERT INTO public.wf_action_sandbox_outbox (org_id, run_id, step_run_id, kind, category, template_ref,
        broker_decision_id, idempotency_key)
     VALUES (wf07t.id('orgA'), wf07t.id('run_m'), wf07t.id('step_m'), 'in_app', 'money_movement', 'notice.a',
        wf07t.decision(wf07t.id('orgA'), 'in_app', 'wf07-nolink-money'), 'wf07-nolink-money')$q$, '23514');
SELECT wf07t.login_as('service_role');
SELECT wf07t.outbox_for('draft_m');
SELECT wf07t.outbox_for('draft_ms');
SELECT wf07t.logout();
SELECT wf07t.expect_true('N8: the service role still writes the outbox after losing EXECUTE on the guard',
  (SELECT count(*) = 2 FROM public.wf_action_sandbox_outbox WHERE draft_id IN (wf07t.id('draft_m'), wf07t.id('draft_ms')))
  AND (SELECT category = 'money_movement' FROM public.wf_action_sandbox_outbox WHERE draft_id = wf07t.id('draft_m'))
  AND (SELECT cardinality(recipient_ids) = 26 AND data_class = 'minor_sensitive'
         FROM public.wf_action_sandbox_outbox WHERE draft_id = wf07t.id('draft_ms')));
SELECT wf07t.expect_error('one approved draft yields one outbox record',
  $q$SELECT wf07t.outbox_for('draft_m')$q$, '23505');
SELECT wf07t.expect_error('N2: a webhook outbox record must carry its registered target',
  $q$INSERT INTO public.wf_action_sandbox_outbox (org_id, run_id, step_run_id, kind, category,
        broker_decision_id, idempotency_key)
     VALUES (wf07t.id('orgA'), wf07t.id('run_m'), wf07t.id('step_m'), 'webhook', 'communication',
        wf07t.decision(wf07t.id('orgA'), 'webhook', 'wf07-hook-no-target'), 'wf07-hook-no-target')$q$, '23514');

SELECT wf07t.login_as('service_role');
-- WF-08 follow-up (WF-07 review): an approved draft whose outbox record exists but whose step still waits is
-- listed too, marked needs_dispatch = false, so the sweep resumes it and never dispatches it twice.
SELECT wf07t.expect_true('approved drafts are listed for dispatch (no outbox record) or for resume (record, step waiting); rejected ones are not',
  (SELECT count(*) = 1 AND bool_and(NOT r.needs_dispatch) FROM public.wf_approved_drafts_ready(100) r WHERE r.draft_id = wf07t.id('draft_m'))
  AND (SELECT count(*) = 1 AND bool_and(r.needs_dispatch) FROM public.wf_approved_drafts_ready(100) r WHERE r.draft_id = wf07t.id('draft_c'))
  AND (SELECT count(*) = 0 FROM public.wf_approved_drafts_ready(100) r WHERE r.draft_id = wf07t.id('draft_rj')));
SELECT public.wf_resume_after_dispatch(wf07t.id('orgA'), wf07t.id('draft_m')) AS resumed_m,
       public.wf_resume_after_dispatch(wf07t.id('orgA'), wf07t.id('draft_c')) AS resumed_c \gset
SELECT wf07t.logout();
SELECT wf07t.expect_true('after the dispatch record exists the action step is released; without it nothing moves',
  :'resumed_m' = 't' AND :'resumed_c' = 'f'
  AND (SELECT status = 'pending' AND resume_at IS NULL FROM public.wf_step_run WHERE id = wf07t.id('step_m'))
  AND (SELECT status = 'waiting' FROM public.wf_step_run WHERE id = wf07t.id('step_c')));

-- ---------------------------------------------------------------------------------------------
-- 14. Inbox reads: list, detail, waiting state, candidates, organization isolation
-- ---------------------------------------------------------------------------------------------
INSERT INTO public.wf_run (id, org_id, definition_id, version_id, idempotency_key, status, max_depth,
  max_steps, started_by, deadline_at, started_at, agent_ref)
VALUES (gen_random_uuid(), wf07t.id('orgA'), 'f0710000-0000-4000-8000-0000000000a1',
  'f0720000-0000-4000-8000-0000000000a1', 'wf07-run-inbox', 'running', 2, 20, wf07t.id('starter'),
  now() + interval '1 hour', now(), 'wf07-agent');
SELECT wf07t.keep('run_inbox', (SELECT id FROM public.wf_run WHERE idempotency_key = 'wf07-run-inbox'));
SELECT wf07t.mkstep('inbox', 'inbox', 'safeguarding');
SELECT wf07t.mkdraft('inbox', 'inbox', 'in_app', 'safeguarding', 'notice.a', 1, NULL, 'internal', '{"name":"Chi"}');
SELECT wf07t.login_as('service_role');
SELECT wf07t.keep('apr_inbox', public.wf_request_draft_approval(wf07t.id('orgA'), wf07t.id('draft_inbox')));
SELECT (wf07t.vote('ap1', 'apr_inbox') ->> 'status') AS inbox_first \gset
SELECT public.wf_approval_view(wf07t.id('ap1'), wf07t.id('apr_inbox')) AS ap1_view \gset
SELECT public.wf_approval_view(wf07t.id('ap2'), wf07t.id('apr_inbox')) AS ap2_view \gset
SELECT public.wf_approval_view(wf07t.id('starter'), wf07t.id('apr_inbox')) AS starter_view \gset
SELECT public.wf_inbox_list(wf07t.id('ap2'), 'pending', 50) AS ap2_list \gset
SELECT public.wf_inbox_list(wf07t.id('bp1'), 'pending', 50) AS bp1_list \gset
SELECT public.wf_inbox_list(wf07t.id('ap1'), 'decided', 50) AS ap1_decided \gset
SELECT wf07t.logout();
SELECT wf07t.expect_true('the waiting-for-second-approver state: one vote in, one more needed, the voter cannot vote again',
  :'inbox_first' = 'pending'
  AND (:'ap1_view'::jsonb ->> 'required')::int = 2
  AND jsonb_array_length(:'ap1_view'::jsonb -> 'votes') = 1
  AND (:'ap1_view'::jsonb ->> 'can_decide')::boolean = false
  AND (:'ap1_view'::jsonb -> 'blockers') ? 'already_voted'
  AND (:'ap2_view'::jsonb ->> 'can_decide')::boolean = true
  AND (:'ap2_view'::jsonb ->> 'step_up_required')::boolean = true);
SELECT wf07t.expect_true('the detail carries the content digest and a bounded draft preview without raw recipients',
  (:'ap2_view'::jsonb ->> 'digest') ~ '^[0-9a-f]{64}$'
  AND (:'ap2_view'::jsonb -> 'draft' ->> 'template_body') = 'Hello {{name}}, please review the notice.'
  AND (:'ap2_view'::jsonb -> 'draft' ->> 'recipient_count')::int = 1
  AND (:'ap2_view'::jsonb -> 'draft' -> 'params' ->> 'name') = 'Chi'
  AND (:'ap2_view'::jsonb -> 'draft') ? 'data_class'
  AND NOT (:'ap2_view'::jsonb -> 'draft') ? 'idempotency_key');
SELECT wf07t.expect_true('the starter sees the item but is blocked from deciding it',
  (:'starter_view'::jsonb ->> 'can_decide')::boolean = false
  AND (:'starter_view'::jsonb -> 'blockers') ? 'requester');
SELECT wf07t.expect_true('the pending list is limited to the caller''s organization and flags my own votes',
  jsonb_array_length(:'ap2_list'::jsonb) >= 1
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(:'ap2_list'::jsonb) i
                   WHERE (i ->> 'approval_id')::uuid = wf07t.id('apr_ob'))
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(:'ap2_list'::jsonb) i
               WHERE (i ->> 'approval_id')::uuid = wf07t.id('apr_inbox')
                 AND (i ->> 'approvals')::int = 1 AND (i ->> 'required')::int = 2
                 AND (i ->> 'voted_by_me')::boolean = false)
  AND jsonb_array_length(:'bp1_list'::jsonb) = 1
  AND (:'bp1_list'::jsonb -> 0 ->> 'approval_id')::uuid = wf07t.id('apr_ob')
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(:'ap1_decided'::jsonb) i
               WHERE (i ->> 'approval_id')::uuid = wf07t.id('apr_m') AND i ->> 'status' = 'approved'));
SELECT wf07t.login_as('service_role');
SELECT wf07t.expect_error('another organization cannot open the detail',
  $q$SELECT public.wf_approval_view(wf07t.id('bp1'), wf07t.id('apr_inbox'))$q$, 'P0002');
SELECT wf07t.expect_error('a user without workflow access cannot list the inbox',
  $q$SELECT public.wf_inbox_list(wf07t.id('teacher'), 'pending', 10)$q$, '42501', 'wf07:not_authorized');
SELECT wf07t.expect_true('the candidate list contains eligible approvers only',
  (SELECT count(*) = 1 FROM public.wf_approver_candidates(wf07t.id('apr_inbox'), 25) c WHERE c.approver_id = wf07t.id('ap2'))
  AND (SELECT count(*) = 1 FROM public.wf_approver_candidates(wf07t.id('apr_inbox'), 25) c WHERE c.approver_id = wf07t.id('ap3'))
  AND NOT EXISTS (SELECT 1 FROM public.wf_approver_candidates(wf07t.id('apr_inbox'), 25) c
                   WHERE c.approver_id IN (wf07t.id('ap1'), wf07t.id('starter'), wf07t.id('teacher'),
                                           wf07t.id('author'), wf07t.id('bp1'))));
SELECT public.wf_audit_step_up_failed(wf07t.id('ap2'), wf07t.id('apr_inbox'), 'assertion_invalid');
SELECT wf07t.expect_error('a free-text failure reason is refused',
  $q$SELECT public.wf_audit_step_up_failed(wf07t.id('ap2'), wf07t.id('apr_inbox'), 'my passkey broke')$q$, '22023');
SELECT wf07t.logout();
SELECT wf07t.expect_true('viewing a high-risk item and a failed step-up are both audited against the person',
  EXISTS (SELECT 1 FROM public.audit_chain WHERE action = 'workflow.approval.viewed'
           AND target_id = wf07t.id('apr_inbox')::text AND actor_id = wf07t.id('ap2')::text)
  AND EXISTS (SELECT 1 FROM public.audit_chain WHERE action = 'workflow.approval.step_up_failed'
               AND target_id = wf07t.id('apr_inbox')::text AND actor_id = wf07t.id('ap2')::text));

SELECT wf07t.login(wf07t.id('ap2'));
SELECT wf07t.expect_true('RLS: an approver reads decisions of their own organization only',
  (SELECT count(*) >= 1 FROM public.wf_approval_decision)
  AND NOT EXISTS (SELECT 1 FROM public.wf_approval_decision WHERE org_id = wf07t.id('orgB')));
SELECT wf07t.logout();
SELECT wf07t.login(wf07t.id('bp1'));
SELECT wf07t.expect_true('RLS: another organization reads no decisions of Org A',
  NOT EXISTS (SELECT 1 FROM public.wf_approval_decision WHERE org_id = wf07t.id('orgA')));
SELECT wf07t.logout();

SELECT wf07t.login(wf07t.id('ap1'));
SELECT wf07t.expect_true('RLS: a member reads only their own organization''s approval policy',
  (SELECT count(*) = 1 FROM public.wf_approval_policy WHERE org_id = wf07t.id('orgA'))
  AND NOT EXISTS (SELECT 1 FROM public.wf_approval_policy WHERE org_id = wf07t.id('orgB')));
SELECT wf07t.logout();

-- A draft that never got an approval (created before WF-07) is picked up by the sweep.
SELECT wf07t.mkrun('sw', 'verA', 'starter');
SELECT wf07t.mkstep('sw', 'sw', 'communication');
SELECT wf07t.mkdraft('sw', 'sw', 'in_app', 'communication', 'notice.a');
SELECT wf07t.login_as('service_role');
SELECT public.wf_request_missing_draft_approvals(50) AS swept \gset
SELECT wf07t.logout();
SELECT wf07t.expect_true('the sweep gives an orphan draft its approval',
  :swept::int >= 1
  AND (SELECT approval_id IS NOT NULL FROM public.wf_action_draft WHERE id = wf07t.id('draft_sw')));

-- ---------------------------------------------------------------------------------------------
-- Round 2: the row-level gate counts only votes cast on the CURRENT content digest
-- ---------------------------------------------------------------------------------------------
SELECT wf07t.mkrun('gt', 'verA', 'starter');
SELECT wf07t.mkstep('gt', 'gt', 'safeguarding');
SELECT wf07t.mkdraft('gt', 'gt', 'in_app', 'safeguarding', 'notice.dg');
SELECT wf07t.keep('apr_gt', public.wf_request_draft_approval(wf07t.id('orgA'), wf07t.id('draft_gt')));
-- Two approvers each hold a consumed step-up and a recorded approving vote, but both were cast on an OLDER digest.
INSERT INTO public.wf_approval_step_up (id, org_id, approval_id, user_id, content_digest, verified_at, expires_at, used_at)
SELECT wf07t.keep('su_old_' || u, gen_random_uuid()), wf07t.id('orgA'), wf07t.id('apr_gt'), wf07t.id(u), repeat('a', 64),
                  now() - interval '1 minute', now() + interval '4 minutes', now() - interval '30 seconds'
  FROM unnest(ARRAY['ap1', 'ap2']) u;
INSERT INTO public.wf_approval_decision (org_id, approval_id, approver_id, decision, high_risk, step_up_id, content_digest)
SELECT wf07t.id('orgA'), wf07t.id('apr_gt'), wf07t.id(u), 'approve', true, wf07t.id('su_old_' || u), repeat('a', 64)
  FROM unnest(ARRAY['ap1', 'ap2']) u;
SELECT wf07t.expect_true('fixture: the stale votes differ from the current digest and meet the old count',
  repeat('a', 64) <> wf07t.digest('ap1', 'apr_gt')
  AND (SELECT count(DISTINCT approver_id) >= 2 FROM public.wf_approval_decision WHERE approval_id = wf07t.id('apr_gt')));
SELECT wf07t.expect_error('votes cast on an older content digest do not satisfy the row-level gate',
  $q$UPDATE public.wf_approval SET status = 'approved', decided_by = wf07t.id('ap1'), decided_at = now(),
            decision_channel = 'console' WHERE id = wf07t.id('apr_gt')$q$, '42501', 'step-up votes');

DO $summary$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM wf07t.passed;
  IF v_count < 60 THEN RAISE EXCEPTION 'WF07 FAIL: expected at least 60 checks, got %', v_count; END IF;
  RAISE NOTICE 'WF07 ALL PASS: % checks', v_count;
END $summary$;

ROLLBACK;
