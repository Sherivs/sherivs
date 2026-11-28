-- M2b override kinds: disable/enable, scope_narrow, add_responsibility, approval_limit and rename.
-- Local disposable Postgres only; rolls back. Fixtures bypass the assignment and override guards (tested elsewhere);
-- the resolver and the new functions are not bypassed.
BEGIN;
DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'M2K FAIL: refusing to run outside the local disposable database';
  END IF;
  IF to_regprocedure('public.workspace_template_disabled(uuid,text,timestamptz)') IS NULL
     OR to_regprocedure('public.workspace_effective_approval_limit(uuid,uuid,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'M2K FAIL: the M2b override kinds migration must be present';
  END IF;
END $guard$;

CREATE SCHEMA m2k;
CREATE TABLE m2k.passed (n serial PRIMARY KEY, label text NOT NULL);
CREATE FUNCTION m2k.ok(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'M2K FAIL [%]', p_label; END IF;
  INSERT INTO m2k.passed (label) VALUES (p_label);
END $$;
CREATE TABLE m2k.ids (name text PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid());
INSERT INTO m2k.ids (name) VALUES ('org'), ('org2'), ('u'), ('lim'), ('narrow'), ('creator'), ('approver');
CREATE FUNCTION m2k.id(p text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM m2k.ids WHERE name = p $$;
CREATE FUNCTION m2k.rows(p_org uuid, p_user text, p_at timestamptz DEFAULT now()) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM public.workspace_effective_permission_rows_at(p_org, m2k.id(p_user), p_at)
$$;
CREATE FUNCTION m2k.has(p_org uuid, p_user text, p_perm text, p_at timestamptz DEFAULT now()) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.workspace_effective_permission_rows_at(p_org, m2k.id(p_user), p_at) WHERE permission_code = p_perm)
$$;
CREATE FUNCTION m2k.ov(p_org uuid, p_kind text, p_payload jsonb, p_approved boolean DEFAULT true,
  p_from timestamptz DEFAULT now() - interval '1 hour', p_to timestamptz DEFAULT NULL, p_template text DEFAULT 'accountant') RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.tenant_role_overrides (org_id, template_code, override_kind, payload, effective_from, effective_to, created_by, approved_by, approved_at)
  VALUES (p_org, p_template, p_kind, p_payload, p_from, p_to, m2k.id('creator'),
          CASE WHEN p_approved THEN m2k.id('approver') END, CASE WHEN p_approved THEN now() END)
$$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) SELECT id FROM m2k.ids WHERE name IN ('u', 'lim', 'narrow', 'creator', 'approver');
INSERT INTO public.schools (id, name, slug) VALUES (m2k.id('org'), 'M2K Org', 'm2k-org'), (m2k.id('org2'), 'M2K Org 2', 'm2k-org2');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  (m2k.id('u'), m2k.id('org'), 'U', 'u@m2k.invalid', 'teacher', true),
  (m2k.id('narrow'), m2k.id('org'), 'N', 'n@m2k.invalid', 'teacher', true),
  (m2k.id('lim'), m2k.id('org'), 'L', 'l@m2k.invalid', 'teacher', true),
  (m2k.id('creator'), m2k.id('org'), 'C', 'c@m2k.invalid', 'admin', true),
  (m2k.id('approver'), m2k.id('org'), 'A', 'a@m2k.invalid', 'admin', true);
INSERT INTO public.organization_memberships (user_id, school_id, role) VALUES
  (m2k.id('u'), m2k.id('org'), 'teacher'), (m2k.id('u'), m2k.id('org2'), 'teacher'),
  (m2k.id('narrow'), m2k.id('org'), 'teacher'), (m2k.id('approver'), m2k.id('org'), 'admin');
INSERT INTO public.user_role_assignments (org_id, user_id, role_code, started_at) VALUES
  (m2k.id('org'), m2k.id('u'), 'ng.account_clerk', now() - interval '1 day'),
  (m2k.id('org2'), m2k.id('u'), 'ng.account_clerk', now() - interval '1 day');
INSERT INTO public.user_role_assignments (org_id, user_id, role_code, scope_type, scope_ref, started_at) VALUES
  (m2k.id('org'), m2k.id('narrow'), 'ng.account_clerk', 'department', 'dept-1', now() - interval '1 day');

CREATE TABLE m2k.lt AS
  SELECT t.code AS tpl, r.code AS role, t.approval_limit_ngn AS ceiling
    FROM public.role_templates t JOIN public.role_catalog r ON r.template_code = t.code AND r.org_id IS NULL
   WHERE t.approval_limit_ngn > 1000 AND NOT coalesce(r.requires_verified_authority_link, false) ORDER BY t.code, r.code LIMIT 1;
INSERT INTO public.organization_memberships (user_id, school_id, role) VALUES (m2k.id('lim'), m2k.id('org'), 'teacher'), (m2k.id('lim'), m2k.id('org2'), 'teacher');
INSERT INTO public.user_role_assignments (org_id, user_id, role_code, started_at)
  SELECT o, m2k.id('lim'), role, now() - interval '1 day' FROM m2k.lt, (VALUES (m2k.id('org')), (m2k.id('org2'))) v(o);
-- pack with one responsibility: one ordinary and one protected permission
INSERT INTO public.cg_role_pack (code, version, kind, applies_to, status, definition, definition_digest)
  VALUES ('zz-m2k', '1.0.0', 'institution_pack', ARRAY['school'], 'draft', '{}'::jsonb, 'm2k-fixture');
CREATE TABLE m2k.pack AS SELECT code, version FROM public.cg_role_pack WHERE code = 'zz-m2k';
CREATE TABLE m2k.prot AS SELECT code FROM public.permission_catalog WHERE protected ORDER BY code LIMIT 1;
INSERT INTO public.tenant_role_pack_installations (org_id, pack_code, pack_version, status)
  SELECT m2k.id('org'), code, version, 'active' FROM m2k.pack;
INSERT INTO public.role_pack_items (pack_code, pack_version, item_kind, item_ref, payload)
  SELECT code, version, 'responsibility', 'zz.resp',
         jsonb_build_object('permissions', jsonb_build_array('zz.resp_perm', (SELECT code FROM m2k.prot)))
    FROM m2k.pack;
-- fixtures and override rows are written with the guards bypassed for the whole run; the resolver is what is under test

SELECT m2k.ok('fixture: a pack, a protected permission, and a clerk with rows',
  (SELECT count(*) = 1 FROM m2k.pack) AND (SELECT count(*) = 1 FROM m2k.prot) AND m2k.rows(m2k.id('org'), 'u') > 0);
CREATE TABLE m2k.base AS SELECT m2k.rows(m2k.id('org'), 'u') AS u_rows, m2k.rows(m2k.id('org'), 'narrow') AS n_rows;

-- disable / enable
SELECT m2k.ov(m2k.id('org'), 'disable', '{"reason":"x"}', false);
SELECT m2k.ok('an unapproved disable changes nothing', m2k.rows(m2k.id('org'), 'u') = (SELECT u_rows FROM m2k.base));
UPDATE public.tenant_role_overrides SET approved_by = m2k.id('approver'), approved_at = now() WHERE override_kind = 'disable';
SELECT m2k.ok('an approved disable removes every row of the template''s roles in that organization',
  m2k.rows(m2k.id('org'), 'u') = 0 AND m2k.rows(m2k.id('org'), 'narrow') = 0);
SELECT m2k.ok('another organization keeps its rows', m2k.rows(m2k.id('org2'), 'u') = (SELECT u_rows FROM m2k.base));
SELECT m2k.ok('before the disable starts the rows are intact', m2k.rows(m2k.id('org'), 'u', now() - interval '2 hours') = (SELECT u_rows FROM m2k.base));
SELECT m2k.ov(m2k.id('org'), 'enable', '{}', true, now() - interval '30 minutes');
SELECT m2k.ok('a later approved enable restores the rows', m2k.rows(m2k.id('org'), 'u') = (SELECT u_rows FROM m2k.base));
SELECT m2k.ok('at a time between disable and enable the template is still off', m2k.rows(m2k.id('org'), 'u', now() - interval '45 minutes') = 0);
SELECT m2k.ov(m2k.id('org'), 'disable', '{"reason":"again"}', true, now() - interval '10 minutes');
SELECT m2k.ok('a disable after the enable switches it off again', m2k.rows(m2k.id('org'), 'u') = 0);
UPDATE public.tenant_role_overrides SET effective_to = now() - interval '1 minute' WHERE override_kind = 'disable';
SELECT m2k.ok('ending the disables brings the rows back', m2k.rows(m2k.id('org'), 'u') = (SELECT u_rows FROM m2k.base));
SELECT m2k.ov(m2k.id('org'), 'disable', '{"reason":"tie"}', true, now() - interval '5 seconds');
UPDATE public.tenant_role_overrides SET effective_from = now() - interval '5 seconds' WHERE override_kind IN ('enable', 'disable') AND effective_to IS NULL;
SELECT m2k.ok('on a tie the disable wins', m2k.rows(m2k.id('org'), 'u') = 0);
UPDATE public.tenant_role_overrides SET effective_to = now() - interval '1 second' WHERE override_kind IN ('enable', 'disable') AND effective_to IS NULL;

-- scope_narrow
SELECT m2k.ov(m2k.id('org'), 'scope_narrow', '{"scope":"department"}', false);
SELECT m2k.ok('an unapproved narrowing changes nothing', m2k.rows(m2k.id('org'), 'u') = (SELECT u_rows FROM m2k.base));
UPDATE public.tenant_role_overrides SET approved_by = m2k.id('approver'), approved_at = now() WHERE override_kind = 'scope_narrow';
SELECT m2k.ok('an org-wide assignment is switched off by a department narrowing (fail closed)', m2k.rows(m2k.id('org'), 'u') = 0);
SELECT m2k.ok('an assignment already at the narrower scope keeps its rows', m2k.rows(m2k.id('org'), 'narrow') = (SELECT n_rows FROM m2k.base));
SELECT m2k.ok('another organization is untouched', m2k.rows(m2k.id('org2'), 'u') = (SELECT u_rows FROM m2k.base));
UPDATE public.tenant_role_overrides SET effective_to = now() - interval '1 minute' WHERE override_kind = 'scope_narrow';
SELECT m2k.ok('an ended narrowing restores the org-wide assignment', m2k.rows(m2k.id('org'), 'u') = (SELECT u_rows FROM m2k.base));
SELECT m2k.ov(m2k.id('org'), 'scope_narrow', '{"scope":"self"}', true);
SELECT m2k.ok('a narrowing to self also removes the department assignment', m2k.rows(m2k.id('org'), 'narrow') = 0);
UPDATE public.tenant_role_overrides SET effective_to = now() - interval '1 minute' WHERE override_kind = 'scope_narrow';

-- add_responsibility
SELECT m2k.ov(m2k.id('org'), 'add_responsibility', '{"responsibility":"zz.resp"}', false);
SELECT m2k.ok('an unapproved responsibility adds nothing', NOT m2k.has(m2k.id('org'), 'u', 'zz.resp_perm'));
UPDATE public.tenant_role_overrides SET approved_by = m2k.id('approver'), approved_at = now() WHERE override_kind = 'add_responsibility';
SELECT m2k.ok('an approved responsibility grants its permission', m2k.has(m2k.id('org'), 'u', 'zz.resp_perm'));
SELECT m2k.ok('a protected permission in the responsibility is never granted',
  NOT m2k.has(m2k.id('org'), 'u', (SELECT code FROM m2k.prot)));
SELECT m2k.ok('another organization does not get it', NOT m2k.has(m2k.id('org2'), 'u', 'zz.resp_perm'));
UPDATE public.tenant_role_overrides SET effective_to = now() - interval '1 minute' WHERE override_kind = 'add_responsibility';
SELECT m2k.ok('an ended responsibility stops granting', NOT m2k.has(m2k.id('org'), 'u', 'zz.resp_perm'));

-- approval_limit
SELECT m2k.ok('fixture: a template with an approval ceiling', (SELECT ceiling > 1000 FROM m2k.lt));
SELECT m2k.ok('with no override the limit is the template ceiling',
  public.workspace_effective_approval_limit(m2k.id('org'), m2k.id('lim')) = (SELECT ceiling FROM m2k.lt));
SELECT m2k.ov(m2k.id('org'), 'approval_limit', jsonb_build_object('limit_ngn', 500), false, now() - interval '1 hour', NULL, (SELECT tpl FROM m2k.lt));
SELECT m2k.ok('an unapproved limit changes nothing', public.workspace_effective_approval_limit(m2k.id('org'), m2k.id('lim')) = (SELECT ceiling FROM m2k.lt));
UPDATE public.tenant_role_overrides SET approved_by = m2k.id('approver'), approved_at = now() WHERE override_kind = 'approval_limit';
SELECT m2k.ok('an approved limit lowers it', public.workspace_effective_approval_limit(m2k.id('org'), m2k.id('lim')) = 500);
SELECT m2k.ok('another organization keeps the ceiling', public.workspace_effective_approval_limit(m2k.id('org2'), m2k.id('lim')) = (SELECT ceiling FROM m2k.lt));
SELECT m2k.ov(m2k.id('org'), 'approval_limit', jsonb_build_object('limit_ngn', 200), true, now() - interval '1 hour', NULL, (SELECT tpl FROM m2k.lt));
SELECT m2k.ok('the lowest in-force limit wins', public.workspace_effective_approval_limit(m2k.id('org'), m2k.id('lim')) = 200);
SELECT m2k.ov(m2k.id('org'), 'approval_limit', jsonb_build_object('limit_ngn', 99999999999), true, now() - interval '1 hour', NULL, (SELECT tpl FROM m2k.lt));
SELECT m2k.ok('a limit above the ceiling can never raise it', public.workspace_effective_approval_limit(m2k.id('org'), m2k.id('lim')) = 200);
SELECT m2k.ok('a user with no assignment has no limit', public.workspace_effective_approval_limit(m2k.id('org'), m2k.id('creator')) IS NULL);

-- the expense guard uses it
SELECT m2k.ok('the expense guard reads the effective limit',
  pg_get_functiondef('public.school_expenses_sod_guard()'::regprocedure) LIKE '%workspace_effective_approval_limit%');
UPDATE public.tenant_role_overrides SET effective_to = now() - interval '1 minute' WHERE override_kind = 'approval_limit';
SELECT m2k.ok('ended limits restore the ceiling', public.workspace_effective_approval_limit(m2k.id('org'), m2k.id('lim')) = (SELECT ceiling FROM m2k.lt));

-- rename
SELECT set_config('request.jwt.claim.role', 'service_role', true), set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT m2k.ok('without an override the catalog name shows (service role)',
  public.workspace_role_display_name(m2k.id('org'), 'ng.account_clerk') = (SELECT name FROM public.role_catalog WHERE code = 'ng.account_clerk'));
SELECT m2k.ov(m2k.id('org'), 'rename', '{"name":"Fee Desk Clerk"}', false);
SELECT m2k.ok('an unapproved rename changes nothing',
  public.workspace_role_display_name(m2k.id('org'), 'ng.account_clerk') = (SELECT name FROM public.role_catalog WHERE code = 'ng.account_clerk'));
UPDATE public.tenant_role_overrides SET approved_by = m2k.id('approver'), approved_at = now() WHERE override_kind = 'rename';
SELECT m2k.ok('an approved rename shows the new name', public.workspace_role_display_name(m2k.id('org'), 'ng.account_clerk') = 'Fee Desk Clerk');
SELECT m2k.ok('another organization keeps the catalog name',
  public.workspace_role_display_name(m2k.id('org2'), 'ng.account_clerk') = (SELECT name FROM public.role_catalog WHERE code = 'ng.account_clerk'));
SELECT m2k.ok('a rename never changes permissions', m2k.rows(m2k.id('org'), 'u') = (SELECT u_rows FROM m2k.base));
SELECT set_config('request.jwt.claim.role', '', true), set_config('request.jwt.claims', '', true);
SELECT m2k.ok('a caller outside the organization gets nothing', public.workspace_role_display_name(m2k.id('org'), 'ng.account_clerk') IS NULL);

-- privileges
SELECT m2k.ok('the helper functions are not callable by client roles',
  (SELECT bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                   AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('workspace_template_disabled', 'workspace_template_min_scope_rank', 'workspace_effective_approval_limit')));
SELECT m2k.ok('the display-name function is for signed-in members and the service role only',
  has_function_privilege('authenticated', 'public.workspace_role_display_name(uuid,text,timestamptz)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.workspace_role_display_name(uuid,text,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.workspace_role_display_name(uuid,text,timestamptz)', 'EXECUTE'));
SELECT m2k.ok('every new function is security definer with a fixed search path',
  (SELECT bool_and(p.prosecdef AND p.proconfig::text LIKE '%search_path%') FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('workspace_template_disabled', 'workspace_template_min_scope_rank', 'workspace_effective_approval_limit', 'workspace_role_display_name')));

SELECT 'M2K ALL PASS: ' || count(*) || ' checks' FROM m2k.passed;
ROLLBACK;
