-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.
-- AIN-05: agent console read models (ADR-129).
-- Origin: Claude Code agent, mission AIN-05 (issue #504).
-- Stacked on AIN-04 (#479) -> AIN-03 (#477) -> AIN-02 (#475) -> AIN-01 (#473) -> WF-12 (#471) -> WF-08 (#469) -> WF-07 (#467) -> WF-06 (#455).
--
-- Version note: 20261117000996 sorts directly after AIN-04 (20261117000995) and before the M2a role catalogue
-- (20261117001000, PR #448).
--
-- What this adds: three read models for one console screen. Nothing is written, no table is added, no guard is changed.
--   wf_console_agents      workflows.view    agents the organization can see, their earned level and ceiling, the next
--                                               rung and its bar, the latest evaluation numbers, the last level changes
--   wf_console_memory_list    workflows.manage  proposed and active memory items of the person's organization (keyset page)
--   wf_console_safety_list    workflows.view    screened texts that were flagged or blocked, and whether a person decided
--                                               (keyset page); never the text, which the ledger does not hold
--
-- What this does NOT do: no model call, no send, no change to autonomy, memory or safety data, no change to any guard.
-- The decisions (lower a level, accept or reject a proposal, retire an item, clear or reject flagged output) stay with
-- the AIN-02, AIN-03 and AIN-04 functions, each of which keeps checking its own authority. `meets_bar` below is
-- information for the screen; the AIN-02 promotion guard remains the only authority on whether a promotion is allowed.
--
-- Authority model (same as WF-07, WF-08, WF-12, AIN-01..04): SECURITY DEFINER, empty search_path, EXECUTE only to
-- service_role; the server passes the verified person, SQL derives the organization and the permission.
BEGIN;

DO $prereq$
BEGIN
  IF to_regclass('public.wf_safety_check') IS NULL
     OR to_regclass('public.wf_memory_item') IS NULL
     OR to_regclass('public.wf_autonomy_change') IS NULL
     OR to_regclass('public.wf_agent') IS NULL
     OR to_regprocedure('public.wf_act_as(uuid)') IS NULL
     OR to_regprocedure('public.wf_act_restore(jsonb)') IS NULL
     OR to_regprocedure('public.wf_can(uuid,text)') IS NULL
     OR to_regprocedure('public.get_my_organization_id()') IS NULL
     OR to_regprocedure('public.is_super_admin()') IS NULL
     OR to_regprocedure('public.wf_autonomy_ceiling(text)') IS NULL
     OR to_regprocedure('public.wf_agent_state_code(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'AIN-05: AIN-04 or earlier prerequisites are missing';
  END IF;
  IF to_regprocedure('public.wf_console_agents(uuid)') IS NOT NULL
     OR to_regprocedure('public.wf_console_memory_list(uuid,text,timestamp with time zone,uuid,integer)') IS NOT NULL
     OR to_regprocedure('public.wf_console_safety_list(uuid,text,timestamp with time zone,uuid,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'AIN-05: console objects already exist';
  END IF;
END
$prereq$;

-- -----------------------------------------------------------------------------
-- 1. Agents
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.wf_console_agents(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prev jsonb;
  v_org uuid;
  v_out jsonb;
BEGIN
  v_prev := public.wf_act_as(p_actor);
  v_org := public.get_my_organization_id();
  IF v_org IS NULL OR NOT public.wf_can(v_org, 'workflows.view') THEN
    RAISE EXCEPTION 'ain05:not_authorized' USING ERRCODE = '42501';
  END IF;
  v_out := jsonb_build_object(
    'ai_route_approved', public.wf_ai_route_approved(),
    'can_manage', public.wf_can(v_org, 'workflows.manage'),
    'can_approve', public.wf_can(v_org, 'workflows.approve'),
    'is_founder', public.is_super_admin(),
    'levels', coalesce((
      SELECT jsonb_agg(jsonb_build_object('level', s.level, 'rank', s.rank, 'label', s.label) ORDER BY s.rank)
        FROM public.wf_autonomy_scale s), '[]'::jsonb),
    'agents', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'agent_ref', a.agent_ref, 'codename', a.codename, 'family', a.family, 'tier', a.agent_tier,
        'accountable', a.accountable, 'state', public.wf_agent_state_code(v_org, a.agent_ref),
        'ceiling', public.wf_autonomy_ceiling(a.agent_ref),
        'earned_level', coalesce(u.earned_level, 'suggest'),
        'next_level', n.next_level,
        'bar', CASE WHEN b.target_level IS NULL THEN NULL ELSE jsonb_build_object(
                 'min_graded', b.min_graded, 'min_pass_rate', b.min_pass_rate, 'max_age_days', b.max_age_days) END,
        'evidence', CASE WHEN e.id IS NULL THEN NULL ELSE jsonb_build_object(
                 'suite_id', e.suite_id, 'graded', e.graded, 'passed', e.passed,
                 'critical_failures', e.critical_failures, 'ungraded', e.ungraded, 'evaluated_at', e.evaluated_at,
                 'age_days', greatest(0, floor(extract(epoch FROM (now() - e.evaluated_at)) / 86400))::integer,
                 -- Information only: the numbers of the latest evaluation against the next rung's bar. The promotion
                 -- guard (AIN-02) is the authority and also looks at supersession and the ungraded rule.
                 'meets_bar', b.target_level IS NOT NULL AND e.evaluated_at <= now()
                              AND e.evaluated_at >= now() - make_interval(days => b.max_age_days)
                              AND e.critical_failures = 0 AND e.graded >= b.min_graded
                              AND e.passed::numeric >= b.min_pass_rate * e.graded
                              AND NOT (e.ungraded > 0 AND public.wf_autonomy_rank(n.next_level) > 1)) END,
        'changes', coalesce((
          SELECT jsonb_agg(jsonb_build_object('kind', c.kind, 'from', c.from_level, 'to', c.to_level, 'at', c.created_at)
                           ORDER BY c.created_at DESC, c.id DESC)
            FROM (SELECT x.* FROM public.wf_autonomy_change x
                   WHERE x.org_id = v_org AND x.agent_ref = a.agent_ref
                   ORDER BY x.created_at DESC, x.id DESC LIMIT 5) c), '[]'::jsonb),
        'steps_24h', (SELECT count(*)::integer FROM public.wf_step_run s
                       WHERE s.org_id = v_org AND s.agent_ref = a.agent_ref
                         AND s.created_at > now() - interval '24 hours'),
        'budget', jsonb_build_object('daily_actions', a.daily_actions, 'daily_model_calls', a.daily_model_calls,
                                     'daily_cost_cap_minor', a.daily_cost_cap_minor)
      ) ORDER BY a.family DESC, a.agent_ref)
      FROM public.wf_agent a
      LEFT JOIN public.wf_agent_autonomy u ON u.org_id = v_org AND u.agent_ref = a.agent_ref
      CROSS JOIN LATERAL (SELECT CASE
          WHEN public.wf_autonomy_rank(coalesce(u.earned_level, 'suggest')) < public.wf_autonomy_rank(public.wf_autonomy_ceiling(a.agent_ref))
          THEN public.wf_autonomy_level_of(public.wf_autonomy_rank(coalesce(u.earned_level, 'suggest')) + 1) END AS next_level) n
      LEFT JOIN public.wf_autonomy_bar b ON b.target_level = n.next_level
      LEFT JOIN LATERAL (SELECT x.* FROM public.wf_autonomy_evidence x WHERE x.agent_ref = a.agent_ref
                          ORDER BY x.evaluated_at DESC, x.recorded_at DESC, x.id DESC LIMIT 1) e ON true
     WHERE a.status = 'active'
       AND (a.family = 'org'
            OR EXISTS (SELECT 1 FROM public.wf_agent_platform_grant g
                        WHERE g.org_id = v_org AND g.agent_ref = a.agent_ref))), '[]'::jsonb));
  PERFORM public.wf_act_restore(v_prev);
  RETURN v_out;
END
$$;

-- -----------------------------------------------------------------------------
-- 2. Memory
-- -----------------------------------------------------------------------------
-- A manager of the organization sees the short value of a proposed or active item of their own organization: a person
-- cannot accept or retire what they cannot read. Retired rows keep no content and are not listed.
CREATE FUNCTION public.wf_console_memory_list(
  p_actor uuid, p_status text DEFAULT 'proposed', p_before timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prev jsonb;
  v_org uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_statuses text[];
  v_rows jsonb;
  v_more boolean;
BEGIN
  v_statuses := CASE coalesce(p_status, 'proposed')
    WHEN 'proposed' THEN ARRAY['proposed']
    WHEN 'active' THEN ARRAY['active']
    WHEN 'all' THEN ARRAY['proposed', 'active']
    ELSE NULL END;
  IF v_statuses IS NULL THEN
    RAISE EXCEPTION 'ain05:invalid_filter' USING ERRCODE = '22023';
  END IF;
  v_prev := public.wf_act_as(p_actor);
  v_org := public.get_my_organization_id();
  IF v_org IS NULL OR NOT public.wf_can(v_org, 'workflows.manage') THEN
    RAISE EXCEPTION 'ain05:not_authorized' USING ERRCODE = '42501';
  END IF;
  WITH page AS (
    SELECT i.* FROM public.wf_memory_item i
     WHERE i.org_id = v_org AND i.status = ANY (v_statuses)
       AND (p_before IS NULL OR i.created_at < p_before
            OR (p_before_id IS NOT NULL AND i.created_at = p_before AND i.id < p_before_id))
     ORDER BY i.created_at DESC, i.id DESC
     LIMIT v_limit + 1
  ), shown AS (
    SELECT * FROM page ORDER BY created_at DESC, id DESC LIMIT v_limit
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'item_id', s.id, 'scope_kind', s.scope_kind, 'scope_ref', s.scope_ref, 'key', s.key,
      'data_class', s.data_class, 'status', s.status, 'source_kind', s.source_kind,
      'source_agent', s.source_agent, 'ai_readable', s.ai_readable, 'version', s.version,
      'expired', s.expires_at <= now(), 'expires_at', s.expires_at, 'created_at', s.created_at,
      'value', s.value) ORDER BY s.created_at DESC, s.id DESC), '[]'::jsonb),
    (SELECT count(*) > v_limit FROM page)
    INTO v_rows, v_more
    FROM shown s;
  PERFORM public.wf_act_restore(v_prev);
  RETURN jsonb_build_object('items', v_rows, 'has_more', v_more);
END
$$;

-- -----------------------------------------------------------------------------
-- 3. Output review
-- -----------------------------------------------------------------------------
-- The ledger holds the hash, length and codes of a screened text, never the text. Filters: pending (flagged, nobody
-- decided yet), blocked (never usable), decided, all (flagged, blocked or decided; clean checks are not listed).
CREATE FUNCTION public.wf_console_safety_list(
  p_actor uuid, p_filter text DEFAULT 'pending', p_before timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prev jsonb;
  v_org uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_filter text := coalesce(p_filter, 'pending');
  v_can_approve boolean;
  v_rows jsonb;
  v_more boolean;
BEGIN
  IF v_filter NOT IN ('pending', 'blocked', 'decided', 'all') THEN
    RAISE EXCEPTION 'ain05:invalid_filter' USING ERRCODE = '22023';
  END IF;
  v_prev := public.wf_act_as(p_actor);
  v_org := public.get_my_organization_id();
  IF v_org IS NULL OR NOT public.wf_can(v_org, 'workflows.view') THEN
    RAISE EXCEPTION 'ain05:not_authorized' USING ERRCODE = '42501';
  END IF;
  v_can_approve := public.wf_can(v_org, 'workflows.approve');
  WITH base AS (
    SELECT c.*, r.decision AS decision, r.created_at AS decided_at
      FROM public.wf_safety_check c
      LEFT JOIN public.wf_safety_review r ON r.org_id = c.org_id AND r.check_id = c.id
     WHERE c.org_id = v_org AND c.verdict <> 'clean'
  ), page AS (
    SELECT b.* FROM base b
     WHERE CASE v_filter
             WHEN 'pending' THEN b.verdict = 'flagged' AND b.decision IS NULL
             WHEN 'blocked' THEN b.verdict = 'blocked'
             WHEN 'decided' THEN b.decision IS NOT NULL
             ELSE true END
       AND (p_before IS NULL OR b.created_at < p_before
            OR (p_before_id IS NOT NULL AND b.created_at = p_before AND b.id < p_before_id))
     ORDER BY b.created_at DESC, b.id DESC
     LIMIT v_limit + 1
  ), shown AS (
    SELECT * FROM page ORDER BY created_at DESC, id DESC LIMIT v_limit
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'check_id', s.id, 'run_id', s.run_id, 'step_key', s.step_key, 'direction', s.direction,
      'verdict', s.verdict, 'codes', to_jsonb(s.codes), 'text_chars', s.text_chars, 'created_at', s.created_at,
      'decision', s.decision, 'decided_at', s.decided_at,
      'started_by_me', s.run_started_by IS NOT DISTINCT FROM p_actor AND s.run_started_by IS NOT NULL,
      'can_review', v_can_approve AND s.verdict = 'flagged' AND s.decision IS NULL
                    AND s.run_started_by IS DISTINCT FROM p_actor) ORDER BY s.created_at DESC, s.id DESC), '[]'::jsonb),
    (SELECT count(*) > v_limit FROM page)
    INTO v_rows, v_more
    FROM shown s;
  PERFORM public.wf_act_restore(v_prev);
  RETURN jsonb_build_object('items', v_rows, 'has_more', v_more, 'can_approve', v_can_approve);
END
$$;

-- -----------------------------------------------------------------------------
-- 4. Privileges
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.wf_console_agents(uuid),
  public.wf_console_memory_list(uuid, text, timestamptz, uuid, integer),
  public.wf_console_safety_list(uuid, text, timestamptz, uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.wf_console_agents(uuid),
  public.wf_console_memory_list(uuid, text, timestamptz, uuid, integer),
  public.wf_console_safety_list(uuid, text, timestamptz, uuid, integer)
  TO service_role;

COMMENT ON FUNCTION public.wf_console_agents(uuid) IS
  'AIN-05 / ADR-129: agents, earned level and ceiling, next rung and bar, latest evaluation numbers, last changes. workflows.view, service role only.';
COMMENT ON FUNCTION public.wf_console_memory_list(uuid, text, timestamptz, uuid, integer) IS
  'AIN-05 / ADR-129: proposed and active memory items of the person''s organization with their short value. workflows.manage, service role only.';
COMMENT ON FUNCTION public.wf_console_safety_list(uuid, text, timestamptz, uuid, integer) IS
  'AIN-05 / ADR-129: flagged and blocked screened texts (codes and length, never the text) and who decided. workflows.view, service role only.';

COMMIT;
