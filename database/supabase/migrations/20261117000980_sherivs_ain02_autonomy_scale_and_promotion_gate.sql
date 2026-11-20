-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.
-- AIN-02: one autonomy scale in the engine, per-step enforcement and the promotion gate (ADR-126).
-- Origin: Claude Code agent, mission AIN-02 (issue #474).
-- Stacked on AIN-01 (#473) -> WF-12 (#471) -> WF-08 (#469) -> WF-07 (#467) -> WF-06 (#455).
--
-- Version note: 20261117000980 sorts directly after AIN-01 (20261117000970) and before the M2a role catalogue
-- (20261117001000, PR #448). It is free on every open branch checked on 2026-11-20.
--
-- What this adds (all names neutral):
--   wf_autonomy_scale             the one scale: suggest < draft < act_with_approval < act_and_report, each mapped to the
--                                 earned-autonomy ladder state (ENGINE-01, ADR-078)
--   wf_autonomy_class_cap         highest level per engine action class (reviewed data); the six capped classes are
--                                 'draft' by a CHECK
--   wf_autonomy_agent_tier_cap    highest level per registry agent tier (reviewed data)
--   wf_autonomy_bar               evidence needed to climb into each level (restates the ladder bars)
--   wf_autonomy_evidence          append-only evaluation numbers for an agent (no tenant data, no content)
--   wf_autonomy_change            append-only ledger of every change of an earned level
--   wf_autonomy_rank, wf_autonomy_level_of, wf_autonomy_ceiling, wf_effective_autonomy   the one ordering and the one
--                                 effective-level function; wf_autonomy_guard (step insert and update) now uses them
--   wf_autonomy_write_gate        trigger: the earned level (wf_agent_autonomy) changes only through the gate
--   wf_autonomy_change_guard      trigger: restates every promotion rule where a bug in a function cannot skip it
--   wf_autonomy_record_evidence   service role: record evidence; a regression lowers the agent one rung everywhere
--   wf_autonomy_promote           service role, verified person must be the founder (super admin)
--   wf_autonomy_demote            service role, verified person is the founder or an administrator of the organization
--   wf_action_sandbox_outbox_90_autonomy   an executed record needs its step at act_and_report or an approved draft
--   wf_run_08_freeze_actor        a run's agent and template cannot be re-pointed once set
--
-- What this does NOT do: no model call, no tenant data to any AI (the AI route stays closed, AIN-01
-- wf_ai_route_approved() = false), no send, no change to any tenant's data, no UI. The service role loses the right to
-- write the earned level directly (it keeps SELECT).
--
-- Authority model (same as WF-07, WF-08, WF-12, AIN-01): SECURITY DEFINER, empty search_path, EXECUTE only to
-- service_role for the three functions the server calls; the server passes the verified person, SQL binds it
-- (wf_act_as) and derives the organization from it.
BEGIN;

DO $prereq$
BEGIN
  IF to_regclass('public.wf_agent') IS NULL
     OR to_regclass('public.wf_agent_autonomy') IS NULL
     OR to_regclass('public.wf_org_settings') IS NULL
     OR to_regclass('public.wf_step_run') IS NULL
     OR to_regclass('public.wf_run') IS NULL
     OR to_regclass('public.wf_action_sandbox_outbox') IS NULL
     OR to_regclass('public.wf_action_draft') IS NULL
     OR to_regclass('public.super_admins') IS NULL
     OR to_regprocedure('public.wf_autonomy_guard()') IS NULL
     OR to_regprocedure('public.wf_agent_state_code(uuid,text)') IS NULL
     OR to_regprocedure('public.wf_audit_append(uuid,text,text,text,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public.wf_act_as(uuid)') IS NULL
     OR to_regprocedure('public.wf_act_restore(jsonb)') IS NULL
     OR to_regprocedure('public.wf_can(uuid,text)') IS NULL
     OR to_regprocedure('public.is_super_admin()') IS NULL
     OR to_regprocedure('public.get_my_organization_id()') IS NULL THEN
    RAISE EXCEPTION 'AIN-02: AIN-01, WF-06 or WF-07 prerequisites are missing';
  END IF;
  IF to_regclass('public.wf_autonomy_scale') IS NOT NULL
     OR to_regclass('public.wf_autonomy_change') IS NOT NULL
     OR to_regprocedure('public.wf_autonomy_promote(uuid,uuid,text,text,uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'AIN-02: autonomy objects already exist';
  END IF;
END
$prereq$;

-- -----------------------------------------------------------------------------
-- 1. The one ordering
-- -----------------------------------------------------------------------------
-- An unknown or null level ranks as the lowest (suggest), so a typo can only ever lower an answer, never raise it
-- (least() ignores nulls, which is why this never returns null).
CREATE FUNCTION public.wf_autonomy_rank(p_level text)
RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT CASE p_level WHEN 'draft' THEN 1 WHEN 'act_with_approval' THEN 2 WHEN 'act_and_report' THEN 3 ELSE 0 END
$$;

CREATE FUNCTION public.wf_autonomy_level_of(p_rank integer)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT CASE greatest(0, least(coalesce(p_rank, 0), 3))
           WHEN 1 THEN 'draft' WHEN 2 THEN 'act_with_approval' WHEN 3 THEN 'act_and_report' ELSE 'suggest' END
$$;

-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------
CREATE TABLE public.wf_autonomy_scale (
  level        text PRIMARY KEY CHECK (level IN ('suggest', 'draft', 'act_with_approval', 'act_and_report')),
  rank         smallint NOT NULL UNIQUE CHECK (rank BETWEEN 0 AND 3),
  ladder_state text NOT NULL UNIQUE CHECK (ladder_state IN ('shadow', 'propose', 'assist', 'autonomous')),
  label        text NOT NULL CHECK (length(btrim(label)) BETWEEN 3 AND 80),
  CONSTRAINT wf_autonomy_scale_rank_agrees CHECK (public.wf_autonomy_rank(level) = rank)
);

-- Highest level per engine action class. A class that is not listed is capped at 'draft' (the guard's rule since WF-03).
CREATE TABLE public.wf_autonomy_class_cap (
  action_class text PRIMARY KEY CHECK (action_class ~ '^[a-z][a-z0-9_]{1,63}$'),
  max_level    text NOT NULL REFERENCES public.wf_autonomy_scale (level) ON DELETE RESTRICT,
  CONSTRAINT wf_autonomy_class_cap_capped_classes CHECK (
    action_class NOT IN ('money_movement', 'safeguarding', 'credential_change', 'public_publish',
                         'mass_message', 'external_authority_share')
    OR max_level IN ('suggest', 'draft')),
  CONSTRAINT wf_autonomy_class_cap_unclassified CHECK (
    action_class NOT IN ('unclassified', 'ai_model') OR max_level IN ('suggest', 'draft'))
);

-- Highest level per registry agent tier. Reviewed data; an engineering default for the founder to ratify.
CREATE TABLE public.wf_autonomy_agent_tier_cap (
  agent_tier text PRIMARY KEY CHECK (agent_tier IN ('executive', 'department', 'assurance', 'organization')),
  max_level  text NOT NULL REFERENCES public.wf_autonomy_scale (level) ON DELETE RESTRICT,
  -- Assurance agents are the independent check on the others; they report and propose, they never act alone.
  CONSTRAINT wf_autonomy_agent_tier_cap_assurance CHECK (agent_tier <> 'assurance' OR max_level IN ('suggest', 'draft')),
  CONSTRAINT wf_autonomy_agent_tier_cap_executive CHECK (agent_tier <> 'executive' OR max_level <> 'act_and_report')
);

-- What evidence lets an agent climb INTO a level. These restate PROMOTION_BAR, EVIDENCE_MAX_AGE_MS and
-- DEMOTE_BELOW_PASS_RATE of the ENGINE-01 ladder; a unit test fails when they differ.
CREATE TABLE public.wf_autonomy_bar (
  target_level  text PRIMARY KEY REFERENCES public.wf_autonomy_scale (level) ON DELETE RESTRICT,
  min_graded    integer NOT NULL CHECK (min_graded BETWEEN 1 AND 100000),
  min_pass_rate numeric(4, 3) NOT NULL CHECK (min_pass_rate BETWEEN 0.5 AND 1),
  max_age_days  integer NOT NULL CHECK (max_age_days BETWEEN 1 AND 90),
  CONSTRAINT wf_autonomy_bar_not_the_floor CHECK (target_level <> 'suggest')
);

-- Evaluation numbers about an agent's behaviour on synthetic cases (ENGINE-14 suites). Never tenant data, never
-- content: counts, a suite id and the hash of the full result held elsewhere.
CREATE TABLE public.wf_autonomy_evidence (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_ref         text NOT NULL REFERENCES public.wf_agent (agent_ref) ON DELETE RESTRICT,
  suite_id          text NOT NULL CHECK (suite_id ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{1,127}$'),
  graded            integer NOT NULL CHECK (graded BETWEEN 0 AND 100000),
  passed            integer NOT NULL CHECK (passed >= 0),
  critical_failures integer NOT NULL CHECK (critical_failures >= 0),
  ungraded          integer NOT NULL CHECK (ungraded BETWEEN 0 AND 100000),
  evaluated_at      timestamptz NOT NULL,
  content_sha256    text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wf_autonomy_evidence_counts CHECK (passed <= graded AND critical_failures <= graded - passed),
  CONSTRAINT wf_autonomy_evidence_once UNIQUE (agent_ref, content_sha256)
);
CREATE INDEX wf_autonomy_evidence_agent_idx ON public.wf_autonomy_evidence (agent_ref, evaluated_at DESC);

-- Every change of an earned level, who decided it and on what evidence.
CREATE TABLE public.wf_autonomy_change (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.wf_org_settings (org_id) ON DELETE RESTRICT,
  agent_ref   text NOT NULL REFERENCES public.wf_agent (agent_ref) ON DELETE RESTRICT,
  kind        text NOT NULL CHECK (kind IN ('promote', 'demote', 'auto_demote')),
  from_level  text NOT NULL REFERENCES public.wf_autonomy_scale (level) ON DELETE RESTRICT,
  to_level    text NOT NULL REFERENCES public.wf_autonomy_scale (level) ON DELETE RESTRICT,
  evidence_id uuid REFERENCES public.wf_autonomy_evidence (id) ON DELETE RESTRICT,
  decided_by  uuid,
  reason      text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 300),
  txid        bigint NOT NULL DEFAULT txid_current(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wf_autonomy_change_shape CHECK (
    (kind = 'promote' AND evidence_id IS NOT NULL AND decided_by IS NOT NULL
       AND public.wf_autonomy_rank(to_level) = public.wf_autonomy_rank(from_level) + 1)
    OR (kind = 'demote' AND decided_by IS NOT NULL
       AND public.wf_autonomy_rank(to_level) < public.wf_autonomy_rank(from_level))
    OR (kind = 'auto_demote' AND evidence_id IS NOT NULL AND decided_by IS NULL
       AND public.wf_autonomy_rank(to_level) = public.wf_autonomy_rank(from_level) - 1))
);
-- One piece of evidence promotes once: a single good result cannot be spent on a second rung or a second organization.
CREATE UNIQUE INDEX wf_autonomy_change_evidence_once ON public.wf_autonomy_change (evidence_id) WHERE kind = 'promote';
CREATE INDEX wf_autonomy_change_org_agent_idx ON public.wf_autonomy_change (org_id, agent_ref, created_at DESC);

-- -----------------------------------------------------------------------------
-- 3. Reviewed data
-- -----------------------------------------------------------------------------
-- BEGIN AIN02 SEED (kept in step with frontend/src/lib/workflow/autonomy-scale.ts by tests/unit/ain02-autonomy-scale.test.ts)
INSERT INTO public.wf_autonomy_scale (level, rank, ladder_state, label) VALUES
  ('suggest', 0, 'shadow', 'Suggest only'),
  ('draft', 1, 'propose', 'Draft for a person'),
  ('act_with_approval', 2, 'assist', 'Act after approval'),
  ('act_and_report', 3, 'autonomous', 'Act and report');

INSERT INTO public.wf_autonomy_class_cap (action_class, max_level) VALUES
  ('internal', 'act_and_report'),
  ('communication', 'act_and_report'),
  ('task', 'act_and_report'),
  ('wait', 'act_and_report'),
  ('unclassified', 'draft'),
  ('ai_model', 'suggest'),
  ('money_movement', 'draft'),
  ('safeguarding', 'draft'),
  ('credential_change', 'draft'),
  ('public_publish', 'draft'),
  ('mass_message', 'draft'),
  ('external_authority_share', 'draft');

INSERT INTO public.wf_autonomy_agent_tier_cap (agent_tier, max_level) VALUES
  ('executive', 'act_with_approval'),
  ('department', 'act_and_report'),
  ('assurance', 'draft'),
  ('organization', 'act_and_report');

INSERT INTO public.wf_autonomy_bar (target_level, min_graded, min_pass_rate, max_age_days) VALUES
  ('draft', 20, 0.900, 30),
  ('act_with_approval', 50, 0.950, 30),
  ('act_and_report', 200, 0.980, 30);
-- END AIN02 SEED

-- The pass rate below which evidence is a regression (DEMOTE_BELOW_PASS_RATE of the ladder).
CREATE FUNCTION public.wf_autonomy_demote_floor()
RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$ SELECT 0.900::numeric $$;

-- -----------------------------------------------------------------------------
-- 4. Append-only history
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.wf_autonomy_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'ain02:% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END
$$;
CREATE TRIGGER wf_autonomy_evidence_00_append_only BEFORE UPDATE OR DELETE ON public.wf_autonomy_evidence
  FOR EACH ROW EXECUTE FUNCTION public.wf_autonomy_append_only();
CREATE TRIGGER wf_autonomy_evidence_01_no_truncate BEFORE TRUNCATE ON public.wf_autonomy_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION public.wf_autonomy_append_only();
CREATE TRIGGER wf_autonomy_change_00_append_only BEFORE UPDATE OR DELETE ON public.wf_autonomy_change
  FOR EACH ROW EXECUTE FUNCTION public.wf_autonomy_append_only();
CREATE TRIGGER wf_autonomy_change_01_no_truncate BEFORE TRUNCATE ON public.wf_autonomy_change
  FOR EACH STATEMENT EXECUTE FUNCTION public.wf_autonomy_append_only();

-- -----------------------------------------------------------------------------
-- 5. Ceilings and the one effective-level function
-- -----------------------------------------------------------------------------
-- The highest level this agent can ever hold: its registry tier's cap, and 'suggest' for a retired or unknown agent.
CREATE FUNCTION public.wf_autonomy_ceiling(p_agent text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce((SELECT CASE WHEN a.status <> 'active' THEN 'suggest' ELSE t.max_level END
                     FROM public.wf_agent a
                     JOIN public.wf_autonomy_agent_tier_cap t ON t.agent_tier = a.agent_tier
                    WHERE a.agent_ref = p_agent), 'suggest')
$$;

-- The one answer to "what may this step do": the lowest of the template, the organization ceiling, the level the agent
-- earned, the agent's own ceiling and the action class cap. An agentless step has no earned level and stays at suggest
-- (the rule since WF-03). A class that is not listed is capped at draft.
CREATE FUNCTION public.wf_effective_autonomy(p_org uuid, p_agent text, p_template_level text, p_action_class text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tenant text;
  v_earned text := 'suggest';
  v_ceiling text := 'suggest';
  v_class text;
BEGIN
  SELECT s.autonomy_ceiling INTO v_tenant FROM public.wf_org_settings s WHERE s.org_id = p_org;
  v_tenant := coalesce(v_tenant, 'draft');
  IF p_agent IS NOT NULL THEN
    SELECT a.earned_level INTO v_earned
      FROM public.wf_agent_autonomy a WHERE a.org_id = p_org AND a.agent_ref = p_agent;
    v_earned := coalesce(v_earned, 'suggest');
    v_ceiling := public.wf_autonomy_ceiling(p_agent);
  END IF;
  SELECT c.max_level INTO v_class FROM public.wf_autonomy_class_cap c WHERE c.action_class = p_action_class;
  v_class := coalesce(v_class, 'draft');
  RETURN public.wf_autonomy_level_of(least(
    public.wf_autonomy_rank(p_template_level), public.wf_autonomy_rank(v_tenant),
    public.wf_autonomy_rank(v_earned), public.wf_autonomy_rank(v_ceiling), public.wf_autonomy_rank(v_class)));
END
$$;

-- The step guard (WF-03, replaced by WF-06): the same run, template and agent resolution, now through the one
-- function. Two changes: it is SECURITY DEFINER so the service role needs no read access to the settings it consults,
-- and on UPDATE the level can only stay or go down. A step is classified when it is inserted; a later promotion does
-- not raise a step that already exists (a pause, a demotion or a lowered ceiling does lower it, at its next update).
CREATE OR REPLACE FUNCTION public.wf_autonomy_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_run public.wf_run%ROWTYPE;
  v_template_level text := 'suggest';
  v_agent_ref text;
  v_template_agent_ref text;
  v_level text;
BEGIN
  SELECT * INTO v_run FROM public.wf_run
   WHERE org_id = NEW.org_id AND id = NEW.run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wf_step_run: run scope is missing' USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.agent_ref IS DISTINCT FROM OLD.agent_ref THEN
    RAISE EXCEPTION 'wf_step_run: agent identity is immutable' USING ERRCODE = '42501';
  END IF;
  IF v_run.agent_ref IS NOT NULL AND NEW.agent_ref IS NOT NULL
     AND v_run.agent_ref IS DISTINCT FROM NEW.agent_ref THEN
    RAISE EXCEPTION 'wf_step_run: agent does not match run' USING ERRCODE = '42501';
  END IF;
  v_agent_ref := coalesce(v_run.agent_ref, NEW.agent_ref);

  IF v_run.template_id IS NOT NULL THEN
    SELECT t.autonomy_max, t.agent_ref INTO v_template_level, v_template_agent_ref
      FROM public.wf_template t WHERE t.id = v_run.template_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'wf_step_run: template is missing' USING ERRCODE = '23503';
    END IF;
    IF v_agent_ref IS NULL THEN v_agent_ref := v_template_agent_ref; END IF;
  END IF;

  v_level := public.wf_effective_autonomy(NEW.org_id, v_agent_ref, v_template_level, NEW.action_class);
  IF TG_OP = 'UPDATE' THEN
    v_level := public.wf_autonomy_level_of(least(
      public.wf_autonomy_rank(v_level), public.wf_autonomy_rank(OLD.autonomy_level)));
  END IF;
  NEW.autonomy_level := v_level;
  RETURN NEW;
END
$$;

-- -----------------------------------------------------------------------------
-- 6. The earned level changes only through the gate
-- -----------------------------------------------------------------------------
-- BEFORE INSERT OR UPDATE OR DELETE on wf_agent_autonomy, covering the upsert path (INSERT ... ON CONFLICT DO UPDATE
-- fires this trigger for the insert half too, so the current level is read from the table, not from OLD).
--   * a row is never deleted, and its key never changes;
--   * the level never exceeds the agent's ceiling (unknown and retired agents hold 'suggest' only);
--   * a rise needs a 'promote' ledger row written in this transaction for exactly this step up;
--   * a fall needs a 'demote' or 'auto_demote' ledger row written in this transaction for exactly this level.
CREATE FUNCTION public.wf_autonomy_write_gate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_current text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ain02:earned_level_rows_are_not_deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.agent_ref IS DISTINCT FROM OLD.agent_ref) THEN
    RAISE EXCEPTION 'ain02:earned_level_key_is_immutable' USING ERRCODE = '42501';
  END IF;
  IF public.wf_autonomy_rank(NEW.earned_level) > public.wf_autonomy_rank(public.wf_autonomy_ceiling(NEW.agent_ref)) THEN
    RAISE EXCEPTION 'ain02:above_agent_ceiling' USING ERRCODE = '42501';
  END IF;
  SELECT a.earned_level INTO v_current FROM public.wf_agent_autonomy a
   WHERE a.org_id = NEW.org_id AND a.agent_ref = NEW.agent_ref;
  v_current := coalesce(v_current, 'suggest');
  IF public.wf_autonomy_rank(NEW.earned_level) > public.wf_autonomy_rank(v_current) THEN
    IF NOT EXISTS (SELECT 1 FROM public.wf_autonomy_change c
                    WHERE c.org_id = NEW.org_id AND c.agent_ref = NEW.agent_ref AND c.kind = 'promote'
                      AND c.from_level = v_current AND c.to_level = NEW.earned_level
                      AND c.txid = txid_current()) THEN
      RAISE EXCEPTION 'ain02:promotion_needs_the_gate' USING ERRCODE = '42501';
    END IF;
  ELSIF public.wf_autonomy_rank(NEW.earned_level) < public.wf_autonomy_rank(v_current) THEN
    IF NOT EXISTS (SELECT 1 FROM public.wf_autonomy_change c
                    WHERE c.org_id = NEW.org_id AND c.agent_ref = NEW.agent_ref AND c.kind IN ('demote', 'auto_demote')
                      AND c.from_level = v_current AND c.to_level = NEW.earned_level
                      AND c.txid = txid_current()) THEN
      RAISE EXCEPTION 'ain02:demotion_needs_the_gate' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER wf_agent_autonomy_05_gate BEFORE INSERT OR UPDATE OR DELETE ON public.wf_agent_autonomy
  FOR EACH ROW EXECUTE FUNCTION public.wf_autonomy_write_gate();

-- -----------------------------------------------------------------------------
-- 7. The ledger guard: every promotion rule, restated where a bug in a function cannot skip it
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.wf_autonomy_change_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_current text;
  v_ev public.wf_autonomy_evidence%ROWTYPE;
  v_bar public.wf_autonomy_bar%ROWTYPE;
BEGIN
  SELECT a.earned_level INTO v_current FROM public.wf_agent_autonomy a
   WHERE a.org_id = NEW.org_id AND a.agent_ref = NEW.agent_ref;
  IF NEW.from_level IS DISTINCT FROM coalesce(v_current, 'suggest') THEN
    RAISE EXCEPTION 'ain02:from_level_is_not_the_current_level' USING ERRCODE = '23514';
  END IF;
  IF NEW.kind = 'demote' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_ev FROM public.wf_autonomy_evidence e WHERE e.id = NEW.evidence_id;
  IF NOT FOUND OR v_ev.agent_ref IS DISTINCT FROM NEW.agent_ref THEN
    RAISE EXCEPTION 'ain02:evidence_is_not_for_this_agent' USING ERRCODE = '23514';
  END IF;

  IF NEW.kind = 'auto_demote' THEN
    -- Only a regression lowers an agent without a person.
    IF NOT (v_ev.critical_failures > 0
            OR (CASE WHEN v_ev.graded = 0 THEN 0::numeric ELSE v_ev.passed::numeric / v_ev.graded END)
               < public.wf_autonomy_demote_floor()) THEN
      RAISE EXCEPTION 'ain02:evidence_is_not_a_regression' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- kind = 'promote'
  IF NOT EXISTS (SELECT 1 FROM public.super_admins s WHERE s.id = NEW.decided_by AND s.is_active = true) THEN
    RAISE EXCEPTION 'ain02:only_the_founder_promotes' USING ERRCODE = '42501';
  END IF;
  IF public.wf_autonomy_rank(NEW.to_level) > public.wf_autonomy_rank(public.wf_autonomy_ceiling(NEW.agent_ref)) THEN
    RAISE EXCEPTION 'ain02:above_agent_ceiling' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_bar FROM public.wf_autonomy_bar b WHERE b.target_level = NEW.to_level;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ain02:no_bar_for_level' USING ERRCODE = '23514';
  END IF;
  IF v_ev.evaluated_at > now() OR v_ev.evaluated_at < now() - make_interval(days => v_bar.max_age_days) THEN
    RAISE EXCEPTION 'ain02:evidence_stale_or_invalid' USING ERRCODE = '23514';
  END IF;
  IF v_ev.critical_failures > 0 THEN
    RAISE EXCEPTION 'ain02:evidence_has_critical_failures' USING ERRCODE = '23514';
  END IF;
  IF v_ev.graded < v_bar.min_graded OR v_ev.passed::numeric < v_bar.min_pass_rate * v_ev.graded THEN
    RAISE EXCEPTION 'ain02:evidence_below_bar' USING ERRCODE = '23514';
  END IF;
  -- Ungraded model cases mean nobody has yet seen how the agent behaves on them: nothing above 'draft'.
  IF v_ev.ungraded > 0 AND public.wf_autonomy_rank(NEW.to_level) > 1 THEN
    RAISE EXCEPTION 'ain02:ungraded_cases_block_this_level' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER wf_autonomy_change_10_guard BEFORE INSERT ON public.wf_autonomy_change
  FOR EACH ROW EXECUTE FUNCTION public.wf_autonomy_change_guard();

CREATE FUNCTION public.wf_autonomy_change_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM public.wf_audit_append(NEW.org_id, 'workflow.autonomy.' || NEW.kind, 'wf_autonomy_change',
    NEW.org_id::text || ':' || NEW.agent_ref, NULL,
    jsonb_build_object('change', NEW.id, 'from', NEW.from_level, 'to', NEW.to_level,
                       'evidence', NEW.evidence_id, 'decided_by', NEW.decided_by));
  RETURN NULL;
END
$$;
CREATE TRIGGER wf_autonomy_change_90_audit AFTER INSERT ON public.wf_autonomy_change
  FOR EACH ROW EXECUTE FUNCTION public.wf_autonomy_change_audit();

-- -----------------------------------------------------------------------------
-- 8. Writing one change (internal)
-- -----------------------------------------------------------------------------
-- The ledger row first (its guard checks the rules), then the level (the write gate finds the ledger row).
CREATE FUNCTION public.wf_autonomy_apply(
  p_org uuid, p_agent text, p_kind text, p_to text, p_evidence uuid, p_by uuid, p_reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_from text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ain02:' || p_org::text || ':' || p_agent, 7126));
  SELECT a.earned_level INTO v_from FROM public.wf_agent_autonomy a
   WHERE a.org_id = p_org AND a.agent_ref = p_agent;
  v_from := coalesce(v_from, 'suggest');
  INSERT INTO public.wf_autonomy_change (org_id, agent_ref, kind, from_level, to_level, evidence_id, decided_by, reason)
  VALUES (p_org, p_agent, p_kind, v_from, p_to, p_evidence, p_by, p_reason);
  INSERT INTO public.wf_agent_autonomy (org_id, agent_ref, earned_level)
  VALUES (p_org, p_agent, p_to)
  ON CONFLICT (org_id, agent_ref) DO UPDATE SET earned_level = EXCLUDED.earned_level, updated_at = now();
  RETURN v_from;
END
$$;

-- -----------------------------------------------------------------------------
-- 9. Evidence, promotion, demotion
-- -----------------------------------------------------------------------------
-- Recording evidence stores numbers. A regression (any critical failure, or a pass rate below the floor; no graded
-- case counts as a pass rate of zero, as in the ladder) lowers the agent by one rung in every organization where it
-- holds more than 'suggest', at once and without a person (the safe direction is automatic).
CREATE FUNCTION public.wf_autonomy_record_evidence(
  p_agent text, p_suite text, p_graded integer, p_passed integer, p_critical_failures integer,
  p_ungraded integer, p_evaluated_at timestamptz, p_content_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_new boolean := false;
  v_regression boolean;
  v_demoted integer := 0;
  r record;
BEGIN
  IF p_evaluated_at IS NULL OR p_evaluated_at > now() THEN
    RAISE EXCEPTION 'ain02:evaluated_at_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wf_agent a WHERE a.agent_ref = p_agent) THEN
    RAISE EXCEPTION 'ain02:agent_unknown' USING ERRCODE = '23503';
  END IF;
  INSERT INTO public.wf_autonomy_evidence (agent_ref, suite_id, graded, passed, critical_failures, ungraded,
                                           evaluated_at, content_sha256)
  VALUES (p_agent, p_suite, p_graded, p_passed, p_critical_failures, p_ungraded, p_evaluated_at, p_content_sha256)
  ON CONFLICT (agent_ref, content_sha256) DO NOTHING
  RETURNING id INTO v_id;
  v_new := v_id IS NOT NULL;
  IF NOT v_new THEN
    SELECT e.id INTO v_id FROM public.wf_autonomy_evidence e
     WHERE e.agent_ref = p_agent AND e.content_sha256 = p_content_sha256;
    RETURN jsonb_build_object('evidence_id', v_id, 'recorded', false, 'regression', false, 'demoted', 0);
  END IF;
  v_regression := p_critical_failures > 0
    OR (CASE WHEN p_graded = 0 THEN 0::numeric ELSE p_passed::numeric / p_graded END) < public.wf_autonomy_demote_floor();
  IF v_regression THEN
    FOR r IN SELECT a.org_id, a.earned_level FROM public.wf_agent_autonomy a
              WHERE a.agent_ref = p_agent AND public.wf_autonomy_rank(a.earned_level) > 0
              ORDER BY a.org_id LOOP
      PERFORM public.wf_autonomy_apply(r.org_id, p_agent, 'auto_demote',
        public.wf_autonomy_level_of(public.wf_autonomy_rank(r.earned_level) - 1), v_id, NULL,
        'Automatic: evaluation evidence shows a regression');
      v_demoted := v_demoted + 1;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('evidence_id', v_id, 'recorded', true, 'regression', v_regression, 'demoted', v_demoted);
END
$$;

-- Promotion: the founder only, one rung, on fresh evidence for this agent that nobody has used before. The ledger
-- guard (section 7) checks the same rules again where this function cannot skip them.
CREATE FUNCTION public.wf_autonomy_promote(
  p_actor uuid, p_org uuid, p_agent text, p_to_level text, p_evidence uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prev jsonb;
  v_state text;
  v_from text;
BEGIN
  v_prev := public.wf_act_as(p_actor);
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'ain02:only_the_founder_promotes' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wf_org_settings s WHERE s.org_id = p_org) THEN
    RAISE EXCEPTION 'ain02:organization_unknown' USING ERRCODE = '23503';
  END IF;
  v_state := public.wf_agent_state_code(p_org, p_agent);
  IF v_state <> 'ok' THEN
    RAISE EXCEPTION 'ain02:agent_not_usable_here:%', v_state USING ERRCODE = '42501';
  END IF;
  v_from := public.wf_autonomy_apply(p_org, p_agent, 'promote', p_to_level, p_evidence, p_actor, p_reason);
  PERFORM public.wf_act_restore(v_prev);
  RETURN jsonb_build_object('org_id', p_org, 'agent_ref', p_agent, 'from', v_from, 'to', p_to_level);
END
$$;

-- Demotion is the safe direction: the founder (any organization) or an administrator of the person's own
-- organization may lower a level, never raise it.
CREATE FUNCTION public.wf_autonomy_demote(
  p_actor uuid, p_org uuid, p_agent text, p_to_level text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prev jsonb;
  v_from text;
BEGIN
  v_prev := public.wf_act_as(p_actor);
  IF NOT public.is_super_admin() THEN
    IF public.get_my_organization_id() IS DISTINCT FROM p_org OR NOT public.wf_can(p_org, 'workflows.manage') THEN
      RAISE EXCEPTION 'ain02:not_authorized' USING ERRCODE = '42501';
    END IF;
  END IF;
  v_from := public.wf_autonomy_apply(p_org, p_agent, 'demote', p_to_level, NULL, p_actor, p_reason);
  PERFORM public.wf_act_restore(v_prev);
  RETURN jsonb_build_object('org_id', p_org, 'agent_ref', p_agent, 'from', v_from, 'to', p_to_level);
END
$$;

-- -----------------------------------------------------------------------------
-- 10. Per-step enforcement where the effect is recorded
-- -----------------------------------------------------------------------------
-- The dispatcher already turns the step's level into "draft" or "execute". This repeats the rule where the executed
-- record is written, so no code path (a bug, a replayed call, a hand-written insert) records an execution for a step
-- whose level does not allow one: the step must be at act_and_report, or a person must have approved a draft for this
-- very step and idempotency key. It also fires on UPDATE, so a stored record cannot be re-pointed at another step.
CREATE FUNCTION public.wf_action_sandbox_outbox_autonomy_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_level text;
BEGIN
  SELECT s.autonomy_level INTO v_level FROM public.wf_step_run s
   WHERE s.org_id = NEW.org_id AND s.id = NEW.step_run_id;
  IF v_level = 'act_and_report' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.wf_action_draft d
              WHERE d.org_id = NEW.org_id AND d.step_run_id = NEW.step_run_id
                AND d.idempotency_key = NEW.idempotency_key AND d.status = 'approved') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ain02:step_autonomy_does_not_allow_execution' USING ERRCODE = '42501';
END
$$;
CREATE TRIGGER wf_action_sandbox_outbox_90_autonomy BEFORE INSERT OR UPDATE ON public.wf_action_sandbox_outbox
  FOR EACH ROW EXECUTE FUNCTION public.wf_action_sandbox_outbox_autonomy_guard();

-- -----------------------------------------------------------------------------
-- 11. A run cannot borrow another agent's or template's level
-- -----------------------------------------------------------------------------
-- The step guard resolves the agent and the template from the run first. If the service role could re-point them, a
-- run could borrow a higher level (AIN-01 review note 3). Once set, neither changes; neither can be set once the
-- run has a step. INSERT ... ON CONFLICT DO UPDATE fires this trigger for its update half.
CREATE FUNCTION public.wf_run_freeze_actor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF (NEW.agent_ref IS DISTINCT FROM OLD.agent_ref OR NEW.template_id IS DISTINCT FROM OLD.template_id)
     AND ((NEW.agent_ref IS DISTINCT FROM OLD.agent_ref AND OLD.agent_ref IS NOT NULL)
          OR (NEW.template_id IS DISTINCT FROM OLD.template_id AND OLD.template_id IS NOT NULL)
          OR EXISTS (SELECT 1 FROM public.wf_step_run s WHERE s.org_id = OLD.org_id AND s.run_id = OLD.id)) THEN
    RAISE EXCEPTION 'ain02:run_actor_is_frozen' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER wf_run_08_freeze_actor BEFORE UPDATE OF agent_ref, template_id ON public.wf_run
  FOR EACH ROW EXECUTE FUNCTION public.wf_run_freeze_actor();

-- -----------------------------------------------------------------------------
-- 12. Row level security and privileges
-- -----------------------------------------------------------------------------
ALTER TABLE public.wf_autonomy_scale ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_autonomy_scale FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wf_autonomy_class_cap ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_autonomy_class_cap FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wf_autonomy_agent_tier_cap ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_autonomy_agent_tier_cap FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wf_autonomy_bar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_autonomy_bar FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wf_autonomy_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_autonomy_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wf_autonomy_change ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_autonomy_change FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.wf_autonomy_scale, public.wf_autonomy_class_cap, public.wf_autonomy_agent_tier_cap,
  public.wf_autonomy_bar, public.wf_autonomy_evidence, public.wf_autonomy_change
  FROM PUBLIC, anon, authenticated, service_role;
-- Nobody writes these tables at run time. Reference data changes through a reviewed migration; evidence and the ledger
-- are written only by the definer functions below.
GRANT SELECT ON public.wf_autonomy_scale, public.wf_autonomy_class_cap, public.wf_autonomy_agent_tier_cap,
  public.wf_autonomy_bar, public.wf_autonomy_evidence, public.wf_autonomy_change TO service_role;

CREATE POLICY wf_autonomy_scale_service_read ON public.wf_autonomy_scale FOR SELECT TO service_role USING (true);
CREATE POLICY wf_autonomy_class_cap_service_read ON public.wf_autonomy_class_cap FOR SELECT TO service_role USING (true);
CREATE POLICY wf_autonomy_agent_tier_cap_service_read ON public.wf_autonomy_agent_tier_cap
  FOR SELECT TO service_role USING (true);
CREATE POLICY wf_autonomy_bar_service_read ON public.wf_autonomy_bar FOR SELECT TO service_role USING (true);
CREATE POLICY wf_autonomy_evidence_service_read ON public.wf_autonomy_evidence FOR SELECT TO service_role USING (true);
CREATE POLICY wf_autonomy_change_service_read ON public.wf_autonomy_change FOR SELECT TO service_role USING (true);

-- The earned level: the service role keeps SELECT and loses every write. WF-03 granted it INSERT and UPDATE, which let a
-- bug in the runtime promote an agent. The write gate trigger is the second lock should a broad GRANT ever return it.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.wf_agent_autonomy
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
  public.wf_autonomy_rank(text), public.wf_autonomy_level_of(integer), public.wf_autonomy_demote_floor(),
  public.wf_autonomy_append_only(), public.wf_autonomy_ceiling(text),
  public.wf_effective_autonomy(uuid, text, text, text), public.wf_autonomy_write_gate(),
  public.wf_autonomy_change_guard(), public.wf_autonomy_change_audit(),
  public.wf_autonomy_apply(uuid, text, text, text, uuid, uuid, text),
  public.wf_autonomy_record_evidence(text, text, integer, integer, integer, integer, timestamptz, text),
  public.wf_autonomy_promote(uuid, uuid, text, text, uuid, text),
  public.wf_autonomy_demote(uuid, uuid, text, text, text),
  public.wf_action_sandbox_outbox_autonomy_guard(), public.wf_run_freeze_actor(), public.wf_autonomy_guard()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.wf_autonomy_record_evidence(text, text, integer, integer, integer, integer, timestamptz, text),
  public.wf_autonomy_promote(uuid, uuid, text, text, uuid, text),
  public.wf_autonomy_demote(uuid, uuid, text, text, text)
  TO service_role;

COMMENT ON TABLE public.wf_autonomy_scale IS
  'AIN-02 / ADR-126: the one autonomy scale of the engine, mapped to the ENGINE-01 ladder states.';
COMMENT ON TABLE public.wf_autonomy_class_cap IS
  'AIN-02 / ADR-126: highest autonomy level per engine action class. The six capped classes are draft by constraint. Engineering default for the founder to ratify.';
COMMENT ON TABLE public.wf_autonomy_agent_tier_cap IS
  'AIN-02 / ADR-126: highest autonomy level per registry agent tier. Engineering default for the founder to ratify.';
COMMENT ON TABLE public.wf_autonomy_bar IS
  'AIN-02 / ADR-126: evidence needed to climb into each level; restates the ENGINE-01 ladder bars.';
COMMENT ON TABLE public.wf_autonomy_evidence IS
  'AIN-02 / ADR-126: append-only evaluation numbers per agent (counts, suite id, result hash). No tenant data, no content.';
COMMENT ON TABLE public.wf_autonomy_change IS
  'AIN-02 / ADR-126: append-only ledger of every change of an earned autonomy level; written only by the gate functions.';
COMMENT ON FUNCTION public.wf_autonomy_promote(uuid, uuid, text, text, uuid, text) IS
  'AIN-02 / ADR-126: the only way to raise an earned level. Founder only, one rung, fresh single-use evidence. Founder decision 9.';
COMMENT ON FUNCTION public.wf_effective_autonomy(uuid, text, text, text) IS
  'AIN-02 / ADR-126: the one answer to what a step may do: lowest of template, organization ceiling, earned level, agent ceiling and class cap.';

COMMIT;
