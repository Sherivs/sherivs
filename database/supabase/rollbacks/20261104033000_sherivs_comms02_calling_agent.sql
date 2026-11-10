-- Rollback COMMS-02 calling-agent gate.
-- Does not remove COMMS-01 bindings, audit_chain rows, or voice_live.
-- PIN hashes are removed with their table. audit_chain entries stay.

DROP TRIGGER IF EXISTS cg_org_voice_agent_calling_plan_guard ON public.cg_org_voice_agent;
DROP TRIGGER IF EXISTS comms_sender_numbers_calling_plan_guard ON public.comms_sender_numbers;
DROP TRIGGER IF EXISTS cg_voice_call_approvals_calling_plan_guard ON public.cg_voice_call_approvals;

DROP FUNCTION IF EXISTS public.comms02_require_calling_plan();
DROP FUNCTION IF EXISTS public.voice_agent_school_line_open(text);
DROP FUNCTION IF EXISTS public.voice_agent_caller_member(text, text);
DROP FUNCTION IF EXISTS public.voice_agent_member_facts(text, uuid, uuid);
DROP FUNCTION IF EXISTS public.voice_agent_member_facts(text, uuid);
DROP FUNCTION IF EXISTS public.voice_agent_call_log();
DROP FUNCTION IF EXISTS public.voice_agent_subscription_tier();
DROP FUNCTION IF EXISTS public.voice_agent_plan_entitled(text);
DROP FUNCTION IF EXISTS public.voice_agent_set_own_pin(text);
DROP FUNCTION IF EXISTS public.voice_agent_verify_pin(text, uuid, text, text);
DROP FUNCTION IF EXISTS public.voice_agent_verify_pin(text, uuid, text);
DROP FUNCTION IF EXISTS public.voice_agent_pin_acceptable(text);
DROP FUNCTION IF EXISTS public.voice_agent_pin_audit(uuid, text, uuid, text);

DROP TABLE IF EXISTS public.cg_voice_pin_attempt;
DROP TABLE IF EXISTS public.cg_voice_member_pin;

UPDATE public.voice_call_sessions
  SET state = 'failed'
  WHERE state = 'pin_pending';

ALTER TABLE public.voice_call_sessions DROP CONSTRAINT IF EXISTS voice_call_sessions_state_check;
ALTER TABLE public.voice_call_sessions
  ADD CONSTRAINT voice_call_sessions_state_check
  CHECK (state IN ('consent_pending', 'active', 'completed', 'escalated', 'declined', 'failed'));

ALTER TABLE public.voice_call_sessions
  DROP CONSTRAINT IF EXISTS voice_call_sessions_line_role_check;

ALTER TABLE public.voice_call_sessions
  DROP COLUMN IF EXISTS pin_attempts,
  DROP COLUMN IF EXISTS pin_member_id,
  DROP COLUMN IF EXISTS pin_verified_at,
  DROP COLUMN IF EXISTS line_role;
