-- WhatsApp n8n RPC 42702 ambiguity fix (LOCAL, DISPOSABLE ONLY).
-- Run only after replaying repository migrations on a loopback disposable DB:
--   psql "postgresql://postgres@127.0.0.1:<port>/<disposable_db>" \
--     -v ON_ERROR_STOP=1 -f tests/integration/whatsapp-n8n-ambiguity-fix.local.sql
-- This transaction is rolled back; it never applies migrations or uses a live DB.
BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'WA-FIX: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NOT NULL
     AND NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet)
     AND coalesce(current_setting('wafix.allow_non_loopback', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'WA-FIX: refusing non-loopback server address %', inet_server_addr();
  END IF;
  IF current_database() !~* '(disposable|scratch|local|test|sim|postgres|wa_fix)' THEN
    RAISE EXCEPTION 'WA-FIX: refusing database %, not a named disposable DB', current_database();
  END IF;
  IF to_regprocedure('public.cg_whatsapp_claim_n8n_outbox(integer)') IS NULL
     OR to_regprocedure('public.cg_whatsapp_prepare_n8n_reply(text,text,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'WA-FIX: WhatsApp n8n migrations are not applied';
  END IF;
  IF (SELECT count(*) FROM public.cg_whatsapp_n8n_outbox) <> 0 THEN
    RAISE EXCEPTION 'WA-FIX: outbox must start empty on a disposable DB';
  END IF;
END
$guard$;

CREATE SCHEMA wafix;
GRANT USAGE ON SCHEMA wafix TO anon, authenticated, service_role;
CREATE FUNCTION wafix.as_role(p_role text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
END $$;
CREATE FUNCTION wafix.expect(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'WA-FIX FAIL: %', p_label; END IF;
  RAISE NOTICE 'WA-FIX PASS: %', p_label;
END $$;
GRANT EXECUTE ON FUNCTION wafix.as_role(text), wafix.expect(text, boolean) TO PUBLIC;

-- Seed rows without FK/trigger side effects; this suite exercises RPC column resolution only.
SET LOCAL session_replication_role = replica;

DO $t$
DECLARE
  v_rows integer;
  v_attempts integer;
  v_status text;
  v_dead integer;
  v_state text;
  v_id uuid := gen_random_uuid();
  v_dead_id uuid := gen_random_uuid();
  v_conv_id uuid := gen_random_uuid();
  v_tenant text;
  v_sender text;
BEGIN
  PERFORM wafix.as_role('service_role');

  -- (a) empty outbox: 0 rows, no 42702
  SELECT count(*) INTO v_rows FROM public.cg_whatsapp_claim_n8n_outbox(20);
  PERFORM wafix.expect('empty outbox claims 0 rows without error', v_rows = 0);

  -- (b) one due pending row is claimed and attempt_count incremented
  RESET ROLE;
  INSERT INTO public.cg_whatsapp_n8n_outbox
    (id, tenant_id, org_ref, conversation_id, message_id, provider_ref, payload, status, attempt_count, next_attempt_at)
  VALUES (v_id, 'wafix-tenant', 'wafix-org', gen_random_uuid(), gen_random_uuid(), 'wamid.wafix.1',
          '{}'::jsonb, 'pending', 0, now() - interval '1 minute');
  PERFORM wafix.as_role('service_role');
  SELECT count(*), max(attempt_count) INTO v_rows, v_attempts
    FROM public.cg_whatsapp_claim_n8n_outbox(20) c WHERE c.outbox_id = v_id;
  PERFORM wafix.expect('due pending row claimed with attempt_count incremented', v_rows = 1 AND v_attempts = 1);
  RESET ROLE;
  SELECT status INTO v_status FROM public.cg_whatsapp_n8n_outbox WHERE id = v_id;
  PERFORM wafix.expect('claimed row is processing', v_status = 'processing');

  -- (c) expired processing row at attempt_count >= 8 goes to the dead letter
  INSERT INTO public.cg_whatsapp_n8n_outbox
    (id, tenant_id, org_ref, conversation_id, message_id, provider_ref, payload, status, attempt_count,
     claim_token, lease_until)
  VALUES (v_dead_id, 'wafix-tenant', 'wafix-org', gen_random_uuid(), gen_random_uuid(), 'wamid.wafix.2',
          '{}'::jsonb, 'processing', 8, gen_random_uuid(), now() - interval '1 minute');
  PERFORM wafix.as_role('service_role');
  PERFORM count(*) FROM public.cg_whatsapp_claim_n8n_outbox(20);
  RESET ROLE;
  SELECT status INTO v_status FROM public.cg_whatsapp_n8n_outbox WHERE id = v_dead_id;
  SELECT count(*) INTO v_dead FROM public.cg_whatsapp_n8n_dead_letter
   WHERE outbox_id = v_dead_id AND tenant_id = 'wafix-tenant' AND attempt_count = 8
     AND error_code = 'retry_exhausted';
  PERFORM wafix.expect('exhausted row marked dead and recorded in dead letter', v_status = 'dead' AND v_dead = 1);

  -- deny for non-service roles (42501)
  FOREACH v_state IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    PERFORM wafix.as_role(v_state);
    BEGIN
      PERFORM * FROM public.cg_whatsapp_claim_n8n_outbox(20);
      RESET ROLE;
      RAISE EXCEPTION 'WA-FIX FAIL: % could claim outbox', v_state;
    EXCEPTION WHEN insufficient_privilege THEN
      RESET ROLE;
      RAISE NOTICE 'WA-FIX PASS: % denied claim (42501)', v_state;
    END;
  END LOOP;
  RESET ROLE;
  PERFORM wafix.expect('anon/authenticated/PUBLIC lack EXECUTE on claim',
    NOT has_function_privilege('anon', 'public.cg_whatsapp_claim_n8n_outbox(integer)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.cg_whatsapp_claim_n8n_outbox(integer)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.cg_whatsapp_claim_n8n_outbox(integer)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.cg_whatsapp_prepare_n8n_reply(text,text,uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.cg_whatsapp_prepare_n8n_reply(text,text,uuid,text)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.cg_whatsapp_prepare_n8n_reply(text,text,uuid,text)', 'EXECUTE'));

  -- prepare_n8n_reply with no seeded data: its own 42501 'unavailable', not 42702
  PERFORM wafix.as_role('service_role');
  BEGIN
    PERFORM * FROM public.cg_whatsapp_prepare_n8n_reply('wafix-reply', 'wamid.missing', gen_random_uuid(), 'hello');
    RESET ROLE;
    RAISE EXCEPTION 'WA-FIX FAIL: prepare_n8n_reply unexpectedly succeeded for missing data';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      RAISE NOTICE 'WA-FIX PASS: prepare_n8n_reply reaches its own 42501 (no 42702)';
    WHEN ambiguous_column THEN
      RESET ROLE;
      RAISE EXCEPTION 'WA-FIX FAIL: prepare_n8n_reply still raises 42702';
  END;

  -- seed the minimum rows so prepare_n8n_reply reaches the INSERT ... ON CONFLICT (tenant_id, reply_id)
  RESET ROLE;
  INSERT INTO public.cg_communication_conversation (id, tenant_id, org_ref, channel, address, principal_ref)
  VALUES (v_conv_id, 'wafix-tenant', 'wafix-org', 'whatsapp', '+2340000000001', 'wafix-principal');
  INSERT INTO public.cg_communication_message
    (tenant_id, org_ref, conversation_id, channel, direction, status, principal_ref, provider_ref, body,
     provider_created_at)
  VALUES ('wafix-tenant', 'wafix-org', v_conv_id, 'whatsapp', 'inbound', 'received', 'wafix-principal',
          'wamid.wafix.in', 'hi', now() - interval '1 minute');
  INSERT INTO public.cg_whatsapp_inbound_event (provider_sender_ref, provider_ref, tenant_id, org_ref, status)
  VALUES ('1000000000001', 'wamid.wafix.in', 'wafix-tenant', 'wafix-org', 'received');
  INSERT INTO public.cg_communication_recipient_address (tenant_id, org_ref, principal_ref, channel, address)
  VALUES ('wafix-tenant', 'wafix-org', 'wafix-principal', 'whatsapp', '+2340000000001');
  INSERT INTO public.cg_communication_optin (tenant_id, org_ref, channel, address, status, source)
  VALUES ('wafix-tenant', 'wafix-org', 'whatsapp', '+2340000000001', 'opted_in', 'authorized_server');
  INSERT INTO public.cg_org_membership (id, tenant_id, org_unit_id, principal_ref, role_ref, state)
  VALUES ('wafix-membership', 'wafix-tenant', 'wafix-org', 'wafix-principal', 'wafix-role', 'active');
  INSERT INTO public.cg_org_communication_sender
    (sender_ref, tenant_id, org_ref, channel, provider, from_number, credential_ref, status, provenance,
     provider_sender_ref)
  VALUES ('wafix-sender-ref', 'wafix-tenant', 'wafix-org', 'whatsapp', 'meta_cloud', '+2340000000002',
          'env://WAFIX_CRED', 'active', '{"createdBy":"wafix","createdAt":"2026-11-04"}'::jsonb, '1000000000001');
  PERFORM wafix.as_role('service_role');
  SELECT count(*), max(r.tenant_id), max(r.provider_sender_ref)
    INTO v_rows, v_tenant, v_sender
    FROM public.cg_whatsapp_prepare_n8n_reply('wafix-reply-2', 'wamid.wafix.in', v_conv_id, 'hello') r;
  RESET ROLE;
  PERFORM wafix.expect('prepare_n8n_reply reaches ON CONFLICT insert and returns one row',
    v_rows = 1 AND v_tenant = 'wafix-tenant' AND v_sender = '1000000000001'
    AND EXISTS (SELECT 1 FROM public.cg_whatsapp_n8n_reply
                 WHERE tenant_id = 'wafix-tenant' AND reply_id = 'wafix-reply-2' AND status = 'queued'));
  -- replay with the same reply_id still resolves ON CONFLICT without 42702 (live lease -> no row)
  PERFORM wafix.as_role('service_role');
  SELECT count(*) INTO v_rows
    FROM public.cg_whatsapp_prepare_n8n_reply('wafix-reply-2', 'wamid.wafix.in', v_conv_id, 'hello');
  RESET ROLE;
  PERFORM wafix.expect('prepare_n8n_reply replay on live lease returns no row', v_rows = 0);
  PERFORM wafix.as_role('anon');
  BEGIN
    PERFORM * FROM public.cg_whatsapp_prepare_n8n_reply('wafix-reply', 'wamid.missing', gen_random_uuid(), 'hello');
    RESET ROLE;
    RAISE EXCEPTION 'WA-FIX FAIL: anon could call prepare_n8n_reply';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    RAISE NOTICE 'WA-FIX PASS: anon denied prepare_n8n_reply (42501)';
  END;
END
$t$;

ROLLBACK;
