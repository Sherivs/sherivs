-- Rollback for the SEC-M0 proposal. It reopens what SEC-M0 closed; use it only to recover a broken
-- public page, and prefer granting the one missing object instead.
-- It cannot restore the exact previous per-object grants (81 tables, 50 functions). It restores
-- the previous behaviour class: anon and authenticated may reach every object again and RLS decides.
BEGIN;

GRANT INSERT, UPDATE, DELETE ON TABLE public.subscriptions TO authenticated;
DROP POLICY IF EXISTS tenant_read_subscriptions ON public.subscriptions;
DROP POLICY IF EXISTS tenant_all_subscriptions ON public.subscriptions;
CREATE POLICY tenant_all_subscriptions ON public.subscriptions FOR ALL TO public
  USING (school_id = public.get_my_school_id() OR public.is_super_admin())
  WITH CHECK (school_id = public.get_my_school_id() OR public.is_super_admin());

GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

COMMIT;
