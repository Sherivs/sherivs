-- Rollback for WF-07b. Runs already resumed stay resumed; approval steps still waiting return to the
-- pre-WF-07b behaviour (they wait for a person to act again).
DROP FUNCTION IF EXISTS public.wf_claim_approved_steps(text, integer, integer);
DROP FUNCTION IF EXISTS public.wf_approver_holds_role(uuid, uuid, text);
