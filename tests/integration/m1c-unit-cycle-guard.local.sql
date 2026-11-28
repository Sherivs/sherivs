-- M1c unit-tree cycle guard. Local disposable PostgreSQL only; rolled back.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA m1ct;
CREATE FUNCTION m1ct.expect(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'M1C FAIL: %', p_label; END IF;
  RAISE NOTICE 'M1C PASS %', p_label;
END $$;
-- Runs a statement and returns the SQLSTATE, or 'ok'.
CREATE FUNCTION m1ct.state(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
END $$;

SET LOCAL session_replication_role = replica;
INSERT INTO public.schools (id, name, slug) VALUES
  ('c1000000-0000-4000-8000-0000000000a1', 'M1C A', 'm1c-a'), ('c1000000-0000-4000-8000-0000000000b1', 'M1C B', 'm1c-b')
ON CONFLICT DO NOTHING;
SET LOCAL session_replication_role = origin;

-- The role audit trigger needs an authenticated actor; it is not under test here (rolled back with the transaction).
ALTER TABLE public.workspace_org_units DISABLE TRIGGER trg_workspace_org_units_m009_audit;
INSERT INTO public.workspace_org_units (id, org_id, parent_unit_id, unit_type, code, name) VALUES
  ('c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000a1', NULL, 'institution', 'm1c-root', 'Root');
SELECT m1ct.expect('a child under the root is accepted',
  m1ct.state($q$INSERT INTO public.workspace_org_units (id, org_id, parent_unit_id, unit_type, code, name) VALUES
   ('c1000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-0000000000a1','c1000000-0000-4000-8000-000000000001','campus','m1c-b','Unit B')$q$) = 'ok');
SELECT m1ct.expect('a grandchild is accepted',
  m1ct.state($q$INSERT INTO public.workspace_org_units (id, org_id, parent_unit_id, unit_type, code, name) VALUES
   ('c1000000-0000-4000-8000-000000000003','c1000000-0000-4000-8000-0000000000a1','c1000000-0000-4000-8000-000000000002','department','m1c-c','Unit C')$q$) = 'ok');
SELECT m1ct.expect('a three-level cycle is refused (root under its grandchild)',
  m1ct.state($q$UPDATE public.workspace_org_units SET parent_unit_id = 'c1000000-0000-4000-8000-000000000003' WHERE id = 'c1000000-0000-4000-8000-000000000001'$q$) LIKE '23514:m1:unit_cycle%');
SELECT m1ct.expect('a two-step cycle is refused (root under its child)',
  m1ct.state($q$UPDATE public.workspace_org_units SET parent_unit_id = 'c1000000-0000-4000-8000-000000000002' WHERE id = 'c1000000-0000-4000-8000-000000000001'$q$) LIKE '23514:m1:unit_cycle%');
SELECT m1ct.expect('a unit as its own parent is still refused',
  m1ct.state($q$UPDATE public.workspace_org_units SET parent_unit_id = id WHERE id = 'c1000000-0000-4000-8000-000000000002'$q$) LIKE '23514%');
SELECT m1ct.expect('the tree is unchanged after the refusals',
  (SELECT parent_unit_id IS NULL FROM public.workspace_org_units WHERE id = 'c1000000-0000-4000-8000-000000000001'));
SELECT m1ct.expect('a valid re-parent to a sibling branch is accepted',
  m1ct.state($q$INSERT INTO public.workspace_org_units (id, org_id, parent_unit_id, unit_type, code, name) VALUES
   ('c1000000-0000-4000-8000-000000000004','c1000000-0000-4000-8000-0000000000a1','c1000000-0000-4000-8000-000000000001','campus','m1c-d','Unit D')$q$) = 'ok'
  AND m1ct.state($q$UPDATE public.workspace_org_units SET parent_unit_id = 'c1000000-0000-4000-8000-000000000004' WHERE id = 'c1000000-0000-4000-8000-000000000003'$q$) = 'ok');
SELECT m1ct.expect('clearing a parent is accepted',
  m1ct.state($q$UPDATE public.workspace_org_units SET parent_unit_id = NULL WHERE id = 'c1000000-0000-4000-8000-000000000003'$q$) = 'ok');
SELECT m1ct.expect('a parent in another organization is still refused by the foreign key (23503)',
  m1ct.state($q$INSERT INTO public.workspace_org_units (id, org_id, parent_unit_id, unit_type, code, name) VALUES
   ('c1000000-0000-4000-8000-000000000005','c1000000-0000-4000-8000-0000000000b1','c1000000-0000-4000-8000-000000000001','campus','m1c-x','Unit X')$q$) LIKE '23503%');

-- Depth: a chain of 33 ancestors is refused, a chain of 32 is accepted.
INSERT INTO public.workspace_org_units (id, org_id, parent_unit_id, unit_type, code, name)
SELECT ('c2000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'c1000000-0000-4000-8000-0000000000a1',
       CASE WHEN g = 1 THEN NULL ELSE ('c2000000-0000-4000-8000-' || lpad((g - 1)::text, 12, '0'))::uuid END,
       'section', 'm1c-chain' || g, 'D' || g
  FROM generate_series(1, 33) g;
SELECT m1ct.expect('a chain with 32 ancestors is accepted', (SELECT count(*) = 33 FROM public.workspace_org_units WHERE code LIKE 'm1c-chain%'));
SELECT m1ct.expect('one more level (33 ancestors) is refused',
  m1ct.state($q$INSERT INTO public.workspace_org_units (id, org_id, parent_unit_id, unit_type, code, name) VALUES
   ('c2000000-0000-4000-8000-000000000034','c1000000-0000-4000-8000-0000000000a1','c2000000-0000-4000-8000-000000000033','section','m1c-chain34','D34')$q$) LIKE '23514:m1:unit_too_deep%');

SELECT m1ct.expect('the guard function is not executable by anon or authenticated',
  NOT has_function_privilege('anon', 'public.workspace_org_units_cycle_guard()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.workspace_org_units_cycle_guard()', 'EXECUTE'));
SELECT m1ct.expect('the guard is SECURITY DEFINER with a fixed search_path',
  (SELECT prosecdef AND proconfig IS NOT NULL FROM pg_proc WHERE oid = 'public.workspace_org_units_cycle_guard()'::regprocedure));
DO $$ BEGIN RAISE NOTICE 'M1C ALL PASS: 13 checks'; END $$;
ROLLBACK;
