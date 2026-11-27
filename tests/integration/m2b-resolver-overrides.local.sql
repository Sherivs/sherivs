-- M2b resolver checks: approved, in-force tenant overrides change effective permissions. Local disposable Postgres only; rolls back.
BEGIN;
DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'M2R FAIL: refusing to run outside the local disposable database';
  END IF;
  IF pg_get_functiondef('public.workspace_effective_permission_rows_at(uuid,uuid,timestamptz)'::regprocedure) NOT LIKE '%tenant_role_overrides%' THEN
    RAISE EXCEPTION 'M2R FAIL: the M2b resolver migration must be present';
  END IF;
END $guard$;

CREATE SCHEMA m2t;
CREATE TABLE m2t.passed (n serial PRIMARY KEY, label text NOT NULL);
CREATE FUNCTION m2t.ok(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'M2R FAIL [%]', p_label; END IF;
  INSERT INTO m2t.passed (label) VALUES (p_label);
END $$;
CREATE TABLE m2t.ids (name text PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid());
INSERT INTO m2t.ids (name) VALUES ('org'), ('org2'), ('u'), ('creator'), ('approver');
CREATE FUNCTION m2t.id(p text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM m2t.ids WHERE name = p $$;
CREATE FUNCTION m2t.has(p_org uuid, p_perm text, p_at timestamptz DEFAULT now()) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.workspace_effective_permission_rows_at(p_org, m2t.id('u'), p_at) WHERE permission_code = p_perm)
$$;

-- Fixtures bypass the assignment triggers (their rules are tested elsewhere); the function under test is not bypassed.
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) SELECT id FROM m2t.ids WHERE name IN ('u', 'creator', 'approver');
INSERT INTO public.schools (id, name, slug) VALUES (m2t.id('org'), 'M2R Org', 'm2r-org'), (m2t.id('org2'), 'M2R Org 2', 'm2r-org2');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  (m2t.id('u'), m2t.id('org'), 'U', 'u@m2r.invalid', 'teacher', true),
  (m2t.id('creator'), m2t.id('org'), 'C', 'c@m2r.invalid', 'admin', true),
  (m2t.id('approver'), m2t.id('org'), 'A', 'a@m2r.invalid', 'admin', true);
INSERT INTO public.organization_memberships (user_id, school_id, role) VALUES (m2t.id('u'), m2t.id('org'), 'teacher'), (m2t.id('u'), m2t.id('org2'), 'teacher');
INSERT INTO public.user_role_assignments (org_id, user_id, role_code, started_at) VALUES
  (m2t.id('org'), m2t.id('u'), 'ng.account_clerk', now() - interval '1 day'), (m2t.id('org2'), m2t.id('u'), 'ng.account_clerk', now() - interval '1 day');

CREATE TABLE m2t.pick AS
  SELECT (SELECT permission_code FROM public.role_template_permissions WHERE template_code = 'accountant' AND kind = 'mandatory' ORDER BY 1 LIMIT 1) AS mand,
         (SELECT permission_code FROM public.role_template_permissions WHERE template_code = 'accountant' AND kind = 'optional' AND default_on ORDER BY 1 LIMIT 1) AS opt;
CREATE FUNCTION m2t.ov(p_org uuid, p_kind text, p_perm text, p_approved boolean, p_from timestamptz DEFAULT now() - interval '1 hour', p_to timestamptz DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.tenant_role_overrides (org_id, template_code, override_kind, payload, effective_from, effective_to, created_by, approved_by, approved_at)
  VALUES (p_org, 'accountant', p_kind, jsonb_build_object('permission', p_perm), p_from, p_to, m2t.id('creator'),
          CASE WHEN p_approved THEN m2t.id('approver') END, CASE WHEN p_approved THEN now() END)
$$;

SELECT m2t.ok('fixture: the clerk holds a mandatory and a default-on optional permission',
  (SELECT mand IS NOT NULL AND opt IS NOT NULL FROM m2t.pick)
  AND m2t.has(m2t.id('org'), (SELECT mand FROM m2t.pick)) AND m2t.has(m2t.id('org'), (SELECT opt FROM m2t.pick)));
SELECT m2t.ok('without an override the extra permission is absent', NOT m2t.has(m2t.id('org'), 'zz.test_extra'));

-- add_optional_permission
SELECT m2t.ov(m2t.id('org'), 'add_optional_permission', 'zz.test_extra', false);
SELECT m2t.ok('an unapproved add changes nothing', NOT m2t.has(m2t.id('org'), 'zz.test_extra'));
UPDATE public.tenant_role_overrides SET approved_by = m2t.id('approver'), approved_at = now() WHERE payload->>'permission' = 'zz.test_extra';
SELECT m2t.ok('once approved, the add grants the permission', m2t.has(m2t.id('org'), 'zz.test_extra'));
SELECT m2t.ok('the grant is for that organisation only', NOT m2t.has(m2t.id('org2'), 'zz.test_extra'));
SELECT m2t.ok('before its start date the add does nothing (and the role itself was in force)', NOT m2t.has(m2t.id('org'), 'zz.test_extra', now() - interval '2 hours') AND m2t.has(m2t.id('org'), (SELECT mand FROM m2t.pick), now() - interval '2 hours'));
UPDATE public.tenant_role_overrides SET effective_to = now() - interval '1 minute' WHERE payload->>'permission' = 'zz.test_extra';
SELECT m2t.ok('after it is ended the add does nothing', NOT m2t.has(m2t.id('org'), 'zz.test_extra'));

-- remove_optional_permission
SELECT m2t.ov(m2t.id('org'), 'remove_optional_permission', (SELECT opt FROM m2t.pick), false);
SELECT m2t.ok('an unapproved removal changes nothing', m2t.has(m2t.id('org'), (SELECT opt FROM m2t.pick)));
UPDATE public.tenant_role_overrides SET approved_by = m2t.id('approver'), approved_at = now()
 WHERE override_kind = 'remove_optional_permission';
SELECT m2t.ok('once approved, the removal takes the optional permission away', NOT m2t.has(m2t.id('org'), (SELECT opt FROM m2t.pick)));
SELECT m2t.ok('another organisation keeps it', m2t.has(m2t.id('org2'), (SELECT opt FROM m2t.pick)));
SELECT m2t.ok('the removal is not in force before its start', m2t.has(m2t.id('org'), (SELECT opt FROM m2t.pick), now() - interval '2 hours'));

-- A mandatory permission can never be removed, even by a row that got past the guard.
SELECT m2t.ov(m2t.id('org'), 'remove_optional_permission', (SELECT mand FROM m2t.pick), true);
SELECT m2t.ok('a mandatory permission survives a removal override', m2t.has(m2t.id('org'), (SELECT mand FROM m2t.pick)));

-- Overrides do not touch roles built on other templates.
INSERT INTO public.user_role_assignments (org_id, user_id, role_code, started_at)
  SELECT m2t.id('org'), m2t.id('u'), 'ng.academic_adviser', now() - interval '1 day';
SELECT m2t.ok('an add for one template does not reach another template''s role',
  NOT EXISTS (SELECT 1 FROM public.workspace_effective_permission_rows_at(m2t.id('org'), m2t.id('u'), now())
               WHERE role_code = 'ng.academic_adviser' AND permission_code = 'zz.test_extra'));
SELECT m2t.ok('the function is still security definer with a fixed search path',
  (SELECT prosecdef AND proconfig::text LIKE '%search_path%' FROM pg_proc WHERE oid = 'public.workspace_effective_permission_rows_at(uuid,uuid,timestamptz)'::regprocedure));

DO $$ BEGIN RAISE NOTICE 'M2R ALL PASS: % checks', (SELECT count(*) FROM m2t.passed); END $$;
ROLLBACK;
