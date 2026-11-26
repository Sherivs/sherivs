-- Rollback for CD-01. Safe at any time: it only removes the guard, never data.
BEGIN;
DROP TRIGGER IF EXISTS wf_action_draft_55_ceiling ON public.wf_action_draft;
DROP FUNCTION IF EXISTS public.wf_action_draft_ceiling_guard();
COMMIT;
