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
  ADD COLUMN IF NOT EXISTS line_role text NOT NULL DEFAULT 'legacy';

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
    IF NEW.channel IS DISTINCT FROM 'voice' OR NEW.binding_role IS DISTINCT FROM 'organization' THEN
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

CREATE OR REPLACE FUNCTION public.voice_agent_member_facts(
  p_tenant_ref text, p_member uuid
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
  public.voice_agent_member_facts(text, uuid),
  public.voice_agent_call_log()
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.voice_agent_plan_entitled(text),
  public.voice_agent_subscription_tier(),
  public.voice_agent_call_log()
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.voice_agent_plan_entitled(text),
  public.voice_agent_school_line_open(text),
  public.voice_agent_caller_member(text, text),
  public.voice_agent_member_facts(text, uuid)
  TO service_role;

COMMENT ON FUNCTION public.voice_agent_plan_entitled(text) IS
  'COMMS-02 commercial gate. Professional and Enterprise only. Does not enable voice_live.';
COMMENT ON FUNCTION public.voice_agent_member_facts(text, uuid) IS
  'Service-role facts for one verified member of one organization. No phone number is returned.';
