-- Rollback SV1-JARVIS-02 approval inbox. Drops the inbox tables and their data.
BEGIN;
DROP TABLE IF EXISTS public.jarvis_approval_events;
DROP TABLE IF EXISTS public.jarvis_approval_requests;
DROP FUNCTION IF EXISTS public.jarvis_approval_transition_guard();
DROP FUNCTION IF EXISTS public.jarvis_approval_append_only_guard();
COMMIT;
