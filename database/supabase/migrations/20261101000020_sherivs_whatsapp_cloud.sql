-- WhatsApp Cloud support for the shared, tenant-neutral communication fabric.
-- NOT APPLIED. Sender identity, messages, and consent use tenant_id + org_ref;
-- provider callbacks never choose a tenant from payload data.
-- Rollback: database/supabase/rollbacks/20261101000020_sherivs_whatsapp_cloud.sql
BEGIN;

ALTER TABLE public.cg_org_communication_sender
  ADD COLUMN provider_sender_ref text;
ALTER TABLE public.cg_org_communication_sender
  DROP CONSTRAINT cg_org_communication_sender_channel_check,
  DROP CONSTRAINT cg_org_communication_sender_provider_check;
ALTER TABLE public.cg_org_communication_sender
  ADD CONSTRAINT cg_org_communication_sender_channel_check CHECK (channel IN ('sms', 'whatsapp')),
  ADD CONSTRAINT cg_org_communication_sender_provider_check CHECK (
    (channel = 'sms' AND provider = 'twilio')
    OR (channel = 'whatsapp' AND provider = 'meta_cloud')
  ),
  ADD CONSTRAINT cg_org_communication_sender_provider_ref_check CHECK (
    channel <> 'whatsapp' OR provider_sender_ref IS NOT NULL AND length(provider_sender_ref) BETWEEN 1 AND 160
  );
CREATE UNIQUE INDEX cg_org_communication_sender_meta_ref_active
  ON public.cg_org_communication_sender (provider_sender_ref)
  WHERE channel = 'whatsapp' AND provider = 'meta_cloud' AND status = 'active';
ALTER TABLE public.cg_org_communication_sender FORCE ROW LEVEL SECURITY;

CREATE TABLE public.cg_communication_recipient_address (
  tenant_id text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  org_ref text NOT NULL CHECK (length(org_ref) BETWEEN 1 AND 160),
  principal_ref text NOT NULL CHECK (length(principal_ref) BETWEEN 1 AND 160),
  channel text NOT NULL CHECK (channel = 'whatsapp'),
  address text NOT NULL CHECK (address ~ '^\+[1-9][0-9]{7,14}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, org_ref, channel, address),
  FOREIGN KEY (org_ref, tenant_id) REFERENCES public.cg_org_unit (id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE public.cg_communication_conversation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  org_ref text NOT NULL CHECK (length(org_ref) BETWEEN 1 AND 160),
  channel text NOT NULL CHECK (channel = 'whatsapp'),
  address text NOT NULL CHECK (address ~ '^\+[1-9][0-9]{7,14}$'),
  principal_ref text CHECK (principal_ref IS NULL OR length(principal_ref) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, org_ref, channel, address),
  UNIQUE (id, tenant_id, org_ref),
  FOREIGN KEY (org_ref, tenant_id) REFERENCES public.cg_org_unit (id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE public.cg_communication_message (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  org_ref text NOT NULL CHECK (length(org_ref) BETWEEN 1 AND 160),
  conversation_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel = 'whatsapp'),
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status text NOT NULL CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed', 'received')),
  principal_ref text CHECK (principal_ref IS NULL OR length(principal_ref) BETWEEN 1 AND 160),
  provider_ref text CHECK (provider_ref IS NULL OR length(provider_ref) BETWEEN 1 AND 200),
  template_code text CHECK (template_code IS NULL OR length(template_code) BETWEEN 1 AND 160),
  body text NOT NULL CHECK (length(body) <= 4096),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Za-z0-9_.-]{1,32}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (conversation_id, tenant_id, org_ref)
    REFERENCES public.cg_communication_conversation (id, tenant_id, org_ref) ON DELETE CASCADE,
  CHECK (
    (direction = 'inbound' AND status = 'received')
    OR (direction = 'outbound' AND status <> 'received')
  )
);
CREATE UNIQUE INDEX cg_communication_message_provider_ref
  ON public.cg_communication_message (tenant_id, provider_ref)
  WHERE provider_ref IS NOT NULL;
CREATE INDEX cg_communication_message_org_recent
  ON public.cg_communication_message (tenant_id, org_ref, created_at DESC);

CREATE TABLE public.cg_communication_optin (
  tenant_id text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  org_ref text NOT NULL CHECK (length(org_ref) BETWEEN 1 AND 160),
  channel text NOT NULL CHECK (channel = 'whatsapp'),
  address text NOT NULL CHECK (address ~ '^\+[1-9][0-9]{7,14}$'),
  status text NOT NULL CHECK (status IN ('opted_in', 'opted_out')),
  source text NOT NULL CHECK (source IN ('whatsapp_reply', 'authorized_server')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, org_ref, channel, address),
  FOREIGN KEY (org_ref, tenant_id) REFERENCES public.cg_org_unit (id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX cg_communication_recipient_principal
  ON public.cg_communication_recipient_address (tenant_id, org_ref, principal_ref, channel);

ALTER TABLE public.cg_communication_recipient_address ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_communication_recipient_address FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cg_communication_conversation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_communication_conversation FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cg_communication_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_communication_message FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cg_communication_optin ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_communication_optin FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cg_communication_recipient_address, public.cg_communication_conversation,
  public.cg_communication_message, public.cg_communication_optin FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.cg_communication_recipient_address, public.cg_communication_conversation,
  public.cg_communication_message, public.cg_communication_optin TO service_role;

CREATE OR REPLACE FUNCTION public.cg_communication_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_data jsonb := coalesce(to_jsonb(NEW), to_jsonb(OLD));
  v_tenant text := v_data->>'tenant_id';
  v_tenant_uuid uuid;
  v_head public.audit_chain%ROWTYPE;
  v_seq bigint;
  v_prev text;
  v_at timestamptz := date_trunc('milliseconds', clock_timestamp());
  v_target text := coalesce(v_data->>'id', v_data->>'sender_ref', encode(sha256(convert_to(
    coalesce(v_data->>'tenant_id', '') || ':' || coalesce(v_data->>'org_ref', '') || ':' ||
    coalesce(v_data->>'address', ''), 'UTF8')), 'hex'));
  v_before text;
  v_after text;
  v_action text := 'comms.whatsapp.' || TG_TABLE_NAME || '.' || lower(TG_OP);
BEGIN
  IF TG_TABLE_NAME = 'cg_org_communication_sender' AND v_data->>'channel' <> 'whatsapp' THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  BEGIN
    v_tenant_uuid := v_tenant::uuid;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'WhatsApp tenant reference cannot be represented in the audit chain';
  END;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant_uuid::text, 7013));
  SELECT * INTO v_head FROM public.audit_chain
   WHERE org_id = v_tenant_uuid ORDER BY seq DESC LIMIT 1;
  v_seq := coalesce(v_head.seq, 0) + 1;
  v_prev := coalesce(v_head.entry_hash, repeat('0', 64));
  IF TG_OP <> 'INSERT' THEN
    v_before := encode(sha256(convert_to(jsonb_build_object(
      'channel', to_jsonb(OLD)->>'channel',
      'direction', to_jsonb(OLD)->>'direction',
      'status', to_jsonb(OLD)->>'status',
      'principal_ref', to_jsonb(OLD)->>'principal_ref',
      'template_code', to_jsonb(OLD)->>'template_code',
      'error_code', to_jsonb(OLD)->>'error_code',
      'provider', to_jsonb(OLD)->>'provider',
      'provider_sender_ref', to_jsonb(OLD)->>'provider_sender_ref',
      'from_number_hash', encode(sha256(convert_to(coalesce(to_jsonb(OLD)->>'from_number', ''), 'UTF8')), 'hex')
    )::text, 'UTF8')), 'hex');
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_after := encode(sha256(convert_to(jsonb_build_object(
      'channel', to_jsonb(NEW)->>'channel',
      'direction', to_jsonb(NEW)->>'direction',
      'status', to_jsonb(NEW)->>'status',
      'principal_ref', to_jsonb(NEW)->>'principal_ref',
      'template_code', to_jsonb(NEW)->>'template_code',
      'error_code', to_jsonb(NEW)->>'error_code',
      'provider', to_jsonb(NEW)->>'provider',
      'provider_sender_ref', to_jsonb(NEW)->>'provider_sender_ref',
      'from_number_hash', encode(sha256(convert_to(coalesce(to_jsonb(NEW)->>'from_number', ''), 'UTF8')), 'hex')
    )::text, 'UTF8')), 'hex');
  END IF;
  INSERT INTO public.audit_chain (
    org_id, seq, at, actor_kind, actor_id, action, target_type, target_id,
    before_hash, after_hash, prev_hash, entry_hash
  ) VALUES (
    v_tenant_uuid, v_seq, v_at, 'system', 'whatsapp_cloud_gateway', v_action,
    TG_TABLE_NAME, v_target, v_before, v_after, v_prev,
    public.audit_chain_canonical_hash(
      v_prev, v_seq, v_at, v_tenant_uuid, 'system', 'whatsapp_cloud_gateway',
      v_action, TG_TABLE_NAME, v_target, NULL, NULL, v_before, v_after
    )
  );
  RETURN coalesce(NEW, OLD);
END
$$;
REVOKE ALL ON FUNCTION public.cg_communication_audit() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER cg_communication_message_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.cg_communication_message
  FOR EACH ROW EXECUTE FUNCTION public.cg_communication_audit();
CREATE TRIGGER cg_communication_optin_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.cg_communication_optin
  FOR EACH ROW EXECUTE FUNCTION public.cg_communication_audit();
CREATE TRIGGER cg_communication_recipient_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.cg_communication_recipient_address
  FOR EACH ROW EXECUTE FUNCTION public.cg_communication_audit();
CREATE TRIGGER cg_communication_sender_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.cg_org_communication_sender
  FOR EACH ROW EXECUTE FUNCTION public.cg_communication_audit();
CREATE TRIGGER cg_communication_conversation_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.cg_communication_conversation
  FOR EACH ROW EXECUTE FUNCTION public.cg_communication_audit();

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
GRANT EXECUTE ON FUNCTION public.cg_whatsapp_prepare_send(text, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.cg_whatsapp_dispatch_result(
  p_message_id uuid,
  p_status text,
  p_provider_ref text DEFAULT NULL,
  p_error_code text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed: WhatsApp dispatch results require the shared server gateway' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('sent', 'failed')
     OR (p_status = 'sent' AND (p_provider_ref IS NULL OR length(p_provider_ref) NOT BETWEEN 1 AND 200))
     OR (p_status = 'failed' AND p_provider_ref IS NOT NULL)
     OR (p_error_code IS NOT NULL AND p_error_code !~ '^[A-Za-z0-9_.-]{1,32}$') THEN
    RAISE EXCEPTION 'invalid WhatsApp dispatch result';
  END IF;
  UPDATE public.cg_communication_message
     SET status = p_status, provider_ref = p_provider_ref, error_code = p_error_code, updated_at = now()
   WHERE id = p_message_id AND channel = 'whatsapp' AND direction = 'outbound' AND status = 'queued';
  RETURN FOUND;
END
$$;
REVOKE ALL ON FUNCTION public.cg_whatsapp_dispatch_result(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_whatsapp_dispatch_result(uuid, text, text, text) TO service_role;

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
     OR p_from IS NULL OR p_from !~ '^\\+[1-9][0-9]{7,14}$'
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

COMMIT;
