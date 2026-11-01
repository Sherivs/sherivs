-- SHERIVS-033: scope-lock the existing communication fabric.
-- Organization IDs are the existing schools IDs in the live V1 identity store.
BEGIN;

ALTER TABLE public.comms_templates
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.schools(id) ON DELETE CASCADE;
ALTER TABLE public.comms_optins
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.schools(id) ON DELETE CASCADE;
ALTER TABLE public.outbound_messages
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS recipient_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS proposal_id uuid,
  ADD COLUMN IF NOT EXISTS template_parameters text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.comms_sender_numbers
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.schools(id) ON DELETE CASCADE;
ALTER TABLE public.inbound_messages
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS sender_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

UPDATE public.comms_templates SET org_id = school_id WHERE org_id IS NULL AND school_id IS NOT NULL;
UPDATE public.comms_optins SET org_id = school_id WHERE org_id IS NULL;
UPDATE public.outbound_messages SET org_id = school_id WHERE org_id IS NULL;
UPDATE public.comms_sender_numbers SET org_id = school_id WHERE org_id IS NULL AND school_id IS NOT NULL;
UPDATE public.inbound_messages SET org_id = school_id WHERE org_id IS NULL AND school_id IS NOT NULL;

ALTER TABLE public.comms_optins ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.outbound_messages ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.comms_sender_numbers ALTER COLUMN school_id DROP NOT NULL;

ALTER TABLE public.comms_templates DROP CONSTRAINT IF EXISTS comms_templates_channel_check;
ALTER TABLE public.comms_templates ADD CONSTRAINT comms_templates_channel_check
  CHECK (channel IN ('sms','whatsapp','email','in_app','voice'));
ALTER TABLE public.comms_optins DROP CONSTRAINT IF EXISTS comms_optins_channel_check;
ALTER TABLE public.comms_optins ADD CONSTRAINT comms_optins_channel_check
  CHECK (channel IN ('sms','whatsapp','voice'));
ALTER TABLE public.outbound_messages DROP CONSTRAINT IF EXISTS outbound_messages_channel_check;
ALTER TABLE public.outbound_messages ADD CONSTRAINT outbound_messages_channel_check
  CHECK (channel IN ('sms','whatsapp','email','in_app','voice'));
ALTER TABLE public.inbound_messages DROP CONSTRAINT IF EXISTS inbound_messages_channel_check;
ALTER TABLE public.inbound_messages ADD CONSTRAINT inbound_messages_channel_check
  CHECK (channel IN ('sms','whatsapp','email','voice','ussd'));

ALTER TABLE public.comms_templates
  ADD CONSTRAINT comms_templates_org_school_match
  CHECK ((school_id IS NULL AND org_id IS NULL) OR org_id = school_id);
ALTER TABLE public.comms_optins
  ADD CONSTRAINT comms_optins_org_school_match CHECK (org_id = school_id);
ALTER TABLE public.outbound_messages
  ADD CONSTRAINT outbound_messages_org_school_match CHECK (org_id = school_id);
ALTER TABLE public.comms_sender_numbers
  ADD CONSTRAINT comms_sender_numbers_org_school_match
  CHECK ((school_id IS NULL AND org_id IS NULL) OR org_id = school_id);
ALTER TABLE public.inbound_messages
  ADD CONSTRAINT inbound_messages_org_school_match
  CHECK (school_id IS NULL OR org_id = school_id) NOT VALID;

CREATE INDEX IF NOT EXISTS outbound_messages_recipient_time
  ON public.outbound_messages (org_id, recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inbound_messages_sender_time
  ON public.inbound_messages (org_id, sender_user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS organization_memberships_org_role_active
  ON public.organization_memberships (school_id, role, user_id)
  WHERE is_active = true;

-- The single Sherivs gateway is registered once, not copied per school.
INSERT INTO public.comms_sender_numbers (school_id, org_id, channel, provider_number, provider)
VALUES (NULL, NULL, 'whatsapp', '+2349015056201', 'meta_cloud:waba:951477341090440')
ON CONFLICT (channel, provider_number) DO UPDATE
  SET school_id = NULL, org_id = NULL, provider = EXCLUDED.provider;

-- Embedded per-organization signup is intentionally unavailable in V1.
INSERT INTO public.feature_flags (key, org_id, enabled, locked, description)
VALUES ('whatsapp_embedded_signup', NULL, false, true,
        'Per-organization WhatsApp numbers are deferred; the shared Sherivs gateway is used.')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.comms_send_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('sms','whatsapp','email','in_app','voice')),
  template_code text NOT NULL,
  language text NOT NULL,
  category text NOT NULL,
  audience_spec jsonb NOT NULL,
  recipient_user_ids uuid[] NOT NULL CHECK (cardinality(recipient_user_ids) > 0),
  template_vars jsonb NOT NULL DEFAULT '{}'::jsonb,
  draft_body text NOT NULL,
  status text NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval','released','rejected')),
  proposed_by uuid NOT NULL REFERENCES public.users(id),
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comms_send_proposals_org_school_match CHECK (org_id = school_id),
  CONSTRAINT comms_send_proposals_approval_pair CHECK
    ((status = 'pending_approval' AND approved_by IS NULL AND approved_at IS NULL)
     OR (status <> 'pending_approval' AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
ALTER TABLE public.outbound_messages
  ADD CONSTRAINT outbound_messages_proposal_fk
  FOREIGN KEY (proposal_id) REFERENCES public.comms_send_proposals(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.comms_conversation_context (
  channel text NOT NULL CHECK (channel = 'whatsapp'),
  gateway_number text NOT NULL,
  sender_phone text NOT NULL,
  sender_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  org_id uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  candidate_org_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  pending_body text,
  pending_provider_ref text,
  state text NOT NULL CHECK (state IN ('select_org','selected')),
  last_inbound_at timestamptz NOT NULL DEFAULT now(),
  session_expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, gateway_number, sender_phone),
  CONSTRAINT comms_conversation_context_selected_org CHECK
    ((state = 'selected' AND org_id IS NOT NULL)
     OR (state = 'select_org' AND org_id IS NULL AND cardinality(candidate_org_ids) > 1))
);

ALTER TABLE public.comms_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comms_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE public.comms_optins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comms_optins FORCE ROW LEVEL SECURITY;
ALTER TABLE public.outbound_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbound_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.comms_sender_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comms_sender_numbers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.comms_send_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comms_send_proposals FORCE ROW LEVEL SECURITY;
ALTER TABLE public.comms_conversation_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comms_conversation_context FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.comms_send_proposals, public.comms_conversation_context
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.comms_send_proposals TO authenticated;
GRANT ALL ON public.comms_send_proposals, public.comms_conversation_context TO service_role;
DROP POLICY IF EXISTS comms_templates_read ON public.comms_templates;
CREATE POLICY comms_templates_read ON public.comms_templates FOR SELECT TO authenticated
  USING (org_id IS NULL OR org_id = public.get_my_school_id());
DROP POLICY IF EXISTS comms_optins_read ON public.comms_optins;
CREATE POLICY comms_optins_read ON public.comms_optins FOR SELECT TO authenticated
  USING (org_id = public.get_my_school_id()
    AND (public.scholar_can(org_id, 'comms.broadcast')
      OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid()
        AND regexp_replace(coalesce(u.phone,''), '\D', '', 'g') =
            regexp_replace(comms_optins.phone, '\D', '', 'g'))));
DROP POLICY IF EXISTS outbound_messages_read ON public.outbound_messages;
CREATE POLICY outbound_messages_read ON public.outbound_messages FOR SELECT TO authenticated
  USING (org_id = public.get_my_school_id()
    AND (recipient_user_id = auth.uid() OR public.scholar_can(org_id, 'comms.broadcast')));
DROP POLICY IF EXISTS inbound_messages_read ON public.inbound_messages;
CREATE POLICY inbound_messages_read ON public.inbound_messages FOR SELECT TO authenticated
  USING (org_id = public.get_my_school_id()
    AND (sender_user_id = auth.uid() OR public.scholar_can(org_id, 'comms.broadcast')));
DROP POLICY IF EXISTS comms_sender_numbers_svc ON public.comms_sender_numbers;
CREATE POLICY comms_sender_numbers_svc ON public.comms_sender_numbers FOR SELECT TO service_role USING (true);
CREATE POLICY comms_send_proposals_read ON public.comms_send_proposals FOR SELECT TO authenticated
  USING (org_id = public.get_my_school_id()
    AND (proposed_by = auth.uid() OR public.scholar_can(org_id, 'comms.broadcast')));

CREATE OR REPLACE FUNCTION public.comms_outbound_recipient_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user public.users%ROWTYPE; v_member boolean;
BEGIN
  IF NEW.org_id IS NULL OR NEW.school_id IS NULL OR NEW.org_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'outbound message organization does not match school' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.recipient_user_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.recipient_user_id IS NULL THEN
    RAISE EXCEPTION 'outbound recipient must resolve to a user in the organization' USING ERRCODE = '23514';
  END IF;
  SELECT u.* INTO v_user FROM public.users u
  WHERE u.id = NEW.recipient_user_id AND coalesce(u.is_active, true);
  SELECT EXISTS (
    SELECT 1 FROM public.organization_memberships m
    WHERE m.user_id = NEW.recipient_user_id AND m.school_id = NEW.org_id AND m.is_active
  ) INTO v_member;
  IF v_user.id IS NULL OR NOT v_member THEN
    RAISE EXCEPTION 'outbound recipient is not an active organization member' USING ERRCODE = '23514';
  END IF;
  IF (NEW.channel = 'in_app' AND NEW.to_address <> NEW.recipient_user_id::text)
     OR (NEW.channel = 'email' AND lower(coalesce(v_user.email,'')) <> lower(NEW.to_address))
     OR (NEW.channel IN ('sms','whatsapp','voice') AND
         regexp_replace(coalesce(v_user.phone,''), '\D', '', 'g') <>
         regexp_replace(NEW.to_address, '\D', '', 'g')) THEN
    RAISE EXCEPTION 'outbound address does not match the organization member' USING ERRCODE = '23514';
  END IF;
  IF NEW.channel IN ('sms','whatsapp','voice') AND NOT EXISTS (
    SELECT 1 FROM auth.users au WHERE au.id = NEW.recipient_user_id
      AND au.phone_confirmed_at IS NOT NULL
      AND regexp_replace(coalesce(au.phone,''), '\D', '', 'g') =
          regexp_replace(coalesce(v_user.phone,''), '\D', '', 'g')
  ) THEN
    RAISE EXCEPTION 'outbound phone is not verified for the organization member' USING ERRCODE = '23514';
  END IF;
  IF NEW.channel = 'email' AND NOT EXISTS (
    SELECT 1 FROM auth.users au WHERE au.id = NEW.recipient_user_id
      AND au.email_confirmed_at IS NOT NULL
      AND lower(coalesce(au.email,'')) = lower(coalesce(v_user.email,''))
  ) THEN
    RAISE EXCEPTION 'outbound email is not verified for the organization member' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS comms_outbound_recipient_guard ON public.outbound_messages;
CREATE TRIGGER comms_outbound_recipient_guard
  BEFORE INSERT OR UPDATE OF org_id, school_id, recipient_user_id, to_address, channel
  ON public.outbound_messages FOR EACH ROW
  EXECUTE FUNCTION public.comms_outbound_recipient_guard();

CREATE OR REPLACE FUNCTION public.comms_inbound_scope_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.org_id IS NULL OR NEW.school_id IS NULL OR NEW.org_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'inbound message requires one organization scope' USING ERRCODE = '23514';
  END IF;
  IF NEW.sender_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.organization_memberships m
    WHERE m.user_id = NEW.sender_user_id AND m.school_id = NEW.org_id AND m.is_active
  ) THEN
    RAISE EXCEPTION 'inbound sender is not an active organization member' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS comms_inbound_scope_guard ON public.inbound_messages;
CREATE TRIGGER comms_inbound_scope_guard
  BEFORE INSERT OR UPDATE OF org_id, school_id, sender_user_id ON public.inbound_messages
  FOR EACH ROW EXECUTE FUNCTION public.comms_inbound_scope_guard();

  CREATE OR REPLACE FUNCTION public.comms_set_optin(
    p_school uuid, p_phone text, p_channel text, p_status text, p_source text
  ) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
  DECLARE v_user uuid;
  BEGIN
    IF p_school IS NULL OR p_channel NOT IN ('sms','whatsapp','voice')
       OR p_status NOT IN ('opted_in','opted_out')
       OR p_source NOT IN ('web_form','paper_signed','whatsapp_reply','sms_reply','admin_entry','admission_form')
       OR p_phone IS NULL OR p_phone !~ '^\+?[0-9]{10,15}$' THEN
      RAISE EXCEPTION 'invalid communication opt-in';
    END IF;
    SELECT u.id INTO v_user FROM public.users u
    JOIN public.organization_memberships m
      ON m.user_id = u.id AND m.school_id = p_school AND m.is_active
    WHERE coalesce(u.is_active, true)
      AND regexp_replace(coalesce(u.phone,''), '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g')
    ORDER BY u.id LIMIT 1;
    IF NOT (coalesce(auth.role(), '') = 'service_role'
      OR public.scholar_can(p_school, 'comms.send_class')
      OR (v_user = auth.uid() AND public.get_my_school_id() = p_school)) THEN
      RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
    END IF;
    IF v_user IS NULL THEN RAISE EXCEPTION 'phone is not a member contact in this organization' USING ERRCODE = '23514'; END IF;
    INSERT INTO public.comms_optins (school_id, org_id, phone, channel, status, source, captured_by)
    VALUES (p_school, p_school, p_phone, p_channel, p_status, p_source, auth.uid())
    ON CONFLICT (school_id, phone, channel) DO UPDATE
      SET org_id = EXCLUDED.org_id, status = EXCLUDED.status, source = EXCLUDED.source,
          captured_by = EXCLUDED.captured_by, updated_at = now();
  END $$;

CREATE OR REPLACE FUNCTION public.comms_audit_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j jsonb := to_jsonb(coalesce(NEW, OLD)); v_org uuid; v_id uuid; v_actor uuid := auth.uid();
BEGIN
  v_org := coalesce((j->>'org_id')::uuid, (j->>'school_id')::uuid);
  IF v_org IS NULL OR NOT EXISTS (SELECT 1 FROM public.schools WHERE id = v_org) THEN RETURN NULL; END IF;
  BEGIN v_id := (j->>'id')::uuid; EXCEPTION WHEN others THEN v_id := NULL; END;
  INSERT INTO public.audit_logs (school_id, user_id, action, table_name, record_id, old_value, new_value)
  VALUES (v_org, CASE WHEN EXISTS (SELECT 1 FROM public.users WHERE id = v_actor) THEN v_actor END,
    'comms.' || TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME, v_id,
    CASE WHEN TG_OP <> 'INSERT' THEN jsonb_build_object('status', to_jsonb(OLD)->>'status') END,
    jsonb_build_object('channel', j->>'channel', 'status', j->>'status',
      'template_code', j->>'template_code', 'recipient_user_id', j->>'recipient_user_id',
      'action', j->>'action', 'proposal_id', j->>'proposal_id'));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.comms_outbound_recipient_guard(), public.comms_inbound_scope_guard(),
  public.comms_audit_event()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_comms_optins_audit ON public.comms_optins;

CREATE OR REPLACE FUNCTION public.comms_send(
  p_school uuid, p_channel text, p_to text, p_template text, p_vars jsonb DEFAULT '{}'::jsonb,
  p_student uuid DEFAULT NULL, p_priority text DEFAULT 'normal', p_reference text DEFAULT NULL,
  p_language text DEFAULT 'en'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tpl public.comms_templates; v_body text; v_ref text := coalesce(p_reference, gen_random_uuid()::text);
  v_status text; v_seg int := 1; v_item text; v_cost numeric := 0; v_opt text;
  v_id uuid; v_err text; m jsonb; v_live boolean; v_recipients uuid[];
  v_org_name text; v_vars jsonb; v_template_parameters text[];
BEGIN
  IF NOT (coalesce(auth.role(), '') = 'service_role'
    OR public.scholar_can(p_school, 'comms.send_class')
    OR public.scholar_can(p_school, 'comms.broadcast')) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO tpl FROM public.comms_templates t
  WHERE t.code = p_template AND t.channel = p_channel AND t.status = 'approved'
    AND (t.org_id = p_school OR t.org_id IS NULL)
  ORDER BY (t.language = p_language) DESC, (t.org_id IS NOT NULL) DESC, (t.language = 'en') DESC
  LIMIT 1;
  IF tpl.id IS NULL THEN RAISE EXCEPTION 'no approved % template %', p_channel, p_template; END IF;
  IF p_channel = 'whatsapp' AND (tpl.wa_template_name IS NULL OR tpl.body NOT LIKE '%{{school}}%') THEN
    RAISE EXCEPTION 'WhatsApp template must be approved and include the organization name';
  END IF;
  IF tpl.category = 'marketing' AND NOT public.scholar_can(p_school, 'comms.broadcast') THEN
    RAISE EXCEPTION 'not allowed: marketing needs comms.broadcast' USING ERRCODE = '42501';
  END IF;
  IF p_priority = 'safety' AND tpl.category NOT IN ('safety', 'authentication') THEN p_priority := 'normal'; END IF;
  IF p_student IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.students WHERE id = p_student AND school_id = p_school
  ) THEN RAISE EXCEPTION 'student not in this school'; END IF;
  IF EXISTS (SELECT 1 FROM public.outbound_messages WHERE org_id = p_school AND reference = v_ref) THEN
    SELECT jsonb_build_object('id', id, 'status', status, 'replay', true)
      INTO m FROM public.outbound_messages WHERE org_id = p_school AND reference = v_ref;
    RETURN m;
  END IF;

  SELECT array_agg(DISTINCT u.id) INTO v_recipients
  FROM public.users u
  JOIN public.organization_memberships om ON om.user_id = u.id AND om.school_id = p_school AND om.is_active
  JOIN auth.users au ON au.id = u.id
  WHERE coalesce(u.is_active, true)
    AND ((p_channel = 'in_app' AND u.id::text = p_to)
      OR (p_channel = 'email' AND lower(coalesce(u.email,'')) = lower(p_to)
          AND lower(coalesce(au.email,'')) = lower(coalesce(u.email,'')) AND au.email_confirmed_at IS NOT NULL)
      OR (p_channel IN ('sms','whatsapp','voice')
          AND regexp_replace(coalesce(u.phone,''), '\D', '', 'g') = regexp_replace(p_to, '\D', '', 'g')
          AND regexp_replace(coalesce(au.phone,''), '\D', '', 'g') = regexp_replace(coalesce(u.phone,''), '\D', '', 'g')
          AND au.phone_confirmed_at IS NOT NULL));
  IF coalesce(cardinality(v_recipients), 0) <> 1 THEN
    RAISE EXCEPTION 'recipient must resolve to exactly one verified contact in this organization' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.comms_send_proposals p
    WHERE p.org_id = p_school AND p.status = 'released' AND p.channel = p_channel
      AND p.template_code = p_template
      AND p.id::text || ':' || v_recipients[1]::text = v_ref
      AND v_recipients[1] = ANY(p.recipient_user_ids)) THEN
    RAISE EXCEPTION 'every outbound message must originate from an approved organization proposal'
      USING ERRCODE = '42501';
  END IF;
  IF p_channel IN ('sms','whatsapp','email','voice') THEN
    SELECT status INTO v_opt FROM public.comms_optins
    WHERE org_id = p_school AND regexp_replace(phone, '\D', '', 'g') = regexp_replace(p_to, '\D', '', 'g')
      AND channel = p_channel;
  END IF;
  v_org_name := (SELECT name FROM public.schools WHERE id = p_school);
  v_vars := coalesce(p_vars, '{}'::jsonb) || jsonb_build_object('school', v_org_name);
  v_body := public.comms_render(tpl.body, v_vars);
  SELECT coalesce(array_agg(left(coalesce(v_vars->>x.matches[1], ''), 200) ORDER BY x.ordinality), ARRAY[]::text[])
    INTO v_template_parameters
  FROM regexp_matches(tpl.body, '\{\{([a-z_]+)\}\}', 'g') WITH ORDINALITY AS x(matches, ordinality);
  IF p_channel = 'sms' THEN
    v_seg := greatest(1, ceil(length(v_body) / 160.0)::int); v_item := 'sms';
  ELSIF p_channel = 'whatsapp' THEN
    v_item := CASE WHEN tpl.category = 'marketing' THEN 'whatsapp_marketing' ELSE 'whatsapp_utility' END;
  END IF;
  IF p_priority <> 'safety' AND (v_opt = 'opted_out'
      OR (p_channel = 'whatsapp' OR tpl.category = 'marketing')
        AND v_opt IS DISTINCT FROM 'opted_in') THEN
    v_status := 'blocked_optout';
  ELSE
    BEGIN
      IF v_item IS NOT NULL THEN
        m := public.meter_usage(p_school, v_item, v_seg, 'msg:' || v_ref, p_student, p_priority);
        v_cost := coalesce((m->>'charged')::numeric, 0);
      END IF;
      v_live := p_channel = 'in_app' OR public.flag_on(p_channel || '_live', p_school);
      v_status := CASE WHEN p_channel = 'in_app' THEN 'sent'
        WHEN v_live THEN 'queued' ELSE 'sent_stub' END;
    EXCEPTION WHEN others THEN
      v_err := SQLERRM;
      v_status := CASE WHEN v_err LIKE 'insufficient_wallet%' THEN 'blocked_wallet'
        WHEN v_err LIKE 'daily_cap%' THEN 'blocked_cap' ELSE NULL END;
      IF v_status IS NULL THEN RAISE; END IF;
    END;
  END IF;
  INSERT INTO public.outbound_messages
    (school_id, org_id, recipient_user_id, channel, to_address, template_code, template_parameters, language, category,
     body, priority, status, provider, segments, cost, student_id, reference, error, created_by)
  VALUES (p_school, p_school, v_recipients[1], p_channel, p_to, p_template, v_template_parameters, tpl.language, tpl.category,
    v_body, p_priority, v_status,
    CASE WHEN v_status = 'queued' THEN CASE p_channel WHEN 'whatsapp' THEN 'meta_cloud'
      WHEN 'sms' THEN 'bulksmsnigeria' ELSE p_channel END ELSE 'stub' END,
    v_seg, v_cost, p_student, v_ref, v_err, auth.uid()) RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'status', v_status, 'segments', v_seg,
    'cost', v_cost, 'language', tpl.language);
END $$;

CREATE OR REPLACE FUNCTION public.comms_propose_send(
  p_org uuid, p_channel text, p_audience jsonb, p_template text,
  p_vars jsonb DEFAULT '{}'::jsonb, p_language text DEFAULT 'en'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_kind text := p_audience->>'kind'; v_user uuid; v_class uuid; v_student uuid;
  v_ids uuid[]; v_template public.comms_templates; v_preview text; v_org_name text; v_id uuid;
BEGIN
  IF auth.role() <> 'authenticated' OR auth.uid() IS NULL OR NOT (public.scholar_can(p_org, 'comms.send_class')
    OR public.scholar_can(p_org, 'comms.broadcast')) THEN
    RAISE EXCEPTION 'not allowed to propose communication' USING ERRCODE = '42501';
  END IF;
  IF octet_length(coalesce(p_audience, '{}'::jsonb)::text) > 2048
     OR octet_length(coalesce(p_vars, '{}'::jsonb)::text) > 8192 THEN
    RAISE EXCEPTION 'communication proposal is too large';
  END IF;
  IF v_kind NOT IN ('user','class','role','guardian_of_student') THEN
    RAISE EXCEPTION 'unsupported communication audience';
  END IF;
  BEGIN
    IF v_kind = 'user' THEN v_user := (p_audience->>'user_id')::uuid; END IF;
    IF v_kind = 'class' THEN v_class := (p_audience->>'class_id')::uuid; END IF;
    IF v_kind = 'guardian_of_student' THEN v_student := (p_audience->>'student_id')::uuid; END IF;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid communication audience identifier'; END;
  SELECT * INTO v_template FROM public.comms_templates t
  WHERE t.code = p_template AND t.channel = p_channel AND t.status = 'approved'
    AND (t.org_id = p_org OR t.org_id IS NULL)
    AND (t.language = p_language OR t.language = 'en')
  ORDER BY (t.org_id IS NOT NULL) DESC, (t.language = p_language) DESC LIMIT 1;
  IF v_template.id IS NULL THEN RAISE EXCEPTION 'no approved template for this organization and channel'; END IF;
  IF v_template.category = 'marketing' AND NOT public.scholar_can(p_org, 'comms.broadcast') THEN
    RAISE EXCEPTION 'marketing communication requires comms.broadcast' USING ERRCODE = '42501';
  END IF;
  IF p_channel = 'whatsapp' AND (v_template.wa_template_name IS NULL OR v_template.body NOT LIKE '%{{school}}%') THEN
    RAISE EXCEPTION 'WhatsApp template must include the organization name';
  END IF;
  SELECT name INTO v_org_name FROM public.schools WHERE id = p_org;
  IF v_org_name IS NULL THEN RAISE EXCEPTION 'unknown organization'; END IF;

  SELECT array_agg(DISTINCT u.id ORDER BY u.id) INTO v_ids
  FROM public.users u
  JOIN public.organization_memberships om
    ON om.user_id = u.id AND om.school_id = p_org AND om.is_active
  JOIN auth.users au ON au.id = u.id
  WHERE coalesce(u.is_active, true)
    AND ((p_channel = 'in_app')
      OR (p_channel = 'email' AND nullif(u.email,'') IS NOT NULL
          AND lower(coalesce(au.email,'')) = lower(u.email) AND au.email_confirmed_at IS NOT NULL)
      OR (p_channel IN ('sms','whatsapp','voice') AND nullif(u.phone,'') IS NOT NULL
          AND regexp_replace(coalesce(au.phone,''), '\D', '', 'g') = regexp_replace(u.phone, '\D', '', 'g')
          AND au.phone_confirmed_at IS NOT NULL))
    AND CASE v_kind
      WHEN 'user' THEN u.id = v_user
      WHEN 'role' THEN om.role = p_audience->>'role'
      WHEN 'class' THEN EXISTS (
        SELECT 1 FROM public.students s WHERE s.school_id = p_org AND s.class_id = v_class
          AND (s.user_id = u.id OR s.parent_id = u.id OR EXISTS (
            SELECT 1 FROM public.parent_student_map pm
            WHERE pm.school_id = p_org AND pm.student_id = s.id AND pm.parent_id = u.id)))
      WHEN 'guardian_of_student' THEN EXISTS (
        SELECT 1 FROM public.students s WHERE s.school_id = p_org AND s.id = v_student
          AND (s.parent_id = u.id OR EXISTS (
            SELECT 1 FROM public.parent_student_map pm
            WHERE pm.school_id = p_org AND pm.student_id = s.id AND pm.parent_id = u.id)))
      ELSE false END;
  IF coalesce(cardinality(v_ids), 0) = 0 THEN
    RAISE EXCEPTION 'audience has no verified contacts in this organization';
  END IF;
  v_preview := public.comms_render(v_template.body,
    coalesce(p_vars, '{}'::jsonb) || jsonb_build_object('school', v_org_name));
  INSERT INTO public.comms_send_proposals
    (org_id, school_id, channel, template_code, language, category, audience_spec,
     recipient_user_ids, template_vars, draft_body, proposed_by)
  VALUES (p_org, p_org, p_channel, p_template, v_template.language, v_template.category,
    p_audience, v_ids, coalesce(p_vars, '{}'::jsonb), v_preview, auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('proposal_id', v_id, 'recipient_count', cardinality(v_ids),
    'status', 'pending_approval');
END $$;

CREATE OR REPLACE FUNCTION public.comms_approve_send(p_org uuid, p_proposal uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.comms_send_proposals%ROWTYPE; v_user uuid; v_to text; v_result jsonb; v_count int := 0;
BEGIN
  IF auth.role() <> 'authenticated' OR auth.uid() IS NULL OR NOT public.scholar_can(p_org, 'comms.broadcast') THEN
    RAISE EXCEPTION 'only an authorized organization approver may release a proposal' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.comms_send_proposals
  WHERE id = p_proposal AND org_id = p_org FOR UPDATE;
  IF v.id IS NOT NULL AND v.status = 'released' THEN
    RETURN jsonb_build_object('proposal_id', v.id,
      'released_count', (SELECT count(*) FROM public.outbound_messages WHERE proposal_id = v.id),
      'status', 'released', 'replay', true);
  END IF;
  IF v.id IS NULL OR v.status <> 'pending_approval' THEN RAISE EXCEPTION 'proposal is unavailable'; END IF;
  IF v.proposed_by = auth.uid() THEN RAISE EXCEPTION 'proposal must be approved by a different human'; END IF;
  UPDATE public.comms_send_proposals SET status = 'released', approved_by = auth.uid(),
    approved_at = now(), released_at = now() WHERE id = v.id;
  FOREACH v_user IN ARRAY v.recipient_user_ids LOOP
    SELECT CASE WHEN v.channel = 'email' THEN u.email
      WHEN v.channel = 'in_app' THEN u.id::text ELSE u.phone END
      INTO v_to
    FROM public.users u
    JOIN public.organization_memberships om
      ON om.user_id = u.id AND om.school_id = p_org AND om.is_active
    JOIN auth.users au ON au.id = u.id
    WHERE u.id = v_user AND coalesce(u.is_active, true)
      AND ((v.channel = 'in_app')
        OR (v.channel = 'email' AND lower(coalesce(au.email,'')) = lower(coalesce(u.email,'')) AND au.email_confirmed_at IS NOT NULL)
        OR (v.channel IN ('sms','whatsapp','voice')
          AND regexp_replace(coalesce(au.phone,''), '\D', '', 'g') = regexp_replace(coalesce(u.phone,''), '\D', '', 'g')
          AND au.phone_confirmed_at IS NOT NULL));
    IF v_to IS NULL THEN RAISE EXCEPTION 'recipient is no longer an active, verified organization member'; END IF;
    v_result := public.comms_send(p_org, v.channel, v_to, v.template_code, v.template_vars,
      NULL, CASE WHEN v.category = 'safety' THEN 'safety' ELSE 'normal' END,
      v.id::text || ':' || v_user::text, v.language);
    UPDATE public.outbound_messages SET proposal_id = v.id
      WHERE id = (v_result->>'id')::uuid AND org_id = p_org AND recipient_user_id = v_user;
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('proposal_id', v.id, 'released_count', v_count, 'status', 'released');
END $$;

CREATE OR REPLACE FUNCTION public.comms_reject_send(p_org uuid, p_proposal uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.comms_send_proposals%ROWTYPE;
BEGIN
  IF auth.role() <> 'authenticated' OR auth.uid() IS NULL OR NOT public.scholar_can(p_org, 'comms.broadcast') THEN
    RAISE EXCEPTION 'only an authorized organization approver may reject a proposal' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.comms_send_proposals
    WHERE id = p_proposal AND org_id = p_org FOR UPDATE;
  IF v.id IS NULL OR v.status <> 'pending_approval' THEN RAISE EXCEPTION 'proposal is unavailable'; END IF;
  IF v.proposed_by = auth.uid() THEN RAISE EXCEPTION 'proposal must be rejected by a different human'; END IF;
  UPDATE public.comms_send_proposals SET status = 'rejected', approved_by = auth.uid(),
    approved_at = now() WHERE id = v.id;
END $$;

CREATE OR REPLACE FUNCTION public.comms_inbound(
  p_school uuid, p_channel text, p_from text, p_body text, p_provider_ref text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_action text := 'logged'; v_user uuid; kw text := upper(trim(coalesce(p_body, '')));
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed: inbound is accepted from the verified provider webhook only' USING ERRCODE = '42501';
  END IF;
  IF p_school IS NULL OR p_channel NOT IN ('sms','whatsapp','voice')
     OR p_from IS NULL OR p_provider_ref IS NULL THEN
    RAISE EXCEPTION 'inbound message requires an organization, sender and provider reference';
  END IF;
  IF EXISTS (SELECT 1 FROM public.inbound_messages WHERE channel = p_channel AND provider_ref = p_provider_ref) THEN
    SELECT action INTO v_action FROM public.inbound_messages
      WHERE channel = p_channel AND provider_ref = p_provider_ref;
    RETURN coalesce(v_action, 'logged');
  END IF;
  SELECT u.id INTO v_user FROM public.users u
  JOIN public.organization_memberships m
    ON m.user_id = u.id AND m.school_id = p_school AND m.is_active
  WHERE coalesce(u.is_active, true)
    AND regexp_replace(coalesce(u.phone,''), '\D', '', 'g') = regexp_replace(p_from, '\D', '', 'g')
    AND EXISTS (SELECT 1 FROM auth.users au WHERE au.id = u.id AND au.phone_confirmed_at IS NOT NULL
      AND regexp_replace(coalesce(au.phone,''), '\D', '', 'g') = regexp_replace(coalesce(u.phone,''), '\D', '', 'g'))
  ORDER BY u.id LIMIT 1;
  IF kw IN ('STOP','UNSUBSCRIBE','END','DAINA','DURO','KWUSI') THEN
    INSERT INTO public.comms_optins (school_id, org_id, phone, channel, status, source)
    VALUES (p_school, p_school, p_from, CASE WHEN p_channel = 'whatsapp' THEN 'whatsapp' ELSE 'sms' END,
      'opted_out', CASE WHEN p_channel = 'whatsapp' THEN 'whatsapp_reply' ELSE 'sms_reply' END)
    ON CONFLICT (school_id, phone, channel) DO UPDATE
      SET org_id = EXCLUDED.org_id, status = 'opted_out', source = EXCLUDED.source, updated_at = now();
    v_action := 'opted_out';
  ELSIF kw IN ('START','YES','JOIN') THEN
    INSERT INTO public.comms_optins (school_id, org_id, phone, channel, status, source)
    VALUES (p_school, p_school, p_from, CASE WHEN p_channel = 'whatsapp' THEN 'whatsapp' ELSE 'sms' END,
      'opted_in', CASE WHEN p_channel = 'whatsapp' THEN 'whatsapp_reply' ELSE 'sms_reply' END)
    ON CONFLICT (school_id, phone, channel) DO UPDATE
      SET org_id = EXCLUDED.org_id, status = 'opted_in', source = EXCLUDED.source, updated_at = now();
    v_action := 'opted_in';
  END IF;
  INSERT INTO public.inbound_messages
    (school_id, org_id, sender_user_id, channel, from_address, body, provider_ref, action)
  VALUES (p_school, p_school, v_user, p_channel, p_from, left(p_body, 2000), p_provider_ref, v_action)
  ON CONFLICT (channel, provider_ref) DO NOTHING;
  RETURN v_action;
END $$;

CREATE OR REPLACE FUNCTION public.comms_route_inbound(
  p_gateway_number text, p_from text, p_body text, p_provider_ref text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_gateway text := regexp_replace(coalesce(p_gateway_number,''), '\D', '', 'g');
  v_from text := regexp_replace(coalesce(p_from,''), '\D', '', 'g');
  v_context public.comms_conversation_context%ROWTYPE;
  v_org_ids uuid[]; v_user_ids uuid[]; v_org uuid; v_user uuid;
  v_choice int; v_options jsonb; v_action text; v_text text := trim(coalesce(p_body,''));
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed: inbound routing is webhook-only' USING ERRCODE = '42501';
  END IF;
  IF v_gateway = '' OR v_from = '' OR p_provider_ref IS NULL THEN
    RAISE EXCEPTION 'inbound gateway, sender and provider reference are required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.comms_sender_numbers s WHERE s.channel = 'whatsapp'
    AND s.org_id IS NULL AND regexp_replace(s.provider_number, '\D', '', 'g') = v_gateway) THEN
    RETURN jsonb_build_object('action','support');
  END IF;

  SELECT * INTO v_context FROM public.comms_conversation_context c
    WHERE c.channel = 'whatsapp' AND c.gateway_number = v_gateway AND c.sender_phone = v_from
    FOR UPDATE;
  IF v_context.channel IS NOT NULL AND (
    v_context.sender_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users u
    JOIN auth.users au ON au.id = u.id
    JOIN public.organization_memberships m
      ON m.user_id = u.id AND m.is_active
    WHERE u.id = v_context.sender_user_id AND coalesce(u.is_active, true)
      AND au.phone_confirmed_at IS NOT NULL
      AND regexp_replace(coalesce(u.phone,''), '\D', '', 'g') = v_from
      AND regexp_replace(coalesce(au.phone,''), '\D', '', 'g') = v_from
      AND ((v_context.state = 'selected' AND m.school_id = v_context.org_id)
        OR (v_context.state = 'select_org' AND m.school_id = ANY(v_context.candidate_org_ids)))
    )
  ) THEN
    DELETE FROM public.comms_conversation_context
      WHERE channel = 'whatsapp' AND gateway_number = v_gateway AND sender_phone = v_from;
    RETURN jsonb_build_object('action','support');
  END IF;
  IF FOUND AND v_context.state = 'select_org' THEN
    BEGIN v_choice := v_text::int; EXCEPTION WHEN others THEN v_choice := NULL; END;
    IF v_choice IS NULL OR v_choice < 1 OR v_choice > cardinality(v_context.candidate_org_ids) THEN
      SELECT jsonb_agg(jsonb_build_object('number', x.ordinality, 'name', s.name) ORDER BY x.ordinality)
        INTO v_options
      FROM unnest(v_context.candidate_org_ids) WITH ORDINALITY AS x(org_id, ordinality)
      JOIN public.schools s ON s.id = x.org_id;
      RETURN jsonb_build_object('action','select_org','options',coalesce(v_options,'[]'::jsonb));
    END IF;
    v_org := v_context.candidate_org_ids[v_choice];
    v_user := v_context.sender_user_id;
    IF NOT EXISTS (SELECT 1 FROM public.organization_memberships m
      WHERE m.user_id = v_user AND m.school_id = v_org AND m.is_active) THEN
      DELETE FROM public.comms_conversation_context
        WHERE channel = 'whatsapp' AND gateway_number = v_gateway AND sender_phone = v_from;
      RETURN jsonb_build_object('action','support');
    END IF;
    UPDATE public.comms_conversation_context SET state = 'selected', org_id = v_org,
      candidate_org_ids = ARRAY[v_org], last_inbound_at = now(),
      session_expires_at = now() + interval '24 hours', updated_at = now()
      WHERE channel = 'whatsapp' AND gateway_number = v_gateway AND sender_phone = v_from;
    IF v_context.pending_provider_ref IS NOT NULL THEN
      v_action := public.comms_inbound(v_org, 'whatsapp', '+' || v_from,
        v_context.pending_body, v_context.pending_provider_ref);
      UPDATE public.comms_conversation_context SET pending_body = NULL, pending_provider_ref = NULL
        WHERE channel = 'whatsapp' AND gateway_number = v_gateway AND sender_phone = v_from;
    END IF;
    RETURN jsonb_build_object('action','org_selected','org_id',v_org);
  END IF;

  IF FOUND AND v_context.state = 'selected'
     AND v_context.session_expires_at > now()
     AND EXISTS (SELECT 1 FROM public.organization_memberships m
       WHERE m.user_id = v_context.sender_user_id AND m.school_id = v_context.org_id AND m.is_active) THEN
    IF upper(v_text) IN ('ORG','ORGANIZATION','SWITCH') THEN
      SELECT array_agg(DISTINCT m.school_id ORDER BY m.school_id)
        INTO v_org_ids FROM public.organization_memberships m
        WHERE m.user_id = v_context.sender_user_id AND m.is_active;
      IF coalesce(cardinality(v_org_ids), 0) < 2 THEN
        RETURN jsonb_build_object('action','routed','org_id',v_context.org_id);
      END IF;
      UPDATE public.comms_conversation_context SET state = 'select_org', org_id = NULL,
        candidate_org_ids = v_org_ids, last_inbound_at = now(),
        session_expires_at = now() + interval '24 hours', updated_at = now()
        WHERE channel = 'whatsapp' AND gateway_number = v_gateway AND sender_phone = v_from;
      SELECT jsonb_agg(jsonb_build_object('number', x.ordinality, 'name', s.name) ORDER BY x.ordinality)
        INTO v_options FROM unnest(v_org_ids) WITH ORDINALITY AS x(org_id, ordinality)
        JOIN public.schools s ON s.id = x.org_id;
      RETURN jsonb_build_object('action','select_org','options',coalesce(v_options,'[]'::jsonb));
    END IF;
    v_action := public.comms_inbound(v_context.org_id, 'whatsapp', '+' || v_from, p_body, p_provider_ref);
    UPDATE public.comms_conversation_context SET last_inbound_at = now(),
      session_expires_at = now() + interval '24 hours', updated_at = now()
      WHERE channel = 'whatsapp' AND gateway_number = v_gateway AND sender_phone = v_from;
    RETURN jsonb_build_object('action','routed','org_id',v_context.org_id,'result',v_action);
  END IF;

  SELECT array_agg(DISTINCT m.school_id ORDER BY m.school_id),
         array_agg(DISTINCT u.id ORDER BY u.id)
    INTO v_org_ids, v_user_ids
  FROM public.users u
  JOIN auth.users au ON au.id = u.id
  JOIN public.organization_memberships m ON m.user_id = u.id AND m.is_active
  WHERE coalesce(u.is_active, true)
    AND regexp_replace(coalesce(u.phone,''), '\D', '', 'g') = v_from
    AND regexp_replace(coalesce(au.phone,''), '\D', '', 'g') = v_from
    AND au.phone_confirmed_at IS NOT NULL;
  IF coalesce(cardinality(v_user_ids), 0) <> 1 OR coalesce(cardinality(v_org_ids), 0) = 0 THEN
    RETURN jsonb_build_object('action','support');
  END IF;
  v_user := v_user_ids[1];
  IF cardinality(v_org_ids) = 1 THEN
    v_org := v_org_ids[1];
    INSERT INTO public.comms_conversation_context
      (channel,gateway_number,sender_phone,sender_user_id,org_id,candidate_org_ids,state)
    VALUES ('whatsapp',v_gateway,v_from,v_user,v_org,ARRAY[v_org],'selected')
    ON CONFLICT (channel,gateway_number,sender_phone) DO UPDATE SET sender_user_id=EXCLUDED.sender_user_id,
      org_id=EXCLUDED.org_id,candidate_org_ids=EXCLUDED.candidate_org_ids,state='selected',
      last_inbound_at=now(),session_expires_at=now()+interval '24 hours',updated_at=now();
    v_action := public.comms_inbound(v_org, 'whatsapp', '+' || v_from, p_body, p_provider_ref);
    RETURN jsonb_build_object('action','routed','org_id',v_org,'result',v_action);
  END IF;
  INSERT INTO public.comms_conversation_context
    (channel,gateway_number,sender_phone,sender_user_id,candidate_org_ids,pending_body,pending_provider_ref,state)
  VALUES ('whatsapp',v_gateway,v_from,v_user,v_org_ids,left(p_body,2000),p_provider_ref,'select_org')
  ON CONFLICT (channel,gateway_number,sender_phone) DO UPDATE SET sender_user_id=EXCLUDED.sender_user_id,
    org_id=NULL,candidate_org_ids=EXCLUDED.candidate_org_ids,pending_body=EXCLUDED.pending_body,
    pending_provider_ref=EXCLUDED.pending_provider_ref,state='select_org',last_inbound_at=now(),
    session_expires_at=now()+interval '24 hours',updated_at=now();
  SELECT jsonb_agg(jsonb_build_object('number', x.ordinality, 'name', s.name) ORDER BY x.ordinality)
    INTO v_options FROM unnest(v_org_ids) WITH ORDINALITY AS x(org_id, ordinality)
    JOIN public.schools s ON s.id = x.org_id;
  RETURN jsonb_build_object('action','select_org','options',coalesce(v_options,'[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.comms_audit_gateway_message(
  p_gateway_number text, p_from text, p_provider_ref text, p_event text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_context public.comms_conversation_context%ROWTYPE; v_org uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed: gateway audit is webhook-only' USING ERRCODE = '42501';
  END IF;
  IF p_event NOT IN ('routing_prompt_sent','support_response_sent') OR p_provider_ref IS NULL THEN
    RAISE EXCEPTION 'invalid gateway audit event';
  END IF;
  SELECT * INTO v_context FROM public.comms_conversation_context
    WHERE channel = 'whatsapp'
      AND regexp_replace(gateway_number, '\D', '', 'g') = regexp_replace(coalesce(p_gateway_number,''), '\D', '', 'g')
      AND sender_phone = regexp_replace(coalesce(p_from,''), '\D', '', 'g');
  IF NOT FOUND THEN RETURN; END IF;
  FOREACH v_org IN ARRAY CASE WHEN v_context.org_id IS NOT NULL
    THEN ARRAY[v_context.org_id] ELSE v_context.candidate_org_ids END LOOP
    INSERT INTO public.audit_logs (school_id, user_id, action, table_name, record_id, new_value)
    VALUES (v_org, NULL, 'comms.whatsapp.' || p_event, 'comms_conversation_context',
      gen_random_uuid(), jsonb_build_object('provider_ref', left(p_provider_ref, 200)));
  END LOOP;
END $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['comms_optins','outbound_messages','inbound_messages','comms_send_proposals'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_comms_audit ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_comms_audit AFTER INSERT OR UPDATE ON public.%1$I '
      'FOR EACH ROW EXECUTE FUNCTION public.comms_audit_event()', t);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.comms_send(uuid,text,text,text,jsonb,uuid,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comms_send(uuid,text,text,text,jsonb,uuid,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.comms_route_inbound(text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comms_route_inbound(text,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.comms_audit_gateway_message(text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comms_audit_gateway_message(text,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.comms_propose_send(uuid,text,jsonb,text,jsonb,text),
  public.comms_approve_send(uuid,uuid), public.comms_reject_send(uuid,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comms_propose_send(uuid,text,jsonb,text,jsonb,text),
  public.comms_approve_send(uuid,uuid), public.comms_reject_send(uuid,uuid)
  TO authenticated;

COMMIT;
