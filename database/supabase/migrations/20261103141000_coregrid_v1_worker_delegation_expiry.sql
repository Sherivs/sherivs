-- =============================================================================
-- CoreGrid V1 — bounded worker delegation expiry (CORE-05 / ADR-020)
-- =============================================================================
-- Forward-only ALTER of the existing worker delegation surfaces plus
-- service-role-only transactional grant/revoke RPCs. Existing rows retain NULL
-- expiry and are rejected by runtime authorization until explicitly renewed
-- with a bounded grant. No worker tables or policies are created; the existing
-- RLS/FORCE RLS and deny-by-default grants are unchanged.
--
-- Rollback:
--   database/supabase/rollbacks/20261103141000_coregrid_v1_worker_delegation_expiry.sql
-- =============================================================================

BEGIN;

ALTER TABLE public.cg_worker_delegation
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD CONSTRAINT cg_worker_delegation_expiry_after_recorded
    CHECK (expires_at IS NULL OR expires_at > recorded_at);

ALTER TABLE public.cg_worker_delegation_grant
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD CONSTRAINT cg_worker_delegation_grant_expiry_after_granted
    CHECK (expires_at IS NULL OR expires_at > granted_at);

CREATE INDEX IF NOT EXISTS cg_worker_delegation_grant_active_expiry_idx
  ON public.cg_worker_delegation_grant (tenant_id, definition_id, expires_at)
  WHERE state = 'active' AND expires_at IS NOT NULL;

COMMENT ON COLUMN public.cg_worker_delegation.expires_at IS
  'CORE-05 bounded delegation window; NULL legacy history is retained but never authorizes runtime execution.';

COMMENT ON COLUMN public.cg_worker_delegation_grant.expires_at IS
  'CORE-05 live delegation expiry; active rows without an expiry fail closed at every activation and action gate.';

CREATE FUNCTION public.cg_worker_grant_delegation(
  p_tenant_id text,
  p_definition_id text,
  p_grant_id text,
  p_delegation_ref text,
  p_delegated_capabilities jsonb,
  p_max_granted_risk_class text,
  p_granted_by text,
  p_granted_at timestamptz,
  p_expires_at timestamptz,
  p_correlation_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_definition public.cg_worker_definition%ROWTYPE;
  v_existing public.cg_worker_delegation_grant%ROWTYPE;
  v_audit_tenant uuid;
BEGIN
  IF p_tenant_id IS NULL
    OR p_tenant_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR length(btrim(p_tenant_id)) NOT BETWEEN 1 AND 128
    OR p_definition_id IS NULL OR length(btrim(p_definition_id)) NOT BETWEEN 1 AND 160
    OR p_grant_id IS NULL OR length(btrim(p_grant_id)) NOT BETWEEN 1 AND 160
    OR p_delegation_ref IS NULL OR length(btrim(p_delegation_ref)) NOT BETWEEN 1 AND 200
    OR p_granted_by IS NULL OR length(btrim(p_granted_by)) NOT BETWEEN 1 AND 160
    OR p_correlation_id IS NULL OR length(btrim(p_correlation_id)) NOT BETWEEN 1 AND 200
    OR jsonb_typeof(p_delegated_capabilities) IS DISTINCT FROM 'array'
    OR p_max_granted_risk_class IS NULL
    OR p_max_granted_risk_class NOT IN ('low', 'medium', 'high', 'critical')
    OR p_granted_at IS NULL OR p_expires_at IS NULL OR p_expires_at <= p_granted_at THEN
    RAISE EXCEPTION 'invalid bounded worker delegation grant';
  END IF;

  SELECT * INTO v_definition
    FROM public.cg_worker_definition
   WHERE tenant_id = p_tenant_id AND id = p_definition_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'worker definition is not registered in tenant';
  END IF;

  SELECT * INTO v_existing
    FROM public.cg_worker_delegation_grant
   WHERE id = p_grant_id
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.tenant_id = p_tenant_id
      AND v_existing.definition_id = p_definition_id
      AND v_existing.delegation_ref = p_delegation_ref
      AND v_existing.delegated_capabilities = p_delegated_capabilities
      AND v_existing.max_granted_risk_class = p_max_granted_risk_class
      AND v_existing.granted_by = p_granted_by
      AND v_existing.granted_at = p_granted_at
      AND v_existing.expires_at = p_expires_at THEN
      RETURN false;
    END IF;
    RAISE EXCEPTION 'worker delegation grant id is already bound to different content';
  END IF;

  INSERT INTO public.cg_worker_delegation_grant (
    id, tenant_id, definition_id, delegation_ref, delegated_capabilities,
    max_granted_risk_class, state, granted_by, granted_at, expires_at
  ) VALUES (
    p_grant_id, p_tenant_id, p_definition_id, p_delegation_ref,
    p_delegated_capabilities, p_max_granted_risk_class, 'active',
    p_granted_by, p_granted_at, p_expires_at
  );
  INSERT INTO public.cg_worker_delegation (
    id, tenant_id, definition_id, delegation_ref, delegated_capabilities,
    max_granted_risk_class, recorded_by, recorded_at, expires_at
  ) VALUES (
    p_grant_id, p_tenant_id, p_definition_id, p_delegation_ref,
    p_delegated_capabilities, p_max_granted_risk_class, p_granted_by,
    p_granted_at, p_expires_at
  );
  UPDATE public.cg_worker_definition
     SET delegation_history_refs =
       CASE
         WHEN delegation_history_refs @> jsonb_build_array(p_delegation_ref)
           THEN delegation_history_refs
         ELSE delegation_history_refs || jsonb_build_array(p_delegation_ref)
       END
   WHERE tenant_id = p_tenant_id AND id = p_definition_id;

  v_audit_tenant := p_tenant_id::uuid;
  INSERT INTO public.audit_logs (
    school_id, user_id, action, table_name, record_id, old_value, new_value
  ) VALUES (
    v_audit_tenant, NULL, 'workforce.worker.grant',
    'cg_worker_delegation_grant', NULL, NULL,
    jsonb_build_object(
      'gate', 'worker-delegation-grant',
      'outcome', 'succeeded',
      'correlation_id', p_correlation_id,
      'actor_kind', 'human',
      'actor_id', NULL,
      'actor_email', NULL,
      'actor_ref', p_granted_by,
      'recorded_at', p_granted_at,
      'tenant_id', p_tenant_id,
      'after', NULL,
      'details', jsonb_build_object(
        'worker_id', p_definition_id,
        'grant_id', p_grant_id,
        'delegation_ref', p_delegation_ref,
        'expires_at', p_expires_at,
        'lifecycle_evidence', jsonb_build_object(
          'transition', 'grant',
          'at', p_granted_at,
          'actorId', p_granted_by,
          'workerId', p_definition_id,
          'grantId', p_grant_id,
          'correlationId', p_correlation_id
        )
      )
    )
  );
  RETURN true;
END;
$function$;

CREATE FUNCTION public.cg_worker_revoke_delegation(
  p_tenant_id text,
  p_definition_id text,
  p_grant_id text,
  p_revoked_by text,
  p_reason text,
  p_now timestamptz,
  p_correlation_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_grant public.cg_worker_delegation_grant%ROWTYPE;
  v_audit_tenant uuid;
  v_changed boolean;
BEGIN
  IF p_tenant_id IS NULL
    OR p_tenant_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR length(btrim(p_tenant_id)) NOT BETWEEN 1 AND 128
    OR p_definition_id IS NULL OR length(btrim(p_definition_id)) NOT BETWEEN 1 AND 160
    OR p_grant_id IS NULL OR length(btrim(p_grant_id)) NOT BETWEEN 1 AND 160
    OR p_revoked_by IS NULL OR length(btrim(p_revoked_by)) NOT BETWEEN 1 AND 160
    OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500
    OR p_now IS NULL
    OR p_correlation_id IS NULL OR length(btrim(p_correlation_id)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid worker delegation revocation';
  END IF;

  SELECT * INTO v_grant
    FROM public.cg_worker_delegation_grant
   WHERE tenant_id = p_tenant_id AND id = p_grant_id
   FOR UPDATE;
  IF NOT FOUND OR v_grant.definition_id <> p_definition_id THEN
    RAISE EXCEPTION 'worker delegation grant does not belong to worker in tenant';
  END IF;
  v_changed := v_grant.state = 'active';
  IF v_changed THEN
    UPDATE public.cg_worker_delegation_grant
       SET state = 'revoked',
           revoked_by = p_revoked_by,
           revoked_at = p_now,
           revoked_reason = p_reason
     WHERE tenant_id = p_tenant_id AND id = p_grant_id;
  END IF;

  v_audit_tenant := p_tenant_id::uuid;
  INSERT INTO public.audit_logs (
    school_id, user_id, action, table_name, record_id, old_value, new_value
  ) VALUES (
    v_audit_tenant, NULL, 'workforce.worker.revoke',
    'cg_worker_delegation_grant', NULL, NULL,
    jsonb_build_object(
      'gate', 'worker-delegation-revocation',
      'outcome', 'succeeded',
      'correlation_id', p_correlation_id,
      'actor_kind', 'human',
      'actor_id', NULL,
      'actor_email', NULL,
      'actor_ref', p_revoked_by,
      'recorded_at', p_now,
      'tenant_id', p_tenant_id,
      'after', NULL,
      'details', jsonb_build_object(
        'worker_id', p_definition_id,
        'grant_id', p_grant_id,
        'reason', p_reason,
        'lifecycle_evidence', jsonb_build_object(
          'transition', 'revoke',
          'at', p_now,
          'actorId', p_revoked_by,
          'workerId', p_definition_id,
          'grantId', p_grant_id,
          'correlationId', p_correlation_id
        )
      )
    )
  );
  RETURN v_changed;
END;
$function$;

REVOKE ALL ON FUNCTION public.cg_worker_grant_delegation(
  text, text, text, text, jsonb, text, text, timestamptz, timestamptz, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cg_worker_revoke_delegation(
  text, text, text, text, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_worker_grant_delegation(
  text, text, text, text, jsonb, text, text, timestamptz, timestamptz, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.cg_worker_revoke_delegation(
  text, text, text, text, text, timestamptz, text
) TO service_role;

COMMIT;
