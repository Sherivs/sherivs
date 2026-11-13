-- COMMS-02 (issue #329): one calling agent for Professional and Enterprise.
-- Status: AUTHORED, NOT APPLIED. This file does not enable live calling.
-- voice_live stays at its existing default (off). No provider secret is stored.
-- Rollback: database/supabase/rollbacks/20261104033000_sherivs_comms02_calling_agent.sql
-- ADR-068. Reserved timestamp 20261104033000, after COMMS-01 20261104032000.
--
-- Apply order:
-- 1. COMMS-01 (20261104032000) is already applied.
-- 2. Run the read-only pre-apply queries in ADR-068. They do not write.
-- 3. Apply this file. Do not apply it to production from the pull request.
-- 4. Re-applying this file is safe. It does not turn voice_live on.

DO $comms02_guard$
BEGIN
  IF to_regclass('public.comms_sender_numbers') IS NULL
     OR to_regclass('public.voice_call_sessions') IS NULL
     OR to_regclass('public.cg_org_voice_agent') IS NULL
     OR to_regclass('public.cg_voice_call_approvals') IS NULL
     OR to_regprocedure('public.voice_agent_assert_recipient_consent(text,uuid)') IS NULL
     OR to_regprocedure('public.comms_voice_digits(text)') IS NULL
     OR to_regprocedure('public.comms_bind_voice_sender(uuid,text)') IS NULL
  THEN
    RAISE EXCEPTION 'COMMS-02 requires the COMMS-01 voice binding'
      USING ERRCODE = '55000';
  END IF;
END
$comms02_guard$;

ALTER TABLE public.voice_call_sessions
  ADD COLUMN IF NOT EXISTS line_role text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS pin_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS pin_member_id uuid,
  ADD COLUMN IF NOT EXISTS pin_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE public.voice_call_sessions DROP CONSTRAINT IF EXISTS voice_call_sessions_state_check;
ALTER TABLE public.voice_call_sessions
  ADD CONSTRAINT voice_call_sessions_state_check
  CHECK (state IN (
    'consent_pending', 'pin_pending', 'active', 'completed', 'escalated', 'declined', 'failed'
  ));

DO $comms02_line_role$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'voice_call_sessions_line_role_check'
  ) THEN
    ALTER TABLE public.voice_call_sessions
      ADD CONSTRAINT voice_call_sessions_line_role_check
      CHECK (line_role IN ('legacy', 'organization', 'platform_support'));
  END IF;
END
$comms02_line_role$;

ALTER TABLE public.voice_call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_call_sessions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_call_sessions FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.voice_agent_plan_entitled(p_tenant text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org uuid;
  v_tier text;
BEGIN
  IF p_tenant IS NULL OR p_tenant !~ '^[0-9a-fA-F-]{36}$' THEN
    RETURN false;
  END IF;
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    IF auth.uid() IS NULL
       OR public.get_my_tenant_id() IS DISTINCT FROM p_tenant
       OR NOT public.is_tenant_admin(p_tenant) THEN
      RETURN false;
    END IF;
  END IF;
  SELECT m.school_id INTO v_org
    FROM public.school_tenant_map m
    WHERE m.tenant_id = p_tenant::uuid;
  IF v_org IS NULL THEN
    v_org := p_tenant::uuid;
  END IF;
  SELECT lower(btrim(coalesce(s.subscription_tier, 'trial'))) INTO v_tier
    FROM public.schools s
    WHERE s.id = v_org;
  RETURN coalesce(v_tier, 'trial') IN ('professional', 'enterprise');
END;
$$;

CREATE OR REPLACE FUNCTION public.voice_agent_subscription_tier()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant text := public.get_my_tenant_id();
  v_org uuid;
  v_tier text;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL OR v_tenant !~ '^[0-9a-fA-F-]{36}$'
     OR NOT public.is_tenant_admin(v_tenant) THEN
    RETURN NULL;
  END IF;
  SELECT m.school_id INTO v_org
    FROM public.school_tenant_map m
    WHERE m.tenant_id = v_tenant::uuid;
  IF v_org IS NULL THEN
    v_org := v_tenant::uuid;
  END IF;
  SELECT lower(btrim(coalesce(s.subscription_tier, 'trial'))) INTO v_tier
    FROM public.schools s
    WHERE s.id = v_org;
  RETURN coalesce(v_tier, 'trial');
END;
$$;

CREATE OR REPLACE FUNCTION public.comms02_require_calling_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant text;
BEGIN
  IF TG_TABLE_NAME = 'cg_org_voice_agent' THEN
    IF NEW.enabled IS NOT TRUE THEN
      RETURN NEW;
    END IF;
    v_tenant := NEW.tenant_ref;
  ELSIF TG_TABLE_NAME = 'comms_sender_numbers' THEN
    IF NEW.channel IS DISTINCT FROM 'voice'
       OR NEW.binding_role IS DISTINCT FROM 'organization'
       OR NEW.number_status IS DISTINCT FROM 'active' THEN
      RETURN NEW;
    END IF;
    v_tenant := coalesce(NEW.tenant_ref, NEW.org_id::text);
  ELSIF TG_TABLE_NAME = 'cg_voice_call_approvals' THEN
    IF NOT (TG_OP = 'INSERT' OR NEW.status IN ('approved', 'dispatching')) THEN
      RETURN NEW;
    END IF;
    v_tenant := NEW.tenant_ref;
  ELSE
    RAISE EXCEPTION 'calling plan guard is not installed on this table' USING ERRCODE = '55000';
  END IF;
  IF NOT public.voice_agent_plan_entitled(v_tenant) THEN
    RAISE EXCEPTION 'calling agent is not included in this organization plan'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cg_org_voice_agent_calling_plan_guard ON public.cg_org_voice_agent;
CREATE TRIGGER cg_org_voice_agent_calling_plan_guard
  BEFORE INSERT OR UPDATE ON public.cg_org_voice_agent
  FOR EACH ROW
  EXECUTE FUNCTION public.comms02_require_calling_plan();

DROP TRIGGER IF EXISTS comms_sender_numbers_calling_plan_guard ON public.comms_sender_numbers;
CREATE TRIGGER comms_sender_numbers_calling_plan_guard
  BEFORE INSERT OR UPDATE ON public.comms_sender_numbers
  FOR EACH ROW
  EXECUTE FUNCTION public.comms02_require_calling_plan();

DROP TRIGGER IF EXISTS cg_voice_call_approvals_calling_plan_guard ON public.cg_voice_call_approvals;
CREATE TRIGGER cg_voice_call_approvals_calling_plan_guard
  BEFORE INSERT OR UPDATE ON public.cg_voice_call_approvals
  FOR EACH ROW
  EXECUTE FUNCTION public.comms02_require_calling_plan();

CREATE OR REPLACE FUNCTION public.voice_agent_school_line_open(p_tenant_ref text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RETURN false;
  END IF;
  IF p_tenant_ref IS NULL OR p_tenant_ref !~ '^[0-9a-fA-F-]{36}$' THEN
    RETURN false;
  END IF;
  IF NOT public.voice_agent_plan_entitled(p_tenant_ref) THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cg_org_voice_agent a
    WHERE a.tenant_ref = p_tenant_ref AND a.enabled
  ) THEN
    RETURN false;
  END IF;
  SELECT m.school_id INTO v_org
    FROM public.school_tenant_map m
    WHERE m.tenant_id = p_tenant_ref::uuid;
  IF v_org IS NULL THEN
    v_org := p_tenant_ref::uuid;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.comms_sender_numbers n
    WHERE n.channel = 'voice'
      AND n.provider = 'africas_talking'
      AND n.binding_role = 'organization'
      AND n.number_status = 'active'
      AND (n.tenant_ref = p_tenant_ref OR n.org_id = v_org)
  ) THEN
    RETURN false;
  END IF;
  IF (
    SELECT count(*) FROM public.voice_call_sessions s
    WHERE s.tenant_id = v_org
      AND s.created_at >= statement_timestamp() - interval '1 hour'
  ) >= 30 THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.voice_agent_caller_member(
  p_tenant_ref text, p_caller_digits text
) RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org uuid;
  v_count integer;
  v_member uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_tenant_ref IS NULL OR p_tenant_ref !~ '^[0-9a-fA-F-]{36}$'
     OR p_caller_digits IS NULL OR p_caller_digits !~ '^[0-9]{7,15}$' THEN
    RETURN NULL;
  END IF;
  IF NOT public.voice_agent_plan_entitled(p_tenant_ref) THEN
    RETURN NULL;
  END IF;
  SELECT m.school_id INTO v_org
    FROM public.school_tenant_map m
    WHERE m.tenant_id = p_tenant_ref::uuid;
  IF v_org IS NULL THEN
    v_org := p_tenant_ref::uuid;
  END IF;
  SELECT count(*) INTO v_count
    FROM public.users u
    JOIN public.organization_memberships mem
      ON mem.user_id = u.id AND mem.school_id = v_org AND mem.is_active
    JOIN auth.users au ON au.id = u.id
    WHERE coalesce(u.is_active, true)
      AND au.phone_confirmed_at IS NOT NULL
      AND public.comms_voice_digits(u.phone) = p_caller_digits
      AND public.comms_voice_digits(au.phone) = p_caller_digits;
  IF v_count <> 1 THEN
    RETURN NULL;
  END IF;
  SELECT u.id INTO v_member
    FROM public.users u
    JOIN public.organization_memberships mem
      ON mem.user_id = u.id AND mem.school_id = v_org AND mem.is_active
    JOIN auth.users au ON au.id = u.id
    WHERE coalesce(u.is_active, true)
      AND au.phone_confirmed_at IS NOT NULL
      AND public.comms_voice_digits(u.phone) = p_caller_digits
      AND public.comms_voice_digits(au.phone) = p_caller_digits;
  BEGIN
    PERFORM public.voice_agent_assert_recipient_consent(p_tenant_ref, v_member);
  EXCEPTION
    WHEN insufficient_privilege THEN
      RETURN NULL;
  END;
  RETURN v_member;
END;
$$;

CREATE TABLE IF NOT EXISTS public.cg_voice_member_pin (
  tenant_ref text NOT NULL CHECK (tenant_ref ~ '^[0-9a-fA-F-]{36}$'),
  user_id uuid NOT NULL,
  pin_hash text NOT NULL CHECK (length(pin_hash) BETWEEN 20 AND 200),
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_ref, user_id)
);

CREATE TABLE IF NOT EXISTS public.cg_voice_pin_attempt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL CHECK (tenant_ref ~ '^[0-9a-fA-F-]{36}$'),
  user_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('ok', 'rejected', 'locked', 'missing', 'rate_limited')),
  caller_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cg_voice_pin_attempt
  ADD COLUMN IF NOT EXISTS caller_hash text;

ALTER TABLE public.cg_voice_member_pin ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_voice_member_pin FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cg_voice_pin_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_voice_pin_attempt FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cg_voice_member_pin, public.cg_voice_pin_attempt
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.voice_agent_pin_audit(
  p_org uuid, p_action text, p_member uuid, p_outcome text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_seq bigint;
  v_prev text;
  v_at timestamptz := statement_timestamp();
  v_actor text := coalesce(auth.uid()::text, 'voice-pin');
  v_kind text := CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END;
  v_target text := coalesce(p_member::text, 'unknown');
  v_after text;
BEGIN
  IF p_org IS NULL OR p_action IS NULL THEN
    RETURN;
  END IF;
  -- Same advisory lock and order as audit_chain_link_guard: lock 7013, then read the head.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text, 7013));
  SELECT seq, entry_hash INTO v_seq, v_prev
    FROM public.audit_chain WHERE org_id = p_org ORDER BY seq DESC LIMIT 1;
  v_after := encode(extensions.digest(convert_to(p_action || ':' || p_outcome, 'UTF8'), 'sha256'), 'hex');
  v_seq := coalesce(v_seq, 0) + 1;
  v_prev := coalesce(v_prev, repeat('0', 64));
  INSERT INTO public.audit_chain (
    org_id, seq, at, actor_kind, actor_id, action, target_type, target_id, ip, device,
    before_hash, after_hash, prev_hash, entry_hash
  ) VALUES (
    p_org, v_seq, v_at, v_kind, v_actor, p_action, 'voice_pin', v_target,
    NULL, NULL, NULL, v_after, v_prev,
    public.audit_chain_canonical_hash(
      v_prev, v_seq, v_at, p_org, v_kind, v_actor, p_action,
      'voice_pin', v_target, NULL, NULL, NULL, v_after
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.voice_agent_pin_acceptable(p_pin text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_index integer;
  v_asc boolean := true;
  v_desc boolean := true;
  v_step integer;
BEGIN
  IF p_pin IS NULL OR p_pin !~ '^[0-9]+$' THEN
    RETURN false;
  END IF;
  IF p_pin IN ('0000', '1111', '1234', '1212', '2580', '6969', '1004', '2000') THEN
    RETURN false;
  END IF;
  IF length(p_pin) = 4 AND p_pin::integer BETWEEN 1950 AND 2030 THEN
    RETURN false;
  END IF;
  IF length(p_pin) < 6 OR length(p_pin) > 8 THEN
    RETURN false;
  END IF;
  IF p_pin ~ '^([0-9])\1+$' THEN
    RETURN false;
  END IF;
  FOR v_index IN 2..length(p_pin) LOOP
    v_step := ascii(substr(p_pin, v_index, 1)) - ascii(substr(p_pin, v_index - 1, 1));
    IF v_step <> 1 THEN
      v_asc := false;
    END IF;
    IF v_step <> -1 THEN
      v_desc := false;
    END IF;
  END LOOP;
  RETURN NOT v_asc AND NOT v_desc;
END;
$$;

CREATE OR REPLACE FUNCTION public.voice_agent_set_own_pin(p_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant text := public.get_my_tenant_id();
  v_org uuid;
  v_tier text;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL OR v_tenant !~ '^[0-9a-fA-F-]{36}$' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT public.voice_agent_pin_acceptable(p_pin) THEN
    RAISE EXCEPTION 'invalid voice pin' USING ERRCODE = '22023';
  END IF;
  SELECT m.school_id INTO v_org
    FROM public.school_tenant_map m
    WHERE m.tenant_id = v_tenant::uuid;
  IF v_org IS NULL THEN
    v_org := v_tenant::uuid;
  END IF;
  SELECT lower(btrim(coalesce(s.subscription_tier, 'trial'))) INTO v_tier
    FROM public.schools s
    WHERE s.id = v_org;
  IF coalesce(v_tier, 'trial') NOT IN ('professional', 'enterprise') THEN
    RAISE EXCEPTION 'calling agent is not included in this organization plan' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_memberships mem
    WHERE mem.user_id = auth.uid() AND mem.school_id = v_org AND mem.is_active
  ) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.cg_voice_member_pin (tenant_ref, user_id, pin_hash, failed_attempts, locked_until)
  VALUES (
    v_tenant, auth.uid(), extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), 0, NULL
  )
  ON CONFLICT (tenant_ref, user_id) DO UPDATE SET
    pin_hash = EXCLUDED.pin_hash,
    failed_attempts = 0,
    locked_until = NULL,
    updated_at = statement_timestamp();
  PERFORM public.voice_agent_pin_audit(v_org, 'voice.pin.set', auth.uid(), 'set');
END;
$$;

DROP FUNCTION IF EXISTS public.voice_agent_verify_pin(text, uuid, text);

CREATE OR REPLACE FUNCTION public.voice_agent_verify_pin(
  p_tenant_ref text, p_member uuid, p_pin text, p_caller_digits text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- Cost-8 bcrypt of a fixed non-member pad so a missing hash still runs crypt().
  v_dummy text := '$2a$08$MATINFJHiPrCcpsqpnNfL.VwBfsABRwqbmPLGjJh2uzdixF1QbPfW';
  v_org uuid;
  v_hash text;
  v_failed integer;
  v_locked timestamptz;
  v_org_attempts integer;
  v_caller_attempts integer := 0;
  v_caller_hash text;
  v_outcome text;
  v_pin text := coalesce(p_pin, '');
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_tenant_ref IS NULL OR p_tenant_ref !~ '^[0-9a-fA-F-]{36}$' THEN
    PERFORM extensions.crypt(v_pin, v_dummy);
    RETURN 'rejected';
  END IF;
  SELECT m.school_id INTO v_org
    FROM public.school_tenant_map m
    WHERE m.tenant_id = p_tenant_ref::uuid;
  IF v_org IS NULL THEN
    v_org := p_tenant_ref::uuid;
  END IF;
  IF p_caller_digits ~ '^[0-9]{7,15}$' THEN
    v_caller_hash := encode(
      extensions.digest(convert_to(p_tenant_ref || ':' || p_caller_digits, 'UTF8'), 'sha256'),
      'hex'
    );
    SELECT count(*) INTO v_caller_attempts
      FROM public.cg_voice_pin_attempt a
      WHERE a.tenant_ref = p_tenant_ref
        AND a.caller_hash = v_caller_hash
        AND a.created_at >= statement_timestamp() - interval '1 hour';
  END IF;
  SELECT count(*) INTO v_org_attempts
    FROM public.cg_voice_pin_attempt a
    WHERE a.tenant_ref = p_tenant_ref
      AND a.created_at >= statement_timestamp() - interval '1 hour';
  IF v_org_attempts >= 30 OR v_caller_attempts >= 10 THEN
    PERFORM extensions.crypt(v_pin, v_dummy);
    INSERT INTO public.cg_voice_pin_attempt (tenant_ref, user_id, outcome, caller_hash)
    VALUES (p_tenant_ref, p_member, 'rate_limited', v_caller_hash);
    PERFORM public.voice_agent_pin_audit(v_org, 'voice.pin.rejected', p_member, 'rate_limited');
    RETURN 'rate_limited';
  END IF;
  IF p_member IS NULL THEN
    PERFORM extensions.crypt(v_pin, v_dummy);
    INSERT INTO public.cg_voice_pin_attempt (tenant_ref, user_id, outcome, caller_hash)
    VALUES (p_tenant_ref, NULL, 'rejected', v_caller_hash);
    PERFORM public.voice_agent_pin_audit(v_org, 'voice.pin.rejected', NULL, 'rejected');
    RETURN 'rejected';
  END IF;
  SELECT pin_hash, failed_attempts, locked_until
    INTO v_hash, v_failed, v_locked
    FROM public.cg_voice_member_pin
    WHERE tenant_ref = p_tenant_ref AND user_id = p_member
    FOR UPDATE;
  IF v_hash IS NULL THEN
    PERFORM extensions.crypt(v_pin, v_dummy);
    INSERT INTO public.cg_voice_pin_attempt (tenant_ref, user_id, outcome, caller_hash)
    VALUES (p_tenant_ref, p_member, 'rejected', v_caller_hash);
    PERFORM public.voice_agent_pin_audit(v_org, 'voice.pin.rejected', p_member, 'rejected');
    RETURN 'rejected';
  END IF;
  IF v_locked IS NOT NULL AND v_locked > statement_timestamp() THEN
    PERFORM extensions.crypt(v_pin, v_hash);
    INSERT INTO public.cg_voice_pin_attempt (tenant_ref, user_id, outcome, caller_hash)
    VALUES (p_tenant_ref, p_member, 'locked', v_caller_hash);
    PERFORM public.voice_agent_pin_audit(v_org, 'voice.pin.rejected', p_member, 'locked');
    RETURN 'locked';
  END IF;
  IF extensions.crypt(v_pin, v_hash) = v_hash AND public.voice_agent_pin_acceptable(v_pin) THEN
    UPDATE public.cg_voice_member_pin
      SET failed_attempts = 0, locked_until = NULL, updated_at = statement_timestamp()
      WHERE tenant_ref = p_tenant_ref AND user_id = p_member;
    INSERT INTO public.cg_voice_pin_attempt (tenant_ref, user_id, outcome, caller_hash)
    VALUES (p_tenant_ref, p_member, 'ok', v_caller_hash);
    PERFORM public.voice_agent_pin_audit(v_org, 'voice.pin.accepted', p_member, 'ok');
    RETURN 'ok';
  END IF;
  v_failed := coalesce(v_failed, 0) + 1;
  v_outcome := CASE WHEN v_failed >= 5 THEN 'locked' ELSE 'rejected' END;
  UPDATE public.cg_voice_member_pin
    SET failed_attempts = v_failed,
        locked_until = CASE WHEN v_failed >= 5 THEN statement_timestamp() + interval '15 minutes' ELSE NULL END,
        updated_at = statement_timestamp()
    WHERE tenant_ref = p_tenant_ref AND user_id = p_member;
  INSERT INTO public.cg_voice_pin_attempt (tenant_ref, user_id, outcome, caller_hash)
  VALUES (p_tenant_ref, p_member, v_outcome, v_caller_hash);
  PERFORM public.voice_agent_pin_audit(v_org, 'voice.pin.rejected', p_member, v_outcome);
  RETURN v_outcome;
END;
$$;

DROP FUNCTION IF EXISTS public.voice_agent_member_facts(text, uuid);

CREATE OR REPLACE FUNCTION public.voice_agent_member_facts(
  p_tenant_ref text, p_member uuid, p_session uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org uuid;
  v_open_count integer;
  v_open_amount text;
  v_results jsonb;
  v_references jsonb;
  v_schedule jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_tenant_ref IS NULL OR p_tenant_ref !~ '^[0-9a-fA-F-]{36}$' OR p_member IS NULL THEN
    RETURN jsonb_build_object('tenantRef', coalesce(p_tenant_ref, ''), 'verified', false);
  END IF;
  IF NOT public.voice_agent_plan_entitled(p_tenant_ref) THEN
    RETURN jsonb_build_object('tenantRef', p_tenant_ref, 'verified', false);
  END IF;
  SELECT m.school_id INTO v_org
    FROM public.school_tenant_map m
    WHERE m.tenant_id = p_tenant_ref::uuid;
  IF v_org IS NULL THEN
    v_org := p_tenant_ref::uuid;
  END IF;
  IF p_session IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.voice_call_sessions s
    WHERE s.id = p_session
      AND s.pin_member_id = p_member
      AND s.pin_verified_at IS NOT NULL
      AND s.line_role = 'organization'
      AND s.state = 'active'
      AND (s.tenant_ref = p_tenant_ref OR s.tenant_id = v_org)
  ) THEN
    RETURN jsonb_build_object('tenantRef', p_tenant_ref, 'verified', false);
  END IF;
  BEGIN
    PERFORM public.voice_agent_assert_recipient_consent(p_tenant_ref, p_member);
  EXCEPTION
    WHEN insufficient_privilege THEN
      RETURN jsonb_build_object('tenantRef', p_tenant_ref, 'verified', false);
  END;

  SELECT count(*)::integer,
         trim(to_char(coalesce(sum(f.amount - f.paid_amount), 0), 'FM999999990.00'))
    INTO v_open_count, v_open_amount
    FROM public.fees f
    JOIN public.students s ON s.id = f.student_id AND s.school_id = v_org
    WHERE f.school_id = v_org
      AND f.status IN ('unpaid', 'partial')
      AND (
        s.user_id = p_member
        OR s.parent_id = p_member
        OR EXISTS (
          SELECT 1 FROM public.parent_student_map link
          WHERE link.student_id = s.id
            AND link.parent_id = p_member
            AND link.school_id = v_org
        )
      );

  SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) INTO v_results
    FROM (
      SELECT g.subject AS label, g.total_score::text AS score, g.term AS period
      FROM public.grades g
      JOIN public.students s ON s.id = g.student_id AND s.school_id = v_org
      WHERE g.school_id = v_org
        AND g.is_published
        AND (
          s.user_id = p_member
          OR s.parent_id = p_member
          OR EXISTS (
            SELECT 1 FROM public.parent_student_map link
            WHERE link.student_id = s.id AND link.parent_id = p_member AND link.school_id = v_org
          )
        )
      ORDER BY g.created_at DESC
      LIMIT 5
    ) q;

  SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) INTO v_references
    FROM (
      SELECT s.admission_number AS reference, coalesce(s.is_active, false) AS active
      FROM public.students s
      WHERE s.school_id = v_org
        AND s.admission_number IS NOT NULL
        AND (
          s.user_id = p_member
          OR s.parent_id = p_member
          OR EXISTS (
            SELECT 1 FROM public.parent_student_map link
            WHERE link.student_id = s.id AND link.parent_id = p_member AND link.school_id = v_org
          )
        )
      ORDER BY s.created_at DESC
      LIMIT 3
    ) q;

  SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) INTO v_schedule
    FROM (
      SELECT slot.day_of_week AS day, slot.period_number AS period, slot.subject AS label
      FROM public.timetable_slots slot
      JOIN public.timetables board ON board.id = slot.timetable_id AND board.school_id = v_org
      JOIN public.students s ON s.class_id = board.class_id AND s.school_id = v_org
      WHERE slot.school_id = v_org
        AND board.published
        AND board.is_active
        AND slot.is_break IS NOT TRUE
        AND (
          s.user_id = p_member
          OR s.parent_id = p_member
          OR EXISTS (
            SELECT 1 FROM public.parent_student_map link
            WHERE link.student_id = s.id AND link.parent_id = p_member AND link.school_id = v_org
          )
        )
      ORDER BY slot.day_of_week, slot.period_number
      LIMIT 8
    ) q;

  RETURN jsonb_build_object(
    'tenantRef', p_tenant_ref,
    'verified', true,
    'fees', jsonb_build_object('openCount', coalesce(v_open_count, 0), 'openAmount', coalesce(v_open_amount, '0.00')),
    'results', v_results,
    'admissions', v_references,
    'timetable', v_schedule
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.voice_agent_call_log()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant text := public.get_my_tenant_id();
  v_org uuid;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL OR v_tenant !~ '^[0-9a-fA-F-]{36}$'
     OR NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT m.school_id INTO v_org
    FROM public.school_tenant_map m
    WHERE m.tenant_id = v_tenant::uuid;
  IF v_org IS NULL THEN
    v_org := v_tenant::uuid;
  END IF;
  SELECT coalesce(jsonb_agg(logged.item ORDER BY logged.at_value DESC), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT combined.at_value, combined.item
      FROM (
        SELECT s.created_at AS at_value,
          jsonb_build_object(
            'id', s.id,
            'kind', 'inbound',
            'status', s.state,
            'summary', 'Inbound call',
            'signal', CASE
              WHEN EXISTS (
                SELECT 1 FROM public.cg_voice_member_pin p
                WHERE p.user_id = s.pin_member_id
                  AND p.tenant_ref = coalesce(s.tenant_ref, s.tenant_id::text)
                  AND p.locked_until > statement_timestamp()
              ) THEN 'member_locked'
              ELSE NULL
            END,
            'at', s.created_at
          ) AS item
        FROM public.voice_call_sessions s
        WHERE s.tenant_id = v_org OR s.tenant_ref = v_tenant
        UNION ALL
        SELECT a.created_at,
          jsonb_build_object(
            'id', a.id,
            'kind', 'outbound',
            'status', a.status,
            'summary', a.category,
            'signal', NULL,
            'at', a.created_at
          )
        FROM public.cg_voice_call_approvals a
        WHERE a.tenant_ref = v_tenant
      ) combined
      ORDER BY combined.at_value DESC
      LIMIT 40
    ) logged;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.voice_agent_plan_entitled(text),
  public.voice_agent_subscription_tier(),
  public.comms02_require_calling_plan(),
  public.voice_agent_school_line_open(text),
  public.voice_agent_caller_member(text, text),
  public.voice_agent_member_facts(text, uuid, uuid),
  public.voice_agent_call_log(),
  public.voice_agent_pin_audit(uuid, text, uuid, text),
  public.voice_agent_set_own_pin(text),
  public.voice_agent_verify_pin(text, uuid, text, text),
  public.voice_agent_pin_acceptable(text)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.voice_agent_plan_entitled(text),
  public.voice_agent_subscription_tier(),
  public.voice_agent_call_log(),
  public.voice_agent_set_own_pin(text)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.voice_agent_plan_entitled(text),
  public.voice_agent_school_line_open(text),
  public.voice_agent_caller_member(text, text),
  public.voice_agent_member_facts(text, uuid, uuid),
  public.voice_agent_verify_pin(text, uuid, text, text)
  TO service_role;

COMMENT ON FUNCTION public.voice_agent_plan_entitled(text) IS
  'COMMS-02 commercial gate. Professional and Enterprise only. Does not enable voice_live.';
COMMENT ON FUNCTION public.voice_agent_member_facts(text, uuid, uuid) IS
  'Service-role facts only after a verified voice PIN on this call. Caller ID is not enough. No phone number or PIN is returned.';
COMMENT ON FUNCTION public.voice_agent_set_own_pin(text) IS
  'Stores a member voice PIN as a bcrypt hash. The PIN value is not written to audit_chain.';
