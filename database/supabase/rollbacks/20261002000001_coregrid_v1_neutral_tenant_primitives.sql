-- =============================================================================
-- Rollback: 20261002000001_coregrid_v1_neutral_tenant_primitives.sql (MISSION-R-20)
-- Status: AUTHORED, NOT APPLIED.
-- WARNING: restores the pre-migration gate posture — every universal cg_
-- substrate RPC below is re-pointed BACK to the Scholar helpers
-- (get_my_school_id / is_school_admin) exactly as defined by their
-- authoritative source migrations, and the three neutral helpers are
-- dropped. This re-introduces the STREAM_I I-002/I-003/I-004/I-005
-- contamination (a non-Scholar tenant can no longer hold or administer a
-- role assignment). For retiring the migration, not for undoing single
-- executions (matches the foundation-001 / org-model rollback discipline).
--
-- Rollback order matters: the re-pointed RPCs are restored FIRST (their
-- bodies reference the neutral predicate), then the neutral helpers are
-- dropped. No table changes exist to reverse (the migration is
-- redefinition-only).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Restore Scholar-gated RPC bodies (verbatim from source migrations)
-- -----------------------------------------------------------------------------

-- Workforce position surface — 20260907000300 (+ final end body 20260907000500)
CREATE OR REPLACE FUNCTION public.list_workforce_positions(p_tenant uuid)
RETURNS TABLE (
  id              uuid,
  identity_ref    text,
  kind_code       text,
  kind_title      text,
  family          text,
  employment_type text,
  started_on      date,
  ended_on        date,
  status          text,
  is_primary      boolean,
  authority_group text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.id, w.identity_ref, w.kind_code, k.title, k.family,
         w.employment_type, w.started_on, w.ended_on, w.status, w.is_primary,
         k.authority_group
  FROM public.cg_workforce_position w
  JOIN public.cg_workforce_kind k
    ON k.runtime_ref = w.runtime_ref AND k.kind_code = w.kind_code
  WHERE w.tenant_ref = p_tenant::text
    AND public.is_school_admin()
    AND public.get_my_school_id() = p_tenant
  ORDER BY w.is_primary DESC, w.started_on DESC, w.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.assign_workforce_position(
  p_tenant          uuid,
  p_identity        uuid,
  p_kind_code       text,
  p_runtime         text DEFAULT 'runtime:scholar',
  p_primary         boolean DEFAULT false,
  p_employment_type text DEFAULT 'full_time',
  p_started_on      date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_position_id uuid;
BEGIN
  IF NOT public.is_school_admin() OR public.get_my_school_id() <> p_tenant THEN
    RAISE EXCEPTION 'Forbidden: school admin role required';
  END IF;
  IF p_employment_type NOT IN ('full_time','part_time','contract','volunteer','intern','seconded') THEN
    RAISE EXCEPTION 'Invalid employment type';
  END IF;

  IF p_primary THEN
    UPDATE public.cg_workforce_position
       SET is_primary = false, updated_at = now()
     WHERE tenant_ref = p_tenant::text
       AND runtime_ref = p_runtime
       AND identity_ref = p_identity::text
       AND is_primary
       AND status IN ('proposed','active','on_leave');
  END IF;

  INSERT INTO public.cg_workforce_position (
    tenant_ref, runtime_ref, kind_code, identity_ref, is_primary,
    employment_type, started_on, status, attributes
  ) VALUES (
    p_tenant::text, p_runtime, p_kind_code, p_identity::text, p_primary,
    p_employment_type, p_started_on, 'active', '{}'::jsonb
  )
  ON CONFLICT (tenant_ref, runtime_ref, identity_ref, kind_code)
  DO UPDATE SET is_primary = EXCLUDED.is_primary,
                employment_type = EXCLUDED.employment_type,
                started_on = EXCLUDED.started_on,
                ended_on = NULL,
                status = 'active',
                updated_at = now()
  RETURNING id INTO v_position_id;

  RETURN v_position_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.end_workforce_position(
  p_position_id uuid,
  p_ended_on    date DEFAULT CURRENT_DATE
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant       text;
  v_identity     text;
  v_was_primary  boolean;
BEGIN
  SELECT tenant_ref, identity_ref, is_primary
    INTO v_tenant, v_identity, v_was_primary
    FROM public.cg_workforce_position
   WHERE id = p_position_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Position not found';
  END IF;
  IF NOT public.is_school_admin() OR public.get_my_school_id() <> v_tenant::uuid THEN
    RAISE EXCEPTION 'Forbidden: school admin role required';
  END IF;

  UPDATE public.cg_workforce_position
     SET status = 'ended', ended_on = p_ended_on,
         is_primary = false, updated_at = now()
   WHERE id = p_position_id;

  IF v_was_primary THEN
    UPDATE public.cg_workforce_position
       SET is_primary = true, updated_at = now()
     WHERE id = (
       SELECT id
         FROM public.cg_workforce_position
        WHERE tenant_ref = v_tenant
          AND identity_ref = v_identity
          AND id <> p_position_id
          AND is_primary = false
          AND status IN ('active','on_leave')
        ORDER BY started_on DESC, created_at DESC
        LIMIT 1
     );
  END IF;

  RETURN FOUND;
END;
$$;

-- Organization-profile surface — 20260907000700
CREATE OR REPLACE FUNCTION public.get_org_profile(
  p_tenant uuid, p_runtime text, p_profile_key text
)
RETURNS TABLE (id uuid, payload jsonb, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, payload, updated_at
    FROM public.cg_org_profile
   WHERE tenant_ref = p_tenant::text
     AND runtime_ref = p_runtime
     AND profile_key = p_profile_key
     AND public.is_school_admin()
     AND public.get_my_school_id() = p_tenant
$$;

CREATE OR REPLACE FUNCTION public.upsert_org_profile(
  p_tenant uuid, p_runtime text, p_profile_key text, p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_school_admin() OR public.get_my_school_id() <> p_tenant THEN
    RAISE EXCEPTION 'Forbidden: school admin role required';
  END IF;
  IF jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'payload must be a JSON object';
  END IF;

  INSERT INTO public.cg_org_profile (tenant_ref, runtime_ref, profile_key, payload)
  VALUES (p_tenant::text, p_runtime, p_profile_key, p_payload)
  ON CONFLICT (tenant_ref, runtime_ref, profile_key)
  DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Role assignment + capability-grant surface — 20260907000800
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

-- -----------------------------------------------------------------------------
-- 2. Drop the neutral helpers (after the RPC bodies no longer reference them)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.is_tenant_admin(text);
DROP FUNCTION IF EXISTS public.holds_tenant_role(text, text);
DROP FUNCTION IF EXISTS public.get_my_tenant_id();