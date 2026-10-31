-- Rollback for 20261101000010_sherivs_whatsapp_cloud.sql (NOT APPLIED).
BEGIN;

DROP TRIGGER IF EXISTS trg_inbound_messages_whatsapp_audit ON public.inbound_messages;
DROP TRIGGER IF EXISTS trg_outbound_messages_whatsapp_audit ON public.outbound_messages;
DROP TRIGGER IF EXISTS trg_inbound_whatsapp_conversation ON public.inbound_messages;
DROP TRIGGER IF EXISTS trg_outbound_whatsapp_conversation ON public.outbound_messages;

DROP FUNCTION IF EXISTS public.comms_whatsapp_status(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.comms_whatsapp_sender_school(text);
DROP FUNCTION IF EXISTS public.comms_whatsapp_map_message();
DROP FUNCTION IF EXISTS public.comms_whatsapp_audit();

ALTER TABLE public.inbound_messages
  DROP CONSTRAINT IF EXISTS inbound_messages_conversation_org_fk,
  DROP COLUMN IF EXISTS user_id,
  DROP COLUMN IF EXISTS conversation_id;
ALTER TABLE public.outbound_messages
  DROP CONSTRAINT IF EXISTS outbound_messages_conversation_org_fk,
  DROP COLUMN IF EXISTS user_id,
  DROP COLUMN IF EXISTS conversation_id,
  DROP CONSTRAINT IF EXISTS outbound_messages_status_check;
ALTER TABLE public.outbound_messages
  ADD CONSTRAINT outbound_messages_status_check
  CHECK (status IN ('queued','sent_stub','sent','delivered','failed','blocked_optout','blocked_wallet','blocked_cap'));

DROP TABLE IF EXISTS public.comms_conversations;

COMMIT;
