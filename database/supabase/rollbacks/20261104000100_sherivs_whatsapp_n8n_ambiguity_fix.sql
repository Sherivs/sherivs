-- Rollback: restore pre-fix definitions (as captured from prod 2026-11-04).

CREATE OR REPLACE FUNCTION public.cg_whatsapp_claim_n8n_outbox(p_limit integer DEFAULT 20)
 RETURNS TABLE(outbox_id uuid, tenant_id text, org_ref text, conversation_id uuid, message_id uuid, provider_ref text, payload jsonb, attempt_count integer, claim_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed: WhatsApp outbox dispatch requires service role' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invalid WhatsApp outbox batch size';
  END IF;
  WITH exhausted AS (
    UPDATE public.cg_whatsapp_n8n_outbox
       SET status = 'dead', claim_token = NULL, lease_until = NULL,
           last_error_code = 'retry_exhausted', updated_at = now()
     WHERE status = 'processing' AND lease_until <= now() AND attempt_count >= 8
     RETURNING id, tenant_id, org_ref, message_id, attempt_count, last_error_code
  )
  INSERT INTO public.cg_whatsapp_n8n_dead_letter
    (tenant_id, org_ref, outbox_id, message_id, attempt_count, error_code)
  SELECT e.tenant_id, e.org_ref, e.id, e.message_id, e.attempt_count, e.last_error_code
    FROM exhausted e
  ON CONFLICT (tenant_id, outbox_id) DO NOTHING;
  RETURN QUERY
    WITH due AS (
      SELECT o.id
        FROM public.cg_whatsapp_n8n_outbox o
       WHERE o.attempt_count < 8 AND (
         (o.status = 'pending' AND o.next_attempt_at <= now())
         OR (o.status = 'processing' AND o.lease_until <= now())
       )
       ORDER BY o.next_attempt_at, o.created_at
       FOR UPDATE SKIP LOCKED
       LIMIT p_limit
    ), claimed AS (
      UPDATE public.cg_whatsapp_n8n_outbox o
         SET status = 'processing', attempt_count = o.attempt_count + 1,
             claim_token = gen_random_uuid(), lease_until = now() + interval '2 minutes',
             updated_at = now()
        FROM due
       WHERE o.id = due.id
       RETURNING o.id, o.tenant_id, o.org_ref, o.conversation_id, o.message_id,
                 o.provider_ref, o.payload, o.attempt_count, o.claim_token
    )
    SELECT c.id, c.tenant_id, c.org_ref, c.conversation_id, c.message_id,
           c.provider_ref, c.payload, c.attempt_count, c.claim_token
      FROM claimed c;
END
$function$;

CREATE OR REPLACE FUNCTION public.cg_whatsapp_prepare_n8n_reply(p_reply_id text, p_inbound_provider_ref text, p_conversation_id uuid, p_body text)
 RETURNS TABLE(tenant_id text, org_ref text, principal_ref text, provider_sender_ref text, conversation_id uuid, recipient_address text, claim_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_message public.cg_communication_message%ROWTYPE;
  v_address text;
  v_sender_ref text;
  v_claim_token uuid := gen_random_uuid();
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed: WhatsApp replies require a signed server request' USING ERRCODE = '42501';
  END IF;
  IF p_reply_id IS NULL OR length(p_reply_id) NOT BETWEEN 1 AND 160
     OR p_inbound_provider_ref IS NULL OR length(p_inbound_provider_ref) NOT BETWEEN 1 AND 200
     OR p_conversation_id IS NULL OR p_body IS NULL OR length(p_body) NOT BETWEEN 1 AND 4096 THEN
    RAISE EXCEPTION 'invalid WhatsApp reply request';
  END IF;
  SELECT m.* INTO v_message
    FROM public.cg_communication_message m
    JOIN public.cg_communication_conversation cv
      ON cv.id = m.conversation_id AND cv.tenant_id = m.tenant_id AND cv.org_ref = m.org_ref
   WHERE m.provider_ref = p_inbound_provider_ref AND m.conversation_id = p_conversation_id
     AND m.channel = 'whatsapp' AND m.direction = 'inbound'
     AND m.principal_ref IS NOT NULL AND cv.principal_ref = m.principal_ref
     AND m.provider_created_at >= now() - interval '24 hours'
     AND m.provider_created_at <= now();
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.cg_whatsapp_inbound_event e
     WHERE e.tenant_id = v_message.tenant_id AND e.org_ref = v_message.org_ref
       AND e.provider_ref = p_inbound_provider_ref AND e.status = 'received'
  ) THEN
    RAISE EXCEPTION 'WhatsApp inbound conversation is unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT cv.address, s.provider_sender_ref INTO v_address, v_sender_ref
    FROM public.cg_communication_conversation cv
    JOIN public.cg_communication_recipient_address r
      ON r.tenant_id = cv.tenant_id AND r.org_ref = cv.org_ref
     AND r.channel = cv.channel AND r.address = cv.address
     AND r.principal_ref = v_message.principal_ref
    JOIN public.cg_communication_optin c
      ON c.tenant_id = r.tenant_id AND c.org_ref = r.org_ref
     AND c.channel = r.channel AND c.address = r.address AND c.status = 'opted_in'
    JOIN public.cg_org_membership m
      ON m.tenant_id = r.tenant_id AND m.org_unit_id = r.org_ref
     AND m.principal_ref = r.principal_ref AND m.state = 'active'
    JOIN public.cg_org_communication_sender s
      ON s.tenant_id = cv.tenant_id AND s.org_ref = cv.org_ref
     AND s.channel = 'whatsapp' AND s.provider = 'meta_cloud' AND s.status = 'active'
    JOIN public.cg_whatsapp_inbound_event e
      ON e.tenant_id = cv.tenant_id AND e.org_ref = cv.org_ref
     AND e.provider_ref = p_inbound_provider_ref AND e.provider_sender_ref = s.provider_sender_ref
     AND e.status = 'received'
   WHERE cv.id = p_conversation_id AND cv.tenant_id = v_message.tenant_id
     AND cv.org_ref = v_message.org_ref AND s.provider_sender_ref IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WhatsApp recipient is not currently authorized' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.cg_whatsapp_n8n_reply
    (tenant_id, org_ref, reply_id, inbound_provider_ref, conversation_id, recipient_hash,
     body_hash, claim_token, lease_until)
  VALUES (v_message.tenant_id, v_message.org_ref, p_reply_id, p_inbound_provider_ref,
          p_conversation_id, encode(sha256(convert_to(v_address, 'UTF8')), 'hex'),
          encode(sha256(convert_to(p_body, 'UTF8')), 'hex'), v_claim_token,
          now() + interval '5 minutes')
  ON CONFLICT (tenant_id, reply_id) DO UPDATE
    SET status = 'queued', claim_token = EXCLUDED.claim_token,
        lease_until = EXCLUDED.lease_until, updated_at = now()
    WHERE cg_whatsapp_n8n_reply.inbound_provider_ref = EXCLUDED.inbound_provider_ref
      AND cg_whatsapp_n8n_reply.conversation_id = EXCLUDED.conversation_id
      AND cg_whatsapp_n8n_reply.recipient_hash = EXCLUDED.recipient_hash
      AND cg_whatsapp_n8n_reply.body_hash = EXCLUDED.body_hash
      AND (cg_whatsapp_n8n_reply.status = 'failed'
        OR (cg_whatsapp_n8n_reply.status = 'queued' AND cg_whatsapp_n8n_reply.lease_until <= now()))
  RETURNING cg_whatsapp_n8n_reply.claim_token INTO v_claim_token;
  IF NOT FOUND THEN RETURN; END IF;
  tenant_id := v_message.tenant_id;
  org_ref := v_message.org_ref;
  principal_ref := v_message.principal_ref;
  provider_sender_ref := v_sender_ref;
  conversation_id := p_conversation_id;
  recipient_address := v_address;
  claim_token := v_claim_token;
  RETURN NEXT;
END
$function$;
