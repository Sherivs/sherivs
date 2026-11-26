-- Rollback for CD-04: removes the trigger. Levels already lowered stay lowered (the ledger keeps the history).
BEGIN;
DROP TRIGGER IF EXISTS agent_pause_events_50_autonomy_drop ON public.agent_pause_events;
DROP FUNCTION IF EXISTS public.wf_pause_autonomy_drop();
COMMIT;
