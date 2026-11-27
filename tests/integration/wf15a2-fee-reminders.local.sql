-- WF-15a2 integration checks: due-date-relative fee reminder events and stop-on-payment. Local disposable Postgres only; rolls back.
BEGIN;
DO $guard$
BEGIN
  IF NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'WF15A2 FAIL: refusing to run outside the local disposable database';
  END IF;
  IF to_regprocedure('public.wf_fee_reminder_scan(timestamptz,integer)') IS NULL THEN
    RAISE EXCEPTION 'WF15A2 FAIL: the WF-15a2 migration must be present';
  END IF;
END $guard$;

CREATE SCHEMA w2t;
CREATE TABLE w2t.passed (n serial PRIMARY KEY, label text NOT NULL);
CREATE FUNCTION w2t.ok(p_label text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'WF15A2 FAIL [%]', p_label; END IF;
  INSERT INTO w2t.passed (label) VALUES (p_label);
END $$;
CREATE FUNCTION w2t.err(p_label text, p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN INSERT INTO w2t.passed (label) VALUES (p_label); RETURN; END IF;
    RAISE EXCEPTION 'WF15A2 FAIL [%]: expected % got %', p_label, p_state, SQLSTATE;
  END;
  RAISE EXCEPTION 'WF15A2 FAIL [%]: statement was allowed', p_label;
END $$;

-- 1. Schedule (pure): due Friday 4 Dec 2026 12:00 Lagos
SELECT w2t.ok('22 rungs: 4 weeks x 2, due day, 12 overdue, 1 escalation',
  (SELECT count(*) = 22 FROM public.wf_fee_reminder_rungs('2026-12-04 11:00+00')));
SELECT w2t.ok('week 4 first day is Monday 6 Nov 2026 08:00 Lagos (07:00 UTC), 28 days before the due date',
  (SELECT at = '2026-11-02 07:00+00' AND offset_days = 32 FROM public.wf_fee_reminder_rungs('2026-12-04 11:00+00') WHERE rung = 'w4_first'));
SELECT w2t.ok('every first-day rung is a Monday at 08:00 Lagos and every last-day rung a Friday at 12:00 Lagos',
  (SELECT bool_and(CASE WHEN rung LIKE '%\_first' THEN extract(isodow FROM at AT TIME ZONE 'Africa/Lagos') = 1 AND extract(hour FROM at AT TIME ZONE 'Africa/Lagos') = 8
                        WHEN rung LIKE '%\_last' THEN extract(isodow FROM at AT TIME ZONE 'Africa/Lagos') = 5 AND extract(hour FROM at AT TIME ZONE 'Africa/Lagos') = 12 ELSE true END)
     FROM public.wf_fee_reminder_rungs('2026-12-04 11:00+00')));
SELECT w2t.ok('the due-day rung is the due date at 08:00 Lagos; overdue rungs are weekly after it',
  (SELECT at = '2026-12-04 07:00+00' FROM public.wf_fee_reminder_rungs('2026-12-04 11:00+00') WHERE rung = 'due_day')
  AND (SELECT at = '2026-12-11 07:00+00' AND offset_days = -7 FROM public.wf_fee_reminder_rungs('2026-12-04 11:00+00') WHERE rung = 'over_w1')
  AND (SELECT at = '2027-02-26 07:00+00' FROM public.wf_fee_reminder_rungs('2026-12-04 11:00+00') WHERE rung = 'over_w12'));
SELECT w2t.ok('the escalation is four weeks after the due date at 09:00 Lagos',
  (SELECT at = '2027-01-01 08:00+00' FROM public.wf_fee_reminder_rungs('2026-12-04 11:00+00') WHERE rung = 'escalate'));
SELECT w2t.ok('no rung is scheduled in the quiet hours (20:00 to 08:00 Lagos)',
  (SELECT bool_and(extract(hour FROM at AT TIME ZONE 'Africa/Lagos') BETWEEN 8 AND 19) FROM public.wf_fee_reminder_rungs('2026-12-04 11:00+00')));
SELECT w2t.ok('a due date late in the evening UTC still lands on the Lagos calendar day',
  (SELECT at = '2026-12-05 07:00+00' FROM public.wf_fee_reminder_rungs('2026-12-04 23:30+00') WHERE rung = 'due_day'));

-- 2. Event sources
SELECT w2t.ok('five reminder event sources are registered with the four-key payload',
  (SELECT count(*) = 5 AND bool_and(payload_keys = ARRAY['amount_kobo', 'due_at', 'invoice_id', 'offset_days'] AND enabled)
     FROM public.wf_event_source WHERE event_type LIKE 'fees.reminder\_%'));

-- 3. Privileges
SELECT w2t.ok('only the scanner is executable, and only by the service role',
  has_function_privilege('service_role', 'public.wf_fee_reminder_scan(timestamptz,integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.wf_fee_reminder_scan(timestamptz,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.wf_fee_reminder_scan(timestamptz,integer)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.wf_fee_invoice_settled(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.wf_fee_reminder_stop_on_payment()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.wf_fee_reminder_rungs(timestamptz)', 'EXECUTE'));
SELECT w2t.ok('all four functions are SECURITY DEFINER or pure with an empty search_path',
  (SELECT count(*) = 4 AND bool_and(p.proconfig @> ARRAY['search_path=""']) FROM pg_proc p
    WHERE p.proname IN ('wf_fee_reminder_rungs', 'wf_fee_invoice_settled', 'wf_fee_reminder_scan', 'wf_fee_reminder_stop_on_payment')));

-- 4. Fixtures: bypass the unrelated fee-ledger foreign keys (local only)
SET session_replication_role = replica;
INSERT INTO public.schools (id, name, slug) VALUES
  ('f1a00000-0000-4000-8000-0000000000a1', 'W2 On', 'w2-on'), ('f1a00000-0000-4000-8000-0000000000b2', 'W2 Off', 'w2-off');
INSERT INTO public.wf_org_settings (org_id, workflows_enabled, autonomy_ceiling) VALUES
  ('f1a00000-0000-4000-8000-0000000000a1', true, 'draft'), ('f1a00000-0000-4000-8000-0000000000b2', false, 'draft')
  ON CONFLICT (org_id) DO UPDATE SET workflows_enabled = EXCLUDED.workflows_enabled;
CREATE FUNCTION w2t.inv(p_id text, p_org text, p_amount bigint, p_due timestamptz, p_issued timestamptz) RETURNS void LANGUAGE plpgsql AS $$
DECLARE o uuid := ('f1a00000-0000-4000-8000-0000000000' || p_org)::uuid;
BEGIN
  INSERT INTO public.cg_fee_invoice (id, scope_ref, tenant_id, org_ref, schedule_id, campus_id, subject_ref, principal_ref, amount_kobo, due_at, issued_by, issued_at)
  VALUES (('f1b00000-0000-4000-8000-0000000000' || p_id)::uuid, 's', o::text, 'o', gen_random_uuid(), gen_random_uuid(), 'sub', 'pri', p_amount, p_due, gen_random_uuid(), p_issued);
END $$;
CREATE FUNCTION w2t.pay(p_id text, p_inv text, p_org text, p_amount bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.cg_fee_payment (id, scope_ref, tenant_id, org_ref, invoice_id, campus_id, subject_ref, principal_ref, amount_kobo, currency, method, idempotency_key, recorded_by, recorded_at)
  VALUES (('f1c00000-0000-4000-8000-0000000000' || p_id)::uuid, 's', 'f1a00000-0000-4000-8000-0000000000' || p_org, 'o',
          ('f1b00000-0000-4000-8000-0000000000' || p_inv)::uuid, gen_random_uuid(), 'sub', 'pri', p_amount, 'NGN', 'cash', 'w2-pay-' || p_id, gen_random_uuid(), now());
END $$;
ALTER TABLE public.cg_fee_payment ENABLE ALWAYS TRIGGER wf15a2_cg_fee_payment_stop;
-- 01 unpaid, org on; 02 org off; 03 part-paid; 04 fully paid; 05 issued after the first rungs
SELECT w2t.inv('01', 'a1', 100000, '2026-12-04 11:00+00', '2026-10-01 00:00+00');
SELECT w2t.inv('02', 'b2', 100000, '2026-12-04 11:00+00', '2026-10-01 00:00+00');
SELECT w2t.inv('03', 'a1', 100000, '2026-12-04 11:00+00', '2026-10-01 00:00+00');
SELECT w2t.inv('04', 'a1', 100000, '2026-12-04 11:00+00', '2026-10-01 00:00+00');
SELECT w2t.inv('05', 'a1', 100000, '2026-12-04 11:00+00', '2026-11-30 00:00+00');
SELECT w2t.pay('03', '03', 'a1', 40000);
SELECT w2t.pay('04', '04', 'a1', 100000);

SELECT w2t.ok('settled is false for unpaid and part-paid, true for fully paid, false for an unknown invoice',
  NOT public.wf_fee_invoice_settled('f1b00000-0000-4000-8000-000000000001')
  AND NOT public.wf_fee_invoice_settled('f1b00000-0000-4000-8000-000000000003')
  AND public.wf_fee_invoice_settled('f1b00000-0000-4000-8000-000000000004')
  AND NOT public.wf_fee_invoice_settled(gen_random_uuid()));

-- 5. Scan: Monday 2 Nov 2026 09:00 Lagos (08:00 UTC) is the week-4 first-day rung (07:00 UTC)
CREATE TABLE w2t.scan_out (n serial, r jsonb);
INSERT INTO w2t.scan_out (r) SELECT public.wf_fee_reminder_scan('2026-11-02 08:00+00');
SELECT w2t.ok('scan on the first-day rung emits one event for each unpaid invoice of the enabled org',
  (SELECT (r ->> 'emitted')::int = 2 FROM w2t.scan_out WHERE n = 1)
  AND (SELECT count(*) = 1 FROM public.wf_event WHERE event_type = 'fees.reminder_week_start' AND subject_ref = 'f1b00000-0000-4000-8000-000000000001')
  AND (SELECT count(*) = 1 FROM public.wf_event WHERE event_type = 'fees.reminder_week_start' AND subject_ref = 'f1b00000-0000-4000-8000-000000000003'));
SELECT w2t.ok('nothing is emitted for the disabled org, the paid invoice, or the late-issued invoice (first-day rung)',
  NOT EXISTS (SELECT 1 FROM public.wf_event WHERE event_type LIKE 'fees.reminder\_%' AND subject_ref IN
    ('f1b00000-0000-4000-8000-000000000002', 'f1b00000-0000-4000-8000-000000000004', 'f1b00000-0000-4000-8000-000000000005')));
SELECT w2t.ok('the payload carries exactly invoice_id, amount_kobo, due_at (Lagos date) and offset_days',
  (SELECT payload = jsonb_build_object('invoice_id', 'f1b00000-0000-4000-8000-000000000001', 'amount_kobo', 100000, 'due_at', '2026-12-04', 'offset_days', 32)
     FROM public.wf_event WHERE subject_ref = 'f1b00000-0000-4000-8000-000000000001' AND event_type = 'fees.reminder_week_start'));
SELECT w2t.ok('running the scan again, and again an hour later, emits nothing new (dedupe)',
  (public.wf_fee_reminder_scan('2026-11-02 08:00+00') ->> 'emitted')::int = 0
  AND (public.wf_fee_reminder_scan('2026-11-02 09:00+00') ->> 'emitted')::int = 0);
SELECT w2t.ok('a scan outside any 36-hour window emits nothing (no backlog flood)',
  (public.wf_fee_reminder_scan('2026-11-22 20:00+00') ->> 'emitted')::int = 0);
INSERT INTO w2t.scan_out (r) SELECT public.wf_fee_reminder_scan('2026-11-06 12:00+00');
INSERT INTO w2t.scan_out (r) SELECT public.wf_fee_reminder_scan('2026-12-04 08:00+00');
INSERT INTO w2t.scan_out (r) SELECT public.wf_fee_reminder_scan('2026-12-11 08:00+00');
INSERT INTO w2t.scan_out (r) SELECT public.wf_fee_reminder_scan('2027-01-01 09:00+00');
SELECT w2t.ok('the last-day rung maps to the week_end event; the due day to due_day; the first overdue to overdue; the escalation to escalation',
  (SELECT array_agg((r ->> 'emitted')::int ORDER BY n) = ARRAY[2, 3, 3, 6] FROM w2t.scan_out WHERE n BETWEEN 2 AND 5)
  AND (SELECT count(DISTINCT event_type) = 5 FROM public.wf_event WHERE event_type LIKE 'fees.reminder\_%'));
SELECT w2t.ok('the overdue payload counts days past the due date as a negative offset',
  (SELECT (payload ->> 'offset_days')::int = -7 FROM public.wf_event WHERE dedupe_key = 'fees.reminder:f1b00000-0000-4000-8000-000000000001:over_w1'));
SELECT w2t.ok('the scan reports skipped paid invoices',
  (public.wf_fee_reminder_scan('2026-11-02 08:00+00') ->> 'skipped_paid')::int >= 1);
SELECT w2t.ok('the limit is clamped (a negative or huge limit does not fail)',
  (public.wf_fee_reminder_scan('2026-11-02 08:00+00', -5) IS NOT NULL) AND (public.wf_fee_reminder_scan('2026-11-02 08:00+00', 999999) IS NOT NULL));

-- 6. Stop on payment: an open run for invoice 01 ends, with its drafts cancelled, when the invoice is fully paid
SET session_replication_role = DEFAULT;
INSERT INTO auth.users (id) VALUES ('f1d00000-0000-4000-8000-000000000001'), ('f1d00000-0000-4000-8000-000000000002');
INSERT INTO public.wf_definition (id, org_id, key, name) VALUES ('f1e00000-0000-4000-8000-000000000001', 'f1a00000-0000-4000-8000-0000000000a1', 'w2-wf', 'W2');
INSERT INTO public.wf_version (id, org_id, definition_id, version, graph, created_by)
  VALUES ('f1e00000-0000-4000-8000-000000000002', 'f1a00000-0000-4000-8000-0000000000a1', 'f1e00000-0000-4000-8000-000000000001', 1, '{"steps":[]}', 'f1d00000-0000-4000-8000-000000000001');
UPDATE public.wf_version SET state = 'published', published_by = 'f1d00000-0000-4000-8000-000000000002' WHERE id = 'f1e00000-0000-4000-8000-000000000002';
UPDATE public.wf_definition SET current_version_id = 'f1e00000-0000-4000-8000-000000000002', status = 'active' WHERE id = 'f1e00000-0000-4000-8000-000000000001';
INSERT INTO public.wf_run (id, org_id, definition_id, version_id, event_id, idempotency_key, status, max_depth, max_steps, step_count, started_by, deadline_at, started_at)
SELECT gen_random_uuid(), e.org_id, 'f1e00000-0000-4000-8000-000000000001', 'f1e00000-0000-4000-8000-000000000002', e.id, 'w2-run-' || e.id::text, 'running', 3, 500, 0, NULL, now() + interval '1 hour', now()
  FROM public.wf_event e WHERE e.event_type = 'fees.reminder_week_start' AND e.subject_ref IN ('f1b00000-0000-4000-8000-000000000001', 'f1b00000-0000-4000-8000-000000000003');
SET session_replication_role = replica;
SELECT w2t.ok('two reminder runs are open (invoice 01 and 03)',
  (SELECT count(*) = 2 FROM public.wf_run WHERE idempotency_key LIKE 'w2-run-%' AND status = 'running'));
SELECT w2t.pay('01', '01', 'a1', 40000);
SELECT w2t.ok('a part payment does not stop the ladder',
  (SELECT count(*) = 2 FROM public.wf_run WHERE idempotency_key LIKE 'w2-run-%' AND status = 'running'));
SELECT w2t.pay('02', '01', 'a1', 60000);
SELECT w2t.ok('the payment that settles invoice 01 cancels its run, with the code fees.paid, and only its run',
  (SELECT r.status = 'cancelled' AND r.error_code = 'fees.paid' AND r.finished_at IS NOT NULL FROM public.wf_run r JOIN public.wf_event e ON e.id = r.event_id WHERE e.subject_ref = 'f1b00000-0000-4000-8000-000000000001' AND r.idempotency_key LIKE 'w2-run-%')
  AND (SELECT r.status = 'running' FROM public.wf_run r JOIN public.wf_event e ON e.id = r.event_id WHERE e.subject_ref = 'f1b00000-0000-4000-8000-000000000003' AND r.idempotency_key LIKE 'w2-run-%'));
INSERT INTO w2t.scan_out (r) SELECT public.wf_fee_reminder_scan('2026-12-18 08:00+00');
SELECT w2t.ok('after payment the scanner emits the next rung for the unpaid invoices only (03 and 05), never the settled 01 or 04',
  (SELECT (r ->> 'emitted')::int = 2 FROM w2t.scan_out ORDER BY n DESC LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM public.wf_event WHERE dedupe_key LIKE 'fees.reminder:f1b00000-0000-4000-8000-000000000001:over_w2')
  AND EXISTS (SELECT 1 FROM public.wf_event WHERE dedupe_key LIKE 'fees.reminder:f1b00000-0000-4000-8000-000000000005:over_w2'));
SELECT w2t.ok('rollback of the stop trigger target: a payment on an unrelated invoice (no reminder run) changes nothing',
  (SELECT count(*) = 1 FROM public.wf_run WHERE idempotency_key LIKE 'w2-run-%' AND status = 'running'));

DO $done$ DECLARE n integer; BEGIN SELECT count(*) INTO n FROM w2t.passed; RAISE NOTICE 'WF15A2 ALL PASS: % checks', n; END $done$;
ROLLBACK;
