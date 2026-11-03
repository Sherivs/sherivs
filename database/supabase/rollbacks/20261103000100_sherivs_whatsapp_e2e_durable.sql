-- Roll back 20261103000100 and restore the prior inbound receiver.
BEGIN;

DROP FUNCTION IF EXISTS public.cg_whatsapp_health();
DROP FUNCTION IF EXISTS public.cg_whatsapp_review_recipient_link(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.cg_whatsapp_list_recipient_link_requests(text);
DROP FUNCTION IF EXISTS public.cg_whatsapp_request_recipient_link_internal(text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.cg_whatsapp_request_recipient_link(text, text, text, text, text);
DROP FUNCTION IF EXISTS public.cg_whatsapp_record_recipient_link_request(text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.cg_whatsapp_auto_ack_result(text, text, text);
DROP FUNCTION IF EXISTS public.cg_whatsapp_prepare_auto_ack(text, text);
DROP FUNCTION IF EXISTS public.cg_whatsapp_dead_letter(text, text, text, text);
DROP FUNCTION IF EXISTS public.cg_whatsapp_receive(text, text, text, text, timestamptz);
DROP TRIGGER IF EXISTS cg_whatsapp_auto_ack_audit ON public.cg_whatsapp_auto_ack;
DROP TRIGGER IF EXISTS cg_whatsapp_recipient_link_request_audit ON public.cg_whatsapp_recipient_link_request;

CREATE OR REPLACE FUNCTION public.cg_whatsapp_status(
  p_provider_sender_ref text,
  p_provider_ref text,
  p_status text,
  p_error_code text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_sender public.cg_org_communication_sender%ROWTYPE;
  v_current text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed: WhatsApp statuses require a verified provider webhook' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('sent', 'delivered', 'read', 'failed')
     OR p_provider_ref IS NULL OR length(p_provider_ref) NOT BETWEEN 1 AND 200
     OR (p_error_code IS NOT NULL AND p_error_code !~ '^[A-Za-z0-9_.-]{1,32}$') THEN
    RAISE EXCEPTION 'invalid WhatsApp delivery status';
  END IF;
  SELECT s.* INTO v_sender
    FROM public.cg_org_communication_sender s
    JOIN public.cg_org_unit o ON o.id = s.org_ref AND o.tenant_id = s.tenant_id
   WHERE s.provider_sender_ref = p_provider_sender_ref
     AND s.channel = 'whatsapp' AND s.provider = 'meta_cloud' AND s.status = 'active'
     AND o.lifecycle_state = 'active';
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT m.status INTO v_current FROM public.cg_communication_message m
   WHERE m.tenant_id = v_sender.tenant_id AND m.org_ref = v_sender.org_ref
     AND m.channel = 'whatsapp' AND m.direction = 'outbound' AND m.provider_ref = p_provider_ref
   FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT (
    v_current = 'queued'
    OR (v_current = 'sent' AND p_status IN ('delivered', 'read', 'failed'))
    OR (v_current = 'delivered' AND p_status IN ('read', 'failed'))
  ) THEN RETURN true; END IF;
  UPDATE public.cg_communication_message
     SET status = p_status,
         error_code = CASE WHEN p_status = 'failed' THEN p_error_code ELSE error_code END,
         updated_at = now()
   WHERE tenant_id = v_sender.tenant_id AND org_ref = v_sender.org_ref
     AND channel = 'whatsapp' AND direction = 'outbound' AND provider_ref = p_provider_ref;
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION public.cg_whatsapp_status(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_whatsapp_status(text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.cg_whatsapp_receive(
  p_provider_sender_ref text,
  p_from text,
  p_body text,
  p_provider_ref text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_sender public.cg_org_communication_sender%ROWTYPE;
  v_count integer;
  v_principal text;
  v_conversation uuid;
  v_action text := 'logged';
  v_keyword text := upper(trim(coalesce(p_body, '')));
  v_message uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed: WhatsApp callbacks require a verified provider webhook' USING ERRCODE = '42501';
  END IF;
  IF p_provider_sender_ref IS NULL OR length(p_provider_sender_ref) NOT BETWEEN 1 AND 160
     OR p_provider_ref IS NULL OR length(p_provider_ref) NOT BETWEEN 1 AND 200
     OR p_from IS NULL OR p_from !~ '^\+[1-9][0-9]{7,14}$'
     OR p_body IS NULL OR length(p_body) > 4096 THEN
    RAISE EXCEPTION 'invalid WhatsApp inbound message';
  END IF;
  SELECT count(*)::integer INTO v_count
    FROM public.cg_org_communication_sender s
    JOIN public.cg_org_unit o ON o.id = s.org_ref AND o.tenant_id = s.tenant_id
   WHERE s.provider_sender_ref = p_provider_sender_ref
     AND s.channel = 'whatsapp' AND s.provider = 'meta_cloud' AND s.status = 'active'
     AND o.lifecycle_state = 'active';
  IF v_count <> 1 THEN RETURN 'unmapped_sender'; END IF;
  SELECT s.* INTO v_sender
    FROM public.cg_org_communication_sender s
    JOIN public.cg_org_unit o ON o.id = s.org_ref AND o.tenant_id = s.tenant_id
   WHERE s.provider_sender_ref = p_provider_sender_ref
     AND s.channel = 'whatsapp' AND s.provider = 'meta_cloud' AND s.status = 'active'
     AND o.lifecycle_state = 'active';
  IF EXISTS (
    SELECT 1 FROM public.cg_communication_message m
     WHERE m.tenant_id = v_sender.tenant_id AND m.provider_ref = p_provider_ref
  ) THEN RETURN 'duplicate'; END IF;
  SELECT r.principal_ref INTO v_principal
    FROM public.cg_communication_recipient_address r
    JOIN public.cg_org_membership m
      ON m.tenant_id = r.tenant_id AND m.org_unit_id = r.org_ref
     AND m.principal_ref = r.principal_ref AND m.state = 'active'
   WHERE r.tenant_id = v_sender.tenant_id AND r.org_ref = v_sender.org_ref
     AND r.channel = 'whatsapp' AND r.address = p_from
   LIMIT 1;
  INSERT INTO public.cg_communication_conversation
    (tenant_id, org_ref, channel, address, principal_ref)
  VALUES (v_sender.tenant_id, v_sender.org_ref, 'whatsapp', p_from, v_principal)
  ON CONFLICT (tenant_id, org_ref, channel, address) DO UPDATE
    SET updated_at = now()
  RETURNING id INTO v_conversation;
  INSERT INTO public.cg_communication_message
    (tenant_id, org_ref, conversation_id, channel, direction, status, principal_ref, provider_ref, body)
  VALUES (v_sender.tenant_id, v_sender.org_ref, v_conversation, 'whatsapp', 'inbound',
          'received', v_principal, p_provider_ref, left(p_body, 4096))
  ON CONFLICT (tenant_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING
  RETURNING id INTO v_message;
  IF v_message IS NULL THEN RETURN 'duplicate'; END IF;
  IF v_keyword IN ('STOP', 'UNSUBSCRIBE', 'END', 'DAINA', 'DURO', 'KWUSI') THEN
    v_action := 'opted_out';
  ELSIF v_keyword IN ('START', 'YES', 'JOIN') THEN
    v_action := 'opted_in';
  END IF;
  IF v_action <> 'logged' THEN
    INSERT INTO public.cg_communication_optin
      (tenant_id, org_ref, channel, address, status, source)
    VALUES (v_sender.tenant_id, v_sender.org_ref, 'whatsapp', p_from,
            CASE WHEN v_action = 'opted_out' THEN 'opted_out' ELSE 'opted_in' END,
            'whatsapp_reply')
    ON CONFLICT (tenant_id, org_ref, channel, address) DO UPDATE
      SET status = EXCLUDED.status, source = EXCLUDED.source, updated_at = now();
  END IF;
  RETURN v_action;
END
$$;
REVOKE ALL ON FUNCTION public.cg_whatsapp_receive(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_whatsapp_receive(text, text, text, text) TO service_role;

DROP TABLE IF EXISTS public.cg_whatsapp_recipient_link_request;
DROP TABLE IF EXISTS public.cg_whatsapp_auto_ack;
DROP TABLE IF EXISTS public.cg_whatsapp_dead_letter;
DROP TABLE IF EXISTS public.cg_whatsapp_inbound_rate_limit;
DROP TABLE IF EXISTS public.cg_whatsapp_inbound_event;
ALTER TABLE public.cg_communication_message
  DROP COLUMN IF EXISTS provider_created_at,
  DROP COLUMN IF EXISTS provider_status_at;

COMMIT;
