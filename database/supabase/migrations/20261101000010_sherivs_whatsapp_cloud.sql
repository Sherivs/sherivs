-- WhatsApp Cloud API support for the V1 organizational communication fabric.
-- NOT APPLIED. Draft migration only; tenant ownership remains schools.id.
-- Rollback: database/supabase/rollbacks/20261101000010_sherivs_whatsapp_cloud.sql
BEGIN;

CREATE TABLE public.comms_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel = 'whatsapp'),
  phone text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, channel, phone),
  UNIQUE (school_id, id)
);

ALTER TABLE public.inbound_messages
  ADD COLUMN user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN conversation_id uuid;
ALTER TABLE public.outbound_messages
  ADD COLUMN user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN conversation_id uuid;
ALTER TABLE public.inbound_messages
  ADD CONSTRAINT inbound_messages_conversation_org_fk
  FOREIGN KEY (school_id, conversation_id) REFERENCES public.comms_conversations(school_id, id) ON DELETE CASCADE;
ALTER TABLE public.outbound_messages
  ADD CONSTRAINT outbound_messages_conversation_org_fk
  FOREIGN KEY (school_id, conversation_id) REFERENCES public.comms_conversations(school_id, id) ON DELETE CASCADE;

CREATE INDEX comms_conversations_user_idx ON public.comms_conversations (school_id, user_id, updated_at DESC);
CREATE INDEX inbound_messages_user_idx ON public.inbound_messages (school_id, user_id, received_at DESC);
CREATE INDEX outbound_messages_user_idx ON public.outbound_messages (school_id, user_id, created_at DESC);

ALTER TABLE public.outbound_messages DROP CONSTRAINT IF EXISTS outbound_messages_status_check;
ALTER TABLE public.outbound_messages
  ADD CONSTRAINT outbound_messages_status_check
  CHECK (status IN ('queued','sent_stub','sent','delivered','read','failed','blocked_optout','blocked_wallet','blocked_cap'));

ALTER TABLE public.comms_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comms_conversations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.comms_conversations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.comms_conversations TO authenticated;
GRANT ALL ON public.comms_conversations TO service_role;
CREATE POLICY comms_conversations_read ON public.comms_conversations FOR SELECT TO authenticated
  USING (public.scholar_can(school_id, 'comms.broadcast') OR user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.comms_whatsapp_map_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_channel text := v_row->>'channel';
  v_school uuid := (v_row->>'school_id')::uuid;
  v_phone text := coalesce(v_row->>'to_address', v_row->>'from_address');
  v_digits text := regexp_replace(coalesce(v_phone, ''), '\D', '', 'g');
  v_user_count integer;
  v_user uuid;
  v_conversation uuid;
BEGIN
  IF v_channel <> 'whatsapp' OR length(v_digits) NOT BETWEEN 8 AND 15 THEN RETURN NEW; END IF;

  SELECT count(*)::integer INTO v_user_count
    FROM public.users u
   WHERE u.school_id = v_school
     AND regexp_replace(coalesce(u.phone, ''), '\D', '', 'g') = v_digits;
  IF v_user_count = 1 THEN
    SELECT u.id INTO v_user
      FROM public.users u
     WHERE u.school_id = v_school
       AND regexp_replace(coalesce(u.phone, ''), '\D', '', 'g') = v_digits;
  END IF;

  INSERT INTO public.comms_conversations (school_id, channel, phone, user_id)
  VALUES (v_school, 'whatsapp', '+' || v_digits, v_user)
  ON CONFLICT (school_id, channel, phone) DO UPDATE
    SET user_id = coalesce(public.comms_conversations.user_id, EXCLUDED.user_id),
        updated_at = now()
  RETURNING id INTO v_conversation;

  SELECT c.user_id INTO v_user FROM public.comms_conversations c WHERE c.id = v_conversation;
  NEW := jsonb_populate_record(
    NEW,
    jsonb_build_object('user_id', v_user, 'conversation_id', v_conversation)
  );
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.comms_whatsapp_map_message() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.comms_whatsapp_sender_school(p_phone text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_schools integer;
  v_school uuid;
BEGIN
  IF length(v_digits) NOT BETWEEN 8 AND 15 THEN RETURN NULL; END IF;
  SELECT count(DISTINCT s.school_id)::integer INTO v_schools
    FROM public.comms_sender_numbers s
   WHERE s.channel = 'whatsapp'
     AND regexp_replace(s.provider_number, '\D', '', 'g') = v_digits;
  IF v_schools <> 1 THEN RETURN NULL; END IF;
  SELECT DISTINCT s.school_id INTO v_school
    FROM public.comms_sender_numbers s
   WHERE s.channel = 'whatsapp'
     AND regexp_replace(s.provider_number, '\D', '', 'g') = v_digits;
  RETURN v_school;
END
$$;
REVOKE ALL ON FUNCTION public.comms_whatsapp_sender_school(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comms_whatsapp_sender_school(text) TO service_role;

DROP TRIGGER IF EXISTS trg_inbound_whatsapp_conversation ON public.inbound_messages;
CREATE TRIGGER trg_inbound_whatsapp_conversation BEFORE INSERT ON public.inbound_messages
  FOR EACH ROW EXECUTE FUNCTION public.comms_whatsapp_map_message();
DROP TRIGGER IF EXISTS trg_outbound_whatsapp_conversation ON public.outbound_messages;
CREATE TRIGGER trg_outbound_whatsapp_conversation BEFORE INSERT ON public.outbound_messages
  FOR EACH ROW EXECUTE FUNCTION public.comms_whatsapp_map_message();

CREATE OR REPLACE FUNCTION public.comms_whatsapp_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_row jsonb := to_jsonb(coalesce(NEW, OLD));
  v_org uuid := (v_row->>'school_id')::uuid;
  v_id uuid;
  v_actor uuid := auth.uid();
  v_action text := left('comms.whatsapp.' || TG_TABLE_NAME || '.' || lower(TG_OP), 100);
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF v_org IS NULL OR NOT EXISTS (SELECT 1 FROM public.schools WHERE id = v_org) THEN RETURN NULL; END IF;
  BEGIN v_id := (v_row->>'id')::uuid; EXCEPTION WHEN others THEN v_id := NULL; END;
  IF TG_OP <> 'INSERT' THEN
    v_before := jsonb_strip_nulls(jsonb_build_object(
      'channel', to_jsonb(OLD)->>'channel',
      'status', to_jsonb(OLD)->>'status',
      'action', to_jsonb(OLD)->>'action',
      'template_code', to_jsonb(OLD)->>'template_code',
      'conversation_id', to_jsonb(OLD)->>'conversation_id',
      'user_id', to_jsonb(OLD)->>'user_id'
    ));
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_after := jsonb_strip_nulls(jsonb_build_object(
      'channel', to_jsonb(NEW)->>'channel',
      'status', to_jsonb(NEW)->>'status',
      'action', to_jsonb(NEW)->>'action',
      'template_code', to_jsonb(NEW)->>'template_code',
      'conversation_id', to_jsonb(NEW)->>'conversation_id',
      'user_id', to_jsonb(NEW)->>'user_id'
    ));
  END IF;
  INSERT INTO public.audit_logs (school_id, user_id, action, table_name, record_id, old_value, new_value)
  VALUES (
    v_org,
    CASE WHEN EXISTS (SELECT 1 FROM public.users WHERE id = v_actor) THEN v_actor END,
    v_action,
    TG_TABLE_NAME,
    v_id,
    v_before,
    v_after
  );
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.comms_whatsapp_audit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_inbound_messages_whatsapp_audit ON public.inbound_messages;
CREATE TRIGGER trg_inbound_messages_whatsapp_audit AFTER INSERT OR UPDATE ON public.inbound_messages
  FOR EACH ROW EXECUTE FUNCTION public.comms_whatsapp_audit();
DROP TRIGGER IF EXISTS trg_outbound_messages_whatsapp_audit ON public.outbound_messages;
CREATE TRIGGER trg_outbound_messages_whatsapp_audit AFTER INSERT OR UPDATE ON public.outbound_messages
  FOR EACH ROW EXECUTE FUNCTION public.comms_whatsapp_audit();

CREATE OR REPLACE FUNCTION public.comms_whatsapp_status(
  p_school uuid,
  p_provider_ref text,
  p_status text,
  p_error_code text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
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

  SELECT m.status INTO v_current
    FROM public.outbound_messages m
   WHERE m.school_id = p_school AND m.channel = 'whatsapp' AND m.provider_ref = p_provider_ref
   FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF NOT (
    v_current = 'queued'
    OR (v_current = 'sent' AND p_status IN ('delivered', 'read', 'failed'))
    OR (v_current = 'delivered' AND p_status IN ('read', 'failed'))
  ) THEN
    RETURN true;
  END IF;

  UPDATE public.outbound_messages
     SET status = p_status,
         error = CASE WHEN p_status = 'failed' THEN 'meta_error_code:' || coalesce(p_error_code, 'unknown') ELSE error END,
         updated_at = now()
   WHERE school_id = p_school AND channel = 'whatsapp' AND provider_ref = p_provider_ref;
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION public.comms_whatsapp_status(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comms_whatsapp_status(uuid, text, text, text) TO service_role;

COMMIT;
