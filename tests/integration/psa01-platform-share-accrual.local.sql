-- PSA-01 platform share accrual, settlement and collections. Local disposable Postgres only; rolls back.
BEGIN;
DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'PSA01 FAIL: refusing to run outside the local disposable database';
  END IF;
  IF to_regprocedure('public.platform_share_accrue(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'PSA01 FAIL: the PSA-01 migration must be present';
  END IF;
END $guard$;

CREATE SCHEMA psat;
CREATE TABLE psat.passed (n serial PRIMARY KEY, label text NOT NULL);
CREATE TABLE psat.ids (name text PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid());
INSERT INTO psat.ids (name) VALUES ('A'), ('B'), ('C'), ('admin'), ('a1'), ('a2'), ('a3'), ('a4'), ('b1'), ('b2'), ('b3'), ('c1'), ('fee1'), ('fee2'), ('fee3');
CREATE FUNCTION psat.id(p text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM psat.ids WHERE name = p $$;
CREATE FUNCTION psat.ok(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'PSA01 FAIL [%]', p_label; END IF;
  INSERT INTO psat.passed (label) VALUES (p_label);
END $$;
CREATE FUNCTION psat.err(p_label text, p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN INSERT INTO psat.passed (label) VALUES (p_label); RETURN; END IF;
    RAISE EXCEPTION 'PSA01 FAIL [%]: expected % got % (%)', p_label, p_state, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'PSA01 FAIL [%]: statement was allowed', p_label;
END $$;
CREATE FUNCTION psat.as_service() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  EXECUTE 'SET LOCAL ROLE service_role';
END $$;
CREATE FUNCTION psat.as_admin() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', psat.id('admin')::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', psat.id('admin'), 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION psat.back() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;
GRANT USAGE ON SCHEMA psat TO PUBLIC;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA psat TO PUBLIC;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA psat TO PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA psat TO PUBLIC;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) VALUES (psat.id('admin'));
INSERT INTO public.schools (id, name, slug) VALUES (psat.id('A'), 'PSA A', 'psa-a'), (psat.id('B'), 'PSA B', 'psa-b'), (psat.id('C'), 'PSA C', 'psa-c');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active)
  VALUES (psat.id('admin'), psat.id('A'), 'admin', 'admin@psa.invalid', 'admin', true);
INSERT INTO public.organization_memberships (user_id, school_id, role) VALUES (psat.id('admin'), psat.id('A'), 'admin');
INSERT INTO public.school_platform_pricing (school_id, per_student_fee) VALUES (psat.id('A'), 1500), (psat.id('B'), 1500), (psat.id('C'), 0);
INSERT INTO public.students (id, school_id, status) VALUES
  (psat.id('a1'), psat.id('A'), 'active'), (psat.id('a2'), psat.id('A'), 'active'), (psat.id('a3'), psat.id('A'), 'active'),
  (psat.id('a4'), psat.id('A'), 'withdrawn'),
  (psat.id('b1'), psat.id('B'), 'active'), (psat.id('b2'), psat.id('B'), 'active'), (psat.id('b3'), psat.id('B'), 'active'),
  (psat.id('c1'), psat.id('C'), 'active');
SET LOCAL session_replication_role = origin;

-- 1 accrual: active students only, schools with no share skipped, idempotent
SELECT psat.as_service();
CREATE TEMP TABLE acc1 AS SELECT public.platform_share_accrue(NULL, '2026/27', 'Term 1') AS j;
CREATE TEMP TABLE acc2 AS SELECT public.platform_share_accrue(NULL, '2026/27', 'Term 1') AS j;
GRANT SELECT ON acc1, acc2 TO PUBLIC;
SELECT psat.back();
SELECT psat.ok('accrual creates 6 pending rows (3 active in A, 3 in B) for 9000 naira',
  (SELECT (j->>'rows_created')::int = 6 AND (j->>'schools')::int = 2 AND (j->>'amount')::numeric = 9000 FROM acc1));
SELECT psat.ok('a withdrawn student gets no row',
  NOT EXISTS (SELECT 1 FROM public.student_platform_fee_ledger WHERE student_id = psat.id('a4')));
SELECT psat.ok('a school with a zero share gets no rows',
  NOT EXISTS (SELECT 1 FROM public.student_platform_fee_ledger WHERE school_id = psat.id('C')));
SELECT psat.ok('every accrued row is pending with the school share',
  (SELECT bool_and(status = 'pending' AND amount = 1500 AND fee_type = 'platform_share' AND payment_reference IS NULL) FROM public.student_platform_fee_ledger WHERE academic_year = '2026/27' AND term = 'Term 1' AND school_id IN (psat.id('A'), psat.id('B'))));
SELECT psat.ok('running the accrual again creates nothing', (SELECT (j->>'rows_created')::int = 0 FROM acc2));
SELECT psat.ok('accrual events are recorded per school', (SELECT count(*) = 2 FROM public.platform_share_event WHERE kind = 'accrue'));

-- 2 only operators may call anything
SELECT psat.as_admin();
SELECT psat.err('a school admin cannot accrue', format($q$SELECT public.platform_share_accrue(%L, '2026/27', 'Term 1')$q$, psat.id('A')), '42501');
SELECT psat.err('a school admin cannot settle', format($q$SELECT public.platform_share_settle_overdue(%L, '2026/27', 'Term 1')$q$, psat.id('A')), '42501');
SELECT psat.err('a school admin cannot read collections', format($q$SELECT * FROM public.platform_share_collections(%L, '2026/27', 'Term 1')$q$, psat.id('A')), '42501');
SELECT psat.err('a school admin cannot list students', format($q$SELECT * FROM public.platform_share_student_list(%L, '2026/27', 'Term 1')$q$, psat.id('A')), '42501');
SELECT psat.err('a school admin cannot set the policy', format($q$SELECT public.platform_share_set_policy(%L, 14, false, 0, NULL, NULL)$q$, psat.id('A')), '42501');
SELECT psat.err('a school admin cannot waive', $q$SELECT public.platform_share_waive(gen_random_uuid(), 'scholarship case')$q$, '42501');
SELECT psat.err('a school admin cannot read the policy table', 'SELECT * FROM public.platform_share_policy', '42501');
SELECT psat.back();
SELECT psat.ok('anon cannot execute the settle function',
  NOT has_function_privilege('anon', 'public.platform_share_settle_overdue(uuid,text,text,integer)', 'EXECUTE'));

-- 3 policy: automatic debit needs a recorded agreement
SELECT psat.as_service();
SELECT psat.err('auto debit without an agreement reference is refused (22023)',
  format($q$SELECT public.platform_share_set_policy(%L, 14, true, 0, NULL, NULL)$q$, psat.id('A')), '22023');
SELECT psat.back();
SELECT psat.err('the table also refuses auto debit without an agreement (23514)',
  format($q$INSERT INTO public.platform_share_policy (school_id, auto_debit) VALUES (%L, true)$q$, psat.id('C')), '23514');

-- 4 no policy, no automatic debit, even when overdue
SELECT public._wallet_post(psat.id('A'), 'topup', 10000, 'psat-topup-a', NULL, 1, NULL, '{}'::jsonb, false);
UPDATE public.student_platform_fee_ledger SET created_at = now() - interval '20 days' WHERE school_id IN (psat.id('A'), psat.id('B'));
SELECT psat.as_service();
CREATE TEMP TABLE s0 AS SELECT public.platform_share_settle_overdue(NULL, '2026/27', 'Term 1') AS j;
GRANT SELECT ON s0 TO PUBLIC;
SELECT psat.back();
SELECT psat.ok('without a recorded policy nothing is debited', (SELECT (j->>'debited')::int = 0 FROM s0));
SELECT psat.ok('the school wallet is untouched', (SELECT balance = 10000 FROM public.school_wallets WHERE school_id = psat.id('A')));

-- 5 within the grace period nothing is debited; after it, agreed schools are debited
SELECT psat.as_service();
SELECT public.platform_share_set_policy(psat.id('A'), 14, true, 0, 'AGREEMENT-A-2026-11', now() - interval '30 days');
SELECT public.platform_share_set_policy(psat.id('B'), 30, true, 1500, 'AGREEMENT-B-2026-11', now() - interval '30 days');
CREATE TEMP TABLE s_grace AS SELECT public.platform_share_settle_overdue(psat.id('B'), '2026/27', 'Term 1') AS j;
GRANT SELECT ON s_grace TO PUBLIC;
SELECT psat.back();
SELECT psat.ok('school B rows are 20 days old and its grace is 30: nothing is debited', (SELECT (j->>'debited')::int = 0 AND (j->>'unfunded')::int = 0 FROM s_grace));
SELECT psat.as_service();
CREATE TEMP TABLE s_a AS SELECT public.platform_share_settle_overdue(psat.id('A'), '2026/27', 'Term 1') AS j;
CREATE TEMP TABLE s_a2 AS SELECT public.platform_share_settle_overdue(psat.id('A'), '2026/27', 'Term 1') AS j;
GRANT SELECT ON s_a, s_a2 TO PUBLIC;
SELECT psat.back();
SELECT psat.ok('school A (grace 14, wallet funded) is debited for its 3 active students', (SELECT (j->>'debited')::int = 3 AND (j->>'amount')::numeric = 4500 FROM s_a));
SELECT psat.ok('the wallet fell by 4500 and holds three platform_share lines',
  (SELECT balance = 5500 FROM public.school_wallets WHERE school_id = psat.id('A'))
  AND (SELECT count(*) = 3 AND sum(amount) = -4500 FROM public.wallet_ledger WHERE school_id = psat.id('A') AND kind = 'platform_share'));
SELECT psat.ok('the rows are collected with an automatic wallet reference',
  (SELECT count(*) = 3 FROM public.student_platform_fee_ledger WHERE school_id = psat.id('A') AND status = 'collected' AND payment_reference LIKE 'wallet:auto:%'));
SELECT psat.ok('settling again debits nothing more', (SELECT (j->>'debited')::int = 0 FROM s_a2) AND (SELECT balance = 5500 FROM public.school_wallets WHERE school_id = psat.id('A')));
SELECT psat.ok('each debit is recorded as a settle event', (SELECT count(*) = 3 FROM public.platform_share_event WHERE kind = 'settle' AND school_id = psat.id('A')));

-- 6 an unfunded school is not driven past its debt limit and keeps its rows pending
UPDATE public.platform_share_policy SET grace_days = 14 WHERE school_id = psat.id('B');
SELECT psat.as_service();
CREATE TEMP TABLE s_b AS SELECT public.platform_share_settle_overdue(psat.id('B'), '2026/27', 'Term 1') AS j;
GRANT SELECT ON s_b TO PUBLIC;
SELECT psat.back();
SELECT psat.ok('school B (empty wallet, debt limit 1500) is debited once and the rest are unfunded',
  (SELECT (j->>'debited')::int = 1 AND (j->>'unfunded')::int = 2 FROM s_b));
SELECT psat.ok('the wallet sits at minus 1500, exactly the debt limit',
  (SELECT balance = -1500 FROM public.school_wallets WHERE school_id = psat.id('B')));
SELECT psat.ok('two shares remain pending', (SELECT count(*) = 2 FROM public.student_platform_fee_ledger WHERE school_id = psat.id('B') AND status = 'pending'));

-- 7 withdrawn after accrual: not auto-debited
SET LOCAL session_replication_role = replica;
UPDATE public.students SET status = 'withdrawn' WHERE id IN (SELECT student_id FROM public.student_platform_fee_ledger WHERE school_id = psat.id('B') AND status = 'pending' ORDER BY id LIMIT 1);
SET LOCAL session_replication_role = origin;
SELECT public._wallet_post(psat.id('B'), 'topup', 10000, 'psat-topup-b', NULL, 1, NULL, '{}'::jsonb, false);
SELECT psat.as_service();
CREATE TEMP TABLE s_b2 AS SELECT public.platform_share_settle_overdue(psat.id('B'), '2026/27', 'Term 1') AS j;
GRANT SELECT ON s_b2 TO PUBLIC;
SELECT psat.back();
SELECT psat.ok('after a top up only the still-active student is debited (the withdrawn one is skipped)',
  (SELECT (j->>'debited')::int = 1 FROM s_b2));
SELECT psat.ok('one share is left pending for the withdrawn student', (SELECT count(*) = 1 FROM public.student_platform_fee_ledger WHERE school_id = psat.id('B') AND status = 'pending'));

-- 8 waiver: only an operator, only a pending row, with a reason
SELECT psat.as_service();
SELECT psat.err('a waiver needs a reason', format($q$SELECT public.platform_share_waive((SELECT id FROM public.student_platform_fee_ledger WHERE school_id = %L AND status = 'pending'), 'no')$q$, psat.id('B')), '22023');
SELECT psat.err('a collected share cannot be waived', format($q$SELECT public.platform_share_waive((SELECT id FROM public.student_platform_fee_ledger WHERE school_id = %L AND status = 'collected' LIMIT 1), 'scholarship case')$q$, psat.id('A')), '22023');
CREATE TEMP TABLE w1 AS SELECT public.platform_share_waive((SELECT id FROM public.student_platform_fee_ledger WHERE school_id = psat.id('B') AND status = 'pending'), 'scholarship approved by Sherivs') AS j;
GRANT SELECT ON w1 TO PUBLIC;
SELECT psat.back();
SELECT psat.ok('the waived row is waived with a waiver reference and an event holds the reason',
  (SELECT count(*) = 1 FROM public.student_platform_fee_ledger WHERE school_id = psat.id('B') AND status = 'waived' AND payment_reference LIKE 'waiver:%')
  AND (SELECT count(*) = 1 FROM public.platform_share_event WHERE kind = 'waive' AND detail->>'reason' = 'scholarship approved by Sherivs'));

-- 9 events cannot be changed
SELECT psat.err('events are append-only (update)', $q$UPDATE public.platform_share_event SET kind = 'settle'$q$, '42501');
SELECT psat.err('events are append-only (delete)', 'DELETE FROM public.platform_share_event', '42501');

-- 10 collections report and student list answer who paid, how, and what Sherivs took
SET LOCAL session_replication_role = replica;
INSERT INTO public.offline_payments (school_id, student_id, academic_year, term, amount, recorded_by)
  VALUES (psat.id('A'), psat.id('a1'), '2026/27', 'Term 1', 50, psat.id('admin'));
SET LOCAL session_replication_role = origin;
SELECT psat.as_service();
SELECT public.platform_share_accrue(psat.id('A'), '2026/27', 'Term 2');
SELECT psat.back();
SET LOCAL session_replication_role = replica;
INSERT INTO public.offline_payments (school_id, student_id, academic_year, term, amount, recorded_by)
  VALUES (psat.id('A'), psat.id('a2'), '2026/27', 'Term 2', 50, psat.id('admin'));
UPDATE public.student_platform_fee_ledger SET created_at = now() - interval '20 days' WHERE school_id = psat.id('A') AND term = 'Term 2';
SET LOCAL session_replication_role = origin;
SELECT psat.as_service();
CREATE TEMP TABLE rep1 AS SELECT * FROM public.platform_share_collections(NULL, '2026/27', 'Term 1');
CREATE TEMP TABLE rep2 AS SELECT * FROM public.platform_share_collections(psat.id('A'), '2026/27', 'Term 2');
CREATE TEMP TABLE lst AS SELECT * FROM public.platform_share_student_list(psat.id('A'), '2026/27', 'Term 2');
GRANT SELECT ON rep1, rep2, lst TO PUBLIC;
SELECT psat.back();
SELECT psat.ok('term 1 report for school A: 3 enrolled, 3 accrued, 3 collected by automatic wallet debit, none pending',
  (SELECT enrolled_active = 3 AND accrued = 3 AND collected_wallet_auto = 3 AND collected_wallet_cash = 0 AND collected_online = 0 AND pending = 0 AND overdue = 0 AND wallet_balance = 5500
     FROM rep1 WHERE school_id = psat.id('A')));
SELECT psat.ok('term 1 report for school B: 1 waived, 2 collected by automatic debit, none pending',
  (SELECT accrued = 3 AND waived = 1 AND collected_wallet_auto = 2 AND pending = 0 FROM rep1 WHERE school_id = psat.id('B')));
SELECT psat.ok('term 2 report: 3 pending and overdue (4500), and one student paid cash with the share not taken',
  (SELECT accrued = 3 AND pending = 3 AND overdue = 3 AND overdue_amount = 4500 AND paid_share_not_taken = 1 AND wallet_cover_gap = 0 FROM rep2));
SELECT psat.ok('the student list names channel and flags the cash payer, with ids only',
  (SELECT count(*) = 3 AND count(*) FILTER (WHERE has_recorded_payment) = 1 AND bool_and(overdue) AND bool_and(channel = 'pending') FROM lst));

-- 11 the online path and the accrued row agree
SET LOCAL session_replication_role = replica;
INSERT INTO public.org_payment_subaccounts (org_id, subaccount_code, settlement_bank_code, account_last4, account_ciphertext, account_wrapped_dek, key_version, platform_charge_kobo, active)
  VALUES (psat.id('A'), 'ACCT_psaa', '000', '0000', 'x', 'x', 'v1', 0, true);
INSERT INTO public.fees (id, school_id, student_id, fee_type, amount, status, term, academic_year, paystack_reference) VALUES
  (psat.id('fee1'), psat.id('A'), psat.id('a3'), 'tuition', 5000, 'unpaid', 'Term 2', '2026/27', 'psa-ref-online-1'),
  (psat.id('fee2'), psat.id('A'), psat.id('a1'), 'tuition', 5000, 'unpaid', 'Term 1', '2026/27', 'psa-ref-online-2');
SET LOCAL session_replication_role = origin;
SELECT psat.as_service();
CREATE TEMP TABLE co1 AS SELECT public.fee_checkout_split(psat.id('fee1'), 'psa-ref-online-1') AS j;
CREATE TEMP TABLE se1 AS SELECT public.fee_split_settle('psa-ref-online-1', 'ACCT_psaa', 150000) AS j;
CREATE TEMP TABLE co2 AS SELECT public.fee_checkout_split(psat.id('fee2'), 'psa-ref-online-2') AS j;
CREATE TEMP TABLE se2 AS SELECT public.fee_split_settle('psa-ref-online-2', 'ACCT_psaa', 150000) AS j;
GRANT SELECT ON co1, se1, co2, se2 TO PUBLIC;
SELECT psat.back();
SELECT psat.ok('checkout reserves the accrued pending row (the split carries 1500 naira)', (SELECT (j->>'share_kobo')::bigint = 150000 FROM co1));
SELECT psat.ok('settling the online payment marks the accrued row collected by Paystack',
  (SELECT (j->>'share_collected')::boolean FROM se1)
  AND (SELECT status = 'collected' AND payment_reference = 'paystack:psa-ref-online-1' FROM public.student_platform_fee_ledger WHERE student_id = psat.id('a3') AND term = 'Term 2'));
SELECT psat.ok('an already auto-debited share is not taken twice online (the split carries no share)', (SELECT (j->>'share_kobo')::bigint = 0 FROM co2));
SELECT psat.ok('if a split that carries the share still arrives after an automatic debit, the school wallet is refunded and Paystack becomes the collector',
  (SELECT (j->>'wallet_refunded')::boolean FROM se2)
  AND (SELECT balance = 7000 FROM public.school_wallets WHERE school_id = psat.id('A'))
  AND (SELECT status = 'collected' AND payment_reference = 'paystack:psa-ref-online-2' FROM public.student_platform_fee_ledger WHERE student_id = psat.id('a1') AND term = 'Term 1'));
SELECT psat.as_service();
CREATE TEMP TABLE rep3 AS SELECT * FROM public.platform_share_collections(psat.id('A'), '2026/27', 'Term 2');
GRANT SELECT ON rep3 TO PUBLIC;
SELECT psat.back();
SELECT psat.ok('the term 2 report counts one online collection', (SELECT collected_online = 1 AND pending = 2 FROM rep3));

-- 12 privileges
SELECT psat.ok('authenticated cannot read or write the new tables',
  NOT has_table_privilege('authenticated', 'public.platform_share_policy', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.platform_share_event', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.platform_share_event', 'INSERT'));
SELECT psat.ok('the operator helper is not executable by anon or authenticated',
  NOT has_function_privilege('anon', 'public.platform_share_is_operator()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.platform_share_is_operator()', 'EXECUTE'));
SELECT psat.ok('every PSA-01 function is security definer with an empty search_path',
  (SELECT bool_and(prosecdef AND proconfig @> ARRAY['search_path=""']) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'platform_share_%' AND proname NOT IN ('platform_share_event_append_only', 'platform_share_per_student')));
DO $done$ DECLARE v int; BEGIN SELECT count(*) INTO v FROM psat.passed; RAISE NOTICE 'PSA01 ALL PASS: % checks', v; END $done$;
ROLLBACK;
