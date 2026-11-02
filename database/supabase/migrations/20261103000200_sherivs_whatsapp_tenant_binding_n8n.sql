-- Tenant-bound WhatsApp dispatch and durable signed n8n forwarding.
-- NOT APPLIED. Rollback: database/supabase/rollbacks/20261103000200_sherivs_whatsapp_tenant_binding_n8n.sql
BEGIN;

ALTER TABLE public.cg_org_communication_sender
  DROP CONSTRAINT cg_org_communication_sender_channel_check,
  DROP CONSTRAINT cg_org_communication_sender_provider_check;
ALTER TABLE public.cg_org_communication_sender
  ADD CONSTRAINT cg_org_communication_sender_channel_check
    CHECK (channel IN ('sms', 'whatsapp', 'voice')),
  ADD CONSTRAINT cg_org_communication_sender_provider_check
    CHECK ((channel = 'sms' AND provider = 'twilio')
        OR (channel = 'whatsapp' AND provider = 'meta_cloud')
        OR (channel = 'voice' AND provider = 'africas_talking'));

CREATE TABLE public.cg_whatsapp_n8n_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  org_ref text NOT NULL CHECK (length(org_ref) BETWEEN 1 AND 160),
  conversation_id uuid NOT NULL,
  message_id uuid NOT NULL,
  provider_ref text NOT NULL CHECK (length(provider_ref) BETWEEN 1 AND 200),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'delivered', 'dead')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claim_token uuid,
  lease_until timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Za-z0-9_.-]{1,32}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, message_id),
  FOREIGN KEY (org_ref, tenant_id) REFERENCES public.cg_org_unit (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id, tenant_id, org_ref)
    REFERENCES public.cg_communication_conversation (id, tenant_id, org_ref) ON DELETE CASCADE
);
CREATE INDEX cg_whatsapp_n8n_outbox_due
  ON public.cg_whatsapp_n8n_outbox (next_attempt_at, created_at)
  WHERE status IN ('pending', 'processing');

CREATE TABLE public.cg_whatsapp_n8n_dead_letter (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  org_ref text NOT NULL CHECK (length(org_ref) BETWEEN 1 AND 160),
  outbox_id uuid NOT NULL,
  message_id uuid NOT NULL,
  attempt_count integer NOT NULL CHECK (attempt_count > 0),
  error_code text NOT NULL CHECK (error_code ~ '^[A-Za-z0-9_.-]{1,32}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, outbox_id),
  FOREIGN KEY (org_ref, tenant_id) REFERENCES public.cg_org_unit (id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE public.cg_whatsapp_send_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  org_ref text NOT NULL CHECK (length(org_ref) BETWEEN 1 AND 160),
  conversation_id uuid NOT NULL,
  message_id uuid NOT NULL,
  recipient_hash text NOT NULL CHECK (recipient_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, message_id),
  FOREIGN KEY (org_ref, tenant_id) REFERENCES public.cg_org_unit (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id, tenant_id, org_ref)
    REFERENCES public.cg_communication_conversation (id, tenant_id, org_ref) ON DELETE CASCADE
);
CREATE FUNCTION public.cg_whatsapp_send_audit_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'WhatsApp send audit is append-only';
END
$$;
CREATE TRIGGER cg_whatsapp_send_audit_append_only
  BEFORE UPDATE OR DELETE ON public.cg_whatsapp_send_audit
  FOR EACH ROW EXECUTE FUNCTION public.cg_whatsapp_send_audit_immutable();
REVOKE ALL ON FUNCTION public.cg_whatsapp_send_audit_immutable() FROM PUBLIC, anon, authenticated;

CREATE TABLE public.cg_whatsapp_n8n_reply (
  tenant_id text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  org_ref text NOT NULL CHECK (length(org_ref) BETWEEN 1 AND 160),
  reply_id text NOT NULL CHECK (length(reply_id) BETWEEN 1 AND 160),
  inbound_provider_ref text NOT NULL CHECK (length(inbound_provider_ref) BETWEEN 1 AND 200),
  conversation_id uuid NOT NULL,
  recipient_hash text NOT NULL CHECK (recipient_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  body_hash text NOT NULL CHECK (body_hash ~ '^[0-9a-f]{64}$'),
  claim_token uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, reply_id),
  CHECK ((status = 'queued' AND claim_token IS NOT NULL AND lease_until IS NOT NULL)
      OR (status <> 'queued' AND claim_token IS NULL AND lease_until IS NULL)),
  FOREIGN KEY (org_ref, tenant_id) REFERENCES public.cg_org_unit (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id, tenant_id, org_ref)
    REFERENCES public.cg_communication_conversation (id, tenant_id, org_ref) ON DELETE CASCADE
);

DO $rls$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'cg_whatsapp_n8n_outbox',
    'cg_whatsapp_n8n_dead_letter',
    'cg_whatsapp_send_audit',
    'cg_whatsapp_n8n_reply'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', v_table);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', v_table);
  END LOOP;
END
$rls$;

CREATE POLICY cg_whatsapp_n8n_outbox_tenant_select
  ON public.cg_whatsapp_n8n_outbox FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.is_tenant_admin(tenant_id));
CREATE POLICY cg_whatsapp_n8n_dead_letter_tenant_select
  ON public.cg_whatsapp_n8n_dead_letter FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.is_tenant_admin(tenant_id));
CREATE POLICY cg_whatsapp_send_audit_tenant_select
  ON public.cg_whatsapp_send_audit FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.is_tenant_admin(tenant_id));
CREATE POLICY cg_whatsapp_n8n_reply_tenant_select
  ON public.cg_whatsapp_n8n_reply FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.is_tenant_admin(tenant_id));

CREATE OR REPLACE FUNCTION public.cg_whatsapp_enqueue_n8n_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_address text;
BEGIN
  IF NEW.channel <> 'whatsapp' OR NEW.direction <> 'inbound' OR NEW.provider_ref IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT cv.address INTO v_address
    FROM public.cg_communication_conversation cv
   WHERE cv.id = NEW.conversation_id AND cv.tenant_id = NEW.tenant_id
     AND cv.org_ref = NEW.org_ref;
  IF v_address IS NULL THEN RAISE EXCEPTION 'WhatsApp conversation is unavailable'; END IF;
  INSERT INTO public.cg_whatsapp_n8n_outbox (
    tenant_id, org_ref, conversation_id, message_id, provider_ref, payload
  ) VALUES (
    NEW.tenant_id, NEW.org_ref, NEW.conversation_id, NEW.id, NEW.provider_ref,
    jsonb_build_object(
      'event_id', NEW.id,
      'provider_message_id', NEW.provider_ref,
      'event_type', 'whatsapp.inbound',
      'tenant_id', NEW.tenant_id,
      'org_ref', NEW.org_ref,
      'conversation_id', NEW.conversation_id,
      'recipient_hash', encode(sha256(convert_to(v_address, 'UTF8')), 'hex'),
      'received_at', NEW.provider_created_at,
      'body', NEW.body
    )
  )
  ON CONFLICT (tenant_id, message_id) DO NOTHING;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.cg_whatsapp_enqueue_n8n_event() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER cg_whatsapp_n8n_outbox_after_inbound
  AFTER INSERT ON public.cg_communication_message
  FOR EACH ROW EXECUTE FUNCTION public.cg_whatsapp_enqueue_n8n_event();

CREATE OR REPLACE FUNCTION public.cg_whatsapp_claim_n8n_outbox(p_limit integer DEFAULT 20)
RETURNS TABLE (
  outbox_id uuid,
  tenant_id text,
  org_ref text,
  conversation_id uuid,
  message_id uuid,
  provider_ref text,
  payload jsonb,
  attempt_count integer,
  claim_token uuid
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
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
$$;
REVOKE ALL ON FUNCTION public.cg_whatsapp_claim_n8n_outbox(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_whatsapp_claim_n8n_outbox(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.cg_whatsapp_complete_n8n_outbox(
  p_outbox_id uuid,
  p_claim_token uuid,
  p_success boolean,
  p_error_code text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_row public.cg_whatsapp_n8n_outbox%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed: WhatsApp outbox dispatch requires service role' USING ERRCODE = '42501';
  END IF;
  IF p_outbox_id IS NULL OR p_claim_token IS NULL
     OR (p_success AND p_error_code IS NOT NULL)
     OR (NOT p_success AND (p_error_code IS NULL OR p_error_code !~ '^[A-Za-z0-9_.-]{1,32}$')) THEN
    RAISE EXCEPTION 'invalid WhatsApp outbox result';
  END IF;
  SELECT * INTO v_row FROM public.cg_whatsapp_n8n_outbox
   WHERE id = p_outbox_id AND status = 'processing' AND claim_token = p_claim_token
   FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_success THEN
    UPDATE public.cg_whatsapp_n8n_outbox
       SET status = 'delivered', claim_token = NULL, lease_until = NULL,
           last_error_code = NULL, updated_at = now()
     WHERE id = v_row.id;
  ELSIF v_row.attempt_count >= 8 THEN
    UPDATE public.cg_whatsapp_n8n_outbox
       SET status = 'dead', claim_token = NULL, lease_until = NULL,
           last_error_code = p_error_code, updated_at = now()
     WHERE id = v_row.id;
    INSERT INTO public.cg_whatsapp_n8n_dead_letter
      (tenant_id, org_ref, outbox_id, message_id, attempt_count, error_code)
    VALUES (v_row.tenant_id, v_row.org_ref, v_row.id, v_row.message_id,
            v_row.attempt_count, p_error_code)
    ON CONFLICT (tenant_id, outbox_id) DO NOTHING;
  ELSE
    UPDATE public.cg_whatsapp_n8n_outbox
       SET status = 'pending', claim_token = NULL, lease_until = NULL,
           next_attempt_at = now() + make_interval(secs => least(3600, 30 * (2 ^ (v_row.attempt_count - 1))::integer)),
           last_error_code = p_error_code, updated_at = now()
     WHERE id = v_row.id;
  END IF;
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION public.cg_whatsapp_complete_n8n_outbox(uuid, uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_whatsapp_complete_n8n_outbox(uuid, uuid, boolean, text)
  TO service_role;

ALTER TABLE public.cg_whatsapp_auto_ack
  ADD COLUMN provider_sender_ref text,
  ADD COLUMN conversation_id uuid;
UPDATE public.cg_whatsapp_auto_ack a
   SET provider_sender_ref = coalesce(
     (SELECT e.provider_sender_ref FROM public.cg_whatsapp_inbound_event e
       WHERE e.tenant_id = a.tenant_id AND e.provider_ref = a.inbound_provider_ref
       ORDER BY e.received_at DESC LIMIT 1),
     'legacy-unresolved'
   ),
       conversation_id = (
         SELECT m.conversation_id FROM public.cg_communication_message m
          WHERE m.tenant_id = a.tenant_id AND m.provider_ref = a.inbound_provider_ref
            AND m.direction = 'inbound' LIMIT 1
       );
ALTER TABLE public.cg_whatsapp_auto_ack
  ALTER COLUMN provider_sender_ref SET NOT NULL,
  DROP CONSTRAINT cg_whatsapp_auto_ack_pkey,
  ADD PRIMARY KEY (tenant_id, provider_sender_ref, inbound_provider_ref),
  ADD CONSTRAINT cg_whatsapp_auto_ack_sender_ref_check
    CHECK (provider_sender_ref = 'legacy-unresolved' OR provider_sender_ref ~ '^[0-9]{1,160}$'),
  ADD CONSTRAINT cg_whatsapp_auto_ack_conversation_fk
    FOREIGN KEY (conversation_id, tenant_id, org_ref)
    REFERENCES public.cg_communication_conversation (id, tenant_id, org_ref) ON DELETE CASCADE;

DROP FUNCTION public.cg_whatsapp_prepare_auto_ack(text, text);
CREATE FUNCTION public.cg_whatsapp_prepare_auto_ack(
  p_provider_sender_ref text,
  p_inbound_provider_ref text,
  p_body text
) RETURNS TABLE (
  tenant_id text,
  org_ref text,
  principal_ref text,
  provider_sender_ref text,
  conversation_id uuid,
  recipient_address text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_message public.cg_communication_message%ROWTYPE;
  v_address text;
  v_sender_ref text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed: WhatsApp auto-ack requires the shared server gateway' USING ERRCODE = '42501';
  END IF;
  IF p_provider_sender_ref IS NULL OR p_provider_sender_ref !~ '^[0-9]{1,160}$'
     OR p_inbound_provider_ref IS NULL OR length(p_inbound_provider_ref) NOT BETWEEN 1 AND 200
     OR p_body IS NULL OR length(p_body) NOT BETWEEN 1 AND 4096 THEN
    RAISE EXCEPTION 'invalid WhatsApp auto-ack request';
  END IF;
  SELECT m.* INTO v_message
    FROM public.cg_whatsapp_inbound_event e
    JOIN public.cg_communication_message m
      ON m.tenant_id = e.tenant_id AND m.org_ref = e.org_ref
     AND m.provider_ref = e.provider_ref AND m.channel = 'whatsapp'
     AND m.direction = 'inbound'
   WHERE e.provider_sender_ref = p_provider_sender_ref
     AND e.provider_ref = p_inbound_provider_ref AND e.status = 'received'
     AND m.provider_created_at >= now() - interval '24 hours'
     AND m.provider_created_at <= now()
     AND m.principal_ref IS NOT NULL;
  IF NOT FOUND OR upper(trim(v_message.body)) IN
     ('STOP', 'UNSUBSCRIBE', 'END', 'DAINA', 'DURO', 'KWUSI') THEN
    RETURN;
  END IF;
  SELECT cv.address, s.provider_sender_ref
    INTO v_address, v_sender_ref
    FROM public.cg_communication_conversation cv
    JOIN public.cg_communication_recipient_address r
      ON r.tenant_id = cv.tenant_id AND r.org_ref = cv.org_ref
     AND r.channel = cv.channel AND r.address = cv.address
     AND r.principal_ref = v_message.principal_ref
    JOIN public.cg_communication_optin c
      ON c.tenant_id = cv.tenant_id AND c.org_ref = cv.org_ref
     AND c.channel = cv.channel AND c.address = cv.address AND c.status = 'opted_in'
    JOIN public.cg_org_membership m
      ON m.tenant_id = r.tenant_id AND m.org_unit_id = r.org_ref
     AND m.principal_ref = r.principal_ref AND m.state = 'active'
    JOIN public.cg_org_communication_sender s
      ON s.tenant_id = cv.tenant_id AND s.org_ref = cv.org_ref
     AND s.channel = 'whatsapp' AND s.provider = 'meta_cloud' AND s.status = 'active'
   WHERE cv.id = v_message.conversation_id AND cv.tenant_id = v_message.tenant_id
     AND cv.org_ref = v_message.org_ref AND cv.principal_ref = v_message.principal_ref
     AND s.provider_sender_ref = p_provider_sender_ref;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO public.cg_whatsapp_auto_ack
    (inbound_provider_ref, provider_sender_ref, tenant_id, org_ref, principal_ref,
     conversation_id, status)
  VALUES (p_inbound_provider_ref, v_sender_ref, v_message.tenant_id, v_message.org_ref,
          v_message.principal_ref, v_message.conversation_id, 'queued')
  ON CONFLICT ON CONSTRAINT cg_whatsapp_auto_ack_pkey DO NOTHING;
  IF NOT FOUND THEN RETURN; END IF;
  tenant_id := v_message.tenant_id;
  org_ref := v_message.org_ref;
  principal_ref := v_message.principal_ref;
  provider_sender_ref := v_sender_ref;
  conversation_id := v_message.conversation_id;
  recipient_address := v_address;
  RETURN NEXT;
END
$$;
REVOKE ALL ON FUNCTION public.cg_whatsapp_prepare_auto_ack(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_whatsapp_prepare_auto_ack(text, text, text) TO service_role;

DROP FUNCTION public.cg_whatsapp_auto_ack_result(text, text, text);
CREATE FUNCTION public.cg_whatsapp_auto_ack_result(
  p_provider_sender_ref text,
  p_inbound_provider_ref text,
  p_status text,
  p_error_code text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed: WhatsApp auto-ack requires the shared server gateway' USING ERRCODE = '42501';
  END IF;
  IF p_provider_sender_ref IS NULL OR p_provider_sender_ref !~ '^[0-9]{1,160}$'
     OR p_inbound_provider_ref IS NULL OR length(p_inbound_provider_ref) NOT BETWEEN 1 AND 200
     OR p_status NOT IN ('sent', 'failed')
     OR (p_error_code IS NOT NULL AND p_error_code !~ '^[A-Za-z0-9_.-]{1,32}$') THEN
    RAISE EXCEPTION 'invalid WhatsApp auto-ack result';
  END IF;
  UPDATE public.cg_whatsapp_auto_ack
     SET status = p_status, error_code = p_error_code, updated_at = now()
   WHERE provider_sender_ref = p_provider_sender_ref
     AND inbound_provider_ref = p_inbound_provider_ref AND status = 'queued';
  RETURN FOUND;
END
$$;
REVOKE ALL ON FUNCTION public.cg_whatsapp_auto_ack_result(text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_whatsapp_auto_ack_result(text, text, text, text) TO service_role;

CREATE FUNCTION public.cg_whatsapp_prepare_send(
  p_tenant_id text,
  p_org_ref text,
  p_principal_ref text,
  p_body text,
  p_template_code text,
  p_conversation_id uuid,
  p_provider_sender_ref text,
  p_inbound_provider_ref text
) RETURNS TABLE (
  message_id uuid,
  provider_sender_ref text,
  recipient_address text,
  conversation_id uuid
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_recipient text;
  v_sender text;
  v_count integer;
  v_inbound_count integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed: WhatsApp sends require the shared server gateway' USING ERRCODE = '42501';
  END IF;
  IF p_tenant_id IS NULL OR length(p_tenant_id) NOT BETWEEN 1 AND 128
     OR p_org_ref IS NULL OR length(p_org_ref) NOT BETWEEN 1 AND 160
     OR p_principal_ref IS NULL OR length(p_principal_ref) NOT BETWEEN 1 AND 160
     OR p_body IS NULL OR length(p_body) > 4096
     OR (p_template_code IS NOT NULL AND p_template_code !~ '^[A-Za-z0-9_.-]{1,160}$')
     OR (p_template_code IS NULL AND length(p_body) = 0)
     OR p_conversation_id IS NULL
     OR p_provider_sender_ref IS NULL OR p_provider_sender_ref !~ '^[0-9]{1,160}$'
     OR p_inbound_provider_ref IS NULL OR length(p_inbound_provider_ref) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid WhatsApp send request';
  END IF;
  SELECT count(*)::integer INTO v_inbound_count
    FROM public.cg_communication_message m
    JOIN public.cg_communication_conversation cv
      ON cv.id = m.conversation_id AND cv.tenant_id = m.tenant_id AND cv.org_ref = m.org_ref
    JOIN public.cg_whatsapp_inbound_event e
      ON e.tenant_id = m.tenant_id AND e.org_ref = m.org_ref AND e.provider_ref = m.provider_ref
     AND e.status = 'received'
   WHERE m.tenant_id = p_tenant_id AND m.org_ref = p_org_ref
     AND m.conversation_id = p_conversation_id AND m.provider_ref = p_inbound_provider_ref
     AND e.provider_sender_ref = p_provider_sender_ref
     AND m.channel = 'whatsapp' AND m.direction = 'inbound'
     AND m.principal_ref = p_principal_ref
     AND m.provider_created_at >= now() - interval '24 hours'
     AND m.provider_created_at <= now()
     AND cv.principal_ref = p_principal_ref;
  IF v_inbound_count <> 1 THEN
    RAISE EXCEPTION 'WhatsApp reply does not match an active inbound conversation' USING ERRCODE = '42501';
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
  SELECT count(*)::integer INTO v_count
    FROM public.cg_communication_recipient_address r
    JOIN public.cg_org_membership m
      ON m.tenant_id = r.tenant_id AND m.org_unit_id = r.org_ref
     AND m.principal_ref = r.principal_ref AND m.state = 'active'
    JOIN public.cg_communication_conversation cv
      ON cv.tenant_id = r.tenant_id AND cv.org_ref = r.org_ref
     AND cv.id = p_conversation_id AND cv.address = r.address
   WHERE r.tenant_id = p_tenant_id AND r.org_ref = p_org_ref
     AND r.principal_ref = p_principal_ref AND r.channel = 'whatsapp'
     AND cv.channel = 'whatsapp';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'WhatsApp conversation address is not uniquely linked';
  END IF;
  SELECT r.address INTO v_recipient
    FROM public.cg_communication_recipient_address r
    JOIN public.cg_communication_conversation cv
      ON cv.tenant_id = r.tenant_id AND cv.org_ref = r.org_ref
     AND cv.id = p_conversation_id AND cv.address = r.address
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
     AND s.provider_sender_ref = p_provider_sender_ref
     AND o.lifecycle_state = 'active';
  IF v_sender IS NULL THEN RAISE EXCEPTION 'no active WhatsApp sender is registered'; END IF;
  INSERT INTO public.cg_communication_message
    (tenant_id, org_ref, conversation_id, channel, direction, status, principal_ref, template_code, body)
  VALUES (p_tenant_id, p_org_ref, p_conversation_id, 'whatsapp', 'outbound', 'queued',
          p_principal_ref, p_template_code, p_body)
  RETURNING id INTO message_id;
  INSERT INTO public.cg_whatsapp_send_audit
    (tenant_id, org_ref, conversation_id, message_id, recipient_hash)
  VALUES (p_tenant_id, p_org_ref, p_conversation_id, message_id,
          encode(sha256(convert_to(v_recipient, 'UTF8')), 'hex'));
  provider_sender_ref := v_sender;
  recipient_address := v_recipient;
  conversation_id := p_conversation_id;
  RETURN NEXT;
END
$$;
REVOKE ALL ON FUNCTION public.cg_whatsapp_prepare_send(text, text, text, text, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_whatsapp_prepare_send(text, text, text, text, text, uuid, text, text)
  TO service_role;

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
  v_inbound record;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed: WhatsApp sends require the shared server gateway' USING ERRCODE = '42501';
  END IF;
  SELECT m.conversation_id, e.provider_sender_ref, m.provider_ref
    INTO v_inbound
    FROM public.cg_communication_message m
    JOIN public.cg_whatsapp_inbound_event e
      ON e.tenant_id = m.tenant_id AND e.org_ref = m.org_ref AND e.provider_ref = m.provider_ref
     AND e.status = 'received'
    JOIN public.cg_communication_recipient_address r
      ON r.tenant_id = m.tenant_id AND r.org_ref = m.org_ref
     AND r.principal_ref = m.principal_ref AND r.channel = 'whatsapp'
    JOIN public.cg_communication_conversation cv
      ON cv.id = m.conversation_id AND cv.tenant_id = m.tenant_id
     AND cv.org_ref = m.org_ref AND cv.address = r.address
   WHERE m.tenant_id = p_tenant_id AND m.org_ref = p_org_ref
     AND m.principal_ref = p_principal_ref AND m.channel = 'whatsapp'
     AND m.direction = 'inbound' AND m.provider_created_at >= now() - interval '24 hours'
     AND m.provider_created_at <= now()
   ORDER BY m.provider_created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WhatsApp send requires a recent server-recorded inbound message' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT p.message_id, p.provider_sender_ref, p.recipient_address
      FROM public.cg_whatsapp_prepare_send(
        p_tenant_id, p_org_ref, p_principal_ref, p_body, p_template_code,
        v_inbound.conversation_id, v_inbound.provider_sender_ref, v_inbound.provider_ref
      ) p;
END
$$;
REVOKE ALL ON FUNCTION public.cg_whatsapp_prepare_send(text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_whatsapp_prepare_send(text, text, text, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.cg_whatsapp_prepare_n8n_reply(
  p_reply_id text,
  p_inbound_provider_ref text,
  p_conversation_id uuid,
  p_body text
) RETURNS TABLE (
  tenant_id text,
  org_ref text,
  principal_ref text,
  provider_sender_ref text,
  conversation_id uuid,
  recipient_address text,
  claim_token uuid
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
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
$$;
REVOKE ALL ON FUNCTION public.cg_whatsapp_prepare_n8n_reply(text, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_whatsapp_prepare_n8n_reply(text, text, uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.cg_whatsapp_n8n_reply_result(
  p_tenant_id text,
  p_reply_id text,
  p_inbound_provider_ref text,
  p_conversation_id uuid,
  p_claim_token uuid,
  p_status text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed: WhatsApp reply result requires service role' USING ERRCODE = '42501';
  END IF;
  IF p_reply_id IS NULL OR p_inbound_provider_ref IS NULL OR p_conversation_id IS NULL
     OR p_claim_token IS NULL
     OR p_tenant_id IS NULL OR length(p_tenant_id) NOT BETWEEN 1 AND 128
     OR p_status NOT IN ('sent', 'failed') THEN
    RAISE EXCEPTION 'invalid WhatsApp reply result';
  END IF;
  UPDATE public.cg_whatsapp_n8n_reply
     SET status = p_status, claim_token = NULL, lease_until = NULL, updated_at = now()
   WHERE reply_id = p_reply_id AND inbound_provider_ref = p_inbound_provider_ref
     AND conversation_id = p_conversation_id AND tenant_id = p_tenant_id
     AND status = 'queued' AND claim_token = p_claim_token;
  RETURN FOUND;
END
$$;
REVOKE ALL ON FUNCTION public.cg_whatsapp_n8n_reply_result(text, text, text, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_whatsapp_n8n_reply_result(text, text, text, uuid, uuid, text)
  TO service_role;

COMMIT;
