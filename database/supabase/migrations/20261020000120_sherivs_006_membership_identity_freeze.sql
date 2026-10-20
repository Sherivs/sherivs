-- SHERIVS-006: membership-aware identity privilege freeze.
--
-- Replaces the users-only proposal (20261015000010_*.sql.proposed). Production's
-- out-of-band identity helpers (captured in 20261003000042) resolve the caller's
-- school and role through public.organization_memberships. That stays, but two
-- holes found in the prod-like rehearsal are closed:
--   1. any signed-in user could UPDATE their own users.school_id / role /
--      is_active (the membership sync trigger then made it effective);
--   2. a deactivated users row kept its role through an active membership.
--
-- After this migration:
--   * get_my_school_id / get_my_role / my_active_role / is_school_admin all
--     resolve through organization_memberships (primary first, then oldest),
--     falling back to users, and ONLY when the users row exists and is active;
--   * users.role / school_id / is_active (and id) can change only as service_role;
--     direct INSERTs into users by anon/authenticated are refused (the
--     SECURITY DEFINER founder RPC still works);
--   * organization_memberships can be written only by service_role or by the
--     users -> memberships sync trigger (nested trigger), and anon/authenticated
--     lose their table write grants.
-- Idempotent. Rollback: database/supabase/rollbacks/20261020000120_*.sql

BEGIN;

-- 1. Identity helpers (membership-aware, fail closed on inactive/missing users row)
CREATE OR REPLACE FUNCTION public.get_my_school_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT m.school_id
       FROM public.organization_memberships m
      WHERE m.user_id = u.id AND m.is_active = true
      ORDER BY m.is_primary DESC, m.created_at ASC
      LIMIT 1),
    u.school_id)
  FROM public.users u
  WHERE u.id = auth.uid() AND u.is_active = true;
$$;
COMMENT ON FUNCTION public.get_my_school_id() IS
  $c$SHERIVS-006: caller's school from the primary active organization membership,
  falling back to users.school_id. NULL unless the users row exists and is active.$c$;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT m.role
       FROM public.organization_memberships m
      WHERE m.user_id = u.id AND m.is_active = true
      ORDER BY m.is_primary DESC, m.created_at ASC
      LIMIT 1),
    u.role)
  FROM public.users u
  WHERE u.id = auth.uid() AND u.is_active = true;
$$;
COMMENT ON FUNCTION public.get_my_role() IS
  $c$SHERIVS-006: caller's role from the primary active organization membership
  (same row as get_my_school_id), falling back to users.role. NULL unless the users
  row exists and is active.$c$;

CREATE OR REPLACE FUNCTION public.my_active_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$ SELECT public.get_my_role() $$;
REVOKE ALL ON FUNCTION public.my_active_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_active_role() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_school_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$ SELECT COALESCE(public.get_my_role() IN ('admin', 'principal'), false) $$;
COMMENT ON FUNCTION public.is_school_admin() IS
  $c$SHERIVS-006: true only when the active role (membership-aware, active users row
  required) is admin or principal. Deactivated administrators lose admin.$c$;

-- 2. users: privileged identity fields are service_role-only
CREATE OR REPLACE FUNCTION public.forbid_self_privilege_mutation()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_user IN ('anon', 'authenticated') THEN
      RAISE EXCEPTION 'Forbidden: identity rows are provisioned server-side only'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF current_user = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.school_id IS DISTINCT FROM OLD.school_id
     OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'Forbidden: only service_role may modify privileged identity fields (id, role, school_id, is_active)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.forbid_self_privilege_mutation() IS
  $c$SHERIVS-006 users guard. UPDATE of id/role/school_id/is_active only as
  service_role (JWT claims and auth.uid() are not trusted). INSERT refused for
  anon/authenticated; SECURITY DEFINER provisioning (founder RPC) and service_role
  are allowed.$c$;
REVOKE ALL ON FUNCTION public.forbid_self_privilege_mutation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_users_forbid_self_privilege_mutation ON public.users;
CREATE TRIGGER trg_users_forbid_self_privilege_mutation
  BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.forbid_self_privilege_mutation();

-- 3. organization_memberships: service_role or the users sync trigger only
CREATE OR REPLACE FUNCTION public.forbid_direct_membership_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  -- pg_trigger_depth() > 1: fired from inside sync_organization_membership_on_user_write,
  -- whose users write already passed trg_users_forbid_self_privilege_mutation.
  IF current_user = 'service_role' OR pg_trigger_depth() > 1 THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'Forbidden: organization memberships are changed server-side only'
    USING ERRCODE = '42501';
END;
$$;
COMMENT ON FUNCTION public.forbid_direct_membership_write() IS
  $c$SHERIVS-006 memberships guard: INSERT/UPDATE/DELETE only as service_role or via
  the users -> memberships sync trigger.$c$;
REVOKE ALL ON FUNCTION public.forbid_direct_membership_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_memberships_forbid_direct_write ON public.organization_memberships;
CREATE TRIGGER trg_memberships_forbid_direct_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.organization_memberships
  FOR EACH ROW EXECUTE FUNCTION public.forbid_direct_membership_write();

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, MAINTAIN ON public.organization_memberships FROM anon, authenticated;

COMMIT;
