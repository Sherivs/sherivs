-- M9B open invoices for the cash picker: cash_open_invoices_for_student is read-only and authorised. Local disposable Postgres only; rolls back.
BEGIN;
DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'M9D FAIL: refusing to run outside the local disposable database';
  END IF;
  IF to_regprocedure('public.cash_open_invoices_for_student(uuid,uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'M9D FAIL: the open-invoices migration must be present';
  END IF;
END $guard$;

CREATE SCHEMA m9d;
CREATE TABLE m9d.passed (n serial PRIMARY KEY, label text NOT NULL);
CREATE TABLE m9d.ids (name text PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid());
INSERT INTO m9d.ids (name) VALUES ('org'), ('org2'), ('campus'), ('admin'), ('cashier'), ('bursar'), ('nobody'),
  ('s1'), ('s2'), ('s3'), ('s4'), ('s5'), ('s6'), ('sx'), ('fee1');
CREATE FUNCTION m9d.id(p text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM m9d.ids WHERE name = p $$;
CREATE FUNCTION m9d.ok(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'M9D FAIL [%]', p_label; END IF;
  INSERT INTO m9d.passed (label) VALUES (p_label);
END $$;
CREATE FUNCTION m9d.err(p_label text, p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN INSERT INTO m9d.passed (label) VALUES (p_label); RETURN; END IF;
    RAISE EXCEPTION 'M9D FAIL [%]: expected % got % (%)', p_label, p_state, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'M9D FAIL [%]: statement was allowed', p_label;
END $$;
CREATE FUNCTION m9d.act(p_user text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', m9d.id(p_user)::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', m9d.id(p_user), 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION m9d.back() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;
GRANT USAGE ON SCHEMA m9d TO PUBLIC;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA m9d TO PUBLIC;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA m9d TO PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA m9d TO PUBLIC;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) SELECT id FROM m9d.ids WHERE name IN ('admin', 'cashier', 'bursar', 'nobody');
INSERT INTO public.schools (id, name, slug) VALUES (m9d.id('org'), 'M9D Org', 'm9d-org'), (m9d.id('org2'), 'M9D Org Two', 'm9d-org-two');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active)
  SELECT id, m9d.id('org'), name, name || '@m9d.invalid', 'admin', true FROM m9d.ids WHERE name IN ('admin', 'cashier', 'bursar', 'nobody');
INSERT INTO public.organization_memberships (user_id, school_id, role)
  SELECT id, m9d.id('org'), 'admin' FROM m9d.ids WHERE name IN ('admin', 'cashier', 'bursar', 'nobody');
INSERT INTO public.campuses (id, school_id, name, code) VALUES (m9d.id('campus'), m9d.id('org'), 'M9D Campus', 'm9d-a');
INSERT INTO public.students (id, school_id, status)
  SELECT id, m9d.id('org'), 'active' FROM m9d.ids WHERE name IN ('s1', 's2', 's3', 's4', 's5', 's6');
INSERT INTO public.students (id, school_id, status) VALUES (m9d.id('sx'), m9d.id('org2'), 'active');
INSERT INTO public.cg_org_unit (id, tenant_id, kind, created_by) VALUES ('m9d-org-ref', m9d.id('org')::text, 'organization', 'm9d-fixture');
INSERT INTO public.cg_financial_scope_binding (scope_ref, tenant_id, org_ref, provisioned_by)
  VALUES ('m9d-scope', m9d.id('org')::text, 'm9d-org-ref', 'test');
INSERT INTO public.user_role_assignments (org_id, user_id, role_code, scope_type, scope_ref, started_at) VALUES
  (m9d.id('org'), m9d.id('cashier'), 'ng.cashier', 'campus', m9d.id('campus')::text, now() - interval '1 day'),
  (m9d.id('org'), m9d.id('bursar'), 'ng.bursar', 'institution', NULL, now() - interval '1 day');
INSERT INTO public.fees (id, school_id, student_id, fee_type, amount, status)
  VALUES (m9d.id('fee1'), m9d.id('org'), m9d.id('s1'), 'tuition', 100, 'unpaid');
SET LOCAL session_replication_role = origin;

-- Invoices through the real M07 path, as the bursar: s1 (one open invoice), s2 (two open invoices), s3 (already settled), s4 (small), s5 (other term)
SELECT m9d.act('bursar');
DO $inv$
DECLARE v_sch uuid; v_sch2 uuid; v_sch3 uuid; v_sch4 uuid; v_i uuid;
BEGIN
  v_sch  := public.cg_fee_create_schedule('m9d-scope', 'M9D-TUITION', 'M9D tuition', '2026/27', 'Term 1', 10000, current_date, NULL);
  v_sch2 := public.cg_fee_create_schedule('m9d-scope', 'M9D-LAB', 'M9D lab', '2026/27', 'Term 1', 5000, current_date, NULL);
  v_sch3 := public.cg_fee_create_schedule('m9d-scope', 'M9D-TUITION-T2', 'M9D tuition t2', '2026/27', 'Term 2', 10000, current_date, NULL);
  PERFORM public.cg_fee_issue_invoice('m9d-scope', v_sch, m9d.id('campus'), m9d.id('s1')::text, 'payer-1', now() + interval '14 days');
  PERFORM public.cg_fee_issue_invoice('m9d-scope', v_sch, m9d.id('campus'), m9d.id('s2')::text, 'payer-2', now() + interval '14 days');
  PERFORM public.cg_fee_issue_invoice('m9d-scope', v_sch2, m9d.id('campus'), m9d.id('s2')::text, 'payer-2', now() + interval '14 days');
  PERFORM public.cg_fee_issue_invoice('m9d-scope', v_sch, m9d.id('campus'), m9d.id('s3')::text, 'payer-3', now() + interval '14 days');
  PERFORM public.cg_fee_issue_invoice('m9d-scope', v_sch, m9d.id('campus'), m9d.id('s4')::text, 'payer-4', now() + interval '14 days');
  PERFORM public.cg_fee_issue_invoice('m9d-scope', v_sch3, m9d.id('campus'), m9d.id('s5')::text, 'payer-5', now() + interval '14 days');
END $inv$;
SELECT m9d.back();

-- 1 legacy call posts to the ledger and keeps the legacy records

CREATE TEMP TABLE before_state AS SELECT (SELECT count(*) FROM public.cg_fee_payment) AS payments,
  (SELECT count(*) FROM public.cg_fee_ledger_posting) AS postings, (SELECT count(*) FROM public.offline_payments) AS offline;
GRANT SELECT ON before_state TO PUBLIC;

-- 1 a cashier sees every open invoice with its outstanding balance
SELECT m9d.act('cashier');
CREATE TEMP TABLE o_s2 AS SELECT * FROM public.cash_open_invoices_for_student(m9d.id('org'), m9d.id('s2'), '2026/27', 'Term 1');
CREATE TEMP TABLE o_s1 AS SELECT * FROM public.cash_open_invoices_for_student(m9d.id('org'), m9d.id('s1'));
GRANT SELECT ON o_s2, o_s1 TO PUBLIC;
SELECT m9d.back();
SELECT m9d.ok('a student with two open invoices lists both', (SELECT count(*) = 2 FROM o_s2));
SELECT m9d.ok('the outstanding balances are 10000 and 5000 kobo', (SELECT array_agg(outstanding_kobo ORDER BY outstanding_kobo) = ARRAY[5000::bigint, 10000] FROM o_s2));
SELECT m9d.ok('each row names its schedule, year, term and campus',
  (SELECT bool_and(schedule_name IS NOT NULL AND academic_year = '2026/27' AND term = 'Term 1' AND campus_id = m9d.id('campus') AND invoice_id IS NOT NULL) FROM o_s2));
SELECT m9d.ok('year and term are optional filters (none given lists the student open invoices)', (SELECT count(*) = 1 FROM o_s1));

-- 2 term filter
SELECT m9d.act('cashier');
CREATE TEMP TABLE o_s5a AS SELECT * FROM public.cash_open_invoices_for_student(m9d.id('org'), m9d.id('s5'), '2026/27', 'Term 2');
CREATE TEMP TABLE o_s5b AS SELECT * FROM public.cash_open_invoices_for_student(m9d.id('org'), m9d.id('s5'), '2026/27', 'Term 1');
GRANT SELECT ON o_s5a, o_s5b TO PUBLIC;
SELECT m9d.back();
SELECT m9d.ok('the term filter returns the matching invoice', (SELECT count(*) = 1 FROM o_s5a));
SELECT m9d.ok('another term returns nothing', (SELECT count(*) = 0 FROM o_s5b));

-- 3 a payment through the real ledger path lowers the outstanding balance; a settled invoice drops out
SELECT m9d.act('cashier');
SELECT public.cg_fee_record_payment((SELECT invoice_id FROM o_s1 LIMIT 1), 3000, 'cash', 'm9d-p1', 'R-1');
SELECT public.cg_fee_record_payment((SELECT i.id FROM public.cg_fee_invoice i WHERE i.subject_ref = m9d.id('s3')::text), 10000, 'cash', 'm9d-p3', 'R-3');
CREATE TEMP TABLE o_s1b AS SELECT * FROM public.cash_open_invoices_for_student(m9d.id('org'), m9d.id('s1'));
CREATE TEMP TABLE o_s3 AS SELECT * FROM public.cash_open_invoices_for_student(m9d.id('org'), m9d.id('s3'));
GRANT SELECT ON o_s1b, o_s3 TO PUBLIC;
SELECT m9d.back();
SELECT m9d.ok('after a 3000 kobo payment the outstanding balance is 7000', (SELECT count(*) = 1 AND min(outstanding_kobo) = 7000 AND min(amount_kobo) = 10000 FROM o_s1b));
SELECT m9d.ok('a fully paid invoice is not listed', (SELECT count(*) = 0 FROM o_s3));

-- 4 refusals
SET LOCAL session_replication_role = replica;
UPDATE public.users SET role = 'parent' WHERE id = m9d.id('nobody');
DELETE FROM public.organization_memberships WHERE user_id = m9d.id('nobody');
SET LOCAL session_replication_role = origin;
SELECT m9d.act('nobody');
SELECT m9d.err('a user without payments.record_cash is refused (42501)',
  format('SELECT * FROM public.cash_open_invoices_for_student(%L, %L)', m9d.id('org'), m9d.id('s1')), '42501');
SELECT m9d.back();
SELECT m9d.act('cashier');
SELECT m9d.err('a student from another school is refused (22023)',
  format('SELECT * FROM public.cash_open_invoices_for_student(%L, %L)', m9d.id('org'), m9d.id('sx')), '22023');
SELECT m9d.err('a school the caller cannot act in is refused (42501)',
  format('SELECT * FROM public.cash_open_invoices_for_student(%L, %L)', m9d.id('org2'), m9d.id('sx')), '42501');
SELECT m9d.back();
SELECT m9d.ok('anon cannot execute the function',
  NOT has_function_privilege('anon', 'public.cash_open_invoices_for_student(uuid,uuid,text,text)', 'EXECUTE'));
SELECT m9d.ok('authenticated and service_role can execute it',
  has_function_privilege('authenticated', 'public.cash_open_invoices_for_student(uuid,uuid,text,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.cash_open_invoices_for_student(uuid,uuid,text,text)', 'EXECUTE'));
SELECT m9d.ok('the function is stable, security definer with an empty search_path',
  (SELECT provolatile = 's' AND prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = 'public.cash_open_invoices_for_student(uuid,uuid,text,text)'::regprocedure));
SELECT m9d.ok('listing wrote nothing beyond the two test payments (no offline payment, one payment and one posting each)',
  (SELECT (SELECT count(*) FROM public.cg_fee_payment) = b.payments + 2 AND (SELECT count(*) FROM public.cg_fee_ledger_posting) = b.postings + 2
          AND (SELECT count(*) FROM public.offline_payments) = b.offline FROM before_state b));
DO $done$ DECLARE v int; BEGIN SELECT count(*) INTO v FROM m9d.passed; RAISE NOTICE 'M9D ALL PASS: % checks', v; END $done$;
ROLLBACK;
