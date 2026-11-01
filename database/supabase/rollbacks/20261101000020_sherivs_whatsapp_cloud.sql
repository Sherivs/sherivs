-- Roll back the tenant-neutral WhatsApp extension before applying the migration.
BEGIN;

DROP FUNCTION IF EXISTS public.cg_whatsapp_status(text, text, text, text);
DROP FUNCTION IF EXISTS public.cg_whatsapp_receive(text, text, text, text);
DROP FUNCTION IF EXISTS public.cg_whatsapp_dispatch_result(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.cg_whatsapp_prepare_send(text, text, text, text, text);
DROP TRIGGER IF EXISTS cg_communication_optin_audit ON public.cg_communication_optin;
DROP TRIGGER IF EXISTS cg_communication_message_audit ON public.cg_communication_message;
DROP TRIGGER IF EXISTS cg_communication_recipient_audit ON public.cg_communication_recipient_address;
DROP TRIGGER IF EXISTS cg_communication_sender_audit ON public.cg_org_communication_sender;
DROP TRIGGER IF EXISTS cg_communication_conversation_audit ON public.cg_communication_conversation;
DROP FUNCTION IF EXISTS public.cg_communication_audit();

DROP TABLE IF EXISTS public.cg_communication_optin;
DROP TABLE IF EXISTS public.cg_communication_message;
DROP TABLE IF EXISTS public.cg_communication_conversation;
DROP TABLE IF EXISTS public.cg_communication_recipient_address;

DROP INDEX IF EXISTS public.cg_org_communication_sender_meta_ref_active;
ALTER TABLE public.cg_org_communication_sender
  DROP CONSTRAINT IF EXISTS cg_org_communication_sender_provider_ref_check,
  DROP CONSTRAINT IF EXISTS cg_org_communication_sender_channel_check,
  DROP CONSTRAINT IF EXISTS cg_org_communication_sender_provider_check;
ALTER TABLE public.cg_org_communication_sender
  ADD CONSTRAINT cg_org_communication_sender_channel_check CHECK (channel = 'sms'),
  ADD CONSTRAINT cg_org_communication_sender_provider_check CHECK (provider = 'twilio');
ALTER TABLE public.cg_org_communication_sender
  DROP COLUMN IF EXISTS provider_sender_ref;
ALTER TABLE public.cg_org_communication_sender NO FORCE ROW LEVEL SECURITY;

COMMIT;
