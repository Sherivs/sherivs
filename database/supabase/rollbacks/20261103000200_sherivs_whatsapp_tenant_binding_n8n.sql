BEGIN;

DROP TRIGGER IF EXISTS cg_whatsapp_n8n_outbox_after_inbound
  ON public.cg_communication_message;
DROP FUNCTION IF EXISTS public.cg_whatsapp_enqueue_n8n_event();
DROP FUNCTION IF EXISTS public.cg_whatsapp_claim_n8n_outbox(integer);
DROP FUNCTION IF EXISTS public.cg_whatsapp_complete_n8n_outbox(uuid, uuid, boolean, text);
DROP FUNCTION IF EXISTS public.cg_whatsapp_prepare_n8n_reply(text, text, uuid, text);
DROP FUNCTION IF EXISTS public.cg_whatsapp_n8n_reply_result(text, text, text, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.cg_whatsapp_n8n_reply_result(text, text, text, uuid, text);
DROP FUNCTION IF EXISTS public.cg_whatsapp_prepare_send(text, text, text, text, text, uuid, text, text);
DROP FUNCTION IF EXISTS public.cg_whatsapp_prepare_auto_ack(text, text, text);
DROP FUNCTION IF EXISTS public.cg_whatsapp_auto_ack_result(text, text, text, text);
DROP TRIGGER IF EXISTS cg_whatsapp_send_audit_append_only ON public.cg_whatsapp_send_audit;
DROP FUNCTION IF EXISTS public.cg_whatsapp_send_audit_immutable();

ALTER TABLE public.cg_org_communication_sender
  DROP CONSTRAINT cg_org_communication_sender_channel_check,
  DROP CONSTRAINT cg_org_communication_sender_provider_check;
ALTER TABLE public.cg_org_communication_sender
  ADD CONSTRAINT cg_org_communication_sender_channel_check
    CHECK (channel IN ('sms', 'voice')),
  ADD CONSTRAINT cg_org_communication_sender_provider_check
    CHECK ((channel = 'sms' AND provider = 'twilio')
        OR (channel = 'voice' AND provider = 'africas_talking'));

DROP TABLE IF EXISTS public.cg_whatsapp_n8n_reply;
DROP TABLE IF EXISTS public.cg_whatsapp_send_audit;
DROP TABLE IF EXISTS public.cg_whatsapp_n8n_dead_letter;
DROP TABLE IF EXISTS public.cg_whatsapp_n8n_outbox;

ALTER TABLE public.cg_whatsapp_auto_ack
  DROP CONSTRAINT IF EXISTS cg_whatsapp_auto_ack_conversation_fk,
  DROP CONSTRAINT IF EXISTS cg_whatsapp_auto_ack_sender_ref_check,
  DROP CONSTRAINT cg_whatsapp_auto_ack_pkey,
  DROP COLUMN conversation_id,
  DROP COLUMN provider_sender_ref,
  ADD PRIMARY KEY (inbound_provider_ref);

CREATE FUNCTION public.cg_whatsapp_prepare_auto_ack(
  p_inbound_provider_ref text,
  p_body text
) RETURNS TABLE (
  tenant_id text,
  org_ref text,
  principal_ref text,
  recipient_address text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_message public.cg_communication_message%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed: WhatsApp auto-ack requires the shared server gateway' USING ERRCODE = '42501';
  END IF;
  IF p_inbound_provider_ref IS NULL OR length(p_inbound_provider_ref) NOT BETWEEN 1 AND 200
     OR p_body IS NULL OR length(p_body) NOT BETWEEN 1 AND 4096 THEN
    RAISE EXCEPTION 'invalid WhatsApp auto-ack request';
  END IF;
  SELECT m.* INTO v_message
    FROM public.cg_communication_message m
   WHERE m.provider_ref = p_inbound_provider_ref AND m.channel = 'whatsapp'
     AND m.direction = 'inbound'
     AND m.provider_created_at >= now() - interval '24 hours'
     AND m.provider_created_at <= now()
     AND m.principal_ref IS NOT NULL;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1
      FROM public.cg_communication_optin c
      JOIN public.cg_communication_recipient_address r
        ON r.tenant_id = c.tenant_id AND r.org_ref = c.org_ref
       AND r.channel = c.channel AND r.address = c.address
       AND r.principal_ref = v_message.principal_ref
      JOIN public.cg_org_membership m
        ON m.tenant_id = r.tenant_id AND m.org_unit_id = r.org_ref
       AND m.principal_ref = r.principal_ref AND m.state = 'active'
      JOIN public.cg_org_communication_sender s
        ON s.tenant_id = c.tenant_id AND s.org_ref = c.org_ref
       AND s.channel = 'whatsapp' AND s.provider = 'meta_cloud' AND s.status = 'active'
      JOIN public.cg_communication_conversation cv
        ON cv.tenant_id = c.tenant_id AND cv.org_ref = c.org_ref
       AND cv.channel = c.channel AND cv.address = c.address
     WHERE c.tenant_id = v_message.tenant_id AND c.org_ref = v_message.org_ref
       AND c.channel = 'whatsapp' AND cv.id = v_message.conversation_id
       AND c.status = 'opted_in'
  ) THEN
    RETURN;
  END IF;
  RETURN QUERY
    WITH eligible AS (
      SELECT v_message.tenant_id AS tenant_id, v_message.org_ref AS org_ref,
             v_message.principal_ref AS principal_ref,
             (SELECT cv.address FROM public.cg_communication_conversation cv
               WHERE cv.id = v_message.conversation_id) AS recipient_address
    ), claimed AS (
      INSERT INTO public.cg_whatsapp_auto_ack
        (inbound_provider_ref, tenant_id, org_ref, principal_ref, status)
      SELECT p_inbound_provider_ref, e.tenant_id, e.org_ref, e.principal_ref, 'queued'
        FROM eligible e
      ON CONFLICT (inbound_provider_ref) DO NOTHING
      RETURNING cg_whatsapp_auto_ack.tenant_id, cg_whatsapp_auto_ack.org_ref,
                cg_whatsapp_auto_ack.principal_ref
    )
    SELECT c.tenant_id, c.org_ref, c.principal_ref, e.recipient_address
      FROM claimed c CROSS JOIN eligible e;
END
$$;
REVOKE ALL ON FUNCTION public.cg_whatsapp_prepare_auto_ack(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_whatsapp_prepare_auto_ack(text, text) TO service_role;

CREATE FUNCTION public.cg_whatsapp_auto_ack_result(
  p_inbound_provider_ref text,
  p_status text,
  p_error_code text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed: WhatsApp auto-ack requires the shared server gateway' USING ERRCODE = '42501';
  END IF;
  IF p_inbound_provider_ref IS NULL OR length(p_inbound_provider_ref) NOT BETWEEN 1 AND 200
     OR p_status NOT IN ('sent', 'failed')
     OR (p_error_code IS NOT NULL AND p_error_code !~ '^[A-Za-z0-9_.-]{1,32}$') THEN
    RAISE EXCEPTION 'invalid WhatsApp auto-ack result';
  END IF;
  UPDATE public.cg_whatsapp_auto_ack
     SET status = p_status, error_code = p_error_code, updated_at = now()
   WHERE inbound_provider_ref = p_inbound_provider_ref AND status = 'queued';
  RETURN FOUND;
END
$$;
REVOKE ALL ON FUNCTION public.cg_whatsapp_auto_ack_result(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_whatsapp_auto_ack_result(text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.cg_whatsapp_prepare_send(
  p_tenant_id text,
  p_org_ref text,
  p_principal_ref text,
  p_body text,
  p_template_code text DEFAULT NULL
) RETURNS TABLE (message_id uuid, provider_sender_ref text, recipient_address text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_recipient text;
  v_conversation uuid;
  v_sender text;
  v_recipient_count integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed: WhatsApp sends require the shared server gateway' USING ERRCODE = '42501';
  END IF;
  IF p_tenant_id IS NULL OR length(p_tenant_id) NOT BETWEEN 1 AND 128
     OR p_org_ref IS NULL OR length(p_org_ref) NOT BETWEEN 1 AND 160
     OR p_principal_ref IS NULL OR length(p_principal_ref) NOT BETWEEN 1 AND 160
     OR p_body IS NULL OR length(p_body) > 4096
     OR (p_template_code IS NOT NULL AND p_template_code !~ '^[A-Za-z0-9_.-]{1,160}$')
     OR (p_template_code IS NULL AND length(p_body) = 0) THEN
    RAISE EXCEPTION 'invalid WhatsApp send request';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cg_org_unit o
    JOIN public.cg_org_membership m
      ON m.tenant_id = o.tenant_id AND m.org_unit_id = o.id
    WHERE o.tenant_id = p_tenant_id AND o.id = p_org_ref
      AND o.lifecycle_state = 'active' AND m.principal_ref = p_principal_ref AND m.state = 'active'
  ) THEN
    RAISE EXCEPTION 'recipient is not an active member of this tenant organization' USING ERRCODE = '42501';
  END IF;
  SELECT count(*)::integer INTO v_recipient_count
    FROM public.cg_communication_recipient_address r
    JOIN public.cg_org_membership m
      ON m.tenant_id = r.tenant_id AND m.org_unit_id = r.org_ref
     AND m.principal_ref = r.principal_ref AND m.state = 'active'
   WHERE r.tenant_id = p_tenant_id AND r.org_ref = p_org_ref
     AND r.principal_ref = p_principal_ref AND r.channel = 'whatsapp';
  IF v_recipient_count <> 1 THEN
    RAISE EXCEPTION 'no server-registered WhatsApp address for active recipient';
  END IF;
  SELECT r.address INTO v_recipient
    FROM public.cg_communication_recipient_address r
    JOIN public.cg_org_membership m
      ON m.tenant_id = r.tenant_id AND m.org_unit_id = r.org_ref
     AND m.principal_ref = r.principal_ref AND m.state = 'active'
   WHERE r.tenant_id = p_tenant_id AND r.org_ref = p_org_ref
     AND r.principal_ref = p_principal_ref AND r.channel = 'whatsapp';
  IF NOT EXISTS (
    SELECT 1 FROM public.cg_communication_optin c
     WHERE c.tenant_id = p_tenant_id AND c.org_ref = p_org_ref
       AND c.channel = 'whatsapp' AND c.address = v_recipient AND c.status = 'opted_in'
  ) THEN
    RAISE EXCEPTION 'WhatsApp recipient has not opted in' USING ERRCODE = '42501';
  END IF;
  SELECT s.provider_sender_ref INTO v_sender
    FROM public.cg_org_communication_sender s
    JOIN public.cg_org_unit o ON o.id = s.org_ref AND o.tenant_id = s.tenant_id
   WHERE s.tenant_id = p_tenant_id AND s.org_ref = p_org_ref
     AND s.channel = 'whatsapp' AND s.provider = 'meta_cloud' AND s.status = 'active'
     AND o.lifecycle_state = 'active';
  IF v_sender IS NULL THEN RAISE EXCEPTION 'no active WhatsApp sender is registered'; END IF;
  INSERT INTO public.cg_communication_conversation
    (tenant_id, org_ref, channel, address, principal_ref)
  VALUES (p_tenant_id, p_org_ref, 'whatsapp', v_recipient, p_principal_ref)
  ON CONFLICT (tenant_id, org_ref, channel, address) DO UPDATE
    SET updated_at = now()
  RETURNING id INTO v_conversation;
  INSERT INTO public.cg_communication_message
    (tenant_id, org_ref, conversation_id, channel, direction, status, principal_ref, template_code, body)
  VALUES (p_tenant_id, p_org_ref, v_conversation, 'whatsapp', 'outbound', 'queued',
          p_principal_ref, p_template_code, p_body)
  RETURNING id INTO message_id;
  provider_sender_ref := v_sender;
  recipient_address := v_recipient;
  RETURN NEXT;
END
$$;
REVOKE ALL ON FUNCTION public.cg_whatsapp_prepare_send(text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_whatsapp_prepare_send(text, text, text, text, text)
  TO service_role;

COMMIT;
