-- M2c: override propose / approve / end as the caller, and the change epoch.
-- Local disposable Postgres only; rolls back. Fixtures bypass triggers; the functions and the override guard do not.
BEGIN;
DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'M2C FAIL: refusing to run outside the local disposable database';
  END IF;
  IF to_regprocedure('public.role_override_create(text,text,jsonb,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'M2C FAIL: the M2c migration must be present';
  END IF;
END $guard$;

CREATE SCHEMA m2c;
CREATE TABLE m2c.passed (n serial PRIMARY KEY, label text NOT NULL);
CREATE FUNCTION m2c.ok(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'M2C FAIL [%]', p_label; END IF;
  INSERT INTO m2c.passed (label) VALUES (p_label);
END $$;
CREATE TABLE m2c.ids (name text PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid());
INSERT INTO m2c.ids (name) VALUES ('org'), ('org2'), ('a'), ('b'), ('m'), ('x');
CREATE FUNCTION m2c.id(p text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM m2c.ids WHERE name = p $$;
CREATE FUNCTION m2c.as_user(p_user text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', m2c.id(p_user)::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', m2c.id(p_user))::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END $$;
-- true when running the statement raises the given SQLSTATE
CREATE FUNCTION m2c.raises(p_sql text, p_state text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE = p_state;
END $$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) SELECT id FROM m2c.ids WHERE name IN ('a', 'b', 'm', 'x');
INSERT INTO public.schools (id, name, slug) VALUES (m2c.id('org'), 'M2C Org', 'm2c-org'), (m2c.id('org2'), 'M2C Org 2', 'm2c-org2');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  (m2c.id('a'), m2c.id('org'), 'A', 'a@m2c.invalid', 'admin', true),
  (m2c.id('b'), m2c.id('org'), 'B', 'b@m2c.invalid', 'admin', true),
  (m2c.id('m'), m2c.id('org'), 'M', 'm@m2c.invalid', 'teacher', true),
  (m2c.id('x'), m2c.id('org2'), 'X', 'x@m2c.invalid', 'admin', true);
INSERT INTO public.organization_memberships (user_id, school_id, role) VALUES
  (m2c.id('a'), m2c.id('org'), 'admin'), (m2c.id('b'), m2c.id('org'), 'admin'),
  (m2c.id('m'), m2c.id('org'), 'teacher'), (m2c.id('x'), m2c.id('org2'), 'admin');
INSERT INTO public.cg_role_pack (code, version, kind, applies_to, status, definition, definition_digest)
  VALUES ('zz-m2c', '1.0.0', 'institution_pack', ARRAY['school'], 'draft', '{}'::jsonb, 'm2c-fixture');
INSERT INTO public.tenant_role_pack_installations (org_id, pack_code, pack_version, status)
  VALUES (m2c.id('org'), 'zz-m2c', '1.0.0', 'active');
INSERT INTO public.role_pack_items (pack_code, pack_version, item_kind, item_ref, payload)
  VALUES ('zz-m2c', '1.0.0', 'template', 'accountant', '{"mandatory":[],"optional":[]}'::jsonb);
SET LOCAL session_replication_role = origin;

-- grants
SELECT m2c.ok('anon cannot run any of the four functions',
  NOT has_function_privilege('anon', 'public.role_override_create(text,text,jsonb,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.role_override_approve(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.role_override_end(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.role_override_epoch()', 'EXECUTE'));
SELECT m2c.ok('authenticated can run all four',
  has_function_privilege('authenticated', 'public.role_override_create(text,text,jsonb,timestamptz)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.role_override_approve(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.role_override_end(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.role_override_epoch()', 'EXECUTE'));

-- propose
SELECT m2c.as_user('m');
SELECT m2c.ok('a plain member cannot propose',
  m2c.raises($$SELECT public.role_override_create('accountant', 'rename', '{"name":"Bursar"}')$$, '42501'));
SELECT m2c.as_user('a');
CREATE TABLE m2c.o AS SELECT public.role_override_create('accountant', 'rename', '{"name":"Bursar"}') AS id;
SELECT m2c.ok('an administrator proposes an override in their own organization, created by the caller',
  (SELECT count(*) = 1 FROM public.tenant_role_overrides o
    WHERE o.id = (SELECT id FROM m2c.o) AND o.org_id = m2c.id('org') AND o.created_by = m2c.id('a') AND o.approved_by IS NULL));
SELECT m2c.ok('a proposal that breaks a guard is refused (rename needs a name)',
  m2c.raises($$SELECT public.role_override_create('accountant', 'rename', '{"name":"x"}')$$, '22023'));
SELECT m2c.ok('a payload key outside the kind is refused',
  m2c.raises($$SELECT public.role_override_create('accountant', 'rename', '{"name":"Bursar","x":1}')$$, '42501'));
SELECT m2c.ok('a template outside the installed pack is refused',
  m2c.raises($$SELECT public.role_override_create('no_such_template', 'enable', '{}')$$, '23503')
  OR m2c.raises($$SELECT public.role_override_create('no_such_template', 'enable', '{}')$$, '42501'));

-- approve
SELECT m2c.ok('the proposer cannot approve their own override (four-eyes)',
  m2c.raises(format('SELECT public.role_override_approve(%L)', (SELECT id FROM m2c.o)), '42501'));
SELECT m2c.as_user('x');
SELECT m2c.ok('an administrator of another organization cannot see or approve it',
  m2c.raises(format('SELECT public.role_override_approve(%L)', (SELECT id FROM m2c.o)), '42704'));
SELECT m2c.as_user('b');
SELECT public.role_override_approve((SELECT id FROM m2c.o));
SELECT m2c.ok('a second administrator approves it',
  (SELECT approved_by = m2c.id('b') AND approved_at IS NOT NULL FROM public.tenant_role_overrides WHERE id = (SELECT id FROM m2c.o)));
SELECT m2c.ok('approving twice is refused',
  m2c.raises(format('SELECT public.role_override_approve(%L)', (SELECT id FROM m2c.o)), '55000'));

-- epoch
SELECT m2c.as_user('m');
CREATE TABLE m2c.e AS SELECT public.role_override_epoch() AS before;
SELECT m2c.ok('any member can read the epoch, and it is not empty', (SELECT before <> '' FROM m2c.e));
SELECT m2c.as_user('x');
SELECT m2c.ok('another organization sees its own epoch (no overrides)', public.role_override_epoch() LIKE '0:%');

-- end
SELECT m2c.as_user('m');
SELECT m2c.ok('a plain member cannot end an override',
  m2c.raises(format('SELECT public.role_override_end(%L)', (SELECT id FROM m2c.o)), '42501'));
SELECT m2c.as_user('a');
SELECT public.role_override_end((SELECT id FROM m2c.o));
SELECT m2c.ok('ending sets the end time and keeps the row as history',
  (SELECT effective_to IS NOT NULL AND effective_to <= now() FROM public.tenant_role_overrides WHERE id = (SELECT id FROM m2c.o)));
SELECT m2c.ok('ending twice is refused',
  m2c.raises(format('SELECT public.role_override_end(%L)', (SELECT id FROM m2c.o)), '42704'));
SELECT m2c.as_user('m');
SELECT m2c.ok('the epoch moved when the override ended', public.role_override_epoch() <> (SELECT before FROM m2c.e));
SELECT m2c.as_user('b');
SELECT m2c.ok('an ended override cannot be approved',
  m2c.raises(format('SELECT public.role_override_approve(%L)', (SELECT id FROM m2c.o)), '55000'));
SELECT m2c.ok('an administrator can read the row, a member cannot (read policy)',
  (SELECT count(*) FROM public.tenant_role_overrides) >= 1);

DO $$ BEGIN RAISE NOTICE 'M2C ALL PASS: % checks', (SELECT count(*) FROM m2c.passed); END $$;
ROLLBACK;
