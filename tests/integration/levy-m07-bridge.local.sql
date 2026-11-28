-- M9B cash path: record_cash_payment posts into the M07 fee ledger. Local disposable Postgres only; rolls back.
BEGIN;
DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'LEVY FAIL: refusing to run outside the local disposable database';
  END IF;
  IF pg_get_functiondef('public.record_cash_payment(uuid,uuid,text,text,numeric,text,text,text,uuid)'::regprocedure) NOT LIKE '%fee_levy_ledger_invoice%' THEN
    RAISE EXCEPTION 'LEVY FAIL: the levy bridge migration must be present';
  END IF;
END $guard$;

CREATE SCHEMA lv;
CREATE TABLE lv.passed (n serial PRIMARY KEY, label text NOT NULL);
CREATE TABLE lv.ids (name text PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid());
INSERT INTO lv.ids (name) VALUES ('org'), ('org2'), ('campus'), ('admin'), ('cashier'), ('bursar'), ('nobody'),
  ('s1'), ('s2'), ('s3'), ('s4'), ('s5'), ('s6'), ('sx'), ('fee1'), ('levy1');
CREATE FUNCTION lv.id(p text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM lv.ids WHERE name = p $$;
CREATE FUNCTION lv.ok(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'LEVY FAIL [%]', p_label; END IF;
  INSERT INTO lv.passed (label) VALUES (p_label);
END $$;
CREATE FUNCTION lv.err(p_label text, p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN INSERT INTO lv.passed (label) VALUES (p_label); RETURN; END IF;
    RAISE EXCEPTION 'LEVY FAIL [%]: expected % got % (%)', p_label, p_state, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'LEVY FAIL [%]: statement was allowed', p_label;
END $$;
CREATE FUNCTION lv.act(p_user text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', lv.id(p_user)::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', lv.id(p_user), 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION lv.back() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;
GRANT USAGE ON SCHEMA lv TO PUBLIC;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA lv TO PUBLIC;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA lv TO PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA lv TO PUBLIC;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) SELECT id FROM lv.ids WHERE name IN ('admin', 'cashier', 'bursar', 'nobody');
INSERT INTO public.schools (id, name, slug) VALUES (lv.id('org'), 'LEVY Org', 'lv-org'), (lv.id('org2'), 'LEVY Org Two', 'lv-org-two');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active)
  SELECT id, lv.id('org'), name, name || '@lv.invalid', 'admin', true FROM lv.ids WHERE name IN ('admin', 'cashier', 'bursar', 'nobody');
INSERT INTO public.organization_memberships (user_id, school_id, role)
  SELECT id, lv.id('org'), 'admin' FROM lv.ids WHERE name IN ('admin', 'cashier', 'bursar', 'nobody');
INSERT INTO public.campuses (id, school_id, name, code) VALUES (lv.id('campus'), lv.id('org'), 'LEVY Campus', 'lv-a');
INSERT INTO public.students (id, school_id, status)
  SELECT id, lv.id('org'), 'active' FROM lv.ids WHERE name IN ('s1', 's2', 's3', 's4', 's5', 's6');
INSERT INTO public.students (id, school_id, status) VALUES (lv.id('sx'), lv.id('org2'), 'active');
INSERT INTO public.cg_org_unit (id, tenant_id, kind, created_by) VALUES ('lv-org-ref', lv.id('org')::text, 'organization', 'lv-fixture');
INSERT INTO public.cg_financial_scope_binding (scope_ref, tenant_id, org_ref, provisioned_by)
  VALUES ('lv-scope', lv.id('org')::text, 'lv-org-ref', 'test');
INSERT INTO public.user_role_assignments (org_id, user_id, role_code, scope_type, scope_ref, started_at) VALUES
  (lv.id('org'), lv.id('cashier'), 'ng.cashier', 'campus', lv.id('campus')::text, now() - interval '1 day'),
  (lv.id('org'), lv.id('bursar'), 'ng.bursar', 'institution', NULL, now() - interval '1 day');
INSERT INTO public.fees (id, school_id, student_id, fee_type, amount, status)
  VALUES (lv.id('fee1'), lv.id('org'), lv.id('s1'), 'tuition', 100, 'unpaid');
SET LOCAL session_replication_role = origin;

-- Invoices through the real M07 path, as the bursar: s1 (one open invoice), s2 (two open invoices), s3 (already settled), s4 (small), s5 (other term)
SELECT lv.act('bursar');
DO $inv$
DECLARE v_sch uuid; v_sch2 uuid; v_sch3 uuid; v_sch4 uuid; v_i uuid;
BEGIN
  v_sch  := public.cg_fee_create_schedule('lv-scope', 'LEVY-TUITION', 'LEVY tuition', '2026/27', 'Term 1', 10000, current_date, NULL);
  v_sch2 := public.cg_fee_create_schedule('lv-scope', 'LEVY-LAB', 'LEVY lab', '2026/27', 'Term 1', 5000, current_date, NULL);
  v_sch3 := public.cg_fee_create_schedule('lv-scope', 'LEVY-TUITION-T2', 'LEVY tuition t2', '2026/27', 'Term 2', 10000, current_date, NULL);
  PERFORM public.cg_fee_issue_invoice('lv-scope', v_sch, lv.id('campus'), lv.id('s1')::text, 'payer-1', now() + interval '14 days');
  PERFORM public.cg_fee_issue_invoice('lv-scope', v_sch, lv.id('campus'), lv.id('s2')::text, 'payer-2', now() + interval '14 days');
  PERFORM public.cg_fee_issue_invoice('lv-scope', v_sch2, lv.id('campus'), lv.id('s2')::text, 'payer-2', now() + interval '14 days');
  PERFORM public.cg_fee_issue_invoice('lv-scope', v_sch, lv.id('campus'), lv.id('s3')::text, 'payer-3', now() + interval '14 days');
  PERFORM public.cg_fee_issue_invoice('lv-scope', v_sch, lv.id('campus'), lv.id('s4')::text, 'payer-4', now() + interval '14 days');
  PERFORM public.cg_fee_issue_invoice('lv-scope', v_sch3, lv.id('campus'), lv.id('s5')::text, 'payer-5', now() + interval '14 days');
END $inv$;
SELECT lv.back();

-- 1 legacy call posts to the ledger and keeps the legacy records

-- Levy for every active student (s1..s6), created the legacy way by the admin.
SELECT lv.act('admin');
CREATE TEMP TABLE lev AS SELECT public.fee_levy_create(lv.id('org'), 'Sports levy', 20.00, 'Term 1', '2026/27', NULL, current_date + 30) AS j;
GRANT SELECT ON lev TO PUBLIC;
SELECT lv.back();
SELECT lv.ok('the legacy levy charged 6 students', (SELECT (j->>'charged_now')::int = 6 FROM lev));

-- 1 the bursar issues the levy invoices into M07
SELECT lv.act('bursar');
CREATE TEMP TABLE i1 AS SELECT public.fee_levy_ledger_issue((SELECT (j->>'levy')::uuid FROM lev), 'lv-scope', lv.id('campus')) AS j;
CREATE TEMP TABLE i2 AS SELECT public.fee_levy_ledger_issue((SELECT (j->>'levy')::uuid FROM lev), 'lv-scope', lv.id('campus')) AS j;
GRANT SELECT ON i1, i2 TO PUBLIC;
SELECT lv.back();
SELECT lv.ok('six invoices were issued and none remain', (SELECT (j->>'issued')::int = 6 AND (j->>'remaining')::int = 0 FROM i1));
SELECT lv.ok('issuing again creates nothing (idempotent)', (SELECT (j->>'issued')::int = 0 FROM i2));
SELECT lv.ok('one schedule exists for the levy at 2000 kobo', (SELECT count(*) = 1 FROM public.cg_fee_schedule WHERE label = 'Levy: Sports levy' AND amount_kobo = 2000));
SELECT lv.ok('each levy invoice is for the student, 2000 kobo, due on the levy due date',
  (SELECT count(*) = 6 AND bool_and(i.amount_kobo = 2000 AND i.subject_ref = f.student_id::text AND i.due_at::date = current_date + 30)
     FROM public.fee_levy_ledger_invoice li JOIN public.cg_fee_invoice i ON i.id = li.invoice_id JOIN public.fees f ON f.id = li.fee_id));

-- 2 levy cash posts to the levy invoice, not the tuition invoice
CREATE TEMP TABLE lf AS SELECT f.id AS fee_id, li.invoice_id FROM public.fees f JOIN public.fee_levy_ledger_invoice li ON li.fee_id = f.id WHERE f.student_id = lv.id('s1');
GRANT SELECT ON lf TO PUBLIC;
SELECT lv.act('cashier');
CREATE TEMP TABLE p1 AS SELECT public.record_cash_payment(lv.id('org'), lv.id('s1'), '2026/27', 'Term 1', 5.00, 'cash', NULL, 'LV-1', (SELECT fee_id FROM lf)) AS j;
GRANT SELECT ON p1 TO PUBLIC;
SELECT lv.back();
SELECT lv.ok('the call reports the ledger was posted', (SELECT (j->>'ledger_posted')::boolean AND j->>'ledger_payment' IS NOT NULL FROM p1));
SELECT lv.ok('the 500 kobo payment is on the levy invoice',
  (SELECT count(*) = 1 FROM public.cg_fee_payment p WHERE p.invoice_id = (SELECT invoice_id FROM lf) AND p.amount_kobo = 500 AND p.external_reference = 'LV-1'));
SELECT lv.ok('the levy invoice balance fell from 2000 to 1500',
  (SELECT sum(l.debit_kobo - l.credit_kobo) = 1500 FROM public.cg_fee_ledger_posting p JOIN public.cg_fee_ledger_line l ON l.posting_id = p.id
    WHERE p.invoice_id = (SELECT invoice_id FROM lf) AND l.account_code = 'accounts_receivable'));
SELECT lv.ok('the tuition invoice of the same student is untouched at 10000',
  (SELECT sum(l.debit_kobo - l.credit_kobo) = 10000 FROM public.cg_fee_ledger_posting p JOIN public.cg_fee_ledger_line l ON l.posting_id = p.id
    JOIN public.cg_fee_invoice i ON i.id = p.invoice_id JOIN public.cg_fee_schedule s ON s.id = i.schedule_id
   WHERE i.subject_ref = lv.id('s1')::text AND s.code = 'LEVY-TUITION' AND l.account_code = 'accounts_receivable'));

-- 3 a levy fee that has no invoice behaves as before: recorded, not posted
INSERT INTO public.fees (id, school_id, student_id, fee_type, amount, term, academic_year, status)
  VALUES (lv.id('levy1'), lv.id('org'), lv.id('s3'), 'levy:Late levy', 10, 'Term 1', '2026/27', 'unpaid');
SELECT lv.act('cashier');
CREATE TEMP TABLE p2 AS SELECT public.record_cash_payment(lv.id('org'), lv.id('s3'), '2026/27', 'Term 1', 3.00, 'cash', NULL, 'LV-2', lv.id('levy1')) AS j;
GRANT SELECT ON p2 TO PUBLIC;
SELECT lv.back();
SELECT lv.ok('an unissued levy is recorded but not posted', (SELECT NOT (j->>'ledger_posted')::boolean AND j->>'ledger_payment' IS NULL FROM p2)
  AND (SELECT count(*) = 1 FROM public.offline_payments WHERE receipt_no = 'LV-2'));

-- 4 paying more than is outstanding on the levy invoice is refused by the ledger, and nothing is left behind
SELECT lv.act('cashier');
SELECT lv.err('overpaying the levy invoice is refused',
  format($q$SELECT public.record_cash_payment(%L,%L,'2026/27','Term 1',100,'cash',NULL,'LV-3',%L)$q$, lv.id('org'), lv.id('s1'), (SELECT fee_id FROM lf)), '23514');
SELECT lv.back();
SELECT lv.ok('the refused payment left no offline payment', NOT EXISTS (SELECT 1 FROM public.offline_payments WHERE receipt_no = 'LV-3'));

-- 5 authorisation
SELECT lv.act('cashier');
SELECT lv.err('a cashier cannot issue levy invoices',
  format($q$SELECT public.fee_levy_ledger_issue(%L, 'lv-scope', %L)$q$, (SELECT (j->>'levy')::uuid FROM lev), lv.id('campus')), '42501');
SELECT lv.back();
INSERT INTO public.cg_financial_scope_binding (scope_ref, tenant_id, org_ref, provisioned_by) VALUES ('lv-scope-2', lv.id('org')::text, 'lv-org-ref', 'test');
SELECT lv.act('bursar');
SELECT lv.err('a campus outside the school is refused',
  format($q$SELECT public.fee_levy_ledger_issue(%L, 'lv-scope', %L)$q$, (SELECT (j->>'levy')::uuid FROM lev), gen_random_uuid()), '22023');
SELECT lv.err('a second valid scope for an already issued levy is refused',
  format($q$SELECT public.fee_levy_ledger_issue(%L, 'lv-scope-2', %L)$q$, (SELECT (j->>'levy')::uuid FROM lev), lv.id('campus')), '22023');
SELECT lv.back();
SELECT lv.act('nobody');
SELECT lv.err('a user with no finance role is refused',
  format($q$SELECT public.fee_levy_ledger_issue(%L, 'lv-scope', %L)$q$, (SELECT (j->>'levy')::uuid FROM lev), lv.id('campus')), '42501');
SELECT lv.back();
SELECT lv.err('an unknown scope is refused by the ledger authorisation',
  format($q$SELECT public.fee_levy_ledger_issue(%L, 'no-such-scope', %L)$q$, (SELECT (j->>'levy')::uuid FROM lev), lv.id('campus')), '42501');
SELECT lv.ok('the link tables are closed to signed-in users',
  NOT has_table_privilege('authenticated', 'public.fee_levy_ledger_invoice', 'SELECT') AND NOT has_table_privilege('anon', 'public.fee_levy_ledger_schedule', 'SELECT'));

DO $done$ BEGIN RAISE NOTICE 'LEVY ALL PASS: % checks', (SELECT count(*) FROM lv.passed); END $done$;
ROLLBACK;
