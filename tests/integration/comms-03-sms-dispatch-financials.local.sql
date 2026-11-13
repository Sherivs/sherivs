-- COMMS-03 SMS dispatch financial integrity and entitlement (LOCAL, DISPOSABLE ONLY).
-- Run only after replaying repository migrations (including FIN-01 and ENT-01) on a loopback disposable DB
-- (CI: migrations-sim, PostgreSQL 17), from the repository root:
--   psql "postgresql://postgres@127.0.0.1:<port>/<disposable_db>" -v ON_ERROR_STOP=1 \
--     -f tests/integration/comms-03-sms-dispatch-financials.local.sql
-- Optional: -v apply_migration=1 applies (twice, to prove idempotency) the COMMS-03 migration inside the test
--   transaction first. Use that on a database that does not yet carry it; the default (0) tests the database as it is.
-- Builds synthetic organizations and users inside ONE transaction and ends with ROLLBACK, so it leaves nothing behind.
-- Every check prints "COMMS-03 PASS: <name>" or "COMMS-03 FAIL: <name>"; any failure makes the script exit non-zero.
-- Every attempt runs under a realistic role (anon, authenticated with a JWT subject, service_role), so grants,
-- row-level security, triggers and the in-function authorization are all exercised.
\if :{?apply_migration}
\else
  \set apply_migration 0
\endif

BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'COMMS-03: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NOT NULL
     AND NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet)
     AND coalesce(current_setting('comms03.allow_non_loopback', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'COMMS-03: refusing non-loopback server address %', inet_server_addr();
  END IF;
  IF current_database() !~* '(disposable|scratch|local|test|sim|postgres|comms_03)' THEN
    RAISE EXCEPTION 'COMMS-03: refusing database %, not a named disposable DB', current_database();
  END IF;
  IF to_regprocedure('public.comms_send(uuid,text,text,text,jsonb,uuid,text,text,text)') IS NULL
     OR to_regprocedure('public.sms_plan_entitled(uuid)') IS NULL
     OR to_regprocedure('public.wallet_credit_topup(uuid,numeric,text)') IS NULL THEN
    RAISE EXCEPTION 'COMMS-03: platform, FIN-01 and ENT-01 migrations must be applied first';
  END IF;
END
$guard$;

CREATE SCHEMA c03;
GRANT USAGE ON SCHEMA c03 TO PUBLIC;
CREATE TABLE c03.results (n serial, name text, ok boolean, detail text);
CREATE TABLE c03.ctx (k text PRIMARY KEY, v text);
GRANT ALL ON c03.results, c03.ctx TO PUBLIC;

\if :apply_migration
  \i database/supabase/migrations/20261104052000_sherivs_comms03_sms_dispatch_financials.sql
  \i database/supabase/migrations/20261104052000_sherivs_comms03_sms_dispatch_financials.sql
\endif

CREATE FUNCTION c03.expect(p_name text, p_ok boolean, p_detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO c03.results (name, ok, detail) VALUES (p_name, coalesce(p_ok, false), p_detail);
  IF coalesce(p_ok, false) THEN RAISE NOTICE 'COMMS-03 PASS: % [%]', p_name, p_detail;
  ELSE RAISE NOTICE 'COMMS-03 FAIL: % [%]', p_name, p_detail; END IF;
END $$;

-- Run one statement under a realistic role and JWT; returns 'ok:<single text value>' or 'err:<sqlstate>:<message>'.
-- The statement runs in a sub-block, so a failure rolls back everything it did (the same way a failed RPC does).
CREATE FUNCTION c03.call(p_role text, p_sub uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_sub IS NULL THEN json_build_object('role', p_role)::text
         ELSE json_build_object('sub', p_sub, 'role', p_role)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql INTO v;
    EXECUTE 'RESET ROLE';
    RETURN 'ok:' || coalesce(v, '');
  EXCEPTION WHEN others THEN
    EXECUTE 'RESET ROLE';
    RETURN 'err:' || SQLSTATE || ':' || SQLERRM;
  END;
END $$;
GRANT EXECUTE ON FUNCTION c03.call(text, uuid, text) TO PUBLIC;

CREATE FUNCTION c03.svc(p_sql text) RETURNS text LANGUAGE sql AS $$ SELECT c03.call('service_role', NULL, p_sql) $$;
CREATE FUNCTION c03.bal(p_org uuid) RETURNS numeric LANGUAGE sql AS $$ SELECT balance FROM public.school_wallets WHERE school_id = p_org $$;
CREATE FUNCTION c03.org(p_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v::uuid FROM c03.ctx WHERE k = p_k $$;
CREATE FUNCTION c03.val(p_k text) RETURNS text LANGUAGE sql AS $$ SELECT v FROM c03.ctx WHERE k = p_k $$;
CREATE FUNCTION c03.claim() RETURNS text LANGUAGE sql AS $$ SELECT 'claim:' || gen_random_uuid()::text $$;
CREATE FUNCTION c03.ok(p text) RETURNS boolean LANGUAGE sql AS $$ SELECT p LIKE 'ok:%' $$;
CREATE FUNCTION c03.v(p text) RETURNS text LANGUAGE sql AS $$ SELECT CASE WHEN p LIKE 'ok:%' THEN substr(p, 4) ELSE p END $$;
-- an error that is a real refusal, not a missing function or table (so a check cannot pass vacuously before the migration)
CREATE FUNCTION c03.refused(p text) RETURNS boolean LANGUAGE sql AS $$ SELECT p LIKE 'err:%' AND p NOT LIKE 'err:42883:%' AND p NOT LIKE 'err:42P01:%' $$;
CREATE FUNCTION c03.denied(p text) RETURNS boolean LANGUAGE sql AS $$ SELECT p LIKE 'err:42501:%' $$;

CREATE FUNCTION c03.revs(p_org uuid, p_msg_reference text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  IF to_regclass('public.usage_event_reversals') IS NULL THEN RETURN -1; END IF;
  EXECUTE 'SELECT count(*)::int FROM public.usage_event_reversals WHERE school_id = $1 AND reference = ''msg:'' || $2' INTO n USING p_org, p_msg_reference;
  RETURN n;
END $$;

-- A released proposal plus a live comms_send for one parent. Returns the message id and status as 'id|status'.
CREATE FUNCTION c03.send(p_org uuid, p_parent uuid, p_phone text, p_admin1 uuid, p_admin2 uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_pid uuid := gen_random_uuid(); v_ref text; r text;
BEGIN
  EXECUTE 'RESET ROLE';
  INSERT INTO public.comms_send_proposals (id, org_id, school_id, channel, template_code, language, category, audience_spec,
     recipient_user_ids, template_vars, draft_body, status, proposed_by, approved_by, approved_at, released_at)
  VALUES (v_pid, p_org, p_org, 'sms', 'fee_reminder', 'en', 'utility', '{"kind":"user"}', ARRAY[p_parent], '{}', 'x',
     'released', p_admin1, p_admin2, now(), now());
  v_ref := v_pid::text || ':' || p_parent::text;
  r := c03.svc(format($q$SELECT concat_ws('|', (x->>'id'), (x->>'status')) FROM (SELECT public.comms_send(%L::uuid,'sms',%L,'fee_reminder',
        '{"student":"K","amount":"1","link":"https://x.test"}'::jsonb,NULL,'normal',%L,'en') AS x) q$q$, p_org, p_phone, v_ref));
  RETURN c03.v(r);
END $$;
GRANT EXECUTE ON FUNCTION c03.send(uuid, uuid, text, uuid, uuid) TO PUBLIC;

-- ---------- synthetic fixtures (owner role) ----------
DO $f$
DECLARE s uuid; k text; t text; i int := 0;
BEGIN
  FOREACH k IN ARRAY ARRAY['growth','growth2','trial','starter','other'] LOOP
    i := i + 1;
    t := CASE k WHEN 'trial' THEN 'trial' WHEN 'starter' THEN 'starter' ELSE 'growth' END;
    INSERT INTO public.schools (name, slug, subscription_tier) VALUES ('C03 ' || k, 'c03-' || k, t) RETURNING id INTO s;
    INSERT INTO c03.ctx VALUES (k, s::text);
    INSERT INTO auth.users (id, email, phone, email_confirmed_at, phone_confirmed_at) VALUES
      (('00000000-0000-0000-0000-0000000c0' || i || '01')::uuid, k || '-a1@c03.test', '23480300' || i || '01', now(), now()),
      (('00000000-0000-0000-0000-0000000c0' || i || '02')::uuid, k || '-a2@c03.test', '23480300' || i || '02', now(), now()),
      (('00000000-0000-0000-0000-0000000c0' || i || '03')::uuid, k || '-p1@c03.test', '23480300' || i || '03', now(), now());
    INSERT INTO public.users (id, school_id, full_name, role, email, phone, is_active) VALUES
      (('00000000-0000-0000-0000-0000000c0' || i || '01')::uuid, s, k || ' Admin 1', 'admin', k || '-a1@c03.test', '23480300' || i || '01', true),
      (('00000000-0000-0000-0000-0000000c0' || i || '02')::uuid, s, k || ' Admin 2', 'admin', k || '-a2@c03.test', '23480300' || i || '02', true),
      (('00000000-0000-0000-0000-0000000c0' || i || '03')::uuid, s, k || ' Parent', 'parent', k || '-p1@c03.test', '23480300' || i || '03', true);
    INSERT INTO c03.ctx VALUES
      (k || '_a1', '00000000-0000-0000-0000-0000000c0' || i || '01'),
      (k || '_a2', '00000000-0000-0000-0000-0000000c0' || i || '02'),
      (k || '_p',  '00000000-0000-0000-0000-0000000c0' || i || '03'),
      (k || '_phone', '23480300' || i || '03');
  END LOOP;
END $f$;

-- fund every organization the way the payment webhook does (service_role), then switch live SMS on where intended
DO $fund$
DECLARE k text;
BEGIN
  FOREACH k IN ARRAY ARRAY['growth','growth2','trial','starter','other'] LOOP
    PERFORM c03.svc(format($q$SELECT public.wallet_credit_topup(%L::uuid, 1000, %L)::text$q$, c03.val(k), 'C03-TOPUP-' || k));
  END LOOP;
  FOREACH k IN ARRAY ARRAY['growth','trial','starter','other'] LOOP
    PERFORM c03.svc(format($q$SELECT public.flag_set('sms_live', %L::uuid, true)::text$q$, c03.val(k)));
  END LOOP;
END $fund$;

-- ================================================================ A. function surface and authorization
DO $t$
DECLARE r text; g uuid := c03.org('growth'); n int;
BEGIN
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname IN ('comms_sms_claim','comms_sms_settle','comms_sms_report_delivery','comms_sms_hold',
         'comms_sms_reconcile','comms_refund_unsubmitted','_comms_refund_charge');
  PERFORM c03.expect('A1 all seven dispatcher/refund functions exist', n = 7, 'found=' || n);
  PERFORM c03.expect('A2 usage_event_reversals exists, RLS forced',
    coalesce((SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.usage_event_reversals')), false), '');

  -- no non-service role can execute any of them (each attempt under a real role)
  r := c03.call('authenticated', c03.val('growth_a1')::uuid, format($q$SELECT public.comms_sms_claim(%L::uuid,%L::uuid,%L,'bulksmsnigeria')::text$q$, gen_random_uuid(), g, c03.claim()));
  PERFORM c03.expect('A3a authenticated cannot call comms_sms_claim', c03.denied(r), r);
  r := c03.call('anon', NULL, format($q$SELECT public.comms_sms_claim(%L::uuid,%L::uuid,%L,'bulksmsnigeria')::text$q$, gen_random_uuid(), g, c03.claim()));
  PERFORM c03.expect('A3b anon cannot call comms_sms_claim', c03.denied(r), r);
  r := c03.call('authenticated', c03.val('growth_a1')::uuid, format($q$SELECT public.comms_sms_settle(%L::uuid,%L::uuid,NULL,'failed',NULL,NULL,'x','provider_rejected')::text$q$, gen_random_uuid(), g));
  PERFORM c03.expect('A3c authenticated cannot call comms_sms_settle', c03.denied(r), r);
  r := c03.call('authenticated', c03.val('growth_a1')::uuid, format($q$SELECT public.comms_sms_report_delivery(%L::uuid,%L::uuid,'delivered','D')::text$q$, gen_random_uuid(), g));
  PERFORM c03.expect('A3d authenticated cannot call comms_sms_report_delivery', c03.denied(r), r);
  r := c03.call('authenticated', c03.val('growth_a1')::uuid, format($q$SELECT public.comms_sms_hold(%L::uuid,%L::uuid,%L,'provider_error','x')::text$q$, gen_random_uuid(), g, c03.claim()));
  PERFORM c03.expect('A3e authenticated cannot call comms_sms_hold', c03.denied(r), r);
  r := c03.call('authenticated', c03.val('growth_a1')::uuid, format($q$SELECT public.comms_sms_reconcile(%L::uuid,%L::uuid,'not_accepted',NULL,'x')::text$q$, gen_random_uuid(), g));
  PERFORM c03.expect('A3f authenticated cannot call comms_sms_reconcile', c03.denied(r), r);
  r := c03.call('authenticated', c03.val('growth_a1')::uuid, format($q$SELECT public.comms_refund_unsubmitted(%L::uuid,%L::uuid,'cancelled_unsent')::text$q$, gen_random_uuid(), g));
  PERFORM c03.expect('A3g authenticated cannot call comms_refund_unsubmitted', c03.denied(r), r);
  r := c03.call('authenticated', c03.val('growth_a1')::uuid, format($q$SELECT public._comms_refund_charge(%L::uuid,'x','provider_rejected')::text$q$, g));
  PERFORM c03.expect('A3h authenticated cannot call the internal refund primitive', c03.denied(r), r);
  r := c03.call('service_role', NULL, format($q$SELECT public._comms_refund_charge(%L::uuid,'x','provider_rejected')::text$q$, g));
  PERFORM c03.expect('A3i not even service_role can call the internal refund primitive', c03.denied(r), r);
  -- service_role still cannot write the table directly: every write goes through the compare-and-set functions
  r := c03.svc($q$UPDATE public.outbound_messages SET status = 'delivered' WHERE false RETURNING 'x'$q$);
  PERFORM c03.expect('A4 service_role cannot UPDATE outbound_messages directly', c03.denied(r), r);
  r := c03.svc($q$INSERT INTO public.usage_event_reversals (school_id, reference, reason, refunded_amount, restored_from_pool) VALUES (gen_random_uuid(), 'x', 'provider_rejected', 1, 0) RETURNING 'x'$q$);
  PERFORM c03.expect('A5 service_role cannot forge a reversal row', c03.denied(r), r);
END $t$;

-- ================================================================ B. live sends queue and are charged once
DO $t$
DECLARE g uuid := c03.org('growth'); b0 numeric := c03.bal(c03.org('growth')); i int; r text;
BEGIN
  FOR i IN 1..8 LOOP
    r := c03.send(g, c03.val('growth_p')::uuid, c03.val('growth_phone'), c03.val('growth_a1')::uuid, c03.val('growth_a2')::uuid);
    INSERT INTO c03.ctx VALUES ('m' || i, split_part(r, '|', 1));
    INSERT INTO c03.ctx VALUES ('s' || i, split_part(r, '|', 2));
  END LOOP;
  PERFORM c03.expect('B0 eight live sends on an entitled organization are queued and debited NGN10 each',
    (SELECT count(*) FROM public.outbound_messages WHERE id IN (SELECT v::uuid FROM c03.ctx WHERE k ~ '^m[0-9]$') AND status = 'queued') = 8
    AND c03.bal(g) = b0 - 80, 'wallet delta=' || (c03.bal(g) - b0));
  INSERT INTO c03.ctx VALUES ('g_bal0', b0::text);
END $t$;

-- ================================================================ C. claim / settle / delivery are compare-and-set, via the functions only
DO $t$
DECLARE g uuid := c03.org('growth'); m uuid := c03.val('m1')::uuid; c1 text := c03.claim(); c2 text := c03.claim();
        r1 text; r2 text; r3 text; r4 text; r5 text; r6 text; r7 text; st text; pr text;
BEGIN
  r1 := c03.svc(format($q$SELECT public.comms_sms_claim(%L::uuid,%L::uuid,%L,'bulksmsnigeria')::text$q$, m, g, c1));
  r2 := c03.svc(format($q$SELECT public.comms_sms_claim(%L::uuid,%L::uuid,%L,'bulksmsnigeria')::text$q$, m, g, c2));
  PERFORM c03.expect('C1 exactly one worker wins the claim', r1 = 'ok:true' AND r2 = 'ok:false', r1 || ' / ' || r2);
  r3 := c03.svc(format($q$SELECT public.comms_sms_settle(%L::uuid,%L::uuid,%L,'sent','bulksmsnigeria','prov-1',NULL)::text$q$, m, g, c2));
  r4 := c03.svc(format($q$SELECT public.comms_sms_settle(%L::uuid,%L::uuid,%L,'sent','bulksmsnigeria','prov-1',NULL)::text$q$, m, g, c1));
  r5 := c03.svc(format($q$SELECT public.comms_sms_settle(%L::uuid,%L::uuid,%L,'failed',NULL,NULL,'late')::text$q$, m, g, c1));
  PERFORM c03.expect('C2 settle is compare-and-set on the claim held (loser and late settle change nothing)',
    r3 = 'ok:false' AND r4 = 'ok:true' AND r5 = 'ok:false', r3 || ' / ' || r4 || ' / ' || r5);
  SELECT status, provider_ref INTO st, pr FROM public.outbound_messages WHERE id = m;
  PERFORM c03.expect('C3 the message is sent with the provider id and no claim marker left', st = 'sent' AND pr = 'prov-1', st || ' ' || pr);
  r6 := c03.svc(format($q$SELECT public.comms_sms_report_delivery(%L::uuid,%L::uuid,'delivered','DELIVRD')::text$q$, m, g));
  r7 := c03.svc(format($q$SELECT public.comms_sms_report_delivery(%L::uuid,%L::uuid,'failed','LATE')::text$q$, m, g));
  PERFORM c03.expect('C4 a delivery report moves sent to delivered exactly once; a replay or contradicting report is a no-op',
    r6 = 'ok:true' AND r7 = 'ok:false' AND (SELECT status FROM public.outbound_messages WHERE id = m) = 'delivered', r6 || ' / ' || r7);
  r6 := c03.svc(format($q$SELECT public.comms_sms_report_delivery(%L::uuid,%L::uuid,'delivered','DELIVRD')::text$q$, m, g));
  PERFORM c03.expect('C5 replaying the same delivery report is idempotent', r6 = 'ok:false', r6);
  -- a settle that claims "sent" without the provider id, or smuggles a claim marker, is refused
  r1 := c03.svc(format($q$SELECT public.comms_sms_settle(%L::uuid,%L::uuid,NULL,'sent','bulksmsnigeria',NULL,NULL)::text$q$, c03.val('m2')::uuid, g));
  r2 := c03.svc(format($q$SELECT public.comms_sms_settle(%L::uuid,%L::uuid,NULL,'sent','bulksmsnigeria','claim:x',NULL)::text$q$, c03.val('m2')::uuid, g));
  PERFORM c03.expect('C6 a sent settle needs a real provider message id', c03.refused(r1) AND c03.refused(r2), r1 || ' / ' || r2);
  -- a delivery report cannot touch a message the provider never accepted
  r1 := c03.svc(format($q$SELECT public.comms_sms_report_delivery(%L::uuid,%L::uuid,'delivered','X')::text$q$, c03.val('m2')::uuid, g));
  PERFORM c03.expect('C7 a delivery report for a message that is still queued is ignored', r1 = 'ok:false'
    AND (SELECT status FROM public.outbound_messages WHERE id = c03.val('m2')::uuid) = 'queued', r1);
END $t$;

-- ================================================================ D. refund policy
DO $t$
DECLARE g uuid := c03.org('growth'); b uuid := c03.val('m3')::uuid; c uuid := c03.val('m4')::uuid; d uuid := c03.val('m5')::uuid; e uuid := c03.val('m6')::uuid;
        cb text := c03.claim(); cc text := c03.claim(); bal_before numeric; bal numeric; r text; ledger int; rev int;
BEGIN
  -- provider definitively rejected before acceptance: failed + refund atomically in one call
  r := c03.svc(format($q$SELECT public.comms_sms_claim(%L::uuid,%L::uuid,%L,'bulksmsnigeria')::text$q$, b, g, cb));
  bal_before := c03.bal(g);
  r := c03.svc(format($q$SELECT public.comms_sms_settle(%L::uuid,%L::uuid,%L,'failed',NULL,NULL,'provider_rejected','provider_rejected')::text$q$, b, g, cb));
  bal := c03.bal(g);
  PERFORM c03.expect('D1 a provider-rejected message is failed and refunded atomically (+NGN10)', r = 'ok:true' AND bal = bal_before + 10
     AND (SELECT status FROM public.outbound_messages WHERE id = b) = 'failed' AND (SELECT provider_ref FROM public.outbound_messages WHERE id = b) IS NULL,
     r || ' delta=' || (bal - bal_before));
  r := c03.svc(format($q$SELECT public.comms_refund_unsubmitted(%L::uuid,%L::uuid,'provider_rejected')::text$q$, b, g));
  PERFORM c03.expect('D2 a second refund of the same message is a no-op (idempotent)', r LIKE 'ok:%already_refunded%' AND c03.bal(g) = bal,
     r || ' balance=' || c03.bal(g));
  SELECT count(*) INTO ledger FROM public.wallet_ledger WHERE school_id = g AND kind = 'refund' AND reference = 'refund:msg:' || (SELECT reference FROM public.outbound_messages WHERE id = b);
  rev := c03.revs(g, (SELECT reference FROM public.outbound_messages WHERE id = b));
  PERFORM c03.expect('D3 exactly one refund ledger row and one reversal row exist for the message', ledger = 1 AND rev = 1, 'ledger=' || ledger || ' reversals=' || rev);
  PERFORM c03.expect('D3b the refund is auditable (an audit_logs row records the reversal)',
    (SELECT count(*) FROM public.audit_logs WHERE school_id = g AND table_name = 'usage_event_reversals') >= 1, '');

  -- ambiguous failure: never refunded; the claim is kept so nothing resends it
  r := c03.svc(format($q$SELECT public.comms_sms_claim(%L::uuid,%L::uuid,%L,'bulksmsnigeria')::text$q$, c, g, cc));
  bal_before := c03.bal(g);
  r := c03.svc(format($q$SELECT public.comms_sms_hold(%L::uuid,%L::uuid,%L,'provider_error','http 502 after request was sent')::text$q$, c, g, cc));
  PERFORM c03.expect('D4 an ambiguous outcome is HELD: still queued, claim kept, no refund, no resend',
    r = 'ok:true' AND c03.bal(g) = bal_before
    AND (SELECT status FROM public.outbound_messages WHERE id = c) = 'queued'
    AND (SELECT provider_ref FROM public.outbound_messages WHERE id = c) = cc
    AND (SELECT error FROM public.outbound_messages WHERE id = c) LIKE 'held:provider_error%', r);
  r := c03.svc(format($q$SELECT public.comms_sms_claim(%L::uuid,%L::uuid,%L,'bulksmsnigeria')::text$q$, c, g, c03.claim()));
  PERFORM c03.expect('D5 a held message cannot be claimed again by another worker', r = 'ok:false', r);
  r := c03.svc(format($q$SELECT public.comms_refund_unsubmitted(%L::uuid,%L::uuid,'provider_rejected')::text$q$, c, g));
  PERFORM c03.expect('D6 the unsubmitted-refund path refuses a claimed (ambiguous) message', r LIKE 'err:%reconcile%' AND c03.bal(g) = bal_before, r);
  r := c03.svc(format($q$SELECT public.comms_sms_hold(%L::uuid,%L::uuid,%L,'provider_error','again')::text$q$, c, g, c03.claim()));
  PERFORM c03.expect('D7 a hold is compare-and-set on the claim held', r = 'ok:false', r);
  -- an operator who verified with the provider that it was NOT accepted reconciles: failed + refund once
  r := c03.svc(format($q$SELECT public.comms_sms_reconcile(%L::uuid,%L::uuid,'not_accepted',NULL,'checked provider dashboard')::text$q$, c, g));
  PERFORM c03.expect('D8 reconciling a held message as not accepted refunds it once', r LIKE 'ok:%"refunded": true%' AND c03.bal(g) = bal_before + 10
    AND (SELECT status FROM public.outbound_messages WHERE id = c) = 'failed' AND (SELECT provider_ref FROM public.outbound_messages WHERE id = c) IS NULL, r || ' bal=' || c03.bal(g));
  r := c03.svc(format($q$SELECT public.comms_sms_reconcile(%L::uuid,%L::uuid,'not_accepted',NULL,'again')::text$q$, c, g));
  PERFORM c03.expect('D9 reconciling twice is refused (the claim is gone) and refunds nothing more', c03.refused(r) AND c03.bal(g) = bal_before + 10, r);
  -- an operator who verified with the provider that it WAS accepted reconciles to sent: no refund, provider id recorded
  r := c03.svc(format($q$SELECT public.comms_sms_claim(%L::uuid,%L::uuid,%L,'bulksmsnigeria')::text$q$, d, g, cc));
  r := c03.svc(format($q$SELECT public.comms_sms_hold(%L::uuid,%L::uuid,%L,'provider_response_invalid','200 without id')::text$q$, d, g, cc));
  bal_before := c03.bal(g);
  r := c03.svc(format($q$SELECT public.comms_sms_reconcile(%L::uuid,%L::uuid,'accepted',%L,'found in provider log')::text$q$, d, g, 'prov-recon-1'));
  PERFORM c03.expect('D10 reconciling a held message as accepted marks it sent with the provider id and does not refund',
    c03.ok(r) AND c03.bal(g) = bal_before AND (SELECT status FROM public.outbound_messages WHERE id = d) = 'sent'
    AND (SELECT provider_ref FROM public.outbound_messages WHERE id = d) = 'prov-recon-1', r);
  -- a rejection before any claim (consent re-check at dispatch time) refunds, with no claim to compare
  bal_before := c03.bal(g);
  r := c03.svc(format($q$SELECT public.comms_sms_settle(%L::uuid,%L::uuid,NULL,'failed',NULL,NULL,'recipient no longer consented','rejected_before_submission')::text$q$, e, g));
  PERFORM c03.expect('D11 a rejection before submission is refunded', r = 'ok:true' AND c03.bal(g) = bal_before + 10, r || ' delta=' || (c03.bal(g) - bal_before));
  -- reconcile only applies to a claimed, queued message
  r := c03.svc(format($q$SELECT public.comms_sms_reconcile(%L::uuid,%L::uuid,'not_accepted',NULL,'x')::text$q$, c03.val('m7')::uuid, g));
  PERFORM c03.expect('D12 reconcile refuses a message that was never claimed', c03.refused(r), r);
  r := c03.svc(format($q$SELECT public.comms_sms_reconcile(%L::uuid,%L::uuid,'not_accepted',NULL,'x')::text$q$, c03.val('m1')::uuid, g));
  PERFORM c03.expect('D13 reconcile refuses a message the provider already accepted', c03.refused(r), r);
  -- a provider-accepted message can never be refunded (m1 is delivered)
  r := c03.svc(format($q$SELECT public.comms_refund_unsubmitted(%L::uuid,%L::uuid,'provider_rejected')::text$q$, c03.val('m1')::uuid, g));
  PERFORM c03.expect('D14 a provider-accepted message can never be refunded', c03.refused(r), r);
  -- refund policy is closed: a duplicate-reported message is ambiguous (the provider may hold the first copy)
  r := c03.svc(format($q$SELECT public.comms_sms_settle(%L::uuid,%L::uuid,NULL,'failed',NULL,NULL,'dup','provider_duplicate')::text$q$, c03.val('m8')::uuid, g));
  PERFORM c03.expect('D15 provider_duplicate is not an automatic refund reason', c03.refused(r), r);
  r := c03.svc(format($q$SELECT public.comms_sms_settle(%L::uuid,%L::uuid,NULL,'sent','bulksmsnigeria','p',NULL,'provider_rejected')::text$q$, c03.val('m8')::uuid, g));
  PERFORM c03.expect('D16 a refund can only ride on a failed settle', c03.refused(r), r);
END $t$;

-- ================================================================ E. delivery failure after acceptance never refunds
DO $t$
DECLARE g uuid := c03.org('growth'); m uuid := c03.val('m2')::uuid; cl text := c03.claim(); b0 numeric; r text;
BEGIN
  r := c03.svc(format($q$SELECT public.comms_sms_claim(%L::uuid,%L::uuid,%L,'bulksmsnigeria')::text$q$, m, g, cl));
  r := c03.svc(format($q$SELECT public.comms_sms_settle(%L::uuid,%L::uuid,%L,'sent','bulksmsnigeria','prov-2',NULL)::text$q$, m, g, cl));
  b0 := c03.bal(g);
  r := c03.svc(format($q$SELECT public.comms_sms_report_delivery(%L::uuid,%L::uuid,'failed','UNDELIV')::text$q$, m, g));
  PERFORM c03.expect('E1 a delivery FAILURE report marks the message failed but does not refund automatically',
    r = 'ok:true' AND c03.bal(g) = b0 AND (SELECT status FROM public.outbound_messages WHERE id = m) = 'failed'
    AND c03.revs(g, (SELECT reference FROM public.outbound_messages WHERE id = m)) = 0,
    r || ' delta=' || (c03.bal(g) - b0));
  r := c03.svc(format($q$SELECT public.comms_refund_unsubmitted(%L::uuid,%L::uuid,'provider_rejected')::text$q$, m, g));
  PERFORM c03.expect('E2 the operator refund path also refuses a message that was accepted then failed delivery', c03.refused(r) AND c03.bal(g) = b0, r);
END $t$;

-- ================================================================ F. net accounting for the whole scenario
DO $t$
DECLARE g uuid := c03.org('growth'); b0 numeric := c03.val('g_bal0')::numeric;
BEGIN
  -- eight messages were queued (-80). Refunded: m3 (rejected), m4 (reconciled not accepted), m6 (rejected before submission) = +30.
  -- Held-then-accepted m5, sent/delivered m1, delivery-failed m2 stay charged; m7 and m8 are still queued and charged.
  PERFORM c03.expect('F1 the wallet equals start minus the five messages that stayed charged, minus the two still queued',
    c03.bal(g) = b0 - 80 + 30, 'balance=' || c03.bal(g) || ' expected=' || (b0 - 50));
  PERFORM c03.expect('F2 refund ledger rows total exactly the three refunds (NGN30)',
    (SELECT coalesce(sum(amount), 0) FROM public.wallet_ledger WHERE school_id = g AND kind = 'refund') = 30,
    'sum=' || (SELECT coalesce(sum(amount), 0) FROM public.wallet_ledger WHERE school_id = g AND kind = 'refund'));
END $t$;

-- ================================================================ G. pool-funded charge: refund restores the pool, not the wallet
DO $t$
DECLARE h uuid := c03.org('growth2'); r text; mid uuid; cl text := c03.claim(); w0 numeric; used_before numeric; used_after numeric;
BEGIN
  INSERT INTO public.term_usage_pools (school_id, academic_year, term, item, allowance, used) VALUES (h, 'y1', 't1', 'sms', 5, 0);
  PERFORM c03.svc(format($q$SELECT public.flag_set('sms_live', %L::uuid, true)::text$q$, h));
  w0 := c03.bal(h);
  r := c03.send(h, c03.val('growth2_p')::uuid, c03.val('growth2_phone'), c03.val('growth2_a1')::uuid, c03.val('growth2_a2')::uuid);
  mid := split_part(r, '|', 1)::uuid;
  used_before := (SELECT used FROM public.term_usage_pools WHERE school_id = h AND item = 'sms');
  r := c03.svc(format($q$SELECT public.comms_sms_claim(%L::uuid,%L::uuid,%L,'bulksmsnigeria')::text$q$, mid, h, cl));
  r := c03.svc(format($q$SELECT public.comms_sms_settle(%L::uuid,%L::uuid,%L,'failed',NULL,NULL,'rej','provider_rejected')::text$q$, mid, h, cl));
  used_after := (SELECT used FROM public.term_usage_pools WHERE school_id = h AND item = 'sms');
  PERFORM c03.expect('G1 a pool-funded message refund restores the pool allowance and leaves the wallet untouched',
    r = 'ok:true' AND used_before = 1 AND used_after = 0 AND c03.bal(h) = w0, 'pool ' || used_before || '->' || coalesce(used_after::text, '?') || ' wallet delta=' || (c03.bal(h) - w0));
END $t$;

-- ================================================================ H. entitlement: plan and live flag decide, in the database
DO $t$
DECLARE tr uuid := c03.org('trial'); st uuid := c03.org('starter'); g2 uuid := c03.org('growth2'); r text; w0 numeric; n0 int; sts text; cst numeric; ue int; pool0 numeric; pool1 numeric;
BEGIN
  -- Trial with sms_live ON: blocked by plan, no charge, no queue
  w0 := c03.bal(tr); n0 := (SELECT count(*) FROM public.usage_events WHERE school_id = tr);
  r := c03.send(tr, c03.val('trial_p')::uuid, c03.val('trial_phone'), c03.val('trial_a1')::uuid, c03.val('trial_a2')::uuid);
  sts := split_part(r, '|', 2);
  PERFORM c03.expect('H1 a Trial organization with sms_live ON is blocked by plan, not charged, not queued',
    sts = 'blocked_plan' AND c03.bal(tr) = w0 AND (SELECT count(*) FROM public.usage_events WHERE school_id = tr) = n0
    AND NOT EXISTS (SELECT 1 FROM public.outbound_messages WHERE org_id = tr AND status = 'queued'), 'status=' || sts);
  r := c03.send(st, c03.val('starter_p')::uuid, c03.val('starter_phone'), c03.val('starter_a1')::uuid, c03.val('starter_a2')::uuid);
  PERFORM c03.expect('H2 a Starter organization with sms_live ON is blocked by plan and not charged',
    split_part(r, '|', 2) = 'blocked_plan' AND c03.bal(st) = 1000, 'status=' || split_part(r, '|', 2));
  PERFORM c03.expect('H3 a blocked_plan message is recorded at cost 0 with the stub provider (evidence, never sent)',
    (SELECT bool_and(cost = 0 AND provider = 'stub') FROM public.outbound_messages WHERE org_id IN (tr, st) AND status = 'blocked_plan'), '');

  -- live flag off: a simulated send is free and records no usage (growth2 had its flag switched on in G; switch it off)
  PERFORM c03.svc(format($q$SELECT public.flag_set('sms_live', %L::uuid, false)::text$q$, g2));
  w0 := c03.bal(g2); n0 := (SELECT count(*) FROM public.usage_events WHERE school_id = g2);
  pool0 := (SELECT used FROM public.term_usage_pools WHERE school_id = g2 AND item = 'sms');
  r := c03.send(g2, c03.val('growth2_p')::uuid, c03.val('growth2_phone'), c03.val('growth2_a1')::uuid, c03.val('growth2_a2')::uuid);
  sts := split_part(r, '|', 2);
  cst := (SELECT o.cost FROM public.outbound_messages o WHERE o.id = split_part(r, '|', 1)::uuid);
  PERFORM c03.expect('H4 a simulated (sent_stub) SMS is not charged and records no usage',
    sts = 'sent_stub' AND cst = 0 AND c03.bal(g2) = w0 AND (SELECT count(*) FROM public.usage_events WHERE school_id = g2) = n0
    AND (SELECT used FROM public.term_usage_pools WHERE school_id = g2 AND item = 'sms') = pool0,
    'status=' || sts || ' cost=' || cst || ' wallet delta=' || (c03.bal(g2) - w0) || ' usage_events delta=' || ((SELECT count(*) FROM public.usage_events WHERE school_id = g2) - n0)
    || ' pool delta=' || ((SELECT used FROM public.term_usage_pools WHERE school_id = g2 AND item = 'sms') - pool0));

  -- an entitled organization still works end to end
  PERFORM c03.expect('H5 the plan function agrees with the catalog (trial/starter no; growth/professional/enterprise yes)',
    NOT public.sms_plan_entitled(tr) AND NOT public.sms_plan_entitled(st) AND public.sms_plan_entitled(g2), '');
END $t$;

-- queued before the entitlement was lost: the dispatcher must not be able to claim it
DO $t$
DECLARE o uuid := c03.org('other'); mid uuid; r text; cl text := c03.claim(); w0 numeric; st text;
BEGIN
  r := c03.send(o, c03.val('other_p')::uuid, c03.val('other_phone'), c03.val('other_a1')::uuid, c03.val('other_a2')::uuid);
  mid := split_part(r, '|', 1)::uuid;
  PERFORM c03.expect('H6 an entitled organization with sms_live ON queues and is charged', split_part(r, '|', 2) = 'queued', r);
  -- 1) live flag switched off after queueing
  PERFORM c03.svc(format($q$SELECT public.flag_set('sms_live', %L::uuid, false)::text$q$, o));
  r := c03.svc(format($q$SELECT public.comms_sms_claim(%L::uuid,%L::uuid,%L,'bulksmsnigeria')::text$q$, mid, o, cl));
  PERFORM c03.expect('H7 a queued message of an organization whose sms_live flag was switched off cannot be claimed (no provider call)',
    r = 'ok:false' AND (SELECT provider_ref FROM public.outbound_messages WHERE id = mid) IS NULL, r);
  -- 2) flag back on, but the plan was downgraded by the platform
  PERFORM c03.svc(format($q$SELECT public.flag_set('sms_live', %L::uuid, true)::text$q$, o));
  r := c03.svc(format($q$UPDATE public.schools SET subscription_tier = 'trial' WHERE id = %L::uuid RETURNING 'x'$q$, o));
  PERFORM c03.expect('H8 the platform (service_role) can downgrade the plan', c03.ok(r) AND NOT public.sms_plan_entitled(o), r);
  r := c03.svc(format($q$SELECT public.comms_sms_claim(%L::uuid,%L::uuid,%L,'bulksmsnigeria')::text$q$, mid, o, cl));
  PERFORM c03.expect('H9 a queued message of an organization that lost SMS entitlement cannot be claimed (no provider call)',
    r = 'ok:false' AND (SELECT provider_ref FROM public.outbound_messages WHERE id = mid) IS NULL, r);
  -- the queued, already-charged message is returned to the wallet by the operator path; once
  w0 := c03.bal(o);
  r := c03.svc(format($q$SELECT public.comms_refund_unsubmitted(%L::uuid,%L::uuid,'cancelled_unsent')::text$q$, mid, o));
  PERFORM c03.expect('H10 an operator can cancel and refund a queued message that can no longer be sent', c03.ok(r) AND c03.bal(o) = w0 + 10
    AND (SELECT status FROM public.outbound_messages WHERE id = mid) = 'failed', r || ' delta=' || (c03.bal(o) - w0));
  r := c03.svc(format($q$SELECT public.comms_refund_unsubmitted(%L::uuid,%L::uuid,'cancelled_unsent')::text$q$, mid, o));
  PERFORM c03.expect('H11 cancelling and refunding it again changes nothing', c03.bal(o) = w0 + 10, r);
  -- restore the plan so later checks keep their meaning
  PERFORM c03.svc(format($q$UPDATE public.schools SET subscription_tier = 'growth' WHERE id = %L::uuid RETURNING 'x'$q$, o));
END $t$;

-- ================================================================ I. tenant isolation: another organization's id never reaches a message
DO $t$
DECLARE g uuid := c03.org('growth'); o uuid := c03.org('other'); mid uuid; cl text := c03.claim(); r text; w0 numeric; st text; pr text;
BEGIN
  -- m7 belongs to growth and is still queued/unclaimed
  mid := c03.val('m7')::uuid;
  w0 := c03.bal(g);
  r := c03.svc(format($q$SELECT public.comms_sms_claim(%L::uuid,%L::uuid,%L,'bulksmsnigeria')::text$q$, mid, o, cl));
  PERFORM c03.expect('I1 claiming another organization''s message by passing a different org id fails', r = 'ok:false', r);
  r := c03.svc(format($q$SELECT public.comms_sms_settle(%L::uuid,%L::uuid,NULL,'failed',NULL,NULL,'x','provider_rejected')::text$q$, mid, o));
  PERFORM c03.expect('I2 settling (and refunding) another organization''s message by passing a different org id fails',
    r = 'ok:false' AND c03.bal(g) = w0 AND c03.bal(o) >= 0, r);
  r := c03.svc(format($q$SELECT public.comms_refund_unsubmitted(%L::uuid,%L::uuid,'cancelled_unsent')::text$q$, mid, o));
  PERFORM c03.expect('I3 the operator refund with the wrong organization is refused', c03.refused(r) AND c03.bal(g) = w0, r);
  r := c03.svc(format($q$SELECT public.comms_sms_hold(%L::uuid,%L::uuid,%L,'provider_error','x')::text$q$, mid, o, cl));
  PERFORM c03.expect('I4 holding another organization''s message fails', r = 'ok:false', r);
  r := c03.svc(format($q$SELECT public.comms_sms_report_delivery(%L::uuid,%L::uuid,'delivered','X')::text$q$, c03.val('m1')::uuid, o));
  PERFORM c03.expect('I5 a delivery report under another organization changes nothing', r = 'ok:false', r);
  SELECT status, provider_ref INTO st, pr FROM public.outbound_messages WHERE id = mid;
  PERFORM c03.expect('I6 after every cross-tenant attempt the message is untouched', st = 'queued' AND pr IS NULL, st);
  -- an authenticated member of the other organization cannot read this organization's reversal rows
  r := c03.call('authenticated', c03.val('other_a1')::uuid, format($q$SELECT count(*)::text FROM public.usage_event_reversals WHERE school_id = %L::uuid$q$, g));
  PERFORM c03.expect('I7 another organization''s admin cannot read this organization''s reversals', r = 'ok:0', r);
  r := c03.call('authenticated', c03.val('growth_a1')::uuid, format($q$SELECT (count(*) > 0)::text FROM public.usage_event_reversals WHERE school_id = %L::uuid$q$, g));
  PERFORM c03.expect('I8 (positive control) this organization''s own admin can read its reversals', r = 'ok:true', r);
END $t$;

-- ================================================================ J. input validation
DO $t$
DECLARE g uuid := c03.org('growth'); r1 text; r2 text; r3 text;
BEGIN
  r1 := c03.svc(format($q$SELECT public.comms_sms_claim(%L::uuid,%L::uuid,'not-a-claim','bulksmsnigeria')::text$q$, c03.val('m7')::uuid, g));
  r2 := c03.svc(format($q$SELECT public.comms_sms_claim(%L::uuid,%L::uuid,%L,'Bad Provider!')::text$q$, c03.val('m7')::uuid, g, c03.claim()));
  r3 := c03.svc(format($q$SELECT public.comms_sms_settle(%L::uuid,%L::uuid,NULL,'delivered',NULL,NULL,'x')::text$q$, c03.val('m7')::uuid, g));
  PERFORM c03.expect('J1 malformed claim, provider and status values are rejected', c03.refused(r1) AND c03.refused(r2) AND c03.refused(r3), r1 || ' | ' || r2 || ' | ' || r3);
  r1 := c03.svc(format($q$SELECT public.comms_sms_reconcile(%L::uuid,%L::uuid,'maybe',NULL,'x')::text$q$, c03.val('m7')::uuid, g));
  PERFORM c03.expect('J2 an unknown reconcile resolution is rejected', c03.refused(r1), r1);
END $t$;

-- ================================================================ K. approval path (authenticated approver) still works and is charged once
DO $t$
DECLARE g uuid := c03.org('growth'); pg text; ap text; b0 numeric := c03.bal(c03.org('growth')); sts text; pid uuid;
BEGIN
  pg := c03.call('authenticated', c03.val('growth_a1')::uuid, format($q$SELECT public.comms_propose_send(%L::uuid,'sms',jsonb_build_object('kind','user','user_id',%L::text),'fee_reminder','{"student":"K","amount":"1","link":"https://x.test"}'::jsonb,'en')::text$q$, g, c03.val('growth_p')));
  pid := (c03.v(pg)::jsonb)->>'proposal_id';
  ap := c03.call('authenticated', c03.val('growth_a2')::uuid, format($q$SELECT public.comms_approve_send(%L::uuid,%L::uuid)::text$q$, g, pid));
  sts := (SELECT status FROM public.outbound_messages WHERE proposal_id = pid LIMIT 1);
  PERFORM c03.expect('K1 propose then approve on a Growth organization queues one message and debits NGN10',
    sts = 'queued' AND c03.bal(g) = b0 - 10, 'status=' || coalesce(sts, '?') || ' delta=' || (c03.bal(g) - b0) || ' ' || left(ap, 80));
END $t$;

-- ================================================================ summary
DO $s$
DECLARE p int; f int; names text;
BEGIN
  SELECT count(*) FILTER (WHERE ok), count(*) FILTER (WHERE NOT ok), string_agg(name, '; ') FILTER (WHERE NOT ok) INTO p, f, names FROM c03.results;
  RAISE NOTICE 'COMMS-03 RESULT: pass=% fail=%', p, f;
  IF f > 0 THEN RAISE EXCEPTION 'COMMS-03: % check(s) failed: %', f, names; END IF;
END $s$;

ROLLBACK;
