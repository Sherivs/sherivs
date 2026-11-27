-- M9B cash path: record_cash_payment posts into the M07 fee ledger. Local disposable Postgres only; rolls back.
BEGIN;
DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'M9C FAIL: refusing to run outside the local disposable database';
  END IF;
  IF pg_get_functiondef('public.record_cash_payment(uuid,uuid,text,text,numeric,text,text,text,uuid)'::regprocedure) NOT LIKE '%cg_fee_record_payment%' THEN
    RAISE EXCEPTION 'M9C FAIL: the cash-path migration must be present';
  END IF;
END $guard$;

CREATE SCHEMA m9c;
CREATE TABLE m9c.passed (n serial PRIMARY KEY, label text NOT NULL);
CREATE TABLE m9c.ids (name text PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid());
INSERT INTO m9c.ids (name) VALUES ('org'), ('org2'), ('campus'), ('admin'), ('cashier'), ('bursar'), ('nobody'),
  ('s1'), ('s2'), ('s3'), ('s4'), ('s5'), ('s6'), ('sx'), ('fee1');
CREATE FUNCTION m9c.id(p text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM m9c.ids WHERE name = p $$;
CREATE FUNCTION m9c.ok(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'M9C FAIL [%]', p_label; END IF;
  INSERT INTO m9c.passed (label) VALUES (p_label);
END $$;
CREATE FUNCTION m9c.err(p_label text, p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN INSERT INTO m9c.passed (label) VALUES (p_label); RETURN; END IF;
    RAISE EXCEPTION 'M9C FAIL [%]: expected % got % (%)', p_label, p_state, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'M9C FAIL [%]: statement was allowed', p_label;
END $$;
CREATE FUNCTION m9c.act(p_user text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', m9c.id(p_user)::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', m9c.id(p_user), 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION m9c.back() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;
GRANT USAGE ON SCHEMA m9c TO PUBLIC;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA m9c TO PUBLIC;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA m9c TO PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA m9c TO PUBLIC;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) SELECT id FROM m9c.ids WHERE name IN ('admin', 'cashier', 'bursar', 'nobody');
INSERT INTO public.schools (id, name, slug) VALUES (m9c.id('org'), 'M9C Org', 'm9c-org'), (m9c.id('org2'), 'M9C Org Two', 'm9c-org-two');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active)
  SELECT id, m9c.id('org'), name, name || '@m9c.invalid', 'admin', true FROM m9c.ids WHERE name IN ('admin', 'cashier', 'bursar', 'nobody');
INSERT INTO public.organization_memberships (user_id, school_id, role)
  SELECT id, m9c.id('org'), 'admin' FROM m9c.ids WHERE name IN ('admin', 'cashier', 'bursar', 'nobody');
INSERT INTO public.campuses (id, school_id, name, code) VALUES (m9c.id('campus'), m9c.id('org'), 'M9C Campus', 'm9c-a');
INSERT INTO public.students (id, school_id, status)
  SELECT id, m9c.id('org'), 'active' FROM m9c.ids WHERE name IN ('s1', 's2', 's3', 's4', 's5', 's6');
INSERT INTO public.students (id, school_id, status) VALUES (m9c.id('sx'), m9c.id('org2'), 'active');
INSERT INTO public.cg_org_unit (id, tenant_id, kind, created_by) VALUES ('m9c-org-ref', m9c.id('org')::text, 'organization', 'm9c-fixture');
INSERT INTO public.cg_financial_scope_binding (scope_ref, tenant_id, org_ref, provisioned_by)
  VALUES ('m9c-scope', m9c.id('org')::text, 'm9c-org-ref', 'test');
INSERT INTO public.user_role_assignments (org_id, user_id, role_code, scope_type, scope_ref, started_at) VALUES
  (m9c.id('org'), m9c.id('cashier'), 'ng.cashier', 'campus', m9c.id('campus')::text, now() - interval '1 day'),
  (m9c.id('org'), m9c.id('bursar'), 'ng.bursar', 'institution', NULL, now() - interval '1 day');
INSERT INTO public.fees (id, school_id, student_id, fee_type, amount, status)
  VALUES (m9c.id('fee1'), m9c.id('org'), m9c.id('s1'), 'tuition', 100, 'unpaid');
SET LOCAL session_replication_role = origin;

-- Invoices through the real M07 path, as the bursar: s1 (one open invoice), s2 (two open invoices), s3 (already settled), s4 (small), s5 (other term)
SELECT m9c.act('bursar');
DO $inv$
DECLARE v_sch uuid; v_sch2 uuid; v_sch3 uuid; v_sch4 uuid; v_i uuid;
BEGIN
  v_sch  := public.cg_fee_create_schedule('m9c-scope', 'M9C-TUITION', 'M9C tuition', '2026/27', 'Term 1', 10000, current_date, NULL);
  v_sch2 := public.cg_fee_create_schedule('m9c-scope', 'M9C-LAB', 'M9C lab', '2026/27', 'Term 1', 5000, current_date, NULL);
  v_sch3 := public.cg_fee_create_schedule('m9c-scope', 'M9C-TUITION-T2', 'M9C tuition t2', '2026/27', 'Term 2', 10000, current_date, NULL);
  PERFORM public.cg_fee_issue_invoice('m9c-scope', v_sch, m9c.id('campus'), m9c.id('s1')::text, 'payer-1', now() + interval '14 days');
  PERFORM public.cg_fee_issue_invoice('m9c-scope', v_sch, m9c.id('campus'), m9c.id('s2')::text, 'payer-2', now() + interval '14 days');
  PERFORM public.cg_fee_issue_invoice('m9c-scope', v_sch2, m9c.id('campus'), m9c.id('s2')::text, 'payer-2', now() + interval '14 days');
  PERFORM public.cg_fee_issue_invoice('m9c-scope', v_sch, m9c.id('campus'), m9c.id('s3')::text, 'payer-3', now() + interval '14 days');
  PERFORM public.cg_fee_issue_invoice('m9c-scope', v_sch, m9c.id('campus'), m9c.id('s4')::text, 'payer-4', now() + interval '14 days');
  PERFORM public.cg_fee_issue_invoice('m9c-scope', v_sch3, m9c.id('campus'), m9c.id('s5')::text, 'payer-5', now() + interval '14 days');
END $inv$;
SELECT m9c.back();

-- 1 legacy call posts to the ledger and keeps the legacy records
SELECT m9c.act('cashier');
CREATE TEMP TABLE r1 AS SELECT public.record_cash_payment(m9c.id('org'), m9c.id('s1'), '2026/27', 'Term 1', 30.00, 'cash', NULL, 'RCPT-1', m9c.id('fee1')) AS j;
GRANT SELECT ON r1 TO PUBLIC;
SELECT m9c.back();
SELECT m9c.ok('the call returns the ledger payment and receipt number',
  (SELECT j->>'ledger_payment' IS NOT NULL AND (j->>'receipt_number')::bigint > 0 AND j->>'offline_payment' IS NOT NULL FROM r1));
SELECT m9c.ok('the ledger holds a 3000 kobo cash payment against the student invoice',
  (SELECT count(*) = 1 FROM public.cg_fee_payment p JOIN public.cg_fee_invoice i ON i.id = p.invoice_id
    WHERE i.subject_ref = m9c.id('s1')::text AND p.amount_kobo = 3000 AND p.method = 'cash' AND p.external_reference = 'RCPT-1'));
SELECT m9c.ok('the ledger balance fell from 10000 to 7000',
  (SELECT sum(l.debit_kobo - l.credit_kobo) = 7000 FROM public.cg_fee_ledger_posting p JOIN public.cg_fee_ledger_line l ON l.posting_id = p.id
    JOIN public.cg_fee_invoice i ON i.id = p.invoice_id WHERE i.subject_ref = m9c.id('s1')::text AND l.account_code = 'accounts_receivable'));
SELECT m9c.ok('the cash account was debited by the same amount',
  (SELECT sum(l.debit_kobo - l.credit_kobo) = 3000 FROM public.cg_fee_ledger_posting p JOIN public.cg_fee_ledger_line l ON l.posting_id = p.id
    JOIN public.cg_fee_invoice i ON i.id = p.invoice_id WHERE i.subject_ref = m9c.id('s1')::text AND l.account_code = 'cash'));
SELECT m9c.ok('a receipt exists for the payment',
  (SELECT count(*) = 1 FROM public.cg_fee_receipt r WHERE r.payment_id = ((SELECT j->>'ledger_payment' FROM r1))::uuid));
SELECT m9c.ok('the legacy offline payment row is kept',
  (SELECT count(*) = 1 FROM public.offline_payments WHERE student_id = m9c.id('s1') AND amount = 30 AND receipt_no = 'RCPT-1'));
SELECT m9c.ok('the legacy fee row is updated as before',
  (SELECT paid_amount = 30 AND status = 'partial' FROM public.fees WHERE id = m9c.id('fee1')));

-- 2 methods
SELECT m9c.act('cashier');
SELECT public.record_cash_payment(m9c.id('org'), m9c.id('s1'), '2026/27', 'Term 1', 10.00, 'bank_deposit', NULL, 'RCPT-2', NULL);
SELECT public.record_cash_payment(m9c.id('org'), m9c.id('s1'), '2026/27', 'Term 1', 5.00, 'pos', NULL, 'RCPT-3', NULL);
SELECT m9c.back();
SELECT m9c.ok('bank_deposit posts as bank_transfer and pos as pos',
  (SELECT count(*) FILTER (WHERE p.method = 'bank_transfer' AND p.amount_kobo = 1000) = 1
      AND count(*) FILTER (WHERE p.method = 'pos' AND p.amount_kobo = 500) = 1
     FROM public.cg_fee_payment p JOIN public.cg_fee_invoice i ON i.id = p.invoice_id WHERE i.subject_ref = m9c.id('s1')::text));

-- 3 refusals leave nothing behind (the whole call is one transaction)
SELECT m9c.act('cashier');
SELECT m9c.err('a cheque cannot be posted to the fee ledger',
  format($q$SELECT public.record_cash_payment(%L,%L,'2026/27','Term 1',10,'cheque',NULL,'RCPT-X1',NULL)$q$, m9c.id('org'), m9c.id('s4')), '22023');
SELECT m9c.err('an amount with fractions of a kobo is refused',
  format($q$SELECT public.record_cash_payment(%L,%L,'2026/27','Term 1',10.005,'cash',NULL,'RCPT-X2',NULL)$q$, m9c.id('org'), m9c.id('s4')), '22023');
SELECT m9c.err('a student with no invoice for that year and term has nowhere to post',
  format($q$SELECT public.record_cash_payment(%L,%L,'2026/27','Term 1',10,'cash',NULL,'RCPT-X3',NULL)$q$, m9c.id('org'), m9c.id('s6')), 'P0002');
SELECT m9c.err('the wrong term finds no invoice',
  format($q$SELECT public.record_cash_payment(%L,%L,'2026/27','Term 1',10,'cash',NULL,'RCPT-X4',NULL)$q$, m9c.id('org'), m9c.id('s5')), 'P0002');
SELECT m9c.err('two open invoices for the same year and term is ambiguous, not guessed',
  format($q$SELECT public.record_cash_payment(%L,%L,'2026/27','Term 1',10,'cash',NULL,'RCPT-X5',NULL)$q$, m9c.id('org'), m9c.id('s2')), '22023');
SELECT m9c.err('a payment above the outstanding balance is refused by the ledger',
  format($q$SELECT public.record_cash_payment(%L,%L,'2026/27','Term 1',500,'cash',NULL,'RCPT-X6',NULL)$q$, m9c.id('org'), m9c.id('s4')), '23514');
SELECT m9c.err('a student of another organisation is refused',
  format($q$SELECT public.record_cash_payment(%L,%L,'2026/27','Term 1',10,'cash',NULL,'RCPT-X7',NULL)$q$, m9c.id('org'), m9c.id('sx')), 'P0001');
SELECT m9c.err('a receipt reference or photo is still required',
  format($q$SELECT public.record_cash_payment(%L,%L,'2026/27','Term 1',10,'cash',NULL,NULL,NULL)$q$, m9c.id('org'), m9c.id('s4')), 'P0001');
SELECT m9c.back();
SELECT m9c.ok('none of the refused calls left an offline payment or a ledger payment',
  (SELECT count(*) = 0 FROM public.offline_payments WHERE receipt_no LIKE 'RCPT-X%')
  AND (SELECT count(*) = 0 FROM public.cg_fee_payment p JOIN public.cg_fee_invoice i ON i.id = p.invoice_id
        WHERE i.subject_ref IN (m9c.id('s2')::text, m9c.id('s4')::text, m9c.id('s5')::text, m9c.id('s6')::text)));

-- 4 a settled invoice is no longer open
SELECT m9c.act('cashier');
SELECT public.record_cash_payment(m9c.id('org'), m9c.id('s3'), '2026/27', 'Term 1', 100.00, 'cash', NULL, 'RCPT-4', NULL);
SELECT m9c.err('once settled, the invoice cannot take another payment',
  format($q$SELECT public.record_cash_payment(%L,%L,'2026/27','Term 1',1,'cash',NULL,'RCPT-X8',NULL)$q$, m9c.id('org'), m9c.id('s3')), 'P0002');
SELECT m9c.back();

-- 5 who may call
SELECT m9c.act('nobody');
SELECT m9c.err('a user with no cashier role cannot record cash',
  format($q$SELECT public.record_cash_payment(%L,%L,'2026/27','Term 1',10,'cash',NULL,'RCPT-X9',NULL)$q$, m9c.id('org'), m9c.id('s4')), '42501');
SELECT m9c.back();
SELECT m9c.ok('the grants are unchanged: authenticated yes, anon no',
  has_function_privilege('authenticated', 'public.record_cash_payment(uuid,uuid,text,text,numeric,text,text,text,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.record_cash_payment(uuid,uuid,text,text,numeric,text,text,text,uuid)', 'EXECUTE'));

DO $done$
DECLARE n int; BEGIN SELECT count(*) INTO n FROM m9c.passed; RAISE NOTICE 'M9C ALL PASS: % checks', n; END $done$;
ROLLBACK;
