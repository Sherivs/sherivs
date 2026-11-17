-- Rollback for ENGINE-16 (20261115000800). Removes the pause state and its history.
-- Pause history is audit evidence: export agent_pause_events before running this.
-- The append-only trigger blocks DELETE, so drop the table (which drops the trigger) rather than deleting rows.
DROP FUNCTION IF EXISTS public.change_agent_pause(text, text, text);
DROP FUNCTION IF EXISTS public.is_agent_paused(text);
DROP TABLE IF EXISTS public.agent_pause_events;
DROP FUNCTION IF EXISTS public.agent_pause_events_immutable();
DROP TABLE IF EXISTS public.agent_pause_rules;
