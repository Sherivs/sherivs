-- Rollback SHERIVS-107. Export voice-session rows before running.
-- Transcript/call-event entries in inbound_messages and audit-chain rows remain.
BEGIN;
DROP TABLE IF EXISTS public.voice_call_sessions;
COMMIT;
