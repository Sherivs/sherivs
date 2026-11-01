-- SV1-CONSOLE Phase D: atomically provision and link the authoritative school.
-- The onboarding case remains platform-scoped; Scholar data remains school-scoped.
-- Rollback: database/supabase/rollbacks/20261101100000_sv1_console_phase_d_org_school_link.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.provision_platform_organization_school(
  p_organization_id uuid,
  p_school_slug text
) RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org public.platform_organization%ROWTYPE;
  v_school_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL
     OR p_school_slug IS NULL
     OR p_school_slug !~ '^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$' THEN
    RAISE EXCEPTION 'INVALID_PROVISIONING_INPUT';
  END IF;

  SELECT * INTO v_org
    FROM public.platform_organization
   WHERE id = p_organization_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORGANIZATION_NOT_FOUND';
  END IF;
  IF v_org.school_id IS NOT NULL THEN
    RETURN v_org.school_id;
  END IF;
  IF v_org.lifecycle_state <> 'provisioning'
     OR v_org.intended_runtime <> 'scholar' THEN
    RAISE EXCEPTION 'ORGANIZATION_NOT_PROVISIONABLE';
  END IF;

  INSERT INTO public.schools (name, slug, email, phone, is_active, onboarding_completed)
  VALUES (
    v_org.display_name,
    p_school_slug,
    COALESCE(v_org.questionnaire->>'officialEmail', v_org.questionnaire->>'contactEmail'),
    v_org.questionnaire->>'contactPhone',
    false,
    false
  )
  RETURNING id INTO v_school_id;

  UPDATE public.platform_organization
     SET school_id = v_school_id,
         updated_at = now()
   WHERE id = p_organization_id;

  RETURN v_school_id;
END;
$$;

COMMENT ON FUNCTION public.provision_platform_organization_school(uuid, text) IS
  'Service-role-only, retry-safe school provisioning for a platform onboarding case. School creation and the authoritative link commit atomically.';

REVOKE ALL ON FUNCTION public.provision_platform_organization_school(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_platform_organization_school(uuid, text)
  TO service_role;

COMMIT;
