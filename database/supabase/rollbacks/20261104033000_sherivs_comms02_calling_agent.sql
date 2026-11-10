-- Rollback COMMS-02 calling-agent gate.
-- Does not remove COMMS-01 bindings, audit_chain rows, or voice_live.
-- Existing call sessions keep their history; only the line_role column is removed.

DROP TRIGGER IF EXISTS cg_org_voice_agent_calling_plan_guard ON public.cg_org_voice_agent;
DROP TRIGGER IF EXISTS comms_sender_numbers_calling_plan_guard ON public.comms_sender_numbers;
DROP TRIGGER IF EXISTS cg_voice_call_approvals_calling_plan_guard ON public.cg_voice_call_approvals;

DROP FUNCTION IF EXISTS public.comms02_require_calling_plan();
DROP FUNCTION IF EXISTS public.voice_agent_school_line_open(text);
DROP FUNCTION IF EXISTS public.voice_agent_caller_member(text, text);
DROP FUNCTION IF EXISTS public.voice_agent_member_facts(text, uuid);
DROP FUNCTION IF EXISTS public.voice_agent_call_log();
DROP FUNCTION IF EXISTS public.voice_agent_subscription_tier();
DROP FUNCTION IF EXISTS public.voice_agent_plan_entitled(text);

ALTER TABLE public.voice_call_sessions
  DROP CONSTRAINT IF EXISTS voice_call_sessions_line_role_check;

ALTER TABLE public.voice_call_sessions
  DROP COLUMN IF EXISTS line_role;
