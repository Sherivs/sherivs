-- SHERIVS-107 — Africa's Talking voice support line (V1, team COMMS).
-- Status: AUTHORED, NOT APPLIED. Production application requires operator approval.
-- Rollback: database/supabase/rollbacks/20261031000010_sherivs_107_voice_ai_support_line.sql
-- Uses the existing public.voice_live feature flag (SHERIVS-018); this migration
-- does not alter provider flags or enable live voice.
BEGIN;

CREATE TABLE IF NOT EXISTS public.voice_call_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider = 'africas_talking'),
  provider_session_id text NOT NULL UNIQUE CHECK (length(provider_session_id) BETWEEN 1 AND 160),
  caller_number text NOT NULL CHECK (caller_number ~ '^\+?[0-9]{7,20}$'),
  destination_number text NOT NULL CHECK (destination_number ~ '^\+?[0-9]{7,20}$'),
  state text NOT NULL CHECK (state IN ('consent_pending', 'active', 'completed', 'escalated', 'declined', 'failed')),
  recording_consent_at timestamptz,
  turn_count integer NOT NULL DEFAULT 0 CHECK (turn_count BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE INDEX IF NOT EXISTS voice_call_sessions_tenant_time
  ON public.voice_call_sessions (tenant_id, created_at DESC);

ALTER TABLE public.voice_call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_call_sessions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_call_sessions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.voice_call_sessions TO service_role;

COMMENT ON TABLE public.voice_call_sessions IS
  'Tenant-scoped Africa''s Talking support call state. Server-only; call events and transcripts use the existing SHERIVS-020 inbound message log.';

COMMIT;
