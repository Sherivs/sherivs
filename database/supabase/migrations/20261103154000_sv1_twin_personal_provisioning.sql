-- SV1-TWIN-01 — one identity-bound personal twin per Scholar tenant.
-- Status: AUTHORED, NOT APPLIED. No production database was accessed.
-- Memory remains in the existing cg_memory_* substrate; this migration adds
-- only the personal-twin identity row and its reference to cg_memory_scope.
-- Rollback: database/supabase/rollbacks/20261103154000_sv1_twin_personal_provisioning.sql

BEGIN;

CREATE TABLE public.cg_personal_twin (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  school_id        uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  tenant_ref       text GENERATED ALWAYS AS (school_id::text) STORED,
  memory_scope_id  text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cg_personal_twin_identity_tenant_unique UNIQUE (identity_id, school_id),
  CONSTRAINT cg_personal_twin_memory_scope_tenant_fk
    FOREIGN KEY (memory_scope_id, tenant_ref)
    REFERENCES public.cg_memory_scope (id, tenant_id)
    ON DELETE RESTRICT
);

COMMENT ON TABLE public.cg_personal_twin IS
  'ACTIVE-V1 personal twin identity binding. One row per authenticated identity '
  'and Scholar tenant; personal memory is scoped through the existing cg_memory_scope.';

ALTER TABLE public.cg_personal_twin ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_personal_twin FORCE ROW LEVEL SECURITY;

CREATE POLICY cg_personal_twin_select_own_active_tenant
  ON public.cg_personal_twin
  FOR SELECT
  TO authenticated
  USING (
    identity_id = (SELECT auth.uid())
    AND school_id = (SELECT public.get_my_school_id())
    AND EXISTS (
      SELECT 1
      FROM public.organization_memberships m
      WHERE m.user_id = (SELECT auth.uid())
        AND m.school_id = cg_personal_twin.school_id
        AND m.is_active = true
    )
  );

REVOKE ALL ON TABLE public.cg_personal_twin FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.cg_personal_twin TO authenticated;
GRANT ALL ON TABLE public.cg_personal_twin TO service_role;

CREATE FUNCTION public.cg_personal_twin_provision(
  p_identity_id uuid,
  p_school_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
DECLARE
  v_twin public.cg_personal_twin%ROWTYPE;
  v_twin_id uuid;
  v_scope_id text;
  v_audit_school_id uuid;
  v_audit_identity_id uuid;
  v_created boolean := false;
  v_correlation_id text := gen_random_uuid()::text;
BEGIN
  IF p_identity_id IS NULL OR p_school_id IS NULL THEN
    RAISE EXCEPTION 'personal twin identity and tenant are required';
  END IF;

  -- Locking the active membership serializes retries for this identity/tenant
  -- and prevents a concurrent membership revocation during provisioning.
  PERFORM 1
  FROM public.organization_memberships m
  JOIN public.users u ON u.id = m.user_id
  WHERE m.user_id = p_identity_id
    AND m.school_id = p_school_id
    AND m.is_active = true
    AND u.is_active = true
  FOR UPDATE OF m, u;

  IF NOT FOUND THEN
    SELECT s.id INTO v_audit_school_id
    FROM public.schools s
    WHERE s.id = p_school_id;
    SELECT u.id INTO v_audit_identity_id
    FROM public.users u
    WHERE u.id = p_identity_id;

    INSERT INTO public.audit_logs (
      school_id, user_id, action, table_name, record_id, old_value, new_value
    ) VALUES (
      v_audit_school_id,
      v_audit_identity_id,
      'twin.personal.provision',
      'cg_personal_twin',
      NULL,
      NULL,
      jsonb_build_object(
        'gate', 'server-resolved-active-membership',
        'outcome', 'denied',
        'denial_reason', 'active_identity_membership_required',
        'correlation_id', v_correlation_id,
        'actor_kind', 'human',
        'actor_id', p_identity_id,
        'tenant_id', p_school_id,
        'recorded_at', now()
      )
    );
    RETURN jsonb_build_object('outcome', 'denied');
  END IF;

  SELECT * INTO v_twin
  FROM public.cg_personal_twin t
  WHERE t.identity_id = p_identity_id
    AND t.school_id = p_school_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_twin_id := gen_random_uuid();
    v_scope_id := 'personal-twin:' || v_twin_id::text;

    INSERT INTO public.cg_memory_scope (
      id, tenant_id, mission_ref, actor_scope, domains, max_sensitivity, declared_by
    ) VALUES (
      v_scope_id,
      p_school_id::text,
      NULL,
      jsonb_build_array(p_identity_id::text),
      '["personal-twin"]'::jsonb,
      'internal',
      p_identity_id::text
    );

    INSERT INTO public.cg_personal_twin (id, identity_id, school_id, memory_scope_id)
    VALUES (v_twin_id, p_identity_id, p_school_id, v_scope_id)
    RETURNING * INTO v_twin;
    v_created := true;
  END IF;

  INSERT INTO public.audit_logs (
    school_id, user_id, action, table_name, record_id, old_value, new_value
  ) VALUES (
    p_school_id,
    p_identity_id,
    'twin.personal.provision',
    'cg_personal_twin',
    v_twin.id,
    NULL,
    jsonb_build_object(
      'gate', 'server-resolved-active-membership',
      'outcome', 'succeeded',
      'created', v_created,
      'correlation_id', v_correlation_id,
      'actor_kind', 'human',
      'actor_id', p_identity_id,
      'tenant_id', p_school_id,
      'memory_scope_id', v_twin.memory_scope_id,
      'recorded_at', now()
    )
  );

  RETURN jsonb_build_object(
    'outcome', 'succeeded',
    'twin_id', v_twin.id,
    'memory_scope_id', v_twin.memory_scope_id,
    'created', v_created
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cg_personal_twin_provision(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_personal_twin_provision(uuid, uuid) TO service_role;

COMMIT;
