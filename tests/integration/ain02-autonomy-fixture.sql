-- AIN-02 fixture helper, included with \ir by the harnesses that need an agent to hold an earned level.
-- Since AIN-02 the earned level (wf_agent_autonomy) changes only through the promotion gate, whose rules (founder,
-- fresh evidence, one rung) are not what those harnesses test. This helper writes a level the way a migration or a
-- database owner would: it switches the write-gate trigger off for the one statement and back on, inside the harness
-- transaction (which is rolled back). It needs the table owner or a superuser, so it is called before any SET ROLE.
-- Nothing here runs against a hosted database.
CREATE FUNCTION pg_temp.ain02_set_level(p_org uuid, p_agent text, p_level text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  ALTER TABLE public.wf_agent_autonomy DISABLE TRIGGER wf_agent_autonomy_05_gate;
  INSERT INTO public.wf_agent_autonomy (org_id, agent_ref, earned_level) VALUES (p_org, p_agent, p_level)
  ON CONFLICT (org_id, agent_ref) DO UPDATE SET earned_level = EXCLUDED.earned_level;
  ALTER TABLE public.wf_agent_autonomy ENABLE TRIGGER wf_agent_autonomy_05_gate;
END $$;

-- Since AIN-02 an executed record (wf_action_sandbox_outbox) needs a step at act_and_report or an approved draft. Some
-- harnesses write executed records for steps they built at a lower level because they test something else (a run guard,
-- a quota, a retry). This marks such a step as one that may execute, the way a database owner would: the step guard
-- trigger is switched off for the one statement. Called before any SET ROLE; nothing here runs against a hosted database.
CREATE FUNCTION pg_temp.ain02_allow_execution(p_step uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- These harnesses test quotas, approvals and history, not the step level. The outbox backstop is switched off for
  -- the rest of the (rolled-back) harness; ain02-autonomy-gate.local.sql tests it with it switched on.
  ALTER TABLE public.wf_action_sandbox_outbox DISABLE TRIGGER wf_action_sandbox_outbox_90_autonomy;
  ALTER TABLE public.wf_step_run DISABLE TRIGGER wf_step_run_05_autonomy;
  UPDATE public.wf_step_run SET autonomy_level = 'act_and_report' WHERE id = p_step;
  ALTER TABLE public.wf_step_run ENABLE TRIGGER wf_step_run_05_autonomy;
END $$;
