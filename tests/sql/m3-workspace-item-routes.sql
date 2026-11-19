-- Disposable proof for 20261117001200_sherivs_m3_workspace_item_routes.sql.
-- A small production-shaped copy of public.workspace_item_catalog (same columns, RLS, policy and
-- grants as UX1/UX2 left them), then: the move to shell routes, the kept legacy value, a second run
-- that changes nothing, unchanged privileges and policies, and an exact rollback. The catalogue is
-- global (no organization column), so there is no cross-organization case to prove.
-- Run as a superuser against an EMPTY database, from the repository root:
--   psql -d m3_test -v ON_ERROR_STOP=1 -f tests/sql/m3-workspace-item-routes.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.workspace_item_catalog (
  key text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('nav','widget','action','inbox')),
  route text NOT NULL,
  any_permissions text[] NOT NULL DEFAULT '{}',
  all_permissions text[] NOT NULL DEFAULT '{}',
  feature text,
  size text NOT NULL DEFAULT 'm',
  label_en text NOT NULL,
  families text[] NOT NULL DEFAULT '{}',
  sort int NOT NULL DEFAULT 0,
  scope_dims text[] NOT NULL DEFAULT '{}',
  policy text);
ALTER TABLE public.workspace_item_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_item_catalog FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_item_catalog_read ON public.workspace_item_catalog FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.workspace_item_catalog FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.workspace_item_catalog TO authenticated;
GRANT ALL ON public.workspace_item_catalog TO service_role;

INSERT INTO public.workspace_item_catalog (key, kind, route, label_en, sort) VALUES
  ('nav.home', 'nav', '/workspace', 'Home', 1),
  ('nav.students', 'nav', '/admin/students', 'People', 2),
  ('nav.messages', 'nav', '/messages', 'Messages', 3),
  ('w.my_trip', 'widget', '/driver', 'My trip', 4),
  ('w.gov_overview', 'widget', '/gov-dashboard', 'Overview', 5),
  ('a.pay_fees', 'action', '/parent/fees', 'Pay', 6),
  ('i.alerts', 'inbox', '/notifications', 'Alerts', 7),
  ('w.already_shell', 'widget', '/home/s/w.already_shell', 'Already moved', 8);

CREATE TEMP TABLE before_rows AS SELECT key, route FROM public.workspace_item_catalog;
CREATE TEMP TABLE before_privs AS
  SELECT r.rolname, p.priv, has_table_privilege(r.rolname, 'public.workspace_item_catalog', p.priv) AS ok
    FROM pg_roles r, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
   WHERE r.rolname IN ('anon','authenticated','service_role');
CREATE TEMP TABLE before_policies AS
  SELECT policyname, cmd, roles::text, qual FROM pg_policies WHERE tablename = 'workspace_item_catalog';

\i database/supabase/migrations/20261117001200_sherivs_m3_workspace_item_routes.sql

DO $$
DECLARE n int;
BEGIN
  -- positive: every row is a shell route
  SELECT count(*) INTO n FROM public.workspace_item_catalog
   WHERE route <> CASE WHEN key = 'nav.home' THEN '/home' ELSE '/home/s/' || key END;
  IF n <> 0 THEN RAISE EXCEPTION 'expected every route to be a shell route, % are not', n; END IF;
  IF (SELECT route FROM public.workspace_item_catalog WHERE key = 'nav.home') <> '/home' THEN
    RAISE EXCEPTION 'nav.home must open /home'; END IF;
  -- the previous value is kept exactly
  SELECT count(*) INTO n FROM public.workspace_item_catalog c JOIN before_rows b USING (key)
   WHERE c.legacy_route IS DISTINCT FROM b.route AND b.route NOT LIKE '/home/s/%';
  IF n <> 0 THEN RAISE EXCEPTION 'legacy_route must hold the previous route, % rows differ', n; END IF;
  -- negative: a row that was already a shell route is not touched
  IF (SELECT legacy_route FROM public.workspace_item_catalog WHERE key = 'w.already_shell') IS NOT NULL THEN
    RAISE EXCEPTION 'an already-moved row must keep legacy_route NULL'; END IF;
  -- no legacy portal path is left
  SELECT count(*) INTO n FROM public.workspace_item_catalog
   WHERE route ~ '^/(admin|teacher|bursar|parent|student|driver|gov-dashboard|messages|notifications|settings|workspace)';
  IF n <> 0 THEN RAISE EXCEPTION 'legacy paths remain: %', n; END IF;
  RAISE NOTICE 'PASS apply: % rows on shell routes', (SELECT count(*) FROM public.workspace_item_catalog);
END $$;

-- privileges and policies unchanged
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM before_privs b
   WHERE has_table_privilege(b.rolname, 'public.workspace_item_catalog', b.priv) IS DISTINCT FROM b.ok;
  IF n <> 0 THEN RAISE EXCEPTION 'table privileges changed for % role/privilege pairs', n; END IF;
  SELECT count(*) INTO n FROM (
    (SELECT policyname, cmd, roles::text, qual FROM pg_policies WHERE tablename = 'workspace_item_catalog'
     EXCEPT SELECT * FROM before_policies)
    UNION ALL
    (SELECT * FROM before_policies
     EXCEPT SELECT policyname, cmd, roles::text, qual FROM pg_policies WHERE tablename = 'workspace_item_catalog')) d;
  IF n <> 0 THEN RAISE EXCEPTION 'policies changed'; END IF;
  IF has_column_privilege('anon', 'public.workspace_item_catalog', 'legacy_route', 'SELECT') THEN
    RAISE EXCEPTION 'anon must not read legacy_route'; END IF;
  IF NOT has_column_privilege('authenticated', 'public.workspace_item_catalog', 'legacy_route', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated must read legacy_route like every other column'; END IF;
  IF has_column_privilege('authenticated', 'public.workspace_item_catalog', 'legacy_route', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated must not write legacy_route'; END IF;
  RAISE NOTICE 'PASS privileges and policies unchanged';
END $$;

-- a signed-in caller reads the new column and cannot write it
SET ROLE authenticated;
SELECT count(*) AS readable_rows FROM public.workspace_item_catalog WHERE legacy_route IS NOT NULL;
DO $$ BEGIN
  BEGIN
    UPDATE public.workspace_item_catalog SET route = '/x' WHERE key = 'nav.home';
    RAISE EXCEPTION 'authenticated update must be refused';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS authenticated update refused';
  END;
END $$;
RESET ROLE;

-- second run changes nothing
CREATE TEMP TABLE after_first AS SELECT key, route, legacy_route FROM public.workspace_item_catalog;
\i database/supabase/migrations/20261117001200_sherivs_m3_workspace_item_routes.sql
DO $$ BEGIN
  IF EXISTS ((SELECT key, route, legacy_route FROM public.workspace_item_catalog EXCEPT SELECT * FROM after_first)
             UNION ALL (SELECT * FROM after_first EXCEPT SELECT key, route, legacy_route FROM public.workspace_item_catalog)) THEN
    RAISE EXCEPTION 'second run changed rows'; END IF;
  RAISE NOTICE 'PASS second run is a no-op';
END $$;

-- rollback restores every route exactly and removes the column
\i database/supabase/rollbacks/20261117001200_sherivs_m3_workspace_item_routes.sql
DO $$ BEGIN
  IF EXISTS ((SELECT key, route FROM public.workspace_item_catalog EXCEPT SELECT * FROM before_rows)
             UNION ALL (SELECT * FROM before_rows EXCEPT SELECT key, route FROM public.workspace_item_catalog)) THEN
    RAISE EXCEPTION 'rollback did not restore routes exactly'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'workspace_item_catalog' AND column_name = 'legacy_route') THEN
    RAISE EXCEPTION 'rollback must drop legacy_route'; END IF;
  RAISE NOTICE 'PASS rollback restored % routes exactly', (SELECT count(*) FROM before_rows);
END $$;

-- apply again after rollback works (forward path is repeatable)
\i database/supabase/migrations/20261117001200_sherivs_m3_workspace_item_routes.sql
DO $$ BEGIN
  IF (SELECT legacy_route FROM public.workspace_item_catalog WHERE key = 'w.my_trip') <> '/driver' THEN
    RAISE EXCEPTION 're-apply after rollback must record the legacy route again'; END IF;
  RAISE NOTICE 'PASS re-apply after rollback';
END $$;
