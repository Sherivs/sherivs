-- Hotfix: cg_whatsapp_receive rejected every E.164 sender because the regex had an escaped
-- backslash, which matches a literal backslash under standard_conforming_strings.
-- NOT APPLIED. Additive CREATE OR REPLACE only; cg_whatsapp_status has no phone regex.
-- Also adds a service-role-only admin RPC to map a Meta phone_number_id to an org sender.
-- Rollback: database/supabase/rollbacks/20261101100100_sherivs_whatsapp_receive_phone_regex_fix.sql
BEGIN;

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

CREATE OR REPLACE FUNCTION public.cg_whatsapp_map_sender(
  p_tenant_id text,
  p_org_ref text,
  p_provider_sender_ref text,
  p_from_number text,
  p_credential_ref text DEFAULT 'env://WHATSAPP_ACCESS_TOKEN',
  p_actor_ref text DEFAULT 'platform-admin'
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_sender_ref text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not allowed: sender mapping requires service role' USING ERRCODE = '42501';
  END IF;
  IF p_tenant_id IS NULL OR length(p_tenant_id) NOT BETWEEN 1 AND 128
     OR p_org_ref IS NULL OR length(p_org_ref) NOT BETWEEN 1 AND 160
     OR p_provider_sender_ref IS NULL OR p_provider_sender_ref !~ '^[0-9]{1,160}$'
     OR p_from_number IS NULL OR p_from_number !~ '^\+[1-9][0-9]{7,14}$'
     OR p_credential_ref IS NULL OR p_credential_ref !~ '^env://[A-Z][A-Z0-9_]{2,127}$'
     OR p_actor_ref IS NULL OR length(p_actor_ref) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'invalid WhatsApp sender mapping';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cg_org_unit o
     WHERE o.id = p_org_ref AND o.tenant_id = p_tenant_id AND o.lifecycle_state = 'active'
  ) THEN
    RAISE EXCEPTION 'unknown or inactive organization for sender mapping';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.cg_org_communication_sender s
     WHERE s.provider_sender_ref = p_provider_sender_ref
       AND s.channel = 'whatsapp' AND s.provider = 'meta_cloud' AND s.status = 'active'
       AND (s.tenant_id <> p_tenant_id OR s.org_ref <> p_org_ref)
  ) THEN
    RAISE EXCEPTION 'sender already mapped to a different organization';
  END IF;

  v_sender_ref := 'wa-' || p_provider_sender_ref;
  INSERT INTO public.cg_org_communication_sender
    (sender_ref, tenant_id, org_ref, channel, provider, from_number, credential_ref,
     status, provider_sender_ref, provenance)
  VALUES (v_sender_ref, p_tenant_id, p_org_ref, 'whatsapp', 'meta_cloud', p_from_number,
          p_credential_ref, 'active', p_provider_sender_ref,
          jsonb_build_object('createdBy', p_actor_ref, 'createdAt', now()))
  ON CONFLICT (sender_ref) DO UPDATE
    SET status = 'active', from_number = EXCLUDED.from_number,
        credential_ref = EXCLUDED.credential_ref, updated_at = now()
    WHERE public.cg_org_communication_sender.tenant_id = EXCLUDED.tenant_id
      AND public.cg_org_communication_sender.org_ref = EXCLUDED.org_ref;
  RETURN v_sender_ref;
END
$$;
REVOKE ALL ON FUNCTION public.cg_whatsapp_map_sender(text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_whatsapp_map_sender(text, text, text, text, text, text) TO service_role;

COMMIT;
