-- Durable webhook protection, recipient review, auto-ack claims, and health data.
-- NOT APPLIED. Rollback: database/supabase/rollbacks/20261103000100_sherivs_whatsapp_e2e_durable.sql
BEGIN;

ALTER TABLE public.cg_communication_message
  ADD COLUMN provider_status_at timestamptz,
  ADD COLUMN provider_created_at timestamptz;

CREATE TABLE public.cg_whatsapp_inbound_event (
  provider_sender_ref text NOT NULL CHECK (provider_sender_ref ~ '^[0-9]{1,160}$'),
  provider_ref text NOT NULL CHECK (length(provider_ref) BETWEEN 1 AND 200),
  tenant_id text CHECK (tenant_id IS NULL OR length(tenant_id) BETWEEN 1 AND 128),
  org_ref text CHECK (org_ref IS NULL OR length(org_ref) BETWEEN 1 AND 160),
  status text NOT NULL CHECK (status IN ('received', 'unmapped_sender', 'rate_limited')),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_sender_ref, provider_ref)
);

CREATE TABLE public.cg_whatsapp_inbound_rate_limit (
  provider_sender_ref text NOT NULL CHECK (provider_sender_ref ~ '^[0-9]{1,160}$'),
  tenant_id text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  address text NOT NULL CHECK (address ~ '^\+[1-9][0-9]{7,14}$'),
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  PRIMARY KEY (provider_sender_ref, address)
);

CREATE TABLE public.cg_whatsapp_dead_letter (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_sender_ref text NOT NULL CHECK (length(provider_sender_ref) BETWEEN 1 AND 160),
  tenant_id text CHECK (tenant_id IS NULL OR length(tenant_id) BETWEEN 1 AND 128),
  provider_ref text CHECK (provider_ref IS NULL OR length(provider_ref) BETWEEN 1 AND 200),
  event_type text NOT NULL CHECK (event_type IN ('message', 'status')),
  error_code text NOT NULL CHECK (error_code ~ '^[A-Za-z0-9_.-]{1,32}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (provider_sender_ref, provider_ref, event_type, error_code)
);

CREATE TABLE public.cg_whatsapp_auto_ack (
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  inbound_provider_ref text PRIMARY KEY CHECK (length(inbound_provider_ref) BETWEEN 1 AND 200),
  tenant_id text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  org_ref text NOT NULL CHECK (length(org_ref) BETWEEN 1 AND 160),
  principal_ref text NOT NULL CHECK (length(principal_ref) BETWEEN 1 AND 160),
  status text NOT NULL CHECK (status IN ('queued', 'sent', 'failed')),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Za-z0-9_.-]{1,32}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_ref, tenant_id) REFERENCES public.cg_org_unit (id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE public.cg_whatsapp_recipient_link_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  org_ref text NOT NULL CHECK (length(org_ref) BETWEEN 1 AND 160),
  principal_ref text NOT NULL CHECK (length(principal_ref) BETWEEN 1 AND 160),
  address text NOT NULL CHECK (address ~ '^\+[1-9][0-9]{7,14}$'),
  consent_evidence text NOT NULL CHECK (length(trim(consent_evidence)) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by text NOT NULL CHECK (length(requested_by) BETWEEN 1 AND 160),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by text CHECK (reviewed_by IS NULL OR length(reviewed_by) BETWEEN 1 AND 160),
  reviewed_at timestamptz,
  review_note text CHECK (review_note IS NULL OR length(review_note) <= 500),
  FOREIGN KEY (org_ref, tenant_id) REFERENCES public.cg_org_unit (id, tenant_id) ON DELETE CASCADE,
  CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status <> 'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX cg_whatsapp_recipient_link_request_pending_unique
  ON public.cg_whatsapp_recipient_link_request (tenant_id, org_ref, principal_ref, address)
  WHERE status = 'pending';

CREATE TRIGGER cg_whatsapp_auto_ack_audit
  AFTER INSERT OR UPDATE ON public.cg_whatsapp_auto_ack
  FOR EACH ROW EXECUTE FUNCTION public.cg_communication_audit();
CREATE TRIGGER cg_whatsapp_recipient_link_request_audit
  AFTER INSERT OR UPDATE ON public.cg_whatsapp_recipient_link_request
  FOR EACH ROW EXECUTE FUNCTION public.cg_communication_audit();

DO $rls$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'cg_whatsapp_inbound_event',
    'cg_whatsapp_inbound_rate_limit',
    'cg_whatsapp_dead_letter',
    'cg_whatsapp_auto_ack',
    'cg_whatsapp_recipient_link_request'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', v_table);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', v_table);
  END LOOP;
END
$rls$;

CREATE POLICY cg_whatsapp_inbound_event_tenant_select
  ON public.cg_whatsapp_inbound_event FOR SELECT TO authenticated
  USING (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id());
CREATE POLICY cg_whatsapp_inbound_rate_limit_tenant_select
  ON public.cg_whatsapp_inbound_rate_limit FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY cg_whatsapp_dead_letter_tenant_select
  ON public.cg_whatsapp_dead_letter FOR SELECT TO authenticated
  USING (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id());
CREATE POLICY cg_whatsapp_auto_ack_tenant_select
  ON public.cg_whatsapp_auto_ack FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY cg_whatsapp_recipient_link_request_tenant_select
  ON public.cg_whatsapp_recipient_link_request FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.is_tenant_admin(tenant_id));

CREATE FUNCTION public.cg_whatsapp_receive(
  p_provider_sender_ref text,
  p_from text,
  p_body text,
  p_provider_ref text,
  p_provider_timestamp timestamptz
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
  v_rate_count integer;
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
  IF v_count <> 1 THEN
    INSERT INTO public.cg_whatsapp_inbound_event
      (provider_sender_ref, provider_ref, status)
    VALUES (p_provider_sender_ref, p_provider_ref, 'unmapped_sender')
    ON CONFLICT (provider_sender_ref, provider_ref) DO NOTHING;
    IF NOT FOUND THEN RETURN 'duplicate'; END IF;
    INSERT INTO public.cg_whatsapp_dead_letter
      (provider_sender_ref, provider_ref, event_type, error_code)
    VALUES (p_provider_sender_ref, p_provider_ref, 'message', 'unmapped_sender')
    ON CONFLICT DO NOTHING;
    RETURN 'unmapped_sender';
  END IF;

  SELECT s.* INTO v_sender
    FROM public.cg_org_communication_sender s
    JOIN public.cg_org_unit o ON o.id = s.org_ref AND o.tenant_id = s.tenant_id
   WHERE s.provider_sender_ref = p_provider_sender_ref
     AND s.channel = 'whatsapp' AND s.provider = 'meta_cloud' AND s.status = 'active'
     AND o.lifecycle_state = 'active';

  INSERT INTO public.cg_whatsapp_inbound_event
    (provider_sender_ref, provider_ref, tenant_id, org_ref, status)
  VALUES (p_provider_sender_ref, p_provider_ref, v_sender.tenant_id, v_sender.org_ref, 'received')
  ON CONFLICT (provider_sender_ref, provider_ref) DO NOTHING;
  IF NOT FOUND THEN RETURN 'duplicate'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.cg_communication_message m
     WHERE m.tenant_id = v_sender.tenant_id AND m.provider_ref = p_provider_ref
  ) THEN RETURN 'duplicate'; END IF;

  INSERT INTO public.cg_whatsapp_inbound_rate_limit
    (provider_sender_ref, tenant_id, address, window_started_at, request_count)
  VALUES (p_provider_sender_ref, v_sender.tenant_id, p_from, clock_timestamp(), 1)
  ON CONFLICT (provider_sender_ref, address) DO UPDATE
    SET tenant_id = EXCLUDED.tenant_id,
        window_started_at = CASE
          WHEN public.cg_whatsapp_inbound_rate_limit.window_started_at <= clock_timestamp() - interval '1 minute'
            THEN clock_timestamp()
          ELSE public.cg_whatsapp_inbound_rate_limit.window_started_at
        END,
        request_count = CASE
          WHEN public.cg_whatsapp_inbound_rate_limit.window_started_at <= clock_timestamp() - interval '1 minute'
            THEN 1
          ELSE public.cg_whatsapp_inbound_rate_limit.request_count + 1
        END
  RETURNING request_count INTO v_rate_count;
  IF v_rate_count > 30 THEN
    UPDATE public.cg_whatsapp_inbound_event
       SET status = 'rate_limited'
     WHERE provider_sender_ref = p_provider_sender_ref AND provider_ref = p_provider_ref;
    INSERT INTO public.cg_whatsapp_dead_letter
      (provider_sender_ref, provider_ref, event_type, error_code)
    VALUES (p_provider_sender_ref, p_provider_ref, 'message', 'rate_limited')
    ON CONFLICT DO NOTHING;
    RETURN 'rate_limited';
  END IF;

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
    (tenant_id, org_ref, conversation_id, channel, direction, status, principal_ref,
     provider_ref, provider_created_at, body)
  VALUES (v_sender.tenant_id, v_sender.org_ref, v_conversation, 'whatsapp', 'inbound',
          'received', v_principal, p_provider_ref, p_provider_timestamp, left(p_body, 4096))
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
REVOKE ALL ON FUNCTION public.cg_whatsapp_receive(text, text, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_whatsapp_receive(text, text, text, text, timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.cg_whatsapp_receive(
  p_provider_sender_ref text,
  p_from text,
  p_body text,
  p_provider_ref text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed: WhatsApp callbacks require a verified provider webhook' USING ERRCODE = '42501';
  END IF;
  RETURN public.cg_whatsapp_receive(
    p_provider_sender_ref, p_from, p_body, p_provider_ref, NULL::timestamptz
  );
END
$$;
REVOKE ALL ON FUNCTION public.cg_whatsapp_receive(text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_whatsapp_receive(text, text, text, text)
  TO service_role;

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
         provider_status_at = now(),
         updated_at = now()
   WHERE tenant_id = v_sender.tenant_id AND org_ref = v_sender.org_ref
     AND channel = 'whatsapp' AND direction = 'outbound' AND provider_ref = p_provider_ref;
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION public.cg_whatsapp_status(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_whatsapp_status(text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.cg_whatsapp_dead_letter(
  p_provider_sender_ref text,
  p_provider_ref text,
  p_event_type text,
  p_error_code text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tenant_id text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed: WhatsApp dead letters require the verified webhook';
  END IF;
  IF p_provider_sender_ref IS NULL OR length(p_provider_sender_ref) NOT BETWEEN 1 AND 160
     OR (p_provider_ref IS NOT NULL AND length(p_provider_ref) NOT BETWEEN 1 AND 200)
     OR p_event_type NOT IN ('message', 'status')
     OR p_error_code IS NULL OR p_error_code !~ '^[A-Za-z0-9_.-]{1,32}$' THEN
    RAISE EXCEPTION 'invalid WhatsApp dead-letter event';
  END IF;
  SELECT s.tenant_id INTO v_tenant_id
    FROM public.cg_org_communication_sender s
   WHERE s.provider_sender_ref = p_provider_sender_ref
     AND s.channel = 'whatsapp' AND s.provider = 'meta_cloud' AND s.status = 'active'
   LIMIT 1;
  INSERT INTO public.cg_whatsapp_dead_letter
    (provider_sender_ref, tenant_id, provider_ref, event_type, error_code)
  VALUES (p_provider_sender_ref, v_tenant_id, p_provider_ref, p_event_type, p_error_code)
  ON CONFLICT DO NOTHING;
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION public.cg_whatsapp_dead_letter(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_whatsapp_dead_letter(text, text, text, text) TO service_role;

DROP FUNCTION IF EXISTS public.cg_whatsapp_prepare_auto_ack(text, text);
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

CREATE OR REPLACE FUNCTION public.cg_whatsapp_auto_ack_result(
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

CREATE OR REPLACE FUNCTION public.cg_whatsapp_record_recipient_link_request(
  p_tenant_id text,
  p_org_ref text,
  p_principal_ref text,
  p_address text,
  p_consent_evidence text,
  p_requested_by text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_tenant_id IS NULL OR length(p_tenant_id) NOT BETWEEN 1 AND 128
     OR p_org_ref IS NULL OR length(p_org_ref) NOT BETWEEN 1 AND 160
     OR p_principal_ref IS NULL OR length(p_principal_ref) NOT BETWEEN 1 AND 160
     OR p_address IS NULL OR p_address !~ '^\+[1-9][0-9]{7,14}$'
     OR p_consent_evidence IS NULL OR length(trim(p_consent_evidence)) NOT BETWEEN 1 AND 500
     OR p_requested_by IS NULL OR length(p_requested_by) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'invalid WhatsApp recipient-link request';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cg_org_unit o
    WHERE o.id = p_org_ref AND o.tenant_id = p_tenant_id AND o.lifecycle_state = 'active'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.cg_org_membership m
    WHERE m.tenant_id = p_tenant_id AND m.org_unit_id = p_org_ref
      AND m.principal_ref = p_principal_ref AND m.state = 'active'
  ) THEN
    RAISE EXCEPTION 'not allowed: active organization administrator and member required'
      USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.cg_whatsapp_recipient_link_request
    (tenant_id, org_ref, principal_ref, address, consent_evidence, requested_by)
  VALUES (p_tenant_id, p_org_ref, p_principal_ref, p_address, trim(p_consent_evidence), p_requested_by)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
REVOKE ALL ON FUNCTION public.cg_whatsapp_record_recipient_link_request(text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cg_whatsapp_request_recipient_link(
  p_tenant_id text,
  p_org_ref text,
  p_principal_ref text,
  p_address text,
  p_consent_evidence text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR coalesce(auth.role(), '') <> 'authenticated'
     OR NOT public.is_tenant_admin(p_tenant_id) THEN
    RAISE EXCEPTION 'not allowed: active organization administrator required'
      USING ERRCODE = '42501';
  END IF;
  RETURN public.cg_whatsapp_record_recipient_link_request(
    p_tenant_id, p_org_ref, p_principal_ref, p_address, p_consent_evidence, auth.uid()::text
  );
END
$$;
REVOKE ALL ON FUNCTION public.cg_whatsapp_request_recipient_link(text, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cg_whatsapp_request_recipient_link(text, text, text, text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.cg_whatsapp_request_recipient_link_internal(
  p_tenant_id text,
  p_org_ref text,
  p_principal_ref text,
  p_address text,
  p_consent_evidence text,
  p_requested_by text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed: Internal Console authorization is required'
      USING ERRCODE = '42501';
  END IF;
  RETURN public.cg_whatsapp_record_recipient_link_request(
    p_tenant_id, p_org_ref, p_principal_ref, p_address, p_consent_evidence, p_requested_by
  );
END
$$;
REVOKE ALL ON FUNCTION public.cg_whatsapp_request_recipient_link_internal(text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_whatsapp_request_recipient_link_internal(text, text, text, text, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.cg_whatsapp_list_recipient_link_requests(p_tenant_id text)
RETURNS TABLE (
  id uuid, tenant_id text, org_ref text, principal_ref text, address text,
  consent_evidence text, status text, requested_by text, requested_at timestamptz,
  reviewed_by text, reviewed_at timestamptz, review_note text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed: recipient-link review requires the Internal Console'
      USING ERRCODE = '42501';
  END IF;
  IF p_tenant_id IS NULL OR length(p_tenant_id) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'invalid WhatsApp tenant scope';
  END IF;
  RETURN QUERY
    SELECT r.id, r.tenant_id, r.org_ref, r.principal_ref, r.address, r.consent_evidence,
           r.status, r.requested_by, r.requested_at, r.reviewed_by, r.reviewed_at, r.review_note
      FROM public.cg_whatsapp_recipient_link_request r
     WHERE r.tenant_id = p_tenant_id
     ORDER BY r.requested_at DESC;
END
$$;
REVOKE ALL ON FUNCTION public.cg_whatsapp_list_recipient_link_requests(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_whatsapp_list_recipient_link_requests(text) TO service_role;

CREATE OR REPLACE FUNCTION public.cg_whatsapp_review_recipient_link(
  p_request_id uuid,
  p_tenant_id text,
  p_decision text,
  p_reviewer_ref text,
  p_review_note text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_request public.cg_whatsapp_recipient_link_request%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed: recipient-link review requires the Internal Console'
      USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_tenant_id IS NULL OR length(p_tenant_id) NOT BETWEEN 1 AND 128
     OR p_decision IS NULL OR p_decision NOT IN ('approved', 'rejected')
     OR p_reviewer_ref IS NULL OR length(p_reviewer_ref) NOT BETWEEN 1 AND 160
     OR (p_review_note IS NOT NULL AND length(p_review_note) > 500) THEN
    RAISE EXCEPTION 'invalid WhatsApp recipient-link review';
  END IF;
  SELECT * INTO v_request
    FROM public.cg_whatsapp_recipient_link_request
   WHERE id = p_request_id AND tenant_id = p_tenant_id AND status = 'pending'
   FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_request.requested_by = p_reviewer_ref THEN
    RAISE EXCEPTION 'requester cannot approve their own WhatsApp recipient-link request'
      USING ERRCODE = '42501';
  END IF;
  IF p_decision = 'approved' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      v_request.tenant_id || ':' || v_request.org_ref || ':' || v_request.address, 8811
    ));
    IF NOT EXISTS (
      SELECT 1 FROM public.cg_org_membership m
       WHERE m.tenant_id = v_request.tenant_id AND m.org_unit_id = v_request.org_ref
         AND m.principal_ref = v_request.principal_ref AND m.state = 'active'
    ) THEN
      RAISE EXCEPTION 'recipient is not an active organization member';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.cg_communication_recipient_address r
       WHERE r.tenant_id = v_request.tenant_id AND r.org_ref = v_request.org_ref
         AND r.channel = 'whatsapp' AND r.address = v_request.address
         AND r.principal_ref <> v_request.principal_ref
    ) THEN
      RAISE EXCEPTION 'WhatsApp address is already linked to a different member';
    END IF;
    INSERT INTO public.cg_communication_recipient_address
      (tenant_id, org_ref, principal_ref, channel, address)
    VALUES (v_request.tenant_id, v_request.org_ref, v_request.principal_ref, 'whatsapp', v_request.address)
    ON CONFLICT (tenant_id, org_ref, channel, address) DO UPDATE
      SET principal_ref = EXCLUDED.principal_ref
      WHERE public.cg_communication_recipient_address.principal_ref = EXCLUDED.principal_ref;
    INSERT INTO public.cg_communication_optin
      (tenant_id, org_ref, channel, address, status, source)
    VALUES (v_request.tenant_id, v_request.org_ref, 'whatsapp', v_request.address, 'opted_in', 'authorized_server')
    ON CONFLICT (tenant_id, org_ref, channel, address) DO UPDATE
      SET status = 'opted_in', source = 'authorized_server', updated_at = now();
  END IF;
  UPDATE public.cg_whatsapp_recipient_link_request
     SET status = p_decision, reviewed_by = p_reviewer_ref, reviewed_at = now(),
         review_note = p_review_note
   WHERE id = p_request_id;
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION public.cg_whatsapp_review_recipient_link(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_whatsapp_review_recipient_link(uuid, text, text, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.cg_whatsapp_health()
RETURNS TABLE (
  mapped_sender_count bigint,
  last_inbound_at timestamptz,
  last_status_at timestamptz,
  unmapped_sender_count bigint
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed: WhatsApp health requires the Internal Console'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT
      (SELECT count(*) FROM public.cg_org_communication_sender s
        JOIN public.cg_org_unit o ON o.id = s.org_ref AND o.tenant_id = s.tenant_id
        WHERE s.channel = 'whatsapp' AND s.provider = 'meta_cloud' AND s.status = 'active'
          AND o.lifecycle_state = 'active'),
      (SELECT max(coalesce(m.provider_created_at, m.created_at))
        FROM public.cg_communication_message m
        WHERE m.channel = 'whatsapp' AND m.direction = 'inbound'),
      (SELECT max(m.provider_status_at) FROM public.cg_communication_message m
        WHERE m.channel = 'whatsapp' AND m.direction = 'outbound'
          AND m.provider_status_at IS NOT NULL),
      (SELECT count(DISTINCT d.provider_sender_ref) FROM public.cg_whatsapp_dead_letter d
        WHERE d.error_code = 'unmapped_sender');
END
$$;
REVOKE ALL ON FUNCTION public.cg_whatsapp_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_whatsapp_health() TO service_role;

COMMIT;
