-- =============================================================================
-- CoreGrid Scholar — role assignment & grant substrate (WAVE-R37, S2)
-- =============================================================================
-- Author: CoreGrid Autonomous Engineering Loop (2026-09-07)
-- Status: AUTHORED — NOT APPLIED (kept DB-gated; apply + verify via the
--         project's migration runner, then record the proof in PROGRESS).
--
-- ARCHITECTURAL BOUNDARY (Phase 01 §5, BOUNDARIES §2, Constitution §16–17):
--   This substrate stores TENANT POLICY DATA, not enforcement:
--     cg_role_assignment -- which reality role an identity holds in a tenant
--                           (time-bounded; reality data + risk context)
--     cg_role_grant      -- which capability a tenant grants to a role, with
--                           the granting actor and revocation history
--
--   Rows are INPUTS to the runtime feature gate (frontend/src/lib/scholar/
--   feature-gate.ts) and are NEVER trusted from the client. Enforcement stays
--   with Phase 08 (security-role-gate) + RLS; the SQL surface below re-derives
--   the tenant from the actor inside every function.
--
-- Security posture: control-plane substrate. RLS enabled with zero policies;
--   anon/authenticated denied by default; scoped access only through the
--   SECURITY DEFINER functions granted below (school-admin scope enforced).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Role assignments (tenant-scoped, time-bounded)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cg_role_assignment (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref   text NOT NULL,
  identity_ref text NOT NULL,
  role_id      text NOT NULL CHECK (role_id ~ '^role:[a-z0-9]+(-[a-z0-9]+)*$'),
  status       text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('proposed','active','suspended','ended')),
  started_on   date NOT NULL DEFAULT CURRENT_DATE,
  ended_on     date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_on IS NULL OR ended_on >= started_on)
);

COMMENT ON TABLE public.cg_role_assignment IS
  $comment$Tenant-scoped appointment of an identity to an Educational Reality role
  (role ids come from the role engine catalog; grants are separate rows).
  Consumed by the runtime feature gate as an input; authorization is decided
  by Phase 08 + policy, never by the mere existence of a row.$comment$;

CREATE UNIQUE INDEX IF NOT EXISTS cg_role_assignment_active_idx
  ON public.cg_role_assignment (tenant_ref, identity_ref, role_id)
  WHERE status IN ('proposed','active','suspended');

CREATE INDEX IF NOT EXISTS cg_role_assignment_identity_idx
  ON public.cg_role_assignment (tenant_ref, identity_ref);
CREATE INDEX IF NOT EXISTS cg_role_assignment_role_idx
  ON public.cg_role_assignment (tenant_ref, role_id);

CREATE TRIGGER cg_role_assignment_touch
  BEFORE UPDATE ON public.cg_role_assignment
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- 2. Role capability grants (tenant policy data, revocable, audited)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cg_role_grant (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  role_id    text NOT NULL CHECK (role_id ~ '^role:[a-z0-9]+(-[a-z0-9]+)*$'),
  capability text NOT NULL CHECK (capability ~ '^[a-z][a-z0-9-]{1,80}$'),
  granted_by text NOT NULL,
  granted_on timestamptz NOT NULL DEFAULT now(),
  revoked_on timestamptz
);

COMMENT ON TABLE public.cg_role_grant IS
  $comment$Capability grant a tenant installs on a reality role. granted_by is always
  auth.uid() captured inside grant_role_capability() — never client-supplied.
  Revocation is a timestamp (history is preserved, never deleted).$comment$;

CREATE UNIQUE INDEX IF NOT EXISTS cg_role_grant_active_idx
  ON public.cg_role_grant (tenant_ref, role_id, capability)
  WHERE revoked_on IS NULL;

CREATE INDEX IF NOT EXISTS cg_role_grant_tenant_idx
  ON public.cg_role_grant (tenant_ref, role_id);

-- -----------------------------------------------------------------------------
-- 3. Security posture (control-plane substrate)
-- -----------------------------------------------------------------------------
ALTER TABLE public.cg_role_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_role_grant      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cg_role_assignment, public.cg_role_grant
  FROM anon, authenticated;
GRANT ALL ON TABLE public.cg_role_assignment, public.cg_role_grant
  TO service_role;

-- -----------------------------------------------------------------------------
-- 4. Scoped RPC surface (school-admin scope re-derived from the actor)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_role_assignments(p_tenant uuid)
RETURNS TABLE (
  id           uuid,
  identity_ref text,
  role_id      text,
  status       text,
  started_on   date,
  ended_on     date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.identity_ref, a.role_id, a.status, a.started_on, a.ended_on
  FROM public.cg_role_assignment a
  WHERE a.tenant_ref = p_tenant::text
    AND public.is_school_admin()
    AND public.get_my_school_id() = p_tenant
  ORDER BY a.role_id, a.identity_ref;
$$;

GRANT EXECUTE ON FUNCTION public.list_role_assignments(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_role(
  p_tenant     uuid,
  p_identity   uuid,
  p_role_id    text,
  p_started_on date DEFAULT CURRENT_DATE,
  p_ended_on   date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_school_admin() OR public.get_my_school_id() <> p_tenant THEN
    RAISE EXCEPTION 'Not authorized to assign roles for this tenant';
  END IF;

  SELECT a.id INTO v_id
  FROM public.cg_role_assignment a
  WHERE a.tenant_ref = p_tenant::text
    AND a.identity_ref = p_identity::text
    AND a.role_id = p_role_id
    AND a.status IN ('proposed','active','suspended')
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.cg_role_assignment
    (tenant_ref, identity_ref, role_id, status, started_on, ended_on)
  VALUES
    (p_tenant::text, p_identity::text, p_role_id, 'active', p_started_on, p_ended_on)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_role(uuid, uuid, text, date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.end_role_assignment(p_assignment_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant text;
BEGIN
  SELECT a.tenant_ref INTO v_tenant
  FROM public.cg_role_assignment a
  WHERE a.id = p_assignment_id;

  IF v_tenant IS NULL THEN
    RETURN false;
  END IF;

  IF NOT public.is_school_admin() OR public.get_my_school_id()::text <> v_tenant THEN
    RAISE EXCEPTION 'Not authorized to end this assignment';
  END IF;

  UPDATE public.cg_role_assignment
  SET status = 'ended', ended_on = COALESCE(ended_on, CURRENT_DATE)
  WHERE id = p_assignment_id AND status <> 'ended';

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.end_role_assignment(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_role_grants(p_tenant uuid)
RETURNS TABLE (
  id          uuid,
  role_id     text,
  capability  text,
  granted_by  text,
  granted_on  timestamptz,
  revoked_on  timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT g.id, g.role_id, g.capability, g.granted_by, g.granted_on, g.revoked_on
  FROM public.cg_role_grant g
  WHERE g.tenant_ref = p_tenant::text
    AND public.is_school_admin()
    AND public.get_my_school_id() = p_tenant
  ORDER BY g.role_id, g.capability, g.granted_on;
$$;

GRANT EXECUTE ON FUNCTION public.list_role_grants(uuid) TO authenticated;

-- granted_by is captured from auth.uid() — a client can never assert who granted.
CREATE OR REPLACE FUNCTION public.grant_role_capability(
  p_tenant     uuid,
  p_role_id    text,
  p_capability text
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_school_admin() OR public.get_my_school_id() <> p_tenant THEN
    RAISE EXCEPTION 'Not authorized to grant capabilities for this tenant';
  END IF;

  SELECT g.id INTO v_id
  FROM public.cg_role_grant g
  WHERE g.tenant_ref = p_tenant::text
    AND g.role_id = p_role_id
    AND g.capability = p_capability
    AND g.revoked_on IS NULL
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.cg_role_grant (tenant_ref, role_id, capability, granted_by)
  VALUES (p_tenant::text, p_role_id, p_capability, COALESCE(auth.uid()::text, 'service'))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_role_capability(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_role_capability(p_grant_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant text;
BEGIN
  SELECT g.tenant_ref INTO v_tenant
  FROM public.cg_role_grant g
  WHERE g.id = p_grant_id AND g.revoked_on IS NULL;

  IF v_tenant IS NULL THEN
    RETURN false;
  END IF;

  IF NOT public.is_school_admin() OR public.get_my_school_id()::text <> v_tenant THEN
    RAISE EXCEPTION 'Not authorized to revoke this grant';
  END IF;

  UPDATE public.cg_role_grant
  SET revoked_on = now()
  WHERE id = p_grant_id AND revoked_on IS NULL;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.revoke_role_capability(uuid) TO authenticated;

-- =============================================================================
-- End of migration. Verification (run when applied):
--   node scripts/verify-role-assignment-substrate.mjs   (see scripts/)
-- Expectations: both tables present for the service role, denied for anon,
-- is_school_admin() gate rejects non-admins, active-grant uniqueness holds,
-- revoke preserves history, and grants never bypass Phase 08.
-- =============================================================================

