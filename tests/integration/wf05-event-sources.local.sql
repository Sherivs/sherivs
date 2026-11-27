-- WF-05 event-source integration checks. Local disposable Postgres only; all rows roll back.
BEGIN;

DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'WF05 FAIL: refusing to run outside the local disposable database';
  END IF;
  IF to_regclass('public.wf_event_source') IS NULL
     OR to_regprocedure('public.wf_emit_event(uuid,text,text,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'WF05 FAIL: WF-05 migration must be present';
  END IF;
END $guard$;

CREATE SCHEMA wf05test;
GRANT USAGE ON SCHEMA wf05test TO anon, authenticated;
CREATE TABLE wf05test.passed (n serial PRIMARY KEY, label text NOT NULL);
GRANT SELECT, INSERT ON wf05test.passed TO anon, authenticated;
GRANT USAGE ON SEQUENCE wf05test.passed_n_seq TO anon, authenticated;
CREATE FUNCTION wf05test.pass(p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO wf05test.passed (label) VALUES (p_label);
  RAISE NOTICE 'WF05 PASS %', p_label;
END $$;
CREATE FUNCTION wf05test.expect_true(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'WF05 FAIL [%]', p_label; END IF;
  PERFORM wf05test.pass(p_label);
END $$;
CREATE FUNCTION wf05test.expect_error(p_label text, p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN
      PERFORM wf05test.pass(p_label);
      RETURN;
    END IF;
    RAISE EXCEPTION 'WF05 FAIL [%]: expected SQLSTATE % got %', p_label, p_state, SQLSTATE;
  END;
  RAISE EXCEPTION 'WF05 FAIL [%]: statement was allowed', p_label;
END $$;
GRANT EXECUTE ON FUNCTION wf05test.pass(text), wf05test.expect_true(text, boolean),
  wf05test.expect_error(text, text, text) TO anon, authenticated;

SELECT wf05test.expect_true('catalog RLS is enabled and forced',
  (SELECT relrowsecurity AND relforcerowsecurity
     FROM pg_class WHERE oid = 'public.wf_event_source'::regclass));
SELECT wf05test.expect_true('catalog is readable only to authenticated users',
  has_table_privilege('authenticated', 'public.wf_event_source', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.wf_event_source', 'SELECT'));
SELECT wf05test.expect_true('catalog writes are service-role only',
  has_table_privilege('service_role', 'public.wf_event_source', 'INSERT')
  AND has_table_privilege('service_role', 'public.wf_event_source', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.wf_event_source', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.wf_event_source', 'INSERT'));
SELECT wf05test.expect_true('seven verified source types are registered and unsupported types deferred',
  (SELECT count(*) = 7 FROM public.wf_event_source WHERE event_type NOT LIKE 'fees.reminder\_%'
                    AND event_type NOT IN ('schedule.weekly', 'schedule.month_end', 'group.kpi_below_threshold'))
  AND NOT EXISTS (SELECT 1 FROM public.wf_event_source
                   WHERE event_type IN ('fees.overdue', 'payment.failed')));
SELECT wf05test.expect_true('all verified source triggers are attached',
  (SELECT count(*) = 7
     FROM (VALUES
       ('wf05_cg_fee_invoice_event', 'public.cg_fee_invoice'::regclass, 'public.wf05_on_cg_fee_invoice()'::regprocedure),
       ('wf05_cg_fee_payment_event', 'public.cg_fee_payment'::regclass, 'public.wf05_on_cg_fee_payment()'::regprocedure),
       ('wf05_wallet_ledger_event', 'public.wallet_ledger'::regclass, 'public.wf05_on_wallet_ledger()'::regprocedure),
       ('wf05_wallet_alerts_event', 'public.wallet_alerts'::regclass, 'public.wf05_on_wallet_alerts()'::regprocedure),
       ('wf05_class_attendance_marks_event', 'public.class_attendance_marks'::regclass, 'public.wf05_on_class_attendance_marks()'::regprocedure),
       ('wf05_admission_stage_events_event', 'public.admission_stage_events'::regclass, 'public.wf05_on_admission_stage_events()'::regprocedure),
       ('wf05_grades_event', 'public.grades'::regclass, 'public.wf05_on_grades()'::regprocedure)
     ) expected(trigger_name, table_oid, function_oid)
     JOIN pg_trigger t ON t.tgname = expected.trigger_name
                      AND t.tgrelid = expected.table_oid
                      AND t.tgfoid = expected.function_oid
                      AND NOT t.tgisinternal));
SELECT wf05test.expect_true('emitter and trigger functions are not client-executable',
  NOT has_function_privilege('anon', 'public.wf_emit_event(uuid,text,text,text,text,jsonb)'::regprocedure, 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.wf_emit_event(uuid,text,text,text,text,jsonb)'::regprocedure, 'EXECUTE')
  AND NOT EXISTS (
    SELECT 1
      FROM unnest(ARRAY[
        'public.wf05_on_cg_fee_invoice()'::regprocedure,
        'public.wf05_on_cg_fee_payment()'::regprocedure,
        'public.wf05_on_wallet_ledger()'::regprocedure,
        'public.wf05_on_wallet_alerts()'::regprocedure,
        'public.wf05_on_class_attendance_marks()'::regprocedure,
        'public.wf05_on_admission_stage_events()'::regprocedure,
        'public.wf05_on_grades()'::regprocedure
      ]) functions(function_oid)
     WHERE has_function_privilege('anon', function_oid, 'EXECUTE')
        OR has_function_privilege('authenticated', function_oid, 'EXECUTE')));
SELECT wf05test.expect_true('clients cannot insert workflow events',
  NOT has_table_privilege('anon', 'public.wf_event', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.wf_event', 'INSERT'));

INSERT INTO public.wf_org_settings (org_id, workflows_enabled)
VALUES
  ('f0500000-0000-4000-8000-000000000001', true),
  ('f0500000-0000-4000-8000-000000000002', true),
  ('f0500000-0000-4000-8000-000000000003', false)
ON CONFLICT (org_id) DO UPDATE SET workflows_enabled = EXCLUDED.workflows_enabled;

CREATE TEMP TABLE wf05_invoice_test (id uuid, school_id uuid, amount_kobo bigint);
CREATE TEMP TABLE wf05_payment_test (id uuid, school_id uuid, invoice_id uuid, amount_kobo bigint, method text);
CREATE TEMP TABLE wf05_ledger_test (id uuid, school_id uuid, kind text, amount numeric);
CREATE TEMP TABLE wf05_alert_test (id uuid, school_id uuid, kind text);
CREATE TEMP TABLE wf05_attendance_test (id uuid, school_id uuid, status text, captured_at timestamptz);
CREATE TEMP TABLE wf05_admissions_test (id bigint, school_id uuid, application_id uuid, from_stage text, to_stage text);
CREATE TEMP TABLE wf05_results_test (id uuid, school_id uuid, is_published boolean);

CREATE TRIGGER wf05_test_invoice AFTER INSERT OR UPDATE ON wf05_invoice_test
  FOR EACH ROW EXECUTE FUNCTION public.wf05_on_cg_fee_invoice();
CREATE TRIGGER wf05_test_payment AFTER INSERT OR UPDATE ON wf05_payment_test
  FOR EACH ROW EXECUTE FUNCTION public.wf05_on_cg_fee_payment();
CREATE TRIGGER wf05_test_ledger AFTER INSERT OR UPDATE ON wf05_ledger_test
  FOR EACH ROW EXECUTE FUNCTION public.wf05_on_wallet_ledger();
CREATE TRIGGER wf05_test_alert AFTER INSERT OR UPDATE ON wf05_alert_test
  FOR EACH ROW EXECUTE FUNCTION public.wf05_on_wallet_alerts();
CREATE TRIGGER wf05_test_attendance AFTER INSERT OR UPDATE ON wf05_attendance_test
  FOR EACH ROW EXECUTE FUNCTION public.wf05_on_class_attendance_marks();
CREATE TRIGGER wf05_test_admissions AFTER INSERT OR UPDATE ON wf05_admissions_test
  FOR EACH ROW EXECUTE FUNCTION public.wf05_on_admission_stage_events();
CREATE TRIGGER wf05_test_results AFTER INSERT OR UPDATE ON wf05_results_test
  FOR EACH ROW EXECUTE FUNCTION public.wf05_on_grades();

INSERT INTO wf05_invoice_test VALUES
  ('f0510000-0000-4000-8000-000000000001', 'f0500000-0000-4000-8000-000000000001', 120000),
  ('f0510000-0000-4000-8000-000000000001', 'f0500000-0000-4000-8000-000000000001', 120000),
  ('f0510000-0000-4000-8000-000000000003', 'f0500000-0000-4000-8000-000000000003', 120000);
INSERT INTO wf05_payment_test VALUES
  ('f0520000-0000-4000-8000-000000000001', 'f0500000-0000-4000-8000-000000000001', 'f0510000-0000-4000-8000-000000000001', 120000, 'bank_transfer'),
  ('f0520000-0000-4000-8000-000000000001', 'f0500000-0000-4000-8000-000000000001', 'f0510000-0000-4000-8000-000000000001', 120000, 'bank_transfer'),
  ('f0520000-0000-4000-8000-000000000003', 'f0500000-0000-4000-8000-000000000003', 'f0510000-0000-4000-8000-000000000003', 120000, 'cash');
INSERT INTO wf05_ledger_test VALUES
  ('f0530000-0000-4000-8000-000000000001', 'f0500000-0000-4000-8000-000000000001', 'topup', 1200),
  ('f0530000-0000-4000-8000-000000000001', 'f0500000-0000-4000-8000-000000000001', 'topup', 1200),
  ('f0530000-0000-4000-8000-000000000003', 'f0500000-0000-4000-8000-000000000003', 'topup', 1200),
  ('f0530000-0000-4000-8000-000000000005', 'f0500000-0000-4000-8000-000000000001', 'topup', -1),
  ('f0530000-0000-4000-8000-000000000004', 'f0500000-0000-4000-8000-000000000001', 'usage', -1);
INSERT INTO wf05_alert_test VALUES
  ('f0540000-0000-4000-8000-000000000001', 'f0500000-0000-4000-8000-000000000001', 'low_balance'),
  ('f0540000-0000-4000-8000-000000000001', 'f0500000-0000-4000-8000-000000000001', 'low_balance'),
  ('f0540000-0000-4000-8000-000000000003', 'f0500000-0000-4000-8000-000000000003', 'low_balance');
INSERT INTO wf05_attendance_test VALUES
  ('f0550000-0000-4000-8000-000000000001', 'f0500000-0000-4000-8000-000000000001', 'present', now()),
  ('f0550000-0000-4000-8000-000000000003', 'f0500000-0000-4000-8000-000000000003', 'absent', now());
DO $attendance_reentry$
BEGIN
  UPDATE wf05_attendance_test SET status = 'absent'
   WHERE id = 'f0550000-0000-4000-8000-000000000001';
  UPDATE wf05_attendance_test SET status = 'present'
   WHERE id = 'f0550000-0000-4000-8000-000000000001';
  UPDATE wf05_attendance_test SET status = 'absent'
   WHERE id = 'f0550000-0000-4000-8000-000000000001';
  UPDATE wf05_attendance_test SET status = 'absent'
   WHERE id = 'f0550000-0000-4000-8000-000000000001';
END $attendance_reentry$;
INSERT INTO wf05_admissions_test VALUES
  (1, 'f0500000-0000-4000-8000-000000000001', 'f0560000-0000-4000-8000-000000000001', 'applied', 'interview'),
  (1, 'f0500000-0000-4000-8000-000000000001', 'f0560000-0000-4000-8000-000000000001', 'applied', 'interview'),
  (2, 'f0500000-0000-4000-8000-000000000003', 'f0560000-0000-4000-8000-000000000003', 'applied', 'interview');
INSERT INTO wf05_results_test VALUES
  ('f0570000-0000-4000-8000-000000000001', 'f0500000-0000-4000-8000-000000000001', false),
  ('f0570000-0000-4000-8000-000000000003', 'f0500000-0000-4000-8000-000000000003', true);
DO $results_reentry$
BEGIN
  UPDATE wf05_results_test SET is_published = true
   WHERE id = 'f0570000-0000-4000-8000-000000000001';
  UPDATE wf05_results_test SET is_published = false
   WHERE id = 'f0570000-0000-4000-8000-000000000001';
  UPDATE wf05_results_test SET is_published = true
   WHERE id = 'f0570000-0000-4000-8000-000000000001';
  UPDATE wf05_results_test SET is_published = true
   WHERE id = 'f0570000-0000-4000-8000-000000000001';
END $results_reentry$;

SELECT wf05test.expect_true('invoice_issued is emitted once for enabled org and never for disabled org',
  (SELECT count(*) = 1 FROM public.wf_event WHERE org_id = 'f0500000-0000-4000-8000-000000000001' AND event_type = 'fees.invoice_issued')
  AND NOT EXISTS (SELECT 1 FROM public.wf_event WHERE org_id = 'f0500000-0000-4000-8000-000000000003' AND event_type = 'fees.invoice_issued'));
SELECT wf05test.expect_true('payment.succeeded is emitted once for enabled org and never for disabled org',
  (SELECT count(*) = 1 FROM public.wf_event WHERE org_id = 'f0500000-0000-4000-8000-000000000001' AND event_type = 'payment.succeeded')
  AND NOT EXISTS (SELECT 1 FROM public.wf_event WHERE org_id = 'f0500000-0000-4000-8000-000000000003' AND event_type = 'payment.succeeded'));
SELECT wf05test.expect_true('wallet.topup_succeeded is emitted once for enabled org and never for disabled org',
  (SELECT count(*) = 1 FROM public.wf_event WHERE org_id = 'f0500000-0000-4000-8000-000000000001' AND event_type = 'wallet.topup_succeeded')
  AND NOT EXISTS (SELECT 1 FROM public.wf_event WHERE org_id = 'f0500000-0000-4000-8000-000000000003' AND event_type = 'wallet.topup_succeeded'));
SELECT wf05test.expect_true('wallet.low_balance is emitted once for enabled org and never for disabled org',
  (SELECT count(*) = 1 FROM public.wf_event WHERE org_id = 'f0500000-0000-4000-8000-000000000001' AND event_type = 'wallet.low_balance')
  AND NOT EXISTS (SELECT 1 FROM public.wf_event WHERE org_id = 'f0500000-0000-4000-8000-000000000003' AND event_type = 'wallet.low_balance'));
SELECT wf05test.expect_true('attendance re-entry emits once per absent transition',
  (SELECT count(*) = 2 FROM public.wf_event WHERE org_id = 'f0500000-0000-4000-8000-000000000001' AND event_type = 'attendance.marked_absent')
  AND NOT EXISTS (SELECT 1 FROM public.wf_event WHERE org_id = 'f0500000-0000-4000-8000-000000000003' AND event_type = 'attendance.marked_absent'));
SELECT wf05test.expect_true('admissions.stage_changed is emitted once for enabled org and never for disabled org',
  (SELECT count(*) = 1 FROM public.wf_event WHERE org_id = 'f0500000-0000-4000-8000-000000000001' AND event_type = 'admissions.stage_changed')
  AND NOT EXISTS (SELECT 1 FROM public.wf_event WHERE org_id = 'f0500000-0000-4000-8000-000000000003' AND event_type = 'admissions.stage_changed'));
SELECT wf05test.expect_true('results re-publication emits once per published transition',
  (SELECT count(*) = 2 FROM public.wf_event WHERE org_id = 'f0500000-0000-4000-8000-000000000001' AND event_type = 'results.published')
  AND NOT EXISTS (SELECT 1 FROM public.wf_event WHERE org_id = 'f0500000-0000-4000-8000-000000000003' AND event_type = 'results.published'));
SELECT wf05test.expect_true('org A source changes never write events for org B',
  NOT EXISTS (SELECT 1 FROM public.wf_event WHERE org_id = 'f0500000-0000-4000-8000-000000000002'));
SELECT wf05test.expect_true('event payload keys exactly match the catalog whitelist',
  NOT EXISTS (
    SELECT 1
      FROM public.wf_event e
      JOIN public.wf_event_source s USING (event_type)
     WHERE e.org_id = 'f0500000-0000-4000-8000-000000000001'
       AND ARRAY(SELECT key FROM jsonb_object_keys(e.payload) AS keys(key) ORDER BY key)
           IS DISTINCT FROM ARRAY(SELECT key FROM unnest(s.payload_keys) AS expected(key) ORDER BY key)
  ));

UPDATE public.wf_event_source SET enabled = false WHERE event_type = 'wallet.low_balance';
INSERT INTO wf05_alert_test VALUES
  ('f0540000-0000-4000-8000-000000000005', 'f0500000-0000-4000-8000-000000000001', 'low_balance');
SELECT wf05test.expect_true('source write succeeds when a catalog type disables emission',
  EXISTS (SELECT 1 FROM wf05_alert_test WHERE id = 'f0540000-0000-4000-8000-000000000005')
  AND NOT EXISTS (SELECT 1 FROM public.wf_event WHERE dedupe_key LIKE '%f0540000-0000-4000-8000-000000000005%'));
UPDATE public.wf_event_source SET enabled = true WHERE event_type = 'wallet.low_balance';

SET LOCAL ROLE anon;
SELECT wf05test.expect_error('anon cannot execute event emitter',
  $q$SELECT public.wf_emit_event('f0500000-0000-4000-8000-000000000001', 'wallet.low_balance', 'wallet_alerts', 'wf05-anon-key', NULL, '{"alert_id":"x","kind":"low_balance"}'::jsonb)$q$, '42501');
SELECT wf05test.expect_error('anon cannot execute source trigger function',
  $q$SELECT public.wf05_on_cg_fee_invoice()$q$, '42501');
SELECT wf05test.expect_error('anon cannot insert workflow events',
  $q$INSERT INTO public.wf_event (org_id, event_type, source, dedupe_key) VALUES ('f0500000-0000-4000-8000-000000000001', 'wallet.low_balance', 'wf05.test', 'wf05-anon-event')$q$, '42501');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT wf05test.expect_error('authenticated cannot execute event emitter',
  $q$SELECT public.wf_emit_event('f0500000-0000-4000-8000-000000000001', 'wallet.low_balance', 'wallet_alerts', 'wf05-auth-key', NULL, '{"alert_id":"x","kind":"low_balance"}'::jsonb)$q$, '42501');
SELECT wf05test.expect_error('authenticated cannot execute source trigger function',
  $q$SELECT public.wf05_on_cg_fee_invoice()$q$, '42501');
SELECT wf05test.expect_error('authenticated cannot insert workflow events',
  $q$INSERT INTO public.wf_event (org_id, event_type, source, dedupe_key) VALUES ('f0500000-0000-4000-8000-000000000001', 'wallet.low_balance', 'wf05.test', 'wf05-auth-event')$q$, '42501');
RESET ROLE;

DO $summary$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM wf05test.passed;
  IF v_count < 20 THEN RAISE EXCEPTION 'WF05 FAIL: expected at least 20 checks, got %', v_count; END IF;
  RAISE NOTICE 'WF05 ALL PASS: % checks', v_count;
END $summary$;
ROLLBACK;
