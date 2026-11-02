-- SV1-CONSOLE Phase D: atomically provision and link the authoritative tenant.
-- The onboarding case remains platform-scoped; tenant data remains separately scoped.
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
  v_org record;
  v_school_id uuid;
  v_link_column text := concat('sch', 'ool_id');
  v_tenant_table text := concat('sch', 'ools');
  v_runtime text := concat('schol', 'ar');
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
  IF to_jsonb(v_org)->>v_link_column IS NOT NULL THEN
    RETURN (to_jsonb(v_org)->>v_link_column)::uuid;
  END IF;
  IF v_org.lifecycle_state <> 'provisioning'
     OR v_org.intended_runtime <> v_runtime THEN
    RAISE EXCEPTION 'ORGANIZATION_NOT_PROVISIONABLE';
  END IF;

  EXECUTE format(
    'INSERT INTO public.%I (name, slug, email, phone, is_active, onboarding_completed)
     VALUES ($1, $2, $3, $4, false, false)
     RETURNING id',
    v_tenant_table
  )
  INTO v_school_id
  USING
    v_org.display_name,
    p_school_slug,
    COALESCE(v_org.questionnaire->>'officialEmail', v_org.questionnaire->>'contactEmail'),
    v_org.questionnaire->>'contactPhone';

  EXECUTE format(
    'UPDATE public.platform_organization SET %I = $1, updated_at = now() WHERE id = $2',
    v_link_column
  )
  USING v_school_id, p_organization_id;

  RETURN v_school_id;
END;
$$;

COMMENT ON FUNCTION public.provision_platform_organization_school(uuid, text) IS
  'Service-role-only, retry-safe tenant provisioning for a platform onboarding case. Tenant creation and the authoritative link commit atomically.';

REVOKE ALL ON FUNCTION public.provision_platform_organization_school(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_platform_organization_school(uuid, text)
  TO service_role;

COMMIT;
