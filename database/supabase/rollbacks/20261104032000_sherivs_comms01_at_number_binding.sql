-- Rollback COMMS-01 voice-number binding.
-- audit_chain entries are retained as immutable evidence.
-- Restores the previous voice-agent function signatures from SHERIVS-108.

DROP TRIGGER IF EXISTS comms_sender_numbers_voice_insert_audit ON public.comms_sender_numbers;
DROP TRIGGER IF EXISTS comms_sender_numbers_voice_update_audit ON public.comms_sender_numbers;
DROP TRIGGER IF EXISTS comms_sender_numbers_voice_delete_audit ON public.comms_sender_numbers;

DROP FUNCTION IF EXISTS public.comms_voice_number_audit();
DROP FUNCTION IF EXISTS public.comms_bind_voice_sender(uuid, text);
DROP FUNCTION IF EXISTS public.comms_attach_platform_voice_org(uuid);
DROP FUNCTION IF EXISTS public.voice_agent_consented_recipients();
DROP FUNCTION IF EXISTS public.voice_agent_assert_recipient_consent(text, uuid);
DROP FUNCTION IF EXISTS public.comms_voice_digits(text);
DROP FUNCTION IF EXISTS public.voice_agent_configure(boolean, text);
DROP FUNCTION IF EXISTS public.voice_agent_request_call(text, text, text, uuid, text);

DELETE FROM public.comms_sender_numbers
WHERE channel = 'voice'
  AND provider = 'africas_talking'
  AND provider_number = '+2349015056201'
  AND binding_role = 'platform_support'
  AND tenant_ref = '3c0d0f9a-56bb-4a3e-8e02-b1a426f1c201';

DROP INDEX IF EXISTS public.comms_sender_numbers_voice_org;
DROP INDEX IF EXISTS public.comms_sender_numbers_one_active_voice_org;
DROP INDEX IF EXISTS public.comms_sender_numbers_one_platform_voice;

ALTER TABLE public.comms_sender_numbers
  DROP CONSTRAINT IF EXISTS comms_sender_numbers_binding_role_check,
  DROP CONSTRAINT IF EXISTS comms_sender_numbers_number_status_check,
  DROP CONSTRAINT IF EXISTS comms_sender_numbers_tenant_ref_check,
  DROP CONSTRAINT IF EXISTS comms_sender_numbers_voice_provider_check;

ALTER TABLE public.comms_sender_numbers
  DROP COLUMN IF EXISTS binding_role,
  DROP COLUMN IF EXISTS tenant_ref,
  DROP COLUMN IF EXISTS number_status;

ALTER TABLE public.cg_voice_call_approvals
  DROP COLUMN IF EXISTS recipient_user_id;

CREATE OR REPLACE FUNCTION public.voice_agent_settings()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tenant text := public.get_my_tenant_id();
  v_sender record;
  v_enabled boolean := false;
  v_live boolean := false;
  v_limit bigint := 0;
  v_used bigint := 0;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL OR NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT enabled INTO v_enabled FROM public.cg_org_voice_agent WHERE tenant_ref = v_tenant;
  SELECT sender_ref, provider, from_number, extension INTO v_sender
    FROM public.cg_org_communication_sender
    WHERE tenant_id = v_tenant AND org_ref = v_tenant AND channel = 'voice' AND status = 'active'
    ORDER BY created_at DESC LIMIT 1;
  v_live := coalesce(public.flag_on('voice_live', v_tenant::uuid), false);
  SELECT q.quota INTO v_limit
    FROM public.org_entitlements e
    JOIN public.entitlement_plan_quotas q ON q.plan_id = e.plan_id AND q.meter = 'voice_minutes'
    WHERE e.org_id = v_tenant::uuid;
  SELECT used INTO v_used FROM public.usage_counters
    WHERE org_id = v_tenant::uuid AND meter = 'voice_minutes'
      AND period_key = to_char(statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM') AND subject_id = '';
  RETURN jsonb_build_object(
    'tenantRef', v_tenant,
    'enabled', coalesce(v_enabled, false),
    'provider', v_sender.provider,
    'providerNumber', v_sender.from_number,
    'extension', v_sender.extension,
    'voiceLive', v_live,
    'voiceMinutesQuota', coalesce(v_limit, 0),
    'voiceMinutesUsed', coalesce(v_used, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.voice_agent_configure(
  p_enabled boolean, p_provider text, p_provider_number text, p_extension text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tenant text := public.get_my_tenant_id();
  v_sender_ref text;
  v_quota bigint;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL OR NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_provider IS DISTINCT FROM 'africas_talking'
     OR p_provider_number !~ '^\+[1-9][0-9]{7,14}$'
     OR (p_extension IS NOT NULL AND p_extension !~ '^[0-9A-Za-z*#]{1,12}$') THEN
    RAISE EXCEPTION 'invalid voice sender configuration';
  END IF;
  IF p_enabled THEN
    SELECT q.quota INTO v_quota
      FROM public.org_entitlements e
      JOIN public.entitlement_plan_quotas q ON q.plan_id = e.plan_id AND q.meter = 'voice_minutes'
      WHERE e.org_id = v_tenant::uuid;
    IF coalesce(v_quota, 0) <= 0 THEN RAISE EXCEPTION 'voice agent is not included in this organization entitlement'; END IF;
  END IF;
  v_sender_ref := 'voice:' || v_tenant || ':africas_talking';
  UPDATE public.cg_org_communication_sender
    SET status = 'suspended', updated_at = statement_timestamp()
    WHERE tenant_id = v_tenant AND org_ref = v_tenant AND channel = 'voice'
      AND status = 'active' AND provider <> p_provider;
  INSERT INTO public.cg_org_communication_sender
    (sender_ref, tenant_id, org_ref, channel, provider, from_number, credential_ref, status, provenance, extension)
  VALUES (v_sender_ref, v_tenant, v_tenant, 'voice', p_provider, p_provider_number,
          CASE p_provider WHEN 'twilio' THEN 'env://TWILIO_API_KEY' ELSE 'env://AT_API_KEY' END,
          'active', jsonb_build_object('createdBy', auth.uid()::text, 'createdAt', statement_timestamp()), p_extension)
  ON CONFLICT (sender_ref) DO UPDATE SET
    from_number = EXCLUDED.from_number, credential_ref = EXCLUDED.credential_ref,
    extension = EXCLUDED.extension, status = 'active', provenance = EXCLUDED.provenance,
    updated_at = statement_timestamp();
  INSERT INTO public.cg_org_voice_agent (tenant_ref, enabled, updated_by)
  VALUES (v_tenant, p_enabled, auth.uid()::text)
  ON CONFLICT (tenant_ref) DO UPDATE SET
    enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = statement_timestamp();
  RETURN public.voice_agent_settings();
END;
$$;

DROP FUNCTION IF EXISTS public.voice_agent_request_call(text, text, text);
CREATE OR REPLACE FUNCTION public.voice_agent_request_call(
  p_tenant_ref text, p_requester text, p_category text, p_recipient_phone text,
  p_subject_ref text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_tenant_ref IS NULL OR p_tenant_ref !~ '^[0-9a-fA-F-]{36}$'
     OR p_requester IS NULL OR length(p_requester) NOT BETWEEN 1 AND 160
     OR p_category IS NULL OR p_category NOT IN ('fee_reminder', 'absence_alert')
     OR p_recipient_phone IS NULL OR p_recipient_phone !~ '^\+[1-9][0-9]{7,14}$'
     OR (p_subject_ref IS NOT NULL AND length(p_subject_ref) > 160) THEN
    RAISE EXCEPTION 'invalid voice call request';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cg_org_voice_agent WHERE tenant_ref = p_tenant_ref AND enabled) THEN
    RAISE EXCEPTION 'voice agent is not enabled for this organization';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_ref, 108));
  IF (SELECT count(*) FROM public.cg_voice_call_approvals
      WHERE tenant_ref = p_tenant_ref AND created_at >= statement_timestamp() - interval '1 hour') >= 20 THEN
    RAISE EXCEPTION 'organization voice request rate limit exceeded';
  END IF;
  INSERT INTO public.cg_voice_call_approvals
    (tenant_ref, category, recipient_phone, script, subject_ref, requested_by)
  VALUES (
    p_tenant_ref, p_category, p_recipient_phone,
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
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_call public.cg_voice_call_approvals%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_call FROM public.cg_voice_call_approvals
    WHERE id = p_call_id AND tenant_ref = p_tenant_ref AND status = 'approved';
  IF v_call.id IS NULL THEN RAISE EXCEPTION 'approved call is unavailable'; END IF;
  RETURN jsonb_build_object(
    'tenantRef', v_call.tenant_ref,
    'recipientPhone', v_call.recipient_phone
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.voice_agent_pending_calls()
RETURNS TABLE (id uuid, category text, recipient_redacted text, script text, status text, requested_by text, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant text := public.get_my_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL OR NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT a.id, a.category,
    left(a.recipient_phone, 4) || repeat('*', greatest(length(a.recipient_phone) - 6, 0)) || right(a.recipient_phone, 2),
    a.script, a.status, a.requested_by, a.created_at
  FROM public.cg_voice_call_approvals a
  WHERE a.tenant_ref = v_tenant AND a.status IN ('pending', 'approved')
  ORDER BY a.created_at ASC LIMIT 50;
END;
$$;

CREATE OR REPLACE FUNCTION public.voice_agent_decide_call(p_call_id uuid, p_approve boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tenant text := public.get_my_tenant_id();
  v_call public.cg_voice_call_approvals%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL OR NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_call FROM public.cg_voice_call_approvals
    WHERE id = p_call_id AND tenant_ref = v_tenant FOR UPDATE;
  IF v_call.id IS NULL OR v_call.status <> 'pending' THEN RAISE EXCEPTION 'call request is not pending'; END IF;
  IF v_call.requested_by = auth.uid()::text THEN
    RAISE EXCEPTION 'the requester cannot approve or reject their own call' USING ERRCODE = '42501';
  END IF;
  UPDATE public.cg_voice_call_approvals
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      approved_by = auth.uid()::text, approved_at = statement_timestamp(), updated_at = statement_timestamp()
  WHERE id = p_call_id;
  RETURN CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
END;
$$;

DROP FUNCTION IF EXISTS public.voice_agent_claim_call(uuid);
CREATE OR REPLACE FUNCTION public.voice_agent_claim_call(p_call_id uuid, p_tenant_ref text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_call public.cg_voice_call_approvals%ROWTYPE;
  v_sender record;
  v_quota bigint;
  v_tenant uuid;
  v_period text := to_char(statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM');
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_call FROM public.cg_voice_call_approvals
    WHERE id = p_call_id AND tenant_ref = p_tenant_ref FOR UPDATE;
  IF v_call.id IS NULL OR v_call.status <> 'approved' THEN RAISE EXCEPTION 'call is not approved'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cg_org_voice_agent WHERE tenant_ref = v_call.tenant_ref AND enabled) THEN
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
  IF coalesce(v_quota, 0) <= 0 THEN RAISE EXCEPTION 'voice minutes are not entitled'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_call.tenant_ref, 108));
  IF (SELECT count(*) FROM public.cg_voice_call_approvals
      WHERE tenant_ref = v_call.tenant_ref AND approved_at >= statement_timestamp() - interval '1 hour'
        AND status IN ('dispatching', 'completed', 'failed')) >= 10 THEN
    RAISE EXCEPTION 'organization voice call rate limit exceeded';
  END IF;
  SELECT provider, from_number INTO v_sender
    FROM public.cg_org_communication_sender
    WHERE tenant_id = v_call.tenant_ref AND org_ref = v_call.tenant_ref
      AND channel = 'voice' AND status = 'active' AND provider = 'africas_talking'
    ORDER BY created_at DESC LIMIT 1;
  IF v_sender.provider IS NULL THEN RAISE EXCEPTION 'outbound voice provider is not configured'; END IF;
  IF NOT public.meter_consume(v_tenant, 'voice_minutes', v_period, '', 1, v_quota) THEN
    RAISE EXCEPTION 'voice minutes quota exceeded';
  END IF;
  UPDATE public.cg_voice_call_approvals
    SET status = 'dispatching', usage_period = v_period, updated_at = statement_timestamp()
    WHERE id = p_call_id;
  RETURN jsonb_build_object(
    'id', v_call.id, 'tenantRef', v_call.tenant_ref, 'provider', v_sender.provider,
    'fromNumber', v_sender.from_number, 'recipientPhone', v_call.recipient_phone, 'script', v_call.script,
    'category', v_call.category
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.voice_agent_finish_call(
  p_call_id uuid, p_succeeded boolean, p_provider_call_id text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_call public.cg_voice_call_approvals%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_call FROM public.cg_voice_call_approvals WHERE id = p_call_id FOR UPDATE;
  IF v_call.id IS NULL OR v_call.status <> 'dispatching' THEN RAISE EXCEPTION 'call is not dispatching'; END IF;
  IF p_provider_call_id IS NOT NULL AND length(p_provider_call_id) > 160 THEN RAISE EXCEPTION 'invalid provider call reference'; END IF;
  IF NOT p_succeeded THEN
    UPDATE public.usage_counters SET used = greatest(used - 1, 0)
      WHERE org_id = v_call.tenant_ref::uuid AND meter = 'voice_minutes'
        AND period_key = v_call.usage_period AND subject_id = '';
  END IF;
  UPDATE public.cg_voice_call_approvals
    SET status = CASE WHEN p_succeeded THEN 'completed' ELSE 'failed' END,
        provider_call_id = p_provider_call_id, updated_at = statement_timestamp()
    WHERE id = p_call_id;
END;
$$;

REVOKE ALL ON FUNCTION public.voice_agent_settings(), public.voice_agent_configure(boolean, text, text, text),
public.voice_agent_request_call(text, text, text, text, text),
public.voice_agent_approved_call_target(uuid, text), public.voice_agent_pending_calls(),
  public.voice_agent_decide_call(uuid, boolean), public.voice_agent_claim_call(uuid, text),
public.voice_agent_finish_call(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.voice_agent_settings(), public.voice_agent_configure(boolean, text, text, text),
public.voice_agent_pending_calls(),
  public.voice_agent_decide_call(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.voice_agent_request_call(text, text, text, text, text),
public.voice_agent_approved_call_target(uuid, text), public.voice_agent_claim_call(uuid, text),
public.voice_agent_finish_call(uuid, boolean, text) TO service_role;
