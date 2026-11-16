-- COMMS-01 (issue #328): bind Africa's Talking voice numbers to a tenant.
-- Status: AUTHORED, NOT APPLIED. This file does not enable live calling.
-- voice_live stays at its existing default (off). No provider secret is stored.
-- Rollback: database/supabase/rollbacks/20261104032000_sherivs_comms01_at_number_binding.sql
-- ADR-067. Reserved timestamp 20261104032000.
--
-- Apply order:
-- 1. Run the read-only pre-apply checks in ADR-067. The voice-row query must
--    return zero rows. The root-tenant map query for
--    3c0d0f9a-56bb-4a3e-8e02-b1a426f1c201 must return exactly one organization.
-- 2. Apply this file only after 20261101000050 (voice add-on) and
--    20261103000200 (sender channels include voice). Do not apply it to production here.
-- 3. The inbound callback treats missing binding columns as "not available" (not HTTP 500),
--    so the application may deploy before this file. Apply this file before operators
--    call voice_agent_configure or voice_agent_request_call.

DO $comms01_guard$
BEGIN
  IF to_regclass('public.comms_sender_numbers') IS NULL
     OR to_regclass('public.cg_voice_call_approvals') IS NULL
     OR to_regclass('public.cg_org_communication_sender') IS NULL
     OR to_regclass('public.audit_chain') IS NULL
     OR to_regprocedure('public.voice_agent_settings()') IS NULL
     OR to_regprocedure('public.audit_chain_canonical_hash(text,bigint,timestamptz,uuid,text,text,text,text,text,inet,text,text,text)') IS NULL
  THEN
    RAISE EXCEPTION 'COMMS-01 requires the communication fabric, voice add-on, and audit chain'
      USING ERRCODE = '55000';
  END IF;
END
$comms01_guard$;

ALTER TABLE public.comms_sender_numbers
  ADD COLUMN IF NOT EXISTS binding_role text,
  ADD COLUMN IF NOT EXISTS tenant_ref text,
  ADD COLUMN IF NOT EXISTS number_status text NOT NULL DEFAULT 'active';

ALTER TABLE public.cg_voice_call_approvals
  ADD COLUMN IF NOT EXISTS recipient_user_id uuid;

DO $comms01_constraints$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.comms_sender_numbers
    WHERE channel = 'voice' AND provider IS DISTINCT FROM 'africas_talking'
  ) THEN
    RAISE EXCEPTION 'voice sender rows must already use africas_talking before COMMS-01'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'comms_sender_numbers_binding_role_check'
  ) THEN
    ALTER TABLE public.comms_sender_numbers
      ADD CONSTRAINT comms_sender_numbers_binding_role_check
      CHECK (binding_role IS NULL OR binding_role IN ('platform_support', 'organization'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'comms_sender_numbers_number_status_check'
  ) THEN
    ALTER TABLE public.comms_sender_numbers
      ADD CONSTRAINT comms_sender_numbers_number_status_check
      CHECK (number_status IN ('active', 'suspended'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'comms_sender_numbers_tenant_ref_check'
  ) THEN
    ALTER TABLE public.comms_sender_numbers
      ADD CONSTRAINT comms_sender_numbers_tenant_ref_check
      CHECK (tenant_ref IS NULL OR tenant_ref ~ '^[0-9a-fA-F-]{36}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'comms_sender_numbers_voice_provider_check'
  ) THEN
    ALTER TABLE public.comms_sender_numbers
      ADD CONSTRAINT comms_sender_numbers_voice_provider_check
      CHECK (channel <> 'voice' OR provider = 'africas_talking');
  END IF;
END
$comms01_constraints$;

CREATE INDEX IF NOT EXISTS comms_sender_numbers_voice_org
  ON public.comms_sender_numbers (org_id)
  WHERE channel = 'voice' AND number_status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS comms_sender_numbers_one_active_voice_org
  ON public.comms_sender_numbers (org_id)
  WHERE channel = 'voice' AND binding_role = 'organization' AND number_status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS comms_sender_numbers_one_platform_voice
  ON public.comms_sender_numbers (binding_role)
  WHERE channel = 'voice' AND binding_role = 'platform_support' AND number_status = 'active';

ALTER TABLE public.comms_sender_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comms_sender_numbers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cg_voice_call_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_voice_call_approvals FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.comms_sender_numbers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.comms_sender_numbers TO service_role;

CREATE OR REPLACE FUNCTION public.comms_voice_number_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor text := coalesce(auth.uid()::text, 'comms01-binding');
  v_actor_kind text := CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END;
  v_old_org uuid;
  v_new_org uuid;
  v_org uuid;
  v_action text;
  v_target_id text;
  v_seq bigint;
  v_at text := to_char(statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_prev_hash text;
  v_before_hash text;
  v_after_hash text;
  v_number text;
  v_step int;
BEGIN
  IF TG_OP <> 'DELETE' AND NEW.channel IS DISTINCT FROM 'voice'
     AND (TG_OP = 'INSERT' OR OLD.channel IS DISTINCT FROM 'voice') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND OLD.channel IS DISTINCT FROM 'voice' THEN
    RETURN OLD;
  END IF;
  v_number := coalesce(CASE WHEN TG_OP = 'DELETE' THEN OLD.provider_number ELSE NEW.provider_number END, '');
  v_target_id := 'voice:' || left(
    encode(extensions.digest(convert_to(v_number, 'UTF8'), 'sha256'), 'hex'), 32);
  IF TG_OP <> 'INSERT' THEN
    v_old_org := coalesce(
      OLD.org_id,
      CASE WHEN OLD.tenant_ref ~ '^[0-9a-fA-F-]{36}$' THEN OLD.tenant_ref::uuid ELSE NULL END
    );
    v_before_hash := encode(extensions.digest(convert_to(jsonb_build_object(
      'binding_role', OLD.binding_role,
      'org_id', OLD.org_id,
      'number_status', OLD.number_status,
      'number_hash', encode(extensions.digest(convert_to(coalesce(OLD.provider_number, ''), 'UTF8'), 'sha256'), 'hex')
    )::text, 'UTF8'), 'sha256'), 'hex');
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_org := coalesce(
      NEW.org_id,
      CASE WHEN NEW.tenant_ref ~ '^[0-9a-fA-F-]{36}$' THEN NEW.tenant_ref::uuid ELSE NULL END
    );
    v_after_hash := encode(extensions.digest(convert_to(jsonb_build_object(
      'binding_role', NEW.binding_role,
      'org_id', NEW.org_id,
      'number_status', NEW.number_status,
      'number_hash', encode(extensions.digest(convert_to(coalesce(NEW.provider_number, ''), 'UTF8'), 'sha256'), 'hex')
    )::text, 'UTF8'), 'sha256'), 'hex');
  END IF;

  -- An organization change writes unbound on the previous chain and bound on the new one.
  IF TG_OP = 'UPDATE' AND OLD.org_id IS DISTINCT FROM NEW.org_id THEN
    FOR v_step IN 1..2 LOOP
      IF v_step = 1 THEN
        v_org := v_old_org;
        v_action := 'voice.number.unbound';
      ELSE
        v_org := v_new_org;
        v_action := 'voice.number.bound';
      END IF;
      IF v_org IS NULL THEN
        CONTINUE;
      END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended(v_org::text, 7013));
      SELECT seq, entry_hash INTO v_seq, v_prev_hash
        FROM public.audit_chain WHERE org_id = v_org ORDER BY seq DESC LIMIT 1;
      v_seq := coalesce(v_seq, 0) + 1;
      v_prev_hash := coalesce(v_prev_hash, repeat('0', 64));
      INSERT INTO public.audit_chain
        (org_id, seq, at, actor_kind, actor_id, action, target_type, target_id, ip, device,
         before_hash, after_hash, prev_hash, entry_hash)
      VALUES (
        v_org, v_seq, v_at::timestamptz, v_actor_kind, v_actor, v_action, 'voice_sender', v_target_id,
        NULL, NULL,
        CASE WHEN v_step = 1 THEN v_before_hash ELSE NULL END,
        CASE WHEN v_step = 2 THEN v_after_hash ELSE NULL END,
        v_prev_hash,
        public.audit_chain_canonical_hash(
          v_prev_hash, v_seq, v_at::timestamptz, v_org, v_actor_kind, v_actor, v_action,
          'voice_sender', v_target_id, NULL, NULL,
          CASE WHEN v_step = 1 THEN v_before_hash ELSE NULL END,
          CASE WHEN v_step = 2 THEN v_after_hash ELSE NULL END)
      );
    END LOOP;
    IF v_old_org IS NULL AND v_new_org IS NULL THEN
      RAISE EXCEPTION 'voice number binding requires a tenant' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  v_org := CASE WHEN TG_OP = 'DELETE' THEN v_old_org ELSE v_new_org END;
  v_action := CASE
    WHEN TG_OP = 'DELETE' THEN 'voice.number.unbound'
    WHEN TG_OP = 'INSERT' THEN 'voice.number.bound'
    ELSE 'voice.number.updated'
  END;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'voice number binding requires a tenant' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_org::text, 7013));
  SELECT seq, entry_hash INTO v_seq, v_prev_hash
    FROM public.audit_chain WHERE org_id = v_org ORDER BY seq DESC LIMIT 1;
  v_seq := coalesce(v_seq, 0) + 1;
  v_prev_hash := coalesce(v_prev_hash, repeat('0', 64));
  INSERT INTO public.audit_chain
    (org_id, seq, at, actor_kind, actor_id, action, target_type, target_id, ip, device,
     before_hash, after_hash, prev_hash, entry_hash)
  VALUES (
    v_org, v_seq, v_at::timestamptz, v_actor_kind, v_actor, v_action, 'voice_sender', v_target_id,
    NULL, NULL,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE v_before_hash END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE v_after_hash END,
    v_prev_hash,
    public.audit_chain_canonical_hash(
      v_prev_hash, v_seq, v_at::timestamptz, v_org, v_actor_kind, v_actor, v_action,
      'voice_sender', v_target_id, NULL, NULL,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE v_before_hash END,
      CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE v_after_hash END)
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.comms_voice_number_audit() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS comms_sender_numbers_voice_insert_audit ON public.comms_sender_numbers;
CREATE TRIGGER comms_sender_numbers_voice_insert_audit
  AFTER INSERT ON public.comms_sender_numbers
  FOR EACH ROW WHEN (NEW.channel = 'voice')
  EXECUTE FUNCTION public.comms_voice_number_audit();

DROP TRIGGER IF EXISTS comms_sender_numbers_voice_update_audit ON public.comms_sender_numbers;
CREATE TRIGGER comms_sender_numbers_voice_update_audit
  AFTER UPDATE ON public.comms_sender_numbers
  FOR EACH ROW WHEN (NEW.channel = 'voice' OR OLD.channel = 'voice')
  EXECUTE FUNCTION public.comms_voice_number_audit();

DROP TRIGGER IF EXISTS comms_sender_numbers_voice_delete_audit ON public.comms_sender_numbers;
CREATE TRIGGER comms_sender_numbers_voice_delete_audit
  AFTER DELETE ON public.comms_sender_numbers
  FOR EACH ROW WHEN (OLD.channel = 'voice')
  EXECUTE FUNCTION public.comms_voice_number_audit();

DO $comms01_platform$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.comms_sender_numbers
    WHERE channel = 'voice'
      AND provider_number = '+2349015056201'
      AND binding_role = 'organization'
  ) THEN
    RAISE EXCEPTION 'platform support line is already bound as an organization number'
      USING ERRCODE = '23505';
  END IF;
END
$comms01_platform$;

INSERT INTO public.comms_sender_numbers (
  school_id, org_id, channel, provider_number, provider, binding_role, tenant_ref, number_status
) VALUES (
  NULL, NULL, 'voice', '+2349015056201', 'africas_talking', 'platform_support',
  '3c0d0f9a-56bb-4a3e-8e02-b1a426f1c201', 'active'
)
ON CONFLICT (channel, provider_number) DO UPDATE
SET provider = EXCLUDED.provider,
    binding_role = EXCLUDED.binding_role,
    tenant_ref = EXCLUDED.tenant_ref,
    number_status = 'active',
    school_id = public.comms_sender_numbers.school_id,
    org_id = public.comms_sender_numbers.org_id
WHERE (
    public.comms_sender_numbers.binding_role IS NULL
    OR public.comms_sender_numbers.binding_role = 'platform_support'
  )
  AND (
    public.comms_sender_numbers.provider IS DISTINCT FROM EXCLUDED.provider
    OR public.comms_sender_numbers.binding_role IS DISTINCT FROM EXCLUDED.binding_role
    OR public.comms_sender_numbers.tenant_ref IS DISTINCT FROM EXCLUDED.tenant_ref
    OR public.comms_sender_numbers.number_status IS DISTINCT FROM 'active'
  );

CREATE OR REPLACE FUNCTION public.comms_bind_voice_sender(p_org uuid, p_number text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_quota bigint;
  v_tenant text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_org IS NULL OR p_number IS NULL OR p_number !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'voice number binding is invalid';
  END IF;
  IF p_number = '+2349015056201' THEN
    RAISE EXCEPTION 'the platform support line cannot be bound as an organization number';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.schools s WHERE s.id = p_org) THEN
    RAISE EXCEPTION 'organization is not provisioned';
  END IF;
  SELECT q.quota INTO v_quota
    FROM public.org_entitlements e
    JOIN public.entitlement_plan_quotas q
      ON q.plan_id = e.plan_id AND q.meter = 'voice_minutes'
    WHERE e.org_id = p_org;
  IF coalesce(v_quota, 0) <= 0 THEN
    RAISE EXCEPTION 'voice is not included in this organization entitlement';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.comms_sender_numbers n
    WHERE n.channel = 'voice'
      AND n.binding_role = 'organization'
      AND n.number_status = 'active'
      AND n.org_id = p_org
      AND n.provider_number <> p_number
  ) THEN
    RAISE EXCEPTION 'this organization already has a bound voice number';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.comms_sender_numbers n
    WHERE n.channel = 'voice'
      AND n.provider_number = p_number
      AND n.org_id IS NOT NULL
      AND n.org_id IS DISTINCT FROM p_org
  ) THEN
    RAISE EXCEPTION 'voice number is already bound to another organization' USING ERRCODE = '42501';
  END IF;
  SELECT m.tenant_id::text INTO v_tenant
    FROM public.school_tenant_map m
    WHERE m.school_id = p_org;
  v_tenant := coalesce(v_tenant, p_org::text);
  INSERT INTO public.comms_sender_numbers (
    school_id, org_id, channel, provider_number, provider, binding_role, tenant_ref, number_status
  ) VALUES (
    p_org, p_org, 'voice', p_number, 'africas_talking', 'organization', v_tenant, 'active'
  )
  ON CONFLICT (channel, provider_number) DO UPDATE
  SET school_id = EXCLUDED.school_id,
      org_id = EXCLUDED.org_id,
      provider = EXCLUDED.provider,
      binding_role = EXCLUDED.binding_role,
      tenant_ref = EXCLUDED.tenant_ref,
      number_status = 'active'
  WHERE public.comms_sender_numbers.org_id IS NULL
     OR public.comms_sender_numbers.org_id = EXCLUDED.org_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.comms_sender_numbers n
    WHERE n.channel = 'voice' AND n.provider_number = p_number
      AND n.org_id = p_org AND n.number_status = 'active'
      AND n.binding_role = 'organization'
  ) THEN
    RAISE EXCEPTION 'voice number is already bound to another organization' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.cg_org_communication_sender (
    sender_ref, tenant_id, org_ref, channel, provider, from_number, credential_ref, status, provenance
  ) VALUES (
    'voice:' || v_tenant || ':africas_talking',
    v_tenant, v_tenant, 'voice', 'africas_talking', p_number, 'env://AT_API_KEY', 'active',
    jsonb_build_object('createdBy', 'comms-bind', 'createdAt', statement_timestamp())
  )
  ON CONFLICT (sender_ref) DO UPDATE
  SET from_number = EXCLUDED.from_number,
      credential_ref = EXCLUDED.credential_ref,
      status = 'active',
      provenance = EXCLUDED.provenance,
      updated_at = statement_timestamp()
  WHERE public.cg_org_communication_sender.tenant_id = EXCLUDED.tenant_id
    AND public.cg_org_communication_sender.org_ref = EXCLUDED.org_ref;
END;
$$;

CREATE OR REPLACE FUNCTION public.comms_attach_platform_voice_org(p_org uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_allowed uuid;
  v_current uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT m.school_id INTO v_allowed
    FROM public.school_tenant_map m
    WHERE m.tenant_id = '3c0d0f9a-56bb-4a3e-8e02-b1a426f1c201'::uuid;
  IF p_org IS NULL OR v_allowed IS NULL OR p_org IS DISTINCT FROM v_allowed THEN
    RAISE EXCEPTION 'platform support line can only be attached to the platform organization'
      USING ERRCODE = '42501';
  END IF;
  SELECT n.org_id INTO v_current
    FROM public.comms_sender_numbers n
    WHERE n.channel = 'voice'
      AND n.provider = 'africas_talking'
      AND n.binding_role = 'platform_support'
      AND n.provider_number = '+2349015056201'
      AND n.number_status = 'active'
      AND n.tenant_ref = '3c0d0f9a-56bb-4a3e-8e02-b1a426f1c201';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform support line is not bound';
  END IF;
  IF v_current IS NOT NULL AND v_current IS DISTINCT FROM p_org THEN
    RAISE EXCEPTION 'platform support line is already attached' USING ERRCODE = '42501';
  END IF;
  IF v_current IS NOT DISTINCT FROM p_org THEN
    RETURN;
  END IF;
  UPDATE public.comms_sender_numbers
    SET school_id = p_org, org_id = p_org
    WHERE channel = 'voice'
      AND provider = 'africas_talking'
      AND binding_role = 'platform_support'
      AND provider_number = '+2349015056201'
      AND number_status = 'active'
      AND tenant_ref = '3c0d0f9a-56bb-4a3e-8e02-b1a426f1c201'
      AND org_id IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.comms_bind_voice_sender(uuid, text),
  public.comms_attach_platform_voice_org(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comms_bind_voice_sender(uuid, text),
  public.comms_attach_platform_voice_org(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.voice_agent_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant text := public.get_my_tenant_id();
  v_enabled boolean := false;
  v_live boolean := false;
  v_limit bigint := 0;
  v_used bigint := 0;
  v_number text;
  v_provider text;
  v_extension text;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL OR NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT enabled INTO v_enabled FROM public.cg_org_voice_agent WHERE tenant_ref = v_tenant;
  SELECT n.provider_number, n.provider INTO v_number, v_provider
    FROM public.comms_sender_numbers n
    LEFT JOIN public.school_tenant_map m ON m.school_id = n.org_id
    WHERE n.channel = 'voice'
      AND n.provider = 'africas_talking'
      AND n.number_status = 'active'
      AND n.binding_role = 'organization'
      AND (n.org_id::text = v_tenant OR m.tenant_id::text = v_tenant)
    ORDER BY n.created_at DESC
    LIMIT 1;
  SELECT extension INTO v_extension
    FROM public.cg_org_communication_sender
    WHERE tenant_id = v_tenant AND org_ref = v_tenant AND channel = 'voice' AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 1;
  v_live := coalesce(public.flag_on('voice_live', v_tenant::uuid), false);
  SELECT q.quota INTO v_limit
    FROM public.org_entitlements e
    JOIN public.entitlement_plan_quotas q ON q.plan_id = e.plan_id AND q.meter = 'voice_minutes'
    WHERE e.org_id = v_tenant::uuid;
  SELECT used INTO v_used FROM public.usage_counters
    WHERE org_id = v_tenant::uuid AND meter = 'voice_minutes'
      AND period_key = to_char(statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM')
      AND subject_id = '';
  RETURN jsonb_build_object(
    'tenantRef', v_tenant,
    'enabled', coalesce(v_enabled, false),
    'provider', v_provider,
    'providerNumber', v_number,
    'extension', v_extension,
    'voiceLive', v_live,
    'voiceMinutesQuota', coalesce(v_limit, 0),
    'voiceMinutesUsed', coalesce(v_used, 0)
  );
END;
$$;

DROP FUNCTION IF EXISTS public.voice_agent_configure(boolean, text, text, text);

CREATE OR REPLACE FUNCTION public.voice_agent_configure(p_enabled boolean, p_extension text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant text := public.get_my_tenant_id();
  v_sender_ref text;
  v_quota bigint;
  v_number text;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL OR NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_extension IS NOT NULL AND p_extension !~ '^[0-9A-Za-z*#]{1,12}$' THEN
    RAISE EXCEPTION 'invalid voice extension';
  END IF;
  IF p_enabled THEN
    SELECT q.quota INTO v_quota
      FROM public.org_entitlements e
      JOIN public.entitlement_plan_quotas q ON q.plan_id = e.plan_id AND q.meter = 'voice_minutes'
      WHERE e.org_id = v_tenant::uuid;
    IF coalesce(v_quota, 0) <= 0 THEN
      RAISE EXCEPTION 'voice agent is not included in this organization entitlement';
    END IF;
  END IF;
  SELECT n.provider_number INTO v_number
    FROM public.comms_sender_numbers n
    LEFT JOIN public.school_tenant_map m ON m.school_id = n.org_id
    WHERE n.channel = 'voice'
      AND n.provider = 'africas_talking'
      AND n.number_status = 'active'
      AND n.binding_role = 'organization'
      AND (n.org_id::text = v_tenant OR m.tenant_id::text = v_tenant)
    ORDER BY n.created_at DESC
    LIMIT 1;
  IF p_enabled AND v_number IS NULL THEN
    RAISE EXCEPTION 'voice number is not bound for this organization';
  END IF;
  IF v_number IS NOT NULL THEN
    v_sender_ref := 'voice:' || v_tenant || ':africas_talking';
    INSERT INTO public.cg_org_communication_sender
      (sender_ref, tenant_id, org_ref, channel, provider, from_number, credential_ref, status, provenance, extension)
    VALUES (
      v_sender_ref, v_tenant, v_tenant, 'voice', 'africas_talking', v_number,
      'env://AT_API_KEY', 'active',
      jsonb_build_object('createdBy', auth.uid()::text, 'createdAt', statement_timestamp()),
      p_extension
    )
    ON CONFLICT (sender_ref) DO UPDATE SET
      from_number = EXCLUDED.from_number,
      credential_ref = EXCLUDED.credential_ref,
      extension = EXCLUDED.extension,
      status = 'active',
      provenance = EXCLUDED.provenance,
      updated_at = statement_timestamp();
  END IF;
  INSERT INTO public.cg_org_voice_agent (tenant_ref, enabled, updated_by)
  VALUES (v_tenant, p_enabled, auth.uid()::text)
  ON CONFLICT (tenant_ref) DO UPDATE SET
    enabled = EXCLUDED.enabled,
    updated_by = EXCLUDED.updated_by,
    updated_at = statement_timestamp();
  RETURN public.voice_agent_settings();
END;
$$;

CREATE OR REPLACE FUNCTION public.comms_voice_digits(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN d ~ '^0[0-9]{10}$' THEN '234' || substr(d, 2)
    ELSE d
  END
  FROM (SELECT regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') AS d) s;
$$;

REVOKE ALL ON FUNCTION public.comms_voice_digits(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.voice_agent_assert_recipient_consent(
  p_tenant_ref text, p_recipient_user uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org uuid;
  v_raw text;
  v_digits text;
  v_phone text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_tenant_ref IS NULL OR p_tenant_ref !~ '^[0-9a-fA-F-]{36}$' OR p_recipient_user IS NULL THEN
    RAISE EXCEPTION 'invalid voice recipient' USING ERRCODE = '42501';
  END IF;
  SELECT m.school_id INTO v_org
    FROM public.school_tenant_map m
    WHERE m.tenant_id = p_tenant_ref::uuid;
  IF v_org IS NULL THEN
    v_org := p_tenant_ref::uuid;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_memberships mem
    WHERE mem.user_id = p_recipient_user AND mem.school_id = v_org AND mem.is_active
  ) THEN
    RAISE EXCEPTION 'recipient is outside this organization' USING ERRCODE = '42501';
  END IF;
  SELECT u.phone INTO v_raw
    FROM public.users u
    JOIN public.organization_memberships mem
      ON mem.user_id = u.id AND mem.school_id = v_org AND mem.is_active
    JOIN auth.users au ON au.id = u.id
    WHERE u.id = p_recipient_user
      AND coalesce(u.is_active, true)
      AND au.phone_confirmed_at IS NOT NULL
      AND public.comms_voice_digits(au.phone) = public.comms_voice_digits(u.phone);
  IF v_raw IS NULL THEN
    RAISE EXCEPTION 'recipient has no confirmed voice number' USING ERRCODE = '42501';
  END IF;
  v_digits := public.comms_voice_digits(v_raw);
  IF v_raw ~ '^\+[1-9][0-9]{7,14}$' THEN
    v_phone := v_raw;
  ELSIF v_digits ~ '^234[0-9]{10}$' THEN
    v_phone := '+' || v_digits;
  ELSIF v_digits ~ '^0[0-9]{10}$' THEN
    v_phone := '+234' || substr(v_digits, 2);
  ELSE
    RAISE EXCEPTION 'recipient has no confirmed voice number' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.comms_optins o
    WHERE o.org_id = v_org
      AND o.channel = 'voice'
      AND o.status = 'opted_in'
      AND public.comms_voice_digits(o.phone) = public.comms_voice_digits(v_phone)
  ) THEN
    RAISE EXCEPTION 'recipient has not opted in to voice calls' USING ERRCODE = '42501';
  END IF;
  RETURN v_phone;
END;
$$;

DROP FUNCTION IF EXISTS public.voice_agent_request_call(text, text, text, text, text);
DROP FUNCTION IF EXISTS public.voice_agent_request_call(text, text, text);

CREATE OR REPLACE FUNCTION public.voice_agent_request_call(
  p_tenant_ref text,
  p_requester text,
  p_category text,
  p_recipient_user uuid,
  p_subject_ref text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_phone text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_tenant_ref IS NULL OR p_tenant_ref !~ '^[0-9a-fA-F-]{36}$'
     OR p_requester IS NULL OR length(p_requester) NOT BETWEEN 1 AND 160
     OR p_category IS NULL OR p_category NOT IN ('fee_reminder', 'absence_alert')
     OR p_recipient_user IS NULL
     OR (p_subject_ref IS NOT NULL AND length(p_subject_ref) > 160) THEN
    RAISE EXCEPTION 'invalid voice call request';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cg_org_voice_agent WHERE tenant_ref = p_tenant_ref AND enabled
  ) THEN
    RAISE EXCEPTION 'voice agent is not enabled for this organization';
  END IF;
  v_phone := public.voice_agent_assert_recipient_consent(p_tenant_ref, p_recipient_user);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_ref, 108));
  IF (
    SELECT count(*) FROM public.cg_voice_call_approvals
    WHERE tenant_ref = p_tenant_ref AND created_at >= statement_timestamp() - interval '1 hour'
  ) >= 20 THEN
    RAISE EXCEPTION 'organization voice request rate limit exceeded';
  END IF;
  INSERT INTO public.cg_voice_call_approvals
    (tenant_ref, category, recipient_phone, recipient_user_id, script, subject_ref, requested_by)
  VALUES (
    p_tenant_ref, p_category, v_phone, p_recipient_user,
    CASE p_category
      WHEN 'fee_reminder' THEN 'Your organization has a billing update. Please contact the office for details.'
      ELSE 'Your organization has an important update. Please contact the office for details.'
    END,
    p_subject_ref, p_requester
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.voice_agent_approved_call_target(
  p_call_id uuid, p_tenant_ref text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_call public.cg_voice_call_approvals%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_call FROM public.cg_voice_call_approvals
    WHERE id = p_call_id AND tenant_ref = p_tenant_ref AND status = 'approved';
  IF v_call.id IS NULL OR v_call.recipient_user_id IS NULL THEN
    RAISE EXCEPTION 'approved call is unavailable';
  END IF;
  RETURN jsonb_build_object(
    'tenantRef', v_call.tenant_ref,
    'recipientUserId', v_call.recipient_user_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.voice_agent_consented_recipients()
RETURNS TABLE (user_id uuid, display_name text, phone_redacted text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant text := public.get_my_tenant_id();
  v_org uuid;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL OR NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF v_tenant !~ '^[0-9a-fA-F-]{36}$' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT m.school_id INTO v_org
    FROM public.school_tenant_map m
    WHERE m.tenant_id = v_tenant::uuid;
  IF v_org IS NULL THEN
    v_org := v_tenant::uuid;
  END IF;
  RETURN QUERY
  SELECT u.id,
    left(u.full_name, 80),
    left(u.phone, 4) || repeat('*', greatest(length(u.phone) - 6, 0)) || right(u.phone, 2)
  FROM public.users u
  JOIN public.organization_memberships mem
    ON mem.user_id = u.id AND mem.school_id = v_org AND mem.is_active
  JOIN auth.users au ON au.id = u.id
  JOIN public.comms_optins o
    ON o.org_id = v_org
   AND o.channel = 'voice'
   AND o.status = 'opted_in'
   AND public.comms_voice_digits(o.phone) = public.comms_voice_digits(u.phone)
  WHERE coalesce(u.is_active, true)
    AND au.phone_confirmed_at IS NOT NULL
    AND public.comms_voice_digits(au.phone) = public.comms_voice_digits(u.phone)
  ORDER BY u.full_name ASC
  LIMIT 100;
END;
$$;

CREATE OR REPLACE FUNCTION public.voice_agent_claim_call(p_call_id uuid, p_tenant_ref text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_call public.cg_voice_call_approvals%ROWTYPE;
  v_sender record;
  v_quota bigint;
  v_tenant uuid;
  v_period text := to_char(statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM');
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_call FROM public.cg_voice_call_approvals
    WHERE id = p_call_id AND tenant_ref = p_tenant_ref FOR UPDATE;
  IF v_call.id IS NULL OR v_call.status <> 'approved' THEN
    RAISE EXCEPTION 'call is not approved';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cg_org_voice_agent WHERE tenant_ref = v_call.tenant_ref AND enabled
  ) THEN
    RAISE EXCEPTION 'voice agent is disabled';
  END IF;
  v_tenant := v_call.tenant_ref::uuid;
  IF NOT coalesce(public.flag_on('voice_live', v_tenant), false) THEN
    RAISE EXCEPTION 'voice_live is disabled for this organization';
  END IF;
  SELECT q.quota INTO v_quota
    FROM public.org_entitlements e
    JOIN public.entitlement_plan_quotas q ON q.plan_id = e.plan_id AND q.meter = 'voice_minutes'
    WHERE e.org_id = v_tenant;
  IF coalesce(v_quota, 0) <= 0 THEN
    RAISE EXCEPTION 'voice minutes are not entitled';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_call.tenant_ref, 108));
  IF (
    SELECT count(*) FROM public.cg_voice_call_approvals
    WHERE tenant_ref = v_call.tenant_ref
      AND approved_at >= statement_timestamp() - interval '1 hour'
      AND status IN ('dispatching', 'completed', 'failed')
  ) >= 10 THEN
    RAISE EXCEPTION 'organization voice call rate limit exceeded';
  END IF;
  SELECT provider, from_number INTO v_sender
    FROM public.cg_org_communication_sender
    WHERE tenant_id = v_call.tenant_ref AND org_ref = v_call.tenant_ref
      AND channel = 'voice' AND status = 'active' AND provider = 'africas_talking'
    ORDER BY created_at DESC
    LIMIT 1;
  IF v_sender.provider IS NULL THEN
    RAISE EXCEPTION 'outbound voice provider is not configured';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.comms_sender_numbers n
    LEFT JOIN public.school_tenant_map m ON m.school_id = n.org_id
    WHERE n.channel = 'voice'
      AND n.provider = 'africas_talking'
      AND n.number_status = 'active'
      AND n.binding_role = 'organization'
      AND n.provider_number = v_sender.from_number
      AND (n.org_id::text = v_call.tenant_ref OR m.tenant_id::text = v_call.tenant_ref)
  ) THEN
    RAISE EXCEPTION 'outbound voice number is not bound to this organization' USING ERRCODE = '42501';
  END IF;
  IF NOT public.meter_consume(v_tenant, 'voice_minutes', v_period, '', 1, v_quota) THEN
    RAISE EXCEPTION 'voice minutes quota exceeded';
  END IF;
  UPDATE public.cg_voice_call_approvals
    SET status = 'dispatching', usage_period = v_period, updated_at = statement_timestamp()
    WHERE id = p_call_id;
  RETURN jsonb_build_object(
    'id', v_call.id,
    'tenantRef', v_call.tenant_ref,
    'provider', v_sender.provider,
    'fromNumber', v_sender.from_number,
    'recipientPhone', v_call.recipient_phone,
    'script', v_call.script,
    'category', v_call.category
  );
END;
$$;

REVOKE ALL ON FUNCTION public.voice_agent_configure(boolean, text),
  public.voice_agent_request_call(text, text, text, uuid, text),
  public.voice_agent_assert_recipient_consent(text, uuid),
  public.voice_agent_consented_recipients(),
  public.voice_agent_claim_call(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.voice_agent_configure(boolean, text),
  public.voice_agent_consented_recipients()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.voice_agent_request_call(text, text, text, uuid, text),
  public.voice_agent_assert_recipient_consent(text, uuid),
  public.voice_agent_claim_call(uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.comms_bind_voice_sender(uuid, text) IS
  'Service-role binding of one Africa''s Talking voice number to an entitled organization. Clients and AI callers cannot supply the number.';
COMMENT ON FUNCTION public.comms_attach_platform_voice_org(uuid) IS
  'Service-role attachment of the already-bound platform support line to an organization. The number is not a parameter.';
