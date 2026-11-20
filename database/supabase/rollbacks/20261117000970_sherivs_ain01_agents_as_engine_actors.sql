-- NOT APPLIED. Rollback for 20261117000970 (AIN-01 agents as engine actors, ADR-125).
-- Removes the step guard, the registry functions, the four registry tables and the daily-count index. It
-- refuses to run when a platform grant exists (a grant is a recorded decision; revoke it deliberately first)
-- (it does not check steps: nothing is deleted or rewritten in wf_step_run, and the agent_ref values stay as plain
-- text, as they were before AIN-01).
-- audit_chain entries AIN-01 wrote stay (the chain is append-only). wf_agent_autonomy is not touched.
BEGIN;

DO $prereq$
BEGIN
  IF to_regclass('public.wf_agent') IS NULL
     OR to_regclass('public.wf_agent_capability') IS NULL
     OR to_regclass('public.wf_agent_tier_action_class') IS NULL
     OR to_regclass('public.wf_agent_platform_grant') IS NULL
     OR to_regprocedure('public.wf_agent_registry_get(uuid)') IS NULL THEN
    RAISE EXCEPTION 'AIN-01 rollback: one or more AIN-01 objects are missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wf_agent_platform_grant) THEN
    RAISE EXCEPTION 'AIN-01 rollback: platform grants exist; revoke them deliberately first';
  END IF;
END
$prereq$;

DROP TRIGGER wf_step_run_07_agent ON public.wf_step_run;
DROP TRIGGER wf_step_run_07_agent_immutable ON public.wf_step_run;
DROP FUNCTION public.wf_agent_step_immutable();
DROP FUNCTION public.wf_agent_step_guard();
DROP FUNCTION public.wf_agent_registry_get(uuid);
DROP FUNCTION public.wf_agent_class_allowed(text, text);
DROP FUNCTION public.wf_agent_state_code(uuid, text);
DROP FUNCTION public.wf_ai_route_approved();
DROP INDEX public.wf_step_run_agent_recent_idx;
DROP TABLE public.wf_agent_platform_grant;
DROP FUNCTION public.wf_agent_platform_grant_audit();
DROP FUNCTION public.wf_agent_platform_grant_guard();
DROP TABLE public.wf_agent_tier_action_class;
DROP TABLE public.wf_agent_capability;
DROP FUNCTION public.wf_agent_capability_guard();
DROP TABLE public.wf_agent;

COMMIT;
