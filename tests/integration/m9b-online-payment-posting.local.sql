-- M9B online payment posting into the M07 fee ledger. Local disposable Postgres only; rolls back.
BEGIN;
DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'M9E FAIL: refusing to run outside the local disposable database';
  END IF;
  IF to_regprocedure('public.cg_fee_post_online_payment(uuid,text,bigint)') IS NULL THEN
    RAISE EXCEPTION 'M9E FAIL: the online posting migration must be present';
  END IF;
END $guard$;

CREATE SCHEMA m9e;
CREATE TABLE m9e.passed (n serial PRIMARY KEY, label text NOT NULL);
CREATE TABLE m9e.ids (name text PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid());
INSERT INTO m9e.ids (name) VALUES ('org'), ('org2'), ('campus'), ('admin'), ('cashier'), ('bursar'), ('nobody'),
  ('s1'), ('s2'), ('s3'), ('s4'), ('s5'), ('s6'), ('sx'), ('fee1'), ('sysactor'), ('f1'), ('f2'), ('f3'), ('f4'), ('f5'), ('f6');
CREATE FUNCTION m9e.id(p text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM m9e.ids WHERE name = p $$;
CREATE FUNCTION m9e.ok(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'M9E FAIL [%]', p_label; END IF;
  INSERT INTO m9e.passed (label) VALUES (p_label);
END $$;
CREATE FUNCTION m9e.err(p_label text, p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN INSERT INTO m9e.passed (label) VALUES (p_label); RETURN; END IF;
    RAISE EXCEPTION 'M9E FAIL [%]: expected % got % (%)', p_label, p_state, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'M9E FAIL [%]: statement was allowed', p_label;
END $$;
CREATE FUNCTION m9e.act(p_user text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', m9e.id(p_user)::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', m9e.id(p_user), 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION m9e.back() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;
CREATE FUNCTION m9e.as_service() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  EXECUTE 'SET LOCAL ROLE service_role';
END $$;
GRANT USAGE ON SCHEMA m9e TO PUBLIC;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA m9e TO PUBLIC;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA m9e TO PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA m9e TO PUBLIC;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) SELECT id FROM m9e.ids WHERE name IN ('admin', 'cashier', 'bursar', 'nobody', 'sysactor');
INSERT INTO public.schools (id, name, slug) VALUES (m9e.id('org'), 'M9E Org', 'm9e-org'), (m9e.id('org2'), 'M9E Org Two', 'm9e-org-two');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active)
  SELECT id, m9e.id('org'), name, name || '@m9e.invalid', 'admin', true FROM m9e.ids WHERE name IN ('admin', 'cashier', 'bursar', 'nobody', 'sysactor');
INSERT INTO public.organization_memberships (user_id, school_id, role)
  SELECT id, m9e.id('org'), 'admin' FROM m9e.ids WHERE name IN ('admin', 'cashier', 'bursar', 'nobody', 'sysactor');
INSERT INTO public.campuses (id, school_id, name, code) VALUES (m9e.id('campus'), m9e.id('org'), 'M9E Campus', 'm9e-a');
INSERT INTO public.students (id, school_id, status)
  SELECT id, m9e.id('org'), 'active' FROM m9e.ids WHERE name IN ('s1', 's2', 's3', 's4', 's5', 's6');
INSERT INTO public.students (id, school_id, status) VALUES (m9e.id('sx'), m9e.id('org2'), 'active');
INSERT INTO public.cg_org_unit (id, tenant_id, kind, created_by) VALUES ('m9e-org-ref', m9e.id('org')::text, 'organization', 'm9e-fixture');
INSERT INTO public.cg_financial_scope_binding (scope_ref, tenant_id, org_ref, provisioned_by)
  VALUES ('m9e-scope', m9e.id('org')::text, 'm9e-org-ref', 'test');
INSERT INTO public.user_role_assignments (org_id, user_id, role_code, scope_type, scope_ref, started_at) VALUES
  (m9e.id('org'), m9e.id('cashier'), 'ng.cashier', 'campus', m9e.id('campus')::text, now() - interval '1 day'),
  (m9e.id('org'), m9e.id('bursar'), 'ng.bursar', 'institution', NULL, now() - interval '1 day');
INSERT INTO public.fees (id, school_id, student_id, fee_type, amount, status)
  VALUES (m9e.id('fee1'), m9e.id('org'), m9e.id('s1'), 'tuition', 100, 'unpaid');
SET LOCAL session_replication_role = origin;

-- Invoices through the real M07 path, as the bursar: s1 (one open invoice), s2 (two open invoices), s3 (already settled), s4 (small), s5 (other term)
SELECT m9e.act('bursar');
DO $inv$
DECLARE v_sch uuid; v_sch2 uuid; v_sch3 uuid; v_sch4 uuid; v_i uuid;
BEGIN
  v_sch  := public.cg_fee_create_schedule('m9e-scope', 'M9E-TUITION', 'M9E tuition', '2026/27', 'Term 1', 10000, current_date, NULL);
  v_sch2 := public.cg_fee_create_schedule('m9e-scope', 'M9E-LAB', 'M9E lab', '2026/27', 'Term 1', 5000, current_date, NULL);
  v_sch3 := public.cg_fee_create_schedule('m9e-scope', 'M9E-TUITION-T2', 'M9E tuition t2', '2026/27', 'Term 2', 10000, current_date, NULL);
  PERFORM public.cg_fee_issue_invoice('m9e-scope', v_sch, m9e.id('campus'), m9e.id('s1')::text, 'payer-1', now() + interval '14 days');
  PERFORM public.cg_fee_issue_invoice('m9e-scope', v_sch, m9e.id('campus'), m9e.id('s2')::text, 'payer-2', now() + interval '14 days');
  PERFORM public.cg_fee_issue_invoice('m9e-scope', v_sch2, m9e.id('campus'), m9e.id('s2')::text, 'payer-2', now() + interval '14 days');
  PERFORM public.cg_fee_issue_invoice('m9e-scope', v_sch, m9e.id('campus'), m9e.id('s3')::text, 'payer-3', now() + interval '14 days');
  PERFORM public.cg_fee_issue_invoice('m9e-scope', v_sch, m9e.id('campus'), m9e.id('s4')::text, 'payer-4', now() + interval '14 days');
  PERFORM public.cg_fee_issue_invoice('m9e-scope', v_sch3, m9e.id('campus'), m9e.id('s5')::text, 'payer-5', now() + interval '14 days');
END $inv$;
SELECT m9e.back();

-- 1 legacy call posts to the ledger and keeps the legacy records

-- legacy fee rows (what a Paystack charge is made against)
SET LOCAL session_replication_role = replica;
INSERT INTO public.fees (id, school_id, student_id, fee_type, amount, status, term, academic_year) VALUES
  (m9e.id('f1'), m9e.id('org'), m9e.id('s1'), 'tuition', 100, 'unpaid', 'Term 1', '2026/27'),
  (m9e.id('f2'), m9e.id('org'), m9e.id('s2'), 'tuition', 100, 'unpaid', 'Term 1', '2026/27'),
  (m9e.id('f3'), m9e.id('org'), m9e.id('s6'), 'tuition', 100, 'unpaid', 'Term 1', '2026/27'),
  (m9e.id('f4'), m9e.id('org'), m9e.id('s1'), 'levy:PTA', 20, 'unpaid', 'Term 1', '2026/27'),
  (m9e.id('f5'), m9e.id('org'), m9e.id('s4'), 'tuition', 500, 'unpaid', 'Term 1', '2026/27'),
  (m9e.id('f6'), m9e.id('org'), m9e.id('s3'), 'tuition', 100, 'unpaid', 'Term 1', '2026/27');
SET LOCAL session_replication_role = origin;

CREATE TEMP TABLE before_state AS SELECT (SELECT count(*) FROM public.cg_fee_payment) AS payments;
GRANT SELECT ON before_state TO PUBLIC;

-- 0 with no system actor configured, a payment is parked (nothing is guessed)
SELECT m9e.as_service();
CREATE TEMP TABLE p0 AS SELECT public.cg_fee_post_online_payment(m9e.id('f6'), 'PSK-TEST-0000', 1000) AS j;
GRANT SELECT ON p0 TO PUBLIC;
SELECT m9e.back();
SELECT m9e.ok('without a configured system actor the payment is parked as actor_not_configured', (SELECT j->>'status' = 'unposted' AND j->>'reason' = 'actor_not_configured' FROM p0));
INSERT INTO public.cg_fee_online_actor (user_id) VALUES (m9e.id('sysactor'));

-- 1 a settled online payment is posted against the single open invoice
SELECT m9e.as_service();
CREATE TEMP TABLE p1 AS SELECT public.cg_fee_post_online_payment(m9e.id('f1'), 'PSK-TEST-0001', 4000) AS j;
CREATE TEMP TABLE p1d AS SELECT public.cg_fee_post_online_payment(m9e.id('f1'), 'PSK-TEST-0001', 4000) AS j;
GRANT SELECT ON p1, p1d TO PUBLIC;
SELECT m9e.back();
SELECT m9e.ok('the payment is posted with a payment id and a receipt number',
  (SELECT j->>'status' = 'posted' AND j->>'payment_id' IS NOT NULL AND (j->>'receipt_number')::bigint > 0 AND NOT (j->>'duplicate')::boolean FROM p1));
SELECT m9e.ok('it is an online payment of 4000 kobo from the system actor, referenced by the Paystack reference',
  (SELECT count(*) = 1 FROM public.cg_fee_payment p JOIN public.cg_fee_invoice i ON i.id = p.invoice_id
    WHERE i.subject_ref = m9e.id('s1')::text AND p.method = 'online' AND p.amount_kobo = 4000 AND p.external_reference = 'PSK-TEST-0001'
      AND p.recorded_by = m9e.id('sysactor')));
SELECT m9e.ok('the receivable fell from 10000 to 6000 and the online clearing account holds the 4000, not the cash account',
  (SELECT sum(l.debit_kobo - l.credit_kobo) FILTER (WHERE l.account_code = 'accounts_receivable') = 6000
      AND sum(l.debit_kobo - l.credit_kobo) FILTER (WHERE l.account_code = 'online_clearing') = 4000
      AND coalesce(sum(l.debit_kobo - l.credit_kobo) FILTER (WHERE l.account_code = 'cash'), 0) = 0
     FROM public.cg_fee_ledger_posting p JOIN public.cg_fee_ledger_line l ON l.posting_id = p.id JOIN public.cg_fee_invoice i ON i.id = p.invoice_id
    WHERE i.subject_ref = m9e.id('s1')::text));
SELECT m9e.ok('a receipt exists for the payment', (SELECT count(*) = 1 FROM public.cg_fee_receipt r WHERE r.payment_id = ((SELECT j->>'payment_id' FROM p1))::uuid));
SELECT m9e.ok('the same reference again is a duplicate and posts nothing',
  (SELECT (j->>'duplicate')::boolean AND j->>'payment_id' = (SELECT j->>'payment_id' FROM p1) FROM p1d)
  AND (SELECT count(*) = 1 FROM public.cg_fee_payment WHERE external_reference = 'PSK-TEST-0001'));
SELECT m9e.as_service();
SELECT m9e.err('the same reference with another amount is a conflict (23505)', format($q$SELECT public.cg_fee_post_online_payment(%L, 'PSK-TEST-0001', 5000)$q$, m9e.id('f1')), '23505');
SELECT m9e.back();

-- 2 payments that cannot be mapped safely are parked with a reason and touch no ledger
SELECT m9e.as_service();
CREATE TEMP TABLE q_amb AS SELECT public.cg_fee_post_online_payment(m9e.id('f2'), 'PSK-TEST-0002', 3000) AS j;
CREATE TEMP TABLE q_none AS SELECT public.cg_fee_post_online_payment(m9e.id('f3'), 'PSK-TEST-0003', 3000) AS j;
CREATE TEMP TABLE q_levy AS SELECT public.cg_fee_post_online_payment(m9e.id('f4'), 'PSK-TEST-0004', 2000) AS j;
CREATE TEMP TABLE q_over AS SELECT public.cg_fee_post_online_payment(m9e.id('f5'), 'PSK-TEST-0005', 99999999) AS j;
GRANT SELECT ON q_amb, q_none, q_levy, q_over TO PUBLIC;
SELECT m9e.back();
SELECT m9e.ok('two open invoices: parked as ambiguous', (SELECT j->>'status' = 'unposted' AND j->>'reason' = 'ambiguous_invoices' FROM q_amb));
SELECT m9e.ok('no open invoice: parked', (SELECT j->>'status' = 'unposted' AND j->>'reason' = 'no_open_invoice' FROM q_none));
SELECT m9e.ok('a levy is parked and not applied to the tuition invoice', (SELECT j->>'status' = 'unposted' AND j->>'reason' = 'levy_not_in_ledger' FROM q_levy)
  AND (SELECT sum(l.debit_kobo - l.credit_kobo) = 6000 FROM public.cg_fee_ledger_posting p JOIN public.cg_fee_ledger_line l ON l.posting_id = p.id JOIN public.cg_fee_invoice i ON i.id = p.invoice_id
        WHERE i.subject_ref = m9e.id('s1')::text AND l.account_code = 'accounts_receivable'));
SELECT m9e.ok('an amount above the outstanding balance is parked, not partly posted', (SELECT j->>'status' = 'unposted' AND j->>'reason' = 'exceeds_outstanding' FROM q_over));
SELECT m9e.ok('only the one posted payment was added to the ledger', (SELECT count(*) = b.payments + 1 FROM public.cg_fee_payment, before_state b GROUP BY b.payments));
SELECT m9e.ok('the queue holds one posted and five unposted rows with their five reasons',
  (SELECT count(*) FILTER (WHERE status = 'posted') = 1 AND count(*) FILTER (WHERE status = 'unposted') = 5 AND count(DISTINCT reason) = 5 FROM public.cg_fee_online_posting));
SELECT m9e.as_service();
CREATE TEMP TABLE q_amb2 AS SELECT public.cg_fee_post_online_payment(m9e.id('f2'), 'PSK-TEST-0002', 3000) AS j;
GRANT SELECT ON q_amb2 TO PUBLIC;
SELECT m9e.back();
SELECT m9e.ok('a parked reference repeated returns the parked answer and adds no row', (SELECT (j->>'duplicate')::boolean AND j->>'reason' = 'ambiguous_invoices' FROM q_amb2) AND (SELECT count(*) = 6 FROM public.cg_fee_online_posting));

-- 3 who may call, and what stays closed
SELECT m9e.act('cashier');
SELECT m9e.err('a cashier cannot post an online payment', format($q$SELECT public.cg_fee_post_online_payment(%L, 'PSK-TEST-0009', 1000)$q$, m9e.id('f6')), '42501');
SELECT m9e.err('a cashier cannot record an online payment through the human function', format($q$SELECT public.cg_fee_record_payment((SELECT id FROM public.cg_fee_invoice WHERE subject_ref = %L), 1000, 'online', 'm9e-human', NULL)$q$, m9e.id('s3')::text), '22023');
SELECT m9e.back();
SELECT m9e.ok('anon and authenticated cannot execute the posting function',
  NOT has_function_privilege('anon', 'public.cg_fee_post_online_payment(uuid,text,bigint)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.cg_fee_post_online_payment(uuid,text,bigint)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.cg_fee_post_online_payment(uuid,text,bigint)', 'EXECUTE'));
SELECT m9e.ok('authenticated cannot read the posting queue or the actor setting', NOT has_table_privilege('authenticated', 'public.cg_fee_online_posting', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.cg_fee_online_actor', 'SELECT'));
SELECT m9e.as_service();
SELECT m9e.err('an unknown fee is refused (42704)', 'SELECT public.cg_fee_post_online_payment(gen_random_uuid(), ''PSK-TEST-0010'', 1000)', '42704');
SELECT m9e.err('a non-positive amount is refused (22023)', format($q$SELECT public.cg_fee_post_online_payment(%L, 'PSK-TEST-0011', 0)$q$, m9e.id('f6')), '22023');
SELECT m9e.back();

-- 4 an online payment cannot be refunded through the cashier refund request
SELECT m9e.act('cashier');
SELECT m9e.err('the cashier refund request refuses an online payment (22023)',
  format($q$SELECT public.cg_fee_request_refund(%L, 1000, 'parent asked for money back', 'm9e-refund-1')$q$, ((SELECT j->>'payment_id' FROM p1))::uuid), '22023');
SELECT m9e.back();

-- 5 the ledger stays balanced
SELECT m9e.ok('every posting still has equal debits and credits',
  (SELECT bool_and(d = c) FROM (SELECT p.id, sum(l.debit_kobo) d, sum(l.credit_kobo) c FROM public.cg_fee_ledger_posting p JOIN public.cg_fee_ledger_line l ON l.posting_id = p.id GROUP BY p.id) x));
DO $done$ DECLARE v int; BEGIN SELECT count(*) INTO v FROM m9e.passed; RAISE NOTICE 'M9E ALL PASS: % checks', v; END $done$;
ROLLBACK;
