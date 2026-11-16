-- Rollback for the SEC-M0 proposal: restores exactly what anon and PUBLIC held before the apply,
-- from the snapshot the apply took (ops_private.sec_m0_acl_snapshot). It grants nothing that was
-- not there before. It refuses to run without a snapshot.
-- Prefer granting the one missing object over running this: it reopens every hole SEC-M0 closed.
-- Not restored, because they change no behaviour: the explicit EXECUTE grants the apply gave
-- authenticated and service_role for access they already had through PUBLIC.
BEGIN;

DO $sec_m0_rb$
DECLARE
  r record;
BEGIN
  IF to_regclass('ops_private.sec_m0_acl_snapshot') IS NULL
     OR NOT EXISTS (SELECT 1 FROM ops_private.sec_m0_acl_snapshot) THEN
    RAISE EXCEPTION 'SEC-M0 rollback: no ACL snapshot found; nothing was changed';
  END IF;

  -- Clear what anon and PUBLIC hold now on every public object, then put back the snapshot.
  FOR r IN SELECT c.oid::regclass AS obj, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S') LOOP
    EXECUTE format('REVOKE ALL ON %s %s FROM anon',
                   CASE WHEN r.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, r.obj);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS obj FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
              AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e') LOOP
    EXECUTE format('REVOKE EXECUTE ON ROUTINE %s FROM PUBLIC, anon', r.obj);
  END LOOP;

  FOR r IN
    SELECT s.kind, s.column_name, s.grantee, s.privilege,
           CASE s.kind WHEN 'routine' THEN s.object_oid::regprocedure::text
                       ELSE s.object_oid::regclass::text END AS obj
      FROM ops_private.sec_m0_acl_snapshot s
     WHERE CASE s.kind WHEN 'routine' THEN EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = s.object_oid)
                       ELSE EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = s.object_oid) END
  LOOP
    IF r.kind = 'routine' THEN
      EXECUTE format('GRANT %s ON ROUTINE %s TO %s', r.privilege, r.obj, r.grantee);
    ELSIF r.kind = 'sequence' THEN
      EXECUTE format('GRANT %s ON SEQUENCE %s TO %s', r.privilege, r.obj, r.grantee);
    ELSIF r.kind = 'column' THEN
      EXECUTE format('GRANT %s (%I) ON TABLE %s TO %s', r.privilege, r.column_name, r.obj, r.grantee);
    ELSE
      EXECUTE format('GRANT %s ON TABLE %s TO %s', r.privilege, r.obj, r.grantee);
    END IF;
  END LOOP;
END
$sec_m0_rb$;

-- subscriptions: back to the previous policy and grants.
GRANT INSERT, UPDATE, DELETE ON TABLE public.subscriptions TO authenticated;
DROP POLICY IF EXISTS tenant_read_subscriptions ON public.subscriptions;
DROP POLICY IF EXISTS tenant_all_subscriptions ON public.subscriptions;
CREATE POLICY tenant_all_subscriptions ON public.subscriptions FOR ALL TO public
  USING (school_id = public.get_my_school_id() OR public.is_super_admin())
  WITH CHECK (school_id = public.get_my_school_id() OR public.is_super_admin());

-- Default privileges for postgres, as audited on 2026-11-16. MAINTAIN exists from PostgreSQL 17.
DO $sec_m0_rb_defaults$
BEGIN
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER%s ON TABLES TO anon, authenticated',
    CASE WHEN current_setting('server_version_num')::int >= 170000 THEN ', MAINTAIN' ELSE '' END);
END
$sec_m0_rb_defaults$;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

COMMIT;
