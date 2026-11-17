-- FIN-01 wallet authorization and financial integrity (LOCAL, DISPOSABLE ONLY).
-- Run only after replaying repository migrations on a loopback disposable DB (CI: migrations-sim, PostgreSQL 17):
--   psql "postgresql://postgres@127.0.0.1:<port>/<disposable_db>" -v ON_ERROR_STOP=1 \
--     -f tests/integration/fin-01-wallet-authorization.local.sql
-- Builds synthetic organizations and users inside ONE transaction and ends with ROLLBACK, so it leaves nothing behind.
-- Every check prints "FIN-01 PASS: <name>" or "FIN-01 FAIL: <name>"; any failure makes the script exit non-zero.
-- Each check runs under a realistic role (anon, authenticated with a JWT subject, service_role) so grants, the in-function
-- authorization and row-level security are all exercised. Concurrent-session behavior is covered by
-- tests/integration/fin-01-wallet-concurrency.local.mjs.
BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'FIN-01: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NOT NULL
     AND NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet)
     AND coalesce(current_setting('fin01.allow_non_loopback', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'FIN-01: refusing non-loopback server address %', inet_server_addr();
  END IF;
  IF current_database() !~* '(disposable|scratch|local|test|sim|postgres|fin_01)' THEN
    RAISE EXCEPTION 'FIN-01: refusing database %, not a named disposable DB', current_database();
  END IF;
  IF to_regprocedure('public.meter_usage(uuid,text,numeric,text,uuid,text,text,text)') IS NULL
     OR to_regclass('public.school_wallets') IS NULL THEN
    RAISE EXCEPTION 'FIN-01: wallet migrations are not applied';
  END IF;
  IF (SELECT count(*) FROM public.wallet_ledger) <> 0 THEN
    RAISE EXCEPTION 'FIN-01: wallet_ledger must start empty on a disposable DB';
  END IF;
END
$guard$;

CREATE SCHEMA fin01;
GRANT USAGE ON SCHEMA fin01 TO PUBLIC;
CREATE TABLE fin01.results (n serial, name text, ok boolean, detail text);
CREATE TABLE fin01.ctx (k text PRIMARY KEY, v text);
GRANT ALL ON fin01.results, fin01.ctx TO PUBLIC;

CREATE FUNCTION fin01.expect(p_name text, p_ok boolean, p_detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO fin01.results (name, ok, detail) VALUES (p_name, coalesce(p_ok, false), p_detail);
  IF coalesce(p_ok, false) THEN RAISE NOTICE 'FIN-01 PASS: % [%]', p_name, p_detail;
  ELSE RAISE NOTICE 'FIN-01 FAIL: % [%]', p_name, p_detail; END IF;
END $$;

-- Run one statement under a realistic role and JWT; returns 'ok:<single text value>' or 'err:<sqlstate>:<message>'.
-- The statement runs in a sub-block, so a failure rolls back everything it did (the same way a failed RPC does).
CREATE FUNCTION fin01.call(p_role text, p_sub uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
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

CREATE FUNCTION fin01.bal(p_school uuid) RETURNS numeric LANGUAGE sql AS
$$ SELECT coalesce((SELECT balance FROM public.school_wallets WHERE school_id = p_school), 0) $$;
CREATE FUNCTION fin01.cnt(p_table text, p_school uuid) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN EXECUTE format('SELECT count(*) FROM public.%I WHERE school_id = $1', p_table) INTO n USING p_school; RETURN n; END $$;
CREATE FUNCTION fin01.ctxid(p_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v::uuid FROM fin01.ctx WHERE k = p_k $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA fin01 TO PUBLIC;

-- ---------------------------------------------------------------- fixtures (owner role, synthetic only)
-- r: attack target (parent, student, teacher, admin).  x: a second tenant (cross-tenant attempts).
-- a: approval path (two admins, one parent recipient, sms_live on).  m / n / d / p: money-rule schools.
CREATE FUNCTION fin01.mk_school(p_key text, p_wallet numeric) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO public.schools (name, slug, subscription_tier) VALUES ('FIN01 ' || p_key, 'fin01-' || p_key, 'growth') RETURNING id INTO v;
  INSERT INTO fin01.ctx VALUES (p_key, v::text);
  IF p_wallet > 0 THEN PERFORM public._wallet_post(v, 'topup', p_wallet, 'FIN01-SEED-' || p_key); END IF;
  RETURN v;
END $$;
CREATE FUNCTION fin01.mk_user(p_id text, p_school uuid, p_role text, p_phone text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid := ('00000000-0000-0000-0000-' || lpad(p_id, 12, '0'))::uuid;
BEGIN
  INSERT INTO auth.users (id, email, phone, email_confirmed_at, phone_confirmed_at)
  VALUES (v, p_id || '@fin01.test', p_phone, now(), now());
  INSERT INTO public.users (id, school_id, full_name, role, email, phone, is_active)
  VALUES (v, p_school, 'FIN01 ' || p_id, p_role, p_id || '@fin01.test', p_phone, true);
  RETURN v;
END $$;

DO $fx$
DECLARE r uuid; x uuid; a uuid; m uuid; n uuid; d uuid; p uuid; o uuid;
BEGIN
  o := fin01.mk_school('o', 1000);
  r := fin01.mk_school('r', 1000); x := fin01.mk_school('x', 1000); a := fin01.mk_school('a', 1000);
  m := fin01.mk_school('m', 100);  n := fin01.mk_school('n', 0);    d := fin01.mk_school('d', 0);
  p := fin01.mk_school('p', 20);
  INSERT INTO fin01.ctx VALUES
    ('u_parent',  fin01.mk_user('f1a001', r, 'parent',  '2349010000001')::text),
    ('u_student', fin01.mk_user('f1a002', r, 'student', '2349010000002')::text),
    ('u_teacher', fin01.mk_user('f1a003', r, 'teacher', '2349010000003')::text),
    ('u_admin',   fin01.mk_user('f1a004', r, 'admin',   '2349010000004')::text),
    ('u_xadmin',  fin01.mk_user('f1b001', x, 'admin',   '2349010000011')::text),
    ('u_oparent', fin01.mk_user('f1d001', o, 'parent',  '2349010000031')::text),
    ('u_ostudent', fin01.mk_user('f1d002', o, 'student', '2349010000032')::text),
    ('u_a1',      fin01.mk_user('f1c001', a, 'admin',   '2349010000021')::text),
    ('u_a2',      fin01.mk_user('f1c002', a, 'admin',   '2349010000022')::text),
    ('u_aparent', fin01.mk_user('f1c003', a, 'parent',  '2349010000023')::text);
  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('00000000-0000-0000-0000-00000000f1ee', 'f1ee@fin01.test', now());
  INSERT INTO public.super_admins (id, full_name, email, is_active) VALUES ('00000000-0000-0000-0000-00000000f1ee', 'FIN01 Super', 'f1ee@fin01.test', true);
  INSERT INTO fin01.ctx VALUES ('u_super', '00000000-0000-0000-0000-00000000f1ee');
  INSERT INTO public.students (school_id) VALUES (m) RETURNING id INTO r;
  INSERT INTO fin01.ctx VALUES ('stu_m', r::text);
  INSERT INTO public.students (school_id) VALUES (n) RETURNING id INTO r;
  INSERT INTO fin01.ctx VALUES ('stu_n', r::text);
END $fx$;

-- sms_live on for the approval-path school only (as the platform does it)
SELECT fin01.call('service_role', NULL,
  format($q$ select public.flag_set('sms_live', %L, true)::text $q$, fin01.ctxid('a'))) AS flag_result \gset

-- ================================================================ R. who may debit a wallet
-- R1-R6: no client role can call the metering function. Original defect: authenticated held EXECUTE and the in-function
-- check admitted every parent and student (the legacy permission bridge grants them ai_tutor.use).
CREATE FUNCTION fin01.attack(p_name text, p_role text, p_sub uuid, p_school uuid, p_ref text, p_priority text, p_qty numeric) RETURNS void LANGUAGE plpgsql AS $$
DECLARE b0 numeric := fin01.bal(p_school); e0 bigint := fin01.cnt('usage_events', p_school); res text;
BEGIN
  res := fin01.call(p_role, p_sub, format($q$ select public.meter_usage(%L,'sms',%s,%L,null,%L,null,null)::text $q$, p_school, p_qty, p_ref, p_priority));
  PERFORM fin01.expect(p_name,
    res LIKE 'err:42501%' AND fin01.bal(p_school) = b0 AND fin01.cnt('usage_events', p_school) = e0,
    left(res, 90) || ' | balance delta ' || (fin01.bal(p_school) - b0));
END $$;
GRANT EXECUTE ON FUNCTION fin01.attack(text, text, uuid, uuid, text, text, numeric) TO PUBLIC;
DO $t$
DECLARE r uuid := fin01.ctxid('r');
BEGIN
  PERFORM fin01.attack('R1 a parent cannot debit the school wallet through meter_usage', 'authenticated', fin01.ctxid('u_parent'), r, 'R-PARENT-1', 'normal', 1);
  PERFORM fin01.attack('R2 a student cannot debit the school wallet through meter_usage', 'authenticated', fin01.ctxid('u_student'), r, 'R-STUDENT-1', 'normal', 1);
  PERFORM fin01.attack('R3 a teacher with comms.send_class cannot call meter_usage directly (only server-side paths meter)', 'authenticated', fin01.ctxid('u_teacher'), r, 'R-TEACHER-1', 'normal', 1);
  PERFORM fin01.attack('R4 a school admin cannot call meter_usage directly', 'authenticated', fin01.ctxid('u_admin'), r, 'R-ADMIN-1', 'normal', 1);
  PERFORM fin01.attack('R5 anon cannot call meter_usage', 'anon', NULL, r, 'R-ANON-1', 'normal', 1);
  PERFORM fin01.attack('R6 an admin of another organization cannot debit this wallet (cross-tenant)', 'authenticated', fin01.ctxid('u_xadmin'), r, 'R-CROSS-1', 'normal', 1);
END $t$;

-- R7-R8: the overdraft the original defect allowed: a student chooses the priority and the quantity (own school, own wallet).
DO $t$
DECLARE o uuid := fin01.ctxid('o');
BEGIN
  PERFORM fin01.attack('R7 a student cannot overdraw the wallet with the safety priority', 'authenticated', fin01.ctxid('u_ostudent'), o, 'R-OVERDRAW-1', 'safety', 100000);
  PERFORM fin01.attack('R8 a parent cannot overdraw the wallet with the safety priority', 'authenticated', fin01.ctxid('u_oparent'), o, 'R-OVERDRAW-2', 'safety', 100000);
  PERFORM fin01.expect('R8b the wallet never went negative through a client call', fin01.bal(o) = 1000, 'balance ' || fin01.bal(o));
END $t$;

-- R9: the platform path still works, and only for the platform.
DO $t$
DECLARE r uuid := fin01.ctxid('r'); b0 numeric := fin01.bal(r); res text; q text; ev0 bigint := fin01.cnt('usage_events', r);
BEGIN
  q := format($q$ select public.meter_usage(%L,'sms',1,'R-PLATFORM-1',null,'normal',null,null)::text $q$, r);
  res := fin01.call('service_role', NULL, q);
  PERFORM fin01.expect('R9 the service role (server-side financial operation) can meter and is charged the price book amount',
    res LIKE 'ok:%' AND fin01.bal(r) = b0 - 10 AND fin01.cnt('usage_events', r) = ev0 + 1, left(res, 80));
END $t$;

-- R10: top-up credit is the payment webhook's alone, with no client EXECUTE at all.
DO $t$
DECLARE r uuid := fin01.ctxid('r'); b0 numeric := fin01.bal(r); res text; q text; priv boolean;
BEGIN
  q := format($q$ select public.wallet_credit_topup(%L, 5000, 'FIN01-FORGED-TOPUP-1')::text $q$, r);
  res := fin01.call('authenticated', fin01.ctxid('u_admin'), q);
  priv := has_function_privilege('authenticated', 'public.wallet_credit_topup(uuid,numeric,text)', 'EXECUTE');
  PERFORM fin01.expect('R10a a school admin cannot credit the wallet (and holds no EXECUTE on wallet_credit_topup)',
    res LIKE 'err:42501%' AND fin01.bal(r) = b0 AND NOT priv, left(res, 70) || ' | execute=' || priv);
  res := fin01.call('service_role', NULL, q);
  PERFORM fin01.expect('R10b the payment webhook (service role) can credit, once per reference',
    res LIKE 'ok:%' AND fin01.bal(r) = b0 + 5000
    AND fin01.call('service_role', NULL, q) LIKE 'ok:%' AND fin01.bal(r) = b0 + 5000, 'balance delta ' || (fin01.bal(r) - b0));
END $t$;

-- R11: privilege matrix. Every SECURITY DEFINER function that touches the wallet tables or the posting primitive must be
-- closed to anon, and the set open to authenticated is an explicit allowlist (each has an in-function permission check).
DO $t$
DECLARE v_anon text; v_auth text; v_allow text[] := ARRAY['record_cash_payment', 'wallet_adjust', 'open_term_pools', 'wallet_set_safety_overdraft_limit'];
BEGIN
  SELECT string_agg(p.proname, ',' ORDER BY p.proname) INTO v_anon FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
     AND (p.prosrc ~* '(school_wallets|wallet_ledger|_wallet_post|usage_events|term_usage_pools|meter_usage)')
     AND has_function_privilege('anon', p.oid, 'EXECUTE');
  SELECT string_agg(p.proname, ',' ORDER BY p.proname) INTO v_auth FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
     AND (p.prosrc ~* '(school_wallets|wallet_ledger|_wallet_post|usage_events|term_usage_pools|meter_usage)')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT (p.proname = ANY (v_allow));
  PERFORM fin01.expect('R11a no wallet-touching SECURITY DEFINER function is executable by anon', v_anon IS NULL, coalesce(v_anon, 'none'));
  PERFORM fin01.expect('R11b authenticated may execute only the allowlisted wallet functions (record_cash_payment, wallet_adjust, open_term_pools, wallet_set_safety_overdraft_limit)',
    v_auth IS NULL, coalesce(v_auth, 'only the allowlist'));
  PERFORM fin01.expect('R11c _wallet_post is executable by no API role',
    NOT has_function_privilege('anon', 'public._wallet_post(uuid,text,numeric,text,text,numeric,uuid,jsonb,boolean)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public._wallet_post(uuid,text,numeric,text,text,numeric,uuid,jsonb,boolean)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public._wallet_post(uuid,text,numeric,text,text,numeric,uuid,jsonb,boolean)', 'EXECUTE'));
END $t$;

-- R12: the safety overdraft limit is platform-staff-only, validated and audited.
DO $t$
DECLARE r uuid := fin01.ctxid('r'); res text; ok_admin boolean; ok_bad boolean; ok_super boolean; lim text; n_audit bigint;
BEGIN
  res := fin01.call('authenticated', fin01.ctxid('u_admin'), format($q$ select public.wallet_set_safety_overdraft_limit(%L, 999999, 'school admin attempt')::text $q$, r));
  ok_admin := res LIKE 'err:%';
  res := fin01.call('authenticated', fin01.ctxid('u_super'), format($q$ select public.wallet_set_safety_overdraft_limit(%L, -5, 'negative limit attempt')::text $q$, r));
  ok_bad := res LIKE 'err:%';
  res := fin01.call('authenticated', fin01.ctxid('u_super'), format($q$ select public.wallet_set_safety_overdraft_limit(%L, 250, 'FIN-01 test limit')::text $q$, r));
  ok_super := res LIKE 'ok:%';
  BEGIN EXECUTE 'SELECT safety_overdraft_limit::text FROM public.school_wallets WHERE school_id = $1' INTO lim USING r; EXCEPTION WHEN others THEN lim := NULL; END;
  SELECT count(*) INTO n_audit FROM public.audit_logs WHERE school_id = r AND table_name = 'school_wallets' AND action = 'scholar.school_wallets.update'
     AND (new_value->>'safety_overdraft_limit') = '250';
  PERFORM fin01.expect('R12 only platform staff can change the safety overdraft limit; it must be non-negative and the change is audited',
    ok_admin AND ok_bad AND ok_super AND lim = '250' AND n_audit >= 1, 'admin denied=' || ok_admin || ' negative refused=' || ok_bad || ' super ok=' || ok_super || ' limit=' || coalesce(lim, 'n/a') || ' audit rows=' || n_audit);
END $t$;

-- ================================================================ M. money rules (server-side path, service role)
-- M1: a normal send never takes the wallet below zero, and a refused debit leaves no trace.
DO $t$
DECLARE m uuid := fin01.ctxid('m'); b0 numeric := fin01.bal(m); res text; q text; l0 bigint := fin01.cnt('wallet_ledger', m); e0 bigint := fin01.cnt('usage_events', m);
BEGIN
  q := format($q$ select public.meter_usage(%L,'sms',11,'M-OVER-1',null,'normal',null,null)::text $q$, m);   -- 110 > 100
  res := fin01.call('service_role', NULL, q);
  PERFORM fin01.expect('M1 an unaffordable normal send is refused and leaves the balance, ledger and usage history untouched',
    res LIKE 'err:%insufficient_wallet%' AND fin01.bal(m) = b0 AND fin01.cnt('wallet_ledger', m) = l0 AND fin01.cnt('usage_events', m) = e0, left(res, 90));
END $t$;

-- M2: atomicity. The pool is consumed before the wallet is checked; when the wallet refuses, the pool must not stay consumed.
DO $t$
DECLARE m uuid := fin01.ctxid('p'); res text; q text; u0 numeric; u1 numeric; l0 bigint := fin01.cnt('wallet_ledger', m);
BEGIN
  INSERT INTO public.term_usage_pools (school_id, academic_year, term, item, allowance) VALUES (m, 'F1', 'T1', 'sms', 5);
  u0 := (SELECT used FROM public.term_usage_pools WHERE school_id = m AND academic_year = 'F1' AND term = 'T1' AND item = 'sms');
  q := format($q$ select public.meter_usage(%L,'sms',20,'M-ATOMIC-1',null,'normal','F1','T1')::text $q$, m);  -- 5 from pool, 15*10=150 > wallet 20
  res := fin01.call('service_role', NULL, q);
  u1 := (SELECT used FROM public.term_usage_pools WHERE school_id = m AND academic_year = 'F1' AND term = 'T1' AND item = 'sms');
  PERFORM fin01.expect('M2 a send that fails on the wallet does not leave the term pool partially consumed',
    res LIKE 'err:%insufficient_wallet%' AND u1 = u0 AND fin01.cnt('wallet_ledger', m) = l0, 'pool used ' || u0 || ' -> ' || u1);
END $t$;

-- M3: idempotent on the reference (a replay never charges twice).
DO $t$
DECLARE m uuid := fin01.ctxid('m'); b0 numeric := fin01.bal(m); r1 text; r2 text; q text;
BEGIN
  q := format($q$ select public.meter_usage(%L,'sms',1,'M-REPLAY-1',null,'normal',null,null)::text $q$, m);
  r1 := fin01.call('service_role', NULL, q); r2 := fin01.call('service_role', NULL, q);
  PERFORM fin01.expect('M3 the same reference charges once and a replay reports replay=true',
    fin01.bal(m) = b0 - 10 AND r2 LIKE '%"replay": true%' AND
    (SELECT count(*) FROM public.wallet_ledger WHERE school_id = m AND reference = 'M-REPLAY-1') = 1, left(r2, 80));
END $t$;

-- M4-M7: the one deliberate negative path (safety/authentication sends) is bounded and per-wallet configurable.
DO $t$
DECLARE n uuid := fin01.ctxid('n'); d uuid := fin01.ctxid('d'); res text; q text; has_col boolean; lim text; b_n numeric;
BEGIN
  SELECT column_default INTO lim FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'school_wallets' AND column_name = 'safety_overdraft_limit';
  has_col := lim IS NOT NULL;
  PERFORM fin01.expect('M4 a wallet carries an explicit safety overdraft limit (default NGN1000)', has_col AND lim = '1000', coalesce(lim, 'column missing'));

  q := format($q$ select public.meter_usage(%L,'sms',5,'N-SAFE-1',null,'safety',null,null)::text $q$, n);       -- -50
  res := fin01.call('service_role', NULL, q);
  PERFORM fin01.expect('M5a a safety send may use the bounded overdraft', res LIKE 'ok:%' AND fin01.bal(n) = -50, left(res, 60) || ' | balance ' || fin01.bal(n));

  q := format($q$ select public.meter_usage(%L,'sms',100,'N-SAFE-2',null,'safety',null,null)::text $q$, n);     -- would reach -1050
  res := fin01.call('service_role', NULL, q);
  PERFORM fin01.expect('M5b a safety send beyond the limit is refused as insufficient_wallet and changes nothing',
    res LIKE 'err:%insufficient_wallet%' AND fin01.bal(n) = -50, left(res, 90) || ' | balance ' || fin01.bal(n));

  b_n := fin01.bal(n);   -- re-read: M5b must not cascade into this check
  q := format($q$ select public.meter_usage(%L,'sms',1,'N-NORMAL-1',null,'normal',null,null)::text $q$, n);     -- normal never overdraws
  res := fin01.call('service_role', NULL, q);
  PERFORM fin01.expect('M6 a normal send never overdraws, even on a wallet already in its safety overdraft',
    res LIKE 'err:%insufficient_wallet%' AND fin01.bal(n) = b_n, left(res, 90));

  res := fin01.call('authenticated', fin01.ctxid('u_super'),
    format($q$ select public.wallet_set_safety_overdraft_limit(%L, 0, 'FIN-01 strict test')::text $q$, d));
  has_col := res LIKE 'ok:%';
  q := format($q$ select public.meter_usage(%L,'sms',1,'D-SAFE-1',null,'safety',null,null)::text $q$, d);
  res := fin01.call('service_role', NULL, q);
  PERFORM fin01.expect('M7 with the limit set to 0 the wallet can never go negative, even for safety sends',
    has_col AND res LIKE 'err:%insufficient_wallet%' AND fin01.bal(d) = 0, left(res, 90) || ' | balance ' || fin01.bal(d));
END $t$;

-- M8: organization ownership of the student the usage is attributed to; M9: the per-student daily cap.
DO $t$
DECLARE m uuid := fin01.ctxid('m'); b0 numeric := fin01.bal(m); res text; q text;
BEGIN
  q := format($q$ select public.meter_usage(%L,'sms',1,'M-FOREIGN-STU-1',%L,'normal',null,null)::text $q$, m, fin01.ctxid('stu_n'));
  res := fin01.call('service_role', NULL, q);
  PERFORM fin01.expect('M8 usage cannot be attributed to a student of another organization',
    res LIKE 'err:%' AND fin01.bal(m) = b0 AND NOT EXISTS (SELECT 1 FROM public.usage_events WHERE reference = 'M-FOREIGN-STU-1'), left(res, 90));

  b0 := fin01.bal(m);   -- re-read: a failure in M8 must not cascade into the cap checks
  q := format($q$ select public.meter_usage(%L,'sms',1,'M-CAP-1',%L,'normal',null,null)::text $q$, m, fin01.ctxid('stu_m'));
  res := fin01.call('service_role', NULL, q);
  PERFORM fin01.expect('M9a the first send for the school''s own student is metered', res LIKE 'ok:%' AND fin01.bal(m) = b0 - 10, left(res, 60));
  q := format($q$ select public.meter_usage(%L,'sms',1,'M-CAP-2',%L,'normal',null,null)::text $q$, m, fin01.ctxid('stu_m'));
  res := fin01.call('service_role', NULL, q);
  PERFORM fin01.expect('M9b the second same-day send hits the plan daily cap and is not charged',
    res LIKE 'err:%daily_cap%' AND fin01.bal(m) = b0 - 10, left(res, 80));
END $t$;

-- M10: invalid input is refused with no side effect.
DO $t$
DECLARE m uuid := fin01.ctxid('m'); b0 numeric := fin01.bal(m); l0 bigint := fin01.cnt('wallet_ledger', m); e0 bigint := fin01.cnt('usage_events', m);
        bad text[]; i int; res text; all_refused boolean := true; detail text := '';
BEGIN
  bad := ARRAY[
    format($q$ select public.meter_usage(NULL,'sms',1,'M-BAD-1',null,'normal',null,null)::text $q$),
    format($q$ select public.meter_usage(%L,'sms',1,NULL,null,'normal',null,null)::text $q$, m),
    format($q$ select public.meter_usage(%L,'sms',1,'',null,'normal',null,null)::text $q$, m),
    format($q$ select public.meter_usage(%L,'sms',1,'   ',null,'normal',null,null)::text $q$, m),
    format($q$ select public.meter_usage(%L,'sms',0,'M-BAD-2',null,'normal',null,null)::text $q$, m),
    format($q$ select public.meter_usage(%L,'sms',-5,'M-BAD-3',null,'normal',null,null)::text $q$, m),
    format($q$ select public.meter_usage(%L,'not_an_item',1,'M-BAD-4',null,'normal',null,null)::text $q$, m),
    format($q$ select public.meter_usage(%L,'sms',1,'M-BAD-5',null,'urgent',null,null)::text $q$, m)];
  FOR i IN 1 .. array_length(bad, 1) LOOP
    res := fin01.call('service_role', NULL, bad[i]);
    IF res NOT LIKE 'err:%' THEN all_refused := false; detail := detail || ' #' || i || '=' || left(res, 30); END IF;
  END LOOP;
  PERFORM fin01.expect('M10 NULL organization, NULL or blank reference, non-positive quantity, unknown item and bad priority are all refused',
    all_refused AND fin01.bal(m) = b0 AND fin01.cnt('wallet_ledger', m) = l0 AND fin01.cnt('usage_events', m) = e0, coalesce(nullif(detail, ''), 'all refused, no side effect'));
END $t$;

-- ================================================================ H. history is append-only, signed and audited
DO $t$
DECLARE m uuid := fin01.ctxid('m'); res text; ok_upd boolean := true; ok_del boolean := true; ok_sign boolean := false; sign_detail text := '';
BEGIN
  BEGIN UPDATE public.wallet_ledger SET amount = amount WHERE school_id = m; ok_upd := false; EXCEPTION WHEN others THEN NULL; END;
  BEGIN DELETE FROM public.wallet_ledger WHERE school_id = m; ok_del := false; EXCEPTION WHEN others THEN NULL; END;
  BEGIN UPDATE public.usage_events SET quantity = quantity WHERE school_id = m; ok_upd := false; EXCEPTION WHEN others THEN NULL; END;
  BEGIN DELETE FROM public.usage_events WHERE school_id = m; ok_del := false; EXCEPTION WHEN others THEN NULL; END;
  PERFORM fin01.expect('H1 the wallet ledger and usage events cannot be updated or deleted, even by the table owner', ok_upd AND ok_del);

  -- each probe insert is rolled back (probe exception) when the database wrongly accepts it, so it cannot pollute later checks
  BEGIN
    INSERT INTO public.wallet_ledger (school_id, kind, amount, balance_after, reference) VALUES (m, 'usage', 50, 999, 'H-SIGN-1');
    sign_detail := 'a positive usage line was accepted';
    RAISE EXCEPTION 'probe' USING ERRCODE = 'P0099';
  EXCEPTION WHEN check_violation THEN ok_sign := true; sign_detail := 'check_violation';
            WHEN SQLSTATE 'P0099' THEN NULL;
            WHEN others THEN sign_detail := SQLERRM; END;
  BEGIN
    INSERT INTO public.wallet_ledger (school_id, kind, amount, balance_after, reference) VALUES (m, 'topup', -50, 0, 'H-SIGN-2');
    ok_sign := false; sign_detail := sign_detail || '; a negative topup was accepted';
    RAISE EXCEPTION 'probe' USING ERRCODE = 'P0099';
  EXCEPTION WHEN check_violation THEN NULL; WHEN SQLSTATE 'P0099' THEN NULL; WHEN others THEN NULL; END;
  PERFORM fin01.expect('H2 the ledger refuses a usage line that adds money and a top-up that removes it', ok_sign, sign_detail);
END $t$;

DO $t$
DECLARE r uuid := fin01.ctxid('r'); w boolean := true; detail text := ''; res text; t text; op text; sqls text[];
BEGIN
  -- no API role can write the wallet tables directly (only the posting function can)
  FOREACH t IN ARRAY ARRAY['school_wallets', 'wallet_ledger', 'usage_events', 'term_usage_pools', 'wallet_alerts'] LOOP
    FOREACH op IN ARRAY ARRAY['authenticated', 'service_role', 'anon'] LOOP
      res := fin01.call(op, CASE WHEN op = 'authenticated' THEN fin01.ctxid('u_admin') END,
        format($q$ with x as (update public.%I set school_id = school_id returning 1) select count(*)::text from x $q$, t));
      IF res NOT LIKE 'err:42501%' THEN w := false; detail := detail || ' ' || op || '/' || t || '=' || left(res, 25); END IF;
    END LOOP;
  END LOOP;
  PERFORM fin01.expect('H3 no API role can write the wallet, ledger, usage, pool or alert tables directly', w, coalesce(nullif(detail, ''), 'all writes denied'));
END $t$;

DO $t$
DECLARE r uuid := fin01.ctxid('r'); n_l bigint; n_u bigint;
BEGIN
  SELECT count(*) INTO n_l FROM public.audit_logs WHERE school_id = r AND table_name = 'wallet_ledger' AND action = 'scholar.wallet_ledger.insert';
  SELECT count(*) INTO n_u FROM public.audit_logs WHERE school_id = r AND table_name = 'usage_events' AND action = 'scholar.usage_events.insert';
  PERFORM fin01.expect('H4 every ledger line is audited', n_l >= 2, n_l || ' audit rows for wallet_ledger');
  PERFORM fin01.expect('H5 every usage event (including pool-covered ones) is audited', n_u >= 1, n_u || ' audit rows for usage_events');
END $t$;

-- ================================================================ A. the legitimate approval path still works end to end
-- comms_approve_send runs under the approver's JWT and meters through the definer chain (comms_send -> meter_usage). The
-- lockdown must not break it, and it must still debit exactly once.
DO $t$
DECLARE a uuid := fin01.ctxid('a'); pg jsonb; ap jsonb; bal0 numeric := fin01.bal(a); bal1 numeric; st text; d text := '';
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', fin01.ctxid('u_a1'), 'role', 'authenticated')::text, true);
    pg := public.comms_propose_send(a, 'sms', json_build_object('kind', 'user', 'user_id', fin01.ctxid('u_aparent'))::jsonb,
            'fee_reminder', '{"student":"K","amount":"1","link":"https://x.test"}'::jsonb, 'en');
    PERFORM set_config('request.jwt.claims', json_build_object('sub', fin01.ctxid('u_a2'), 'role', 'authenticated')::text, true);
    ap := public.comms_approve_send(a, (pg->>'proposal_id')::uuid);
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN others THEN EXECUTE 'RESET ROLE'; d := SQLERRM; END;
  bal1 := fin01.bal(a);
  st := (SELECT status FROM public.outbound_messages WHERE proposal_id = (pg->>'proposal_id')::uuid LIMIT 1);
  PERFORM fin01.expect('A1 propose then approve (two admins, authenticated) still queues the message and debits NGN10 exactly once',
    coalesce(st = 'queued' AND bal1 = bal0 - 10 AND (ap->>'released_count')::int = 1, false), d || ' status=' || coalesce(st, '?') || ' delta=' || (bal1 - bal0));
END $t$;

-- ================================================================ I. ledger invariants across every synthetic organization
DO $t$
DECLARE bad text;
BEGIN
  SELECT string_agg(s.slug, ',') INTO bad FROM public.schools s JOIN public.school_wallets w ON w.school_id = s.id
   WHERE s.slug LIKE 'fin01-%'
     AND w.balance IS DISTINCT FROM (SELECT coalesce(sum(l.amount), 0) FROM public.wallet_ledger l WHERE l.school_id = s.id);
  PERFORM fin01.expect('I1 every wallet balance equals the sum of its ledger lines', bad IS NULL, coalesce(bad, 'all reconcile'));
  SELECT string_agg(q.slug || ' ref=' || q.reference || ' amount=' || q.amount || ' after=' || q.balance_after || ' running=' || q.running, '; ') INTO bad FROM (
    SELECT s.slug, l.reference, l.amount, l.balance_after, sum(l.amount) OVER (PARTITION BY l.school_id ORDER BY l.created_at, l.ctid) AS running
      FROM public.wallet_ledger l JOIN public.schools s ON s.id = l.school_id WHERE s.slug LIKE 'fin01-%') q
   WHERE q.balance_after IS DISTINCT FROM q.running;
  PERFORM fin01.expect('I2 every ledger line records the running balance after it', bad IS NULL, coalesce(bad, 'all consistent'));
  SELECT string_agg(s.slug, ',') INTO bad FROM public.schools s JOIN public.school_wallets w ON w.school_id = s.id
   WHERE s.slug LIKE 'fin01-%' AND w.balance < 0 AND s.slug NOT IN ('fin01-n');
  PERFORM fin01.expect('I3 only the school that used its bounded safety overdraft is negative', bad IS NULL, coalesce(bad, 'only fin01-n'));
END $t$;

-- ---------------------------------------------------------------- summary
DO $s$
DECLARE p int; f int; names text;
BEGIN
  SELECT count(*) FILTER (WHERE ok), count(*) FILTER (WHERE NOT ok), string_agg(name, '; ') FILTER (WHERE NOT ok) INTO p, f, names FROM fin01.results;
  RAISE NOTICE 'FIN-01 RESULT: pass=% fail=%', p, f;
  IF f > 0 THEN RAISE EXCEPTION 'FIN-01: % check(s) failed: %', f, names; END IF;
END $s$;

ROLLBACK;
