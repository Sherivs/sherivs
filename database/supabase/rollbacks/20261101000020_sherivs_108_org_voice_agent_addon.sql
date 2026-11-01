-- Rollback SHERIVS-108. Export tenant voice settings and call approvals first.
-- audit_chain entries are retained as immutable evidence.
BEGIN;

DROP TRIGGER IF EXISTS cg_org_voice_sender_insert_audit ON public.cg_org_communication_sender;
DROP TRIGGER IF EXISTS cg_org_voice_sender_update_audit ON public.cg_org_communication_sender;
DROP TRIGGER IF EXISTS cg_voice_call_approvals_audit ON public.cg_voice_call_approvals;
DROP TRIGGER IF EXISTS cg_org_voice_agent_audit ON public.cg_org_voice_agent;

DROP FUNCTION IF EXISTS public.voice_agent_finish_call(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.voice_agent_claim_call(uuid, text);
DROP FUNCTION IF EXISTS public.voice_agent_claim_call(uuid);
DROP FUNCTION IF EXISTS public.voice_agent_approved_call_target(uuid, text);
DROP FUNCTION IF EXISTS public.voice_agent_decide_call(uuid, boolean);
DROP FUNCTION IF EXISTS public.voice_agent_pending_calls();
DROP FUNCTION IF EXISTS public.voice_agent_request_call(text, text, text, text, text);
DROP FUNCTION IF EXISTS public.voice_agent_request_call(text, text, text);
DROP FUNCTION IF EXISTS public.voice_agent_configure(boolean, text, text, text);
DROP FUNCTION IF EXISTS public.voice_agent_settings();
DROP FUNCTION IF EXISTS public.cg_voice_agent_audit();

DROP TABLE IF EXISTS public.cg_voice_call_approvals;
DROP TABLE IF EXISTS public.cg_org_voice_agent;

DELETE FROM public.cg_org_communication_sender WHERE channel = 'voice';
ALTER TABLE public.voice_call_sessions DROP COLUMN IF EXISTS tenant_ref;
ALTER TABLE public.cg_org_communication_sender
  DROP CONSTRAINT IF EXISTS cg_org_communication_sender_channel_check,
  DROP CONSTRAINT IF EXISTS cg_org_communication_sender_provider_check,
  DROP COLUMN IF EXISTS extension;
ALTER TABLE public.cg_org_communication_sender
  ADD CONSTRAINT cg_org_communication_sender_channel_check CHECK (channel = 'sms'),
  ADD CONSTRAINT cg_org_communication_sender_provider_check CHECK (provider = 'twilio');

COMMIT;
