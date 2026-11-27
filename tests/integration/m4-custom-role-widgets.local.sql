-- M4 follow-up checks: the live workspace manifest includes widgets of an active custom role the person holds, and
-- nothing the person may not see. Local disposable Postgres only; rolls back.
BEGIN;
DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'M4W FAIL: refusing to run outside the local disposable database';
  END IF;
  IF pg_get_functiondef('public.workspace_manifest(uuid)'::regprocedure) NOT LIKE '%org_custom_roles%' THEN
    RAISE EXCEPTION 'M4W FAIL: the M4 manifest migration must be present';
  END IF;
END $guard$;

CREATE SCHEMA m4t;
CREATE TABLE m4t.passed (n serial PRIMARY KEY, label text NOT NULL);
CREATE FUNCTION m4t.ok(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'M4W FAIL [%]', p_label; END IF;
  INSERT INTO m4t.passed (label) VALUES (p_label);
END $$;
CREATE FUNCTION m4t.widgets(p_org uuid) RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT array(SELECT jsonb_array_elements(public.workspace_manifest(p_org)->'widgets')->>'key')
$$;
CREATE FUNCTION m4t.act(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
END $$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) VALUES ('00000000-0000-4000-8000-0000000000e1'), ('00000000-0000-4000-8000-0000000000e2'), ('00000000-0000-4000-8000-0000000000e3');
INSERT INTO public.schools (id, name, slug) VALUES ('00000000-0000-4000-8000-0000000000a1', 'M4W Org', 'm4w-org'), ('00000000-0000-4000-8000-0000000000a2', 'M4W Other', 'm4w-other');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1', 'Holder', 'h@m4w.invalid', 'admin', true),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000a1', 'Plain', 'p@m4w.invalid', 'admin', true),
  ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000a2', 'Elsewhere', 'e@m4w.invalid', 'admin', true);
INSERT INTO public.organization_memberships (user_id, school_id, role) VALUES
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1', 'admin'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000a1', 'admin'),
  ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000a2', 'admin');
-- A custom role of org 1 based on the bursar template; its layout lists one widget the bursar may see
-- (w.announcements) and one it may not (w.grading_queue needs grades.enter). Org 2 has a role with the same widgets.
INSERT INTO public.org_custom_roles (id, org_id, code, name, base_template_code, permissions, responsibilities, scope_ceiling, workspace_category, layout, status, version, created_by, approved_by, approved_at)
VALUES ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a1', 'custom.bursar_plus', 'Bursar Plus', 'bursar', '{}', '{}', 'org', 'finance',
        '{"widgets": ["w.announcements", "w.grading_queue"]}', 'active', 1, '00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000e1', now()),
       ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000a1', 'custom.bursar_draft', 'Draft Role', 'bursar', '{}', '{}', 'org', 'finance',
        '{"widgets": ["w.today_classes"]}', 'draft', 1, '00000000-0000-4000-8000-0000000000e2', NULL, NULL);
INSERT INTO public.role_catalog (code, name, category, template_code, institution_types, org_id, base_role_code, description)
SELECT 'zz.m4w_bursar_plus', 'Bursar Plus', 'Custom', 'bursar', institution_types, '00000000-0000-4000-8000-0000000000a1', code, 'org_custom_roles:00000000-0000-4000-8000-0000000000c1'
  FROM public.role_catalog WHERE code = 'ng.bursar';
INSERT INTO public.role_catalog (code, name, category, template_code, institution_types, org_id, base_role_code, description)
SELECT 'zz.m4w_draft', 'Draft Role', 'Custom', 'bursar', institution_types, '00000000-0000-4000-8000-0000000000a1', code, 'org_custom_roles:00000000-0000-4000-8000-0000000000c2'
  FROM public.role_catalog WHERE code = 'ng.bursar';
INSERT INTO public.user_role_assignments (org_id, user_id, role_code, started_at) VALUES
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1', 'zz.m4w_bursar_plus', now() - interval '1 day'),
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e2', 'ng.bursar', now() - interval '1 day'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000e3', 'ng.bursar', now() - interval '1 day');
SET LOCAL session_replication_role = origin;

SELECT m4t.act('00000000-0000-4000-8000-0000000000e2');
SELECT m4t.ok('baseline: a plain bursar does not see the extra widget', NOT ('w.announcements' = ANY (m4t.widgets('00000000-0000-4000-8000-0000000000a1'))));
SELECT m4t.act('00000000-0000-4000-8000-0000000000e1');
SELECT m4t.ok('the holder of the active custom role sees its permitted widget', 'w.announcements' = ANY (m4t.widgets('00000000-0000-4000-8000-0000000000a1')));
SELECT m4t.ok('the custom role cannot show a widget its holder may not see (grades.enter)', NOT ('w.grading_queue' = ANY (m4t.widgets('00000000-0000-4000-8000-0000000000a1'))));
SELECT m4t.ok('a draft custom role adds nothing', NOT ('w.today_classes' = ANY (m4t.widgets('00000000-0000-4000-8000-0000000000a1'))));
SELECT m4t.ok('the widget is shown once, with the family widgets still present',
  (SELECT count(*) = 1 FROM unnest(m4t.widgets('00000000-0000-4000-8000-0000000000a1')) w WHERE w = 'w.announcements')
  AND 'w.fee_collection' = ANY (m4t.widgets('00000000-0000-4000-8000-0000000000a1')));
SELECT m4t.ok('the widget is no longer offered as merely available',
  NOT (public.workspace_manifest('00000000-0000-4000-8000-0000000000a1')->'available' ? 'w.announcements'));
SELECT m4t.act('00000000-0000-4000-8000-0000000000e3');
SELECT m4t.ok('another organisation is unaffected', NOT ('w.announcements' = ANY (m4t.widgets('00000000-0000-4000-8000-0000000000a2'))));

DO $$ BEGIN RAISE NOTICE 'M4W ALL PASS: % checks', (SELECT count(*) FROM m4t.passed); END $$;
ROLLBACK;
