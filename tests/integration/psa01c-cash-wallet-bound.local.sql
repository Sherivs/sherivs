-- M9B cash path: record_cash_payment posts into the M07 fee ledger. Local disposable Postgres only; rolls back.
BEGIN;
DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'WBND FAIL: refusing to run outside the local disposable database';
  END IF;
  IF pg_get_functiondef('public.record_cash_payment(uuid,uuid,text,text,numeric,text,text,text,uuid)'::regprocedure) NOT LIKE '%share_parked%' THEN
    RAISE EXCEPTION 'WBND FAIL: the wallet-bound migration must be present';
  END IF;
END $guard$;

CREATE SCHEMA wb;
CREATE TABLE wb.passed (n serial PRIMARY KEY, label text NOT NULL);
CREATE TABLE wb.ids (name text PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid());
INSERT INTO wb.ids (name) VALUES ('org'), ('org2'), ('campus'), ('admin'), ('cashier'), ('bursar'), ('nobody'),
  ('s1'), ('s2'), ('s3'), ('s4'), ('s5'), ('s6'), ('sx'), ('fee1'), ('levy1');
CREATE FUNCTION wb.id(p text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM wb.ids WHERE name = p $$;
CREATE FUNCTION wb.ok(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'WBND FAIL [%]', p_label; END IF;
  INSERT INTO wb.passed (label) VALUES (p_label);
END $$;
CREATE FUNCTION wb.err(p_label text, p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN INSERT INTO wb.passed (label) VALUES (p_label); RETURN; END IF;
    RAISE EXCEPTION 'WBND FAIL [%]: expected % got % (%)', p_label, p_state, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'WBND FAIL [%]: statement was allowed', p_label;
END $$;
CREATE FUNCTION wb.act(p_user text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', wb.id(p_user)::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', wb.id(p_user), 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION wb.back() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;
GRANT USAGE ON SCHEMA wb TO PUBLIC;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA wb TO PUBLIC;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA wb TO PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wb TO PUBLIC;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) SELECT id FROM wb.ids WHERE name IN ('admin', 'cashier', 'bursar', 'nobody');
INSERT INTO public.schools (id, name, slug) VALUES (wb.id('org'), 'WBND Org', 'wb-org'), (wb.id('org2'), 'WBND Org Two', 'wb-org-two');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active)
  SELECT id, wb.id('org'), name, name || '@wb.invalid', 'admin', true FROM wb.ids WHERE name IN ('admin', 'cashier', 'bursar', 'nobody');
INSERT INTO public.organization_memberships (user_id, school_id, role)
  SELECT id, wb.id('org'), 'admin' FROM wb.ids WHERE name IN ('admin', 'cashier', 'bursar', 'nobody');
INSERT INTO public.campuses (id, school_id, name, code) VALUES (wb.id('campus'), wb.id('org'), 'WBND Campus', 'wb-a');
INSERT INTO public.students (id, school_id, status)
  SELECT id, wb.id('org'), 'active' FROM wb.ids WHERE name IN ('s1', 's2', 's3', 's4', 's5', 's6');
INSERT INTO public.students (id, school_id, status) VALUES (wb.id('sx'), wb.id('org2'), 'active');
INSERT INTO public.cg_org_unit (id, tenant_id, kind, created_by) VALUES ('wb-org-ref', wb.id('org')::text, 'organization', 'wb-fixture');
INSERT INTO public.cg_financial_scope_binding (scope_ref, tenant_id, org_ref, provisioned_by)
  VALUES ('wb-scope', wb.id('org')::text, 'wb-org-ref', 'test');
INSERT INTO public.user_role_assignments (org_id, user_id, role_code, scope_type, scope_ref, started_at) VALUES
  (wb.id('org'), wb.id('cashier'), 'ng.cashier', 'campus', wb.id('campus')::text, now() - interval '1 day'),
  (wb.id('org'), wb.id('bursar'), 'ng.bursar', 'institution', NULL, now() - interval '1 day');
INSERT INTO public.fees (id, school_id, student_id, fee_type, amount, status)
  VALUES (wb.id('fee1'), wb.id('org'), wb.id('s1'), 'tuition', 100, 'unpaid');
SET LOCAL session_replication_role = origin;

-- Invoices through the real M07 path, as the bursar: s1 (one open invoice), s2 (two open invoices), s3 (already settled), s4 (small), s5 (other term)
SELECT wb.act('bursar');
DO $inv$
DECLARE v_sch uuid; v_sch2 uuid; v_sch3 uuid; v_sch4 uuid; v_i uuid;
BEGIN
  v_sch  := public.cg_fee_create_schedule('wb-scope', 'WBND-TUITION', 'WBND tuition', '2026/27', 'Term 1', 10000, current_date, NULL);
  v_sch2 := public.cg_fee_create_schedule('wb-scope', 'WBND-LAB', 'WBND lab', '2026/27', 'Term 1', 5000, current_date, NULL);
  v_sch3 := public.cg_fee_create_schedule('wb-scope', 'WBND-TUITION-T2', 'WBND tuition t2', '2026/27', 'Term 2', 10000, current_date, NULL);
  PERFORM public.cg_fee_issue_invoice('wb-scope', v_sch, wb.id('campus'), wb.id('s1')::text, 'payer-1', now() + interval '14 days');
  PERFORM public.cg_fee_issue_invoice('wb-scope', v_sch, wb.id('campus'), wb.id('s2')::text, 'payer-2', now() + interval '14 days');
  PERFORM public.cg_fee_issue_invoice('wb-scope', v_sch2, wb.id('campus'), wb.id('s2')::text, 'payer-2', now() + interval '14 days');
  PERFORM public.cg_fee_issue_invoice('wb-scope', v_sch, wb.id('campus'), wb.id('s3')::text, 'payer-3', now() + interval '14 days');
  PERFORM public.cg_fee_issue_invoice('wb-scope', v_sch, wb.id('campus'), wb.id('s4')::text, 'payer-4', now() + interval '14 days');
  PERFORM public.cg_fee_issue_invoice('wb-scope', v_sch3, wb.id('campus'), wb.id('s5')::text, 'payer-5', now() + interval '14 days');
END $inv$;
SELECT wb.back();

-- 1 legacy call posts to the ledger and keeps the legacy records

INSERT INTO public.school_platform_pricing (school_id, per_student_fee) VALUES (wb.id('org'), 1500);
SELECT public._wallet_post(wb.id('org'), 'topup', 2000, 'wb-topup', NULL, 1, NULL, '{}'::jsonb, false);

-- 1 a funded wallet pays the share as before
SELECT wb.act('cashier');
CREATE TEMP TABLE c1 AS SELECT public.record_cash_payment(wb.id('org'), wb.id('s1'), '2026/27', 'Term 1', 30.00, 'cash', NULL, 'WB-1', NULL) AS j;
GRANT SELECT ON c1 TO PUBLIC;
SELECT wb.back();
SELECT wb.ok('funded: the share is debited and collected', (SELECT (j->>'share_debited')::boolean AND NOT (j->>'share_parked')::boolean AND (j->>'balance')::numeric = 500 FROM c1));
SELECT wb.ok('funded: the share ledger row is collected', (SELECT status = 'collected' AND amount = 1500 FROM public.student_platform_fee_ledger WHERE student_id = wb.id('s1') AND fee_type = 'platform_share'));

-- 2 an unfunded wallet is not pushed below the limit; the cash is still recorded
SELECT wb.act('cashier');
CREATE TEMP TABLE c2 AS SELECT public.record_cash_payment(wb.id('org'), wb.id('s3'), '2026/27', 'Term 1', 20.00, 'cash', NULL, 'WB-2', NULL) AS j;
GRANT SELECT ON c2 TO PUBLIC;
SELECT wb.back();
SELECT wb.ok('bounded: the share is parked, not debited', (SELECT NOT (j->>'share_debited')::boolean AND (j->>'share_parked')::boolean AND (j->>'share')::numeric = 0 FROM c2));
SELECT wb.ok('bounded: the wallet is unchanged', (SELECT balance = 500 FROM public.school_wallets WHERE school_id = wb.id('org')));
SELECT wb.ok('bounded: the cash payment is still posted to the fee ledger and kept', (SELECT j->>'ledger_payment' IS NOT NULL AND j->>'offline_payment' IS NOT NULL FROM c2)
  AND (SELECT count(*) = 1 FROM public.offline_payments WHERE student_id = wb.id('s3') AND receipt_no = 'WB-2'));
SELECT wb.ok('bounded: the share row is pending with no reference',
  (SELECT status = 'pending' AND payment_reference IS NULL AND amount = 1500 FROM public.student_platform_fee_ledger WHERE student_id = wb.id('s3') AND fee_type = 'platform_share'));
SELECT wb.ok('bounded: no wallet line was written for the parked share',
  NOT EXISTS (SELECT 1 FROM public.wallet_ledger WHERE school_id = wb.id('org') AND reference = 'share:' || wb.id('s3') || ':2026/27:Term 1'));

-- 3 paying again keeps one pending row
SELECT wb.act('cashier');
SELECT public.record_cash_payment(wb.id('org'), wb.id('s3'), '2026/27', 'Term 1', 5.00, 'cash', NULL, 'WB-3', NULL);
SELECT wb.back();
SELECT wb.ok('a second payment leaves one pending share row', (SELECT count(*) = 1 FROM public.student_platform_fee_ledger WHERE student_id = wb.id('s3') AND fee_type = 'platform_share' AND status = 'pending'));

-- 4 the operator report counts the parked share as paid at the school, not taken
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;
SELECT wb.ok('the report shows one paid-but-not-taken share for the school',
  (SELECT paid_share_not_taken = 1 FROM public.platform_share_collections(wb.id('org'), '2026/27', 'Term 1')));
RESET ROLE;
SELECT set_config('request.jwt.claim.role', '', true);
SELECT set_config('request.jwt.claims', '', true);

-- 5 a recorded debt limit lets the wallet go that far, and no further
INSERT INTO public.platform_share_policy (school_id, grace_days, auto_debit, debt_limit) VALUES (wb.id('org'), 14, false, 1000);
SELECT wb.act('cashier');
CREATE TEMP TABLE c3 AS SELECT public.record_cash_payment(wb.id('org'), wb.id('s4'), '2026/27', 'Term 1', 10.00, 'cash', NULL, 'WB-4', NULL) AS j;
GRANT SELECT ON c3 TO PUBLIC;
SELECT wb.back();
SELECT wb.ok('within the limit: 500 - 1500 = -1000 is allowed', (SELECT (j->>'share_debited')::boolean AND (j->>'balance')::numeric = -1000 FROM c3));
SELECT wb.act('cashier');
CREATE TEMP TABLE c4 AS SELECT public.record_cash_payment(wb.id('org'), wb.id('s3'), '2026/27', 'Term 1', 2.00, 'cash', NULL, 'WB-5', NULL) AS j;
GRANT SELECT ON c4 TO PUBLIC;
SELECT wb.back();
SELECT wb.ok('past the limit: the next share is parked again and the wallet stays at -1000',
  (SELECT (j->>'share_parked')::boolean AND (j->>'balance')::numeric = -1000 FROM c4)
  AND (SELECT balance = -1000 FROM public.school_wallets WHERE school_id = wb.id('org')));

-- 6 refusals are unchanged by the bound
SELECT wb.act('nobody');
SELECT wb.err('a user without the permission is still refused',
  format($q$SELECT public.record_cash_payment(%L,%L,'2026/27','Term 1',1,'cash',NULL,'WB-X',NULL)$q$, wb.id('org'), wb.id('s4')), '42501');
SELECT wb.back();

DO $done$ BEGIN RAISE NOTICE 'WBND ALL PASS: % checks', (SELECT count(*) FROM wb.passed); END $done$;
ROLLBACK;
