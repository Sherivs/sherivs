-- M07 fees ledger (LOCAL, DISPOSABLE ONLY).
-- Run only after replaying repository migrations on a loopback disposable DB:
--   psql "postgresql://supabase_admin@127.0.0.1:<port>/postgres" \
--     -v ON_ERROR_STOP=1 -f tests/integration/m07-fees-ledger.local.sql
-- All fixtures are synthetic and the transaction is rolled back.
BEGIN;

DO $guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'M07: must run as a superuser on a disposable DB';
  END IF;
  IF inet_server_addr() IS NOT NULL
     AND NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'M07: refusing non-loopback server address %', inet_server_addr();
  END IF;
  IF to_regclass('public.cg_fee_schedule') IS NULL
     OR to_regclass('public.cg_fee_ledger_line') IS NULL
     OR to_regprocedure('public.cg_fee_decide_refund(uuid,text,text)') IS NULL
     OR to_regprocedure('public.workspace_role_sod_assert(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'M07: fee ledger or role-engine migration is not applied';
  END IF;
END
$guard$;

CREATE SCHEMA m07;
GRANT USAGE ON SCHEMA m07 TO authenticated;
CREATE TABLE m07.ids (label text PRIMARY KEY, id uuid NOT NULL);
CREATE TABLE m07.receipt_ids (label text PRIMARY KEY, number bigint NOT NULL);
GRANT SELECT, INSERT ON m07.ids, m07.receipt_ids TO authenticated;

CREATE FUNCTION m07.login(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION m07.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE 'RESET ROLE'; END $$;
CREATE FUNCTION m07.cnt(p_label text, p_sql text, p_expected bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO n;
  IF n IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'M07 FAIL [%]: expected % rows, got %', p_label, p_expected, n;
  END IF;
END $$;
CREATE FUNCTION m07.denied(p_label text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION
    WHEN SQLSTATE '55000' OR insufficient_privilege OR check_violation THEN RETURN;
  END;
  RAISE EXCEPTION 'M07 FAIL [%]: statement was allowed but must be denied', p_label;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA m07 TO authenticated;

INSERT INTO auth.users (id) VALUES
  ('a7000000-0000-4000-8000-000000000001'),
  ('a7000000-0000-4000-8000-000000000002'),
  ('a7000000-0000-4000-8000-000000000003'),
  ('a7000000-0000-4000-8000-000000000004'),
  ('b7000000-0000-4000-8000-000000000001');
INSERT INTO public.schools (id, name, slug) VALUES
  ('57000000-0000-4000-8000-0000000000a1', 'M07 Synthetic Organization A', 'm07-synthetic-org-a'),
  ('57000000-0000-4000-8000-0000000000b1', 'M07 Synthetic Organization B', 'm07-synthetic-org-b');
INSERT INTO public.users (id, school_id, full_name, email, role, is_active) VALUES
  ('a7000000-0000-4000-8000-000000000001','57000000-0000-4000-8000-0000000000a1','M07 Synthetic Admin','m07-admin@example.invalid','admin',true),
  ('a7000000-0000-4000-8000-000000000002','57000000-0000-4000-8000-0000000000a1','M07 Synthetic Cashier','m07-cashier@example.invalid','teacher',true),
  ('a7000000-0000-4000-8000-000000000003','57000000-0000-4000-8000-0000000000a1','M07 Synthetic Bursar','m07-bursar@example.invalid','teacher',true),
  ('a7000000-0000-4000-8000-000000000004','57000000-0000-4000-8000-0000000000a1','M07 Synthetic Auditor','m07-auditor@example.invalid','teacher',true),
  ('b7000000-0000-4000-8000-000000000001','57000000-0000-4000-8000-0000000000b1','M07 Synthetic Tenant B','m07-tenant-b@example.invalid','teacher',true);
INSERT INTO public.campuses (id, school_id, name, code) VALUES
  ('57000000-0000-4000-8000-0000000000a2','57000000-0000-4000-8000-0000000000a1','M07 Synthetic Campus A','m07-a'),
  ('57000000-0000-4000-8000-0000000000b2','57000000-0000-4000-8000-0000000000b1','M07 Synthetic Campus B','m07-b');
INSERT INTO public.cg_org_unit (id, tenant_id, kind, created_by)
VALUES
  ('m07-org-a','57000000-0000-4000-8000-0000000000a1','organization','m07-fixture'),
  ('m07-org-b','57000000-0000-4000-8000-0000000000b1','organization','m07-fixture');
INSERT INTO public.cg_financial_scope_binding (scope_ref, tenant_id, org_ref, provisioned_by)
VALUES
  ('m07-scope-a','57000000-0000-4000-8000-0000000000a1','m07-org-a','M07 synthetic fixture'),
  ('m07-scope-b','57000000-0000-4000-8000-0000000000b1','m07-org-b','M07 synthetic fixture');
INSERT INTO public.cg_fee_schedule (
  id, scope_ref, tenant_id, org_ref, code, label, academic_year, term, amount_kobo, effective_from, created_by
) VALUES (
  'b7000000-0000-4000-8000-0000000000b1','m07-scope-b','57000000-0000-4000-8000-0000000000b1',
  'm07-org-b','M07-TUITION-B','M07 synthetic tenant B tuition','2026/27','Term 1',15000,
  current_date,'b7000000-0000-4000-8000-000000000001'
);
INSERT INTO public.cg_fee_invoice (
  id, scope_ref, tenant_id, org_ref, schedule_id, campus_id, subject_ref,
  principal_ref, amount_kobo, due_at, issued_by
) VALUES (
  'b7000000-0000-4000-8000-0000000000b2','m07-scope-b','57000000-0000-4000-8000-0000000000b1',
  'm07-org-b','b7000000-0000-4000-8000-0000000000b1','57000000-0000-4000-8000-0000000000b2',
  'm07-student-b-001','m07-payer-b-001',15000,now() + interval '14 days',
  'b7000000-0000-4000-8000-000000000001'
);
SELECT m07.cnt('synthetic tenant B fee exists', $$SELECT 1 FROM public.cg_fee_invoice
  WHERE id='b7000000-0000-4000-8000-0000000000b2'$$, 1);

SELECT m07.login('a7000000-0000-4000-8000-000000000001');
DO $assignments$
DECLARE v_id uuid;
BEGIN
  v_id := public.workspace_role_assignment_create(
    '57000000-0000-4000-8000-0000000000a1','a7000000-0000-4000-8000-000000000002',
    'ng.cashier','campus','57000000-0000-4000-8000-0000000000a2',now() - interval '1 minute',NULL,false,NULL,'{}','{}'
  );
  v_id := public.workspace_role_assignment_create(
    '57000000-0000-4000-8000-0000000000a1','a7000000-0000-4000-8000-000000000003',
    'ng.bursar','institution',NULL,now() - interval '1 minute',NULL,false,NULL,'{}','{}'
  );
  v_id := public.workspace_role_assignment_create(
    '57000000-0000-4000-8000-0000000000a1','a7000000-0000-4000-8000-000000000004',
    'ng.internal_auditor','institution',NULL,now() - interval '1 minute',NULL,false,NULL,'{}','{}'
  );
END
$assignments$;
SELECT m07.logout();

SELECT m07.login('a7000000-0000-4000-8000-000000000003');
DO $invoices$
DECLARE v_schedule uuid; v_invoice uuid; v_invoice_to_reverse uuid;
BEGIN
  v_schedule := public.cg_fee_create_schedule(
    'm07-scope-a','M07-TUITION-2026','M07 synthetic tuition','2026/27',
    'Term 1',10000,current_date,NULL
  );
  INSERT INTO m07.ids VALUES ('schedule',v_schedule);
  v_invoice := public.cg_fee_issue_invoice(
    'm07-scope-a',v_schedule,'57000000-0000-4000-8000-0000000000a2',
    'm07-student-001','m07-payer-001',now() + interval '14 days'
  );
  INSERT INTO m07.ids VALUES ('invoice',v_invoice);
  v_invoice_to_reverse := public.cg_fee_issue_invoice(
    'm07-scope-a',v_schedule,'57000000-0000-4000-8000-0000000000a2',
    'm07-student-002','m07-payer-002',now() + interval '14 days'
  );
  INSERT INTO m07.ids VALUES ('invoice-to-reverse',v_invoice_to_reverse);
END
$invoices$;
SELECT m07.logout();

SELECT m07.login('a7000000-0000-4000-8000-000000000002');
DO $payments$
DECLARE v_invoice uuid; v_payment uuid; v_refund uuid; v_result jsonb; v_number bigint;
BEGIN
  SELECT id INTO v_invoice FROM m07.ids WHERE label='invoice';
  v_result := public.cg_fee_record_payment(v_invoice,3000,'cash','m07-payment-001',NULL);
  v_payment := (v_result->>'payment_id')::uuid;
  v_number := (v_result->>'receipt_number')::bigint;
  INSERT INTO m07.ids VALUES ('payment-one',v_payment);
  INSERT INTO m07.receipt_ids VALUES ('receipt-one',v_number);
  IF v_number <> 1 OR coalesce((v_result->>'duplicate')::boolean,true) THEN
    RAISE EXCEPTION 'M07 FAIL [first receipt is sequence one]';
  END IF;
  v_result := public.cg_fee_record_payment(v_invoice,3000,'cash','m07-payment-001',NULL);
  IF (v_result->>'payment_id')::uuid <> v_payment
     OR (v_result->>'receipt_number')::bigint <> v_number
     OR NOT (v_result->>'duplicate')::boolean THEN
    RAISE EXCEPTION 'M07 FAIL [payment retry is idempotent]';
  END IF;
  v_result := public.cg_fee_record_payment(v_invoice,1000,'bank_transfer','m07-payment-002','M07-SYNTHETIC-BANK-REF');
  INSERT INTO m07.ids VALUES ('payment-two',(v_result->>'payment_id')::uuid);
  INSERT INTO m07.receipt_ids VALUES ('receipt-two',(v_result->>'receipt_number')::bigint);
  IF (v_result->>'receipt_number')::bigint <> 2 THEN
    RAISE EXCEPTION 'M07 FAIL [second receipt increments tenant sequence]';
  END IF;
  PERFORM m07.denied(
    'overpayment is rejected',
    format('SELECT public.cg_fee_record_payment(%L,7000,''cash'',''m07-overpay'',NULL)',v_invoice)
  );
  PERFORM m07.denied(
    'refund request cannot exceed payment amount',
    format('SELECT public.cg_fee_request_refund(%L,4000,''too much'',''m07-refund-too-much'')',v_payment)
  );
  PERFORM m07.denied(
    'cashier cannot reverse an invoice',
    format('SELECT public.cg_fee_reverse_invoice(%L,''unauthorized'')',
      (SELECT id FROM m07.ids WHERE label='invoice-to-reverse'))
  );
  v_refund := public.cg_fee_request_refund(
    v_payment,500,'M07 synthetic refund reason','m07-refund-001'
  );
  INSERT INTO m07.ids VALUES ('refund-request',v_refund);
END
$payments$;
SELECT m07.cnt('cashier cannot approve a refund',
  $$SELECT 1 WHERE NOT public.has_permission('57000000-0000-4000-8000-0000000000a1','payments.refund','institution','57000000-0000-4000-8000-0000000000a1')$$, 1);
SELECT m07.denied('cashier cannot decide own refund',
  $$SELECT public.cg_fee_decide_refund((SELECT id FROM m07.ids WHERE label='refund-request'),'approved',NULL)$$);
SELECT m07.logout();

SELECT m07.cnt('receipt numbers are sequential, tenant-unique, and gap-free',
  $$SELECT 1 FROM public.cg_fee_receipt_sequence_status
      WHERE tenant_id='57000000-0000-4000-8000-0000000000a1'
        AND issued_count=2 AND first_number=1 AND last_number=2 AND gap_free IS TRUE
        AND (SELECT count(DISTINCT receipt_number) FROM public.cg_fee_receipt
              WHERE tenant_id='57000000-0000-4000-8000-0000000000a1')=2$$, 1);
UPDATE public.cg_fee_receipt_counter SET last_number=3
 WHERE tenant_id='57000000-0000-4000-8000-0000000000a1';
SELECT m07.login('a7000000-0000-4000-8000-000000000002');
DO $receipt_gap$
DECLARE v_result jsonb;
BEGIN
  v_result := public.cg_fee_record_payment(
    (SELECT id FROM m07.ids WHERE label='invoice'),1000,'cash','m07-payment-003',NULL
  );
  IF (v_result->>'receipt_number')::bigint <> 4 THEN
    RAISE EXCEPTION 'M07 FAIL [receipt counter advances monotonically after a gap]';
  END IF;
  INSERT INTO m07.ids VALUES ('payment-three',(v_result->>'payment_id')::uuid);
END
$receipt_gap$;
SELECT m07.logout();

WITH request_row AS (
  INSERT INTO public.cg_fee_refund_request (
    scope_ref, tenant_id, org_ref, payment_id, invoice_id, campus_id,
    subject_ref, principal_ref, amount_kobo, reason, idempotency_key, requested_by
  )
  SELECT p.scope_ref, p.tenant_id, p.org_ref, p.id, p.invoice_id, p.campus_id,
         p.subject_ref, p.principal_ref, 250, 'M07 synthetic same-actor test',
         'm07-refund-same-actor', 'a7000000-0000-4000-8000-000000000003'
    FROM public.cg_fee_payment p
   WHERE p.id=(SELECT id FROM m07.ids WHERE label='payment-one')
  RETURNING id
)
INSERT INTO m07.ids SELECT 'same-actor-refund-request', id FROM request_row;

SELECT m07.login('a7000000-0000-4000-8000-000000000003');
SELECT m07.denied('same user cannot request and approve a refund',
  $$SELECT public.cg_fee_decide_refund((SELECT id FROM m07.ids WHERE label='same-actor-refund-request'),'approved',NULL)$$);
SELECT m07.denied('invoice with recorded payments cannot be reversed',
  $$SELECT public.cg_fee_reverse_invoice((SELECT id FROM m07.ids WHERE label='invoice'),'paid invoice correction')$$);
INSERT INTO m07.ids (label,id)
SELECT 'invoice-reversal-posting',
       public.cg_fee_reverse_invoice((SELECT id FROM m07.ids WHERE label='invoice-to-reverse'),'M07 synthetic invoice correction');
SELECT m07.cnt('invoice reversal retry is idempotent',
  $$SELECT 1
      WHERE (SELECT id FROM m07.ids WHERE label='invoice-reversal-posting')
        = public.cg_fee_reverse_invoice((SELECT id FROM m07.ids WHERE label='invoice-to-reverse'),'M07 synthetic invoice correction')$$, 1);
SELECT public.cg_fee_decide_refund(
  (SELECT id FROM m07.ids WHERE label='refund-request'),'approved','M07 synthetic approval'
);
SELECT m07.logout();

SELECT m07.login('a7000000-0000-4000-8000-000000000004');
SELECT m07.cnt('auditor remains read-only',
  $$SELECT 1 FROM public.cg_fee_invoice WHERE id=(SELECT id FROM m07.ids WHERE label='invoice')$$, 1);
SELECT m07.denied('auditor cannot record a payment',
  $$SELECT public.cg_fee_record_payment((SELECT id FROM m07.ids WHERE label='invoice'),100,'cash','m07-auditor-payment',NULL)$$);
SELECT m07.cnt('invoice balance is reconstructed from ledger lines',
  $$SELECT 1 FROM public.cg_fee_invoice_balances
     WHERE invoice_id=(SELECT id FROM m07.ids WHERE label='invoice')
       AND invoiced_kobo=10000 AND balance_kobo=5500$$, 1);
SELECT m07.cnt('view balance equals the sum of ledger lines',
  $$SELECT 1 FROM public.cg_fee_invoice_balances b
      WHERE b.invoice_id=(SELECT id FROM m07.ids WHERE label='invoice')
       AND b.balance_kobo=(
         SELECT coalesce(sum(l.debit_kobo-l.credit_kobo),0)::bigint
           FROM public.cg_fee_ledger_posting p
           JOIN public.cg_fee_ledger_line l ON l.posting_id=p.id
          WHERE p.invoice_id=b.invoice_id AND l.account_code='accounts_receivable'
       )$$, 1);
SELECT m07.cnt('invoice corrections use a balanced reversal entry',
  $$SELECT 1 FROM public.cg_fee_invoice_balances
     WHERE invoice_id=(SELECT id FROM m07.ids WHERE label='invoice-to-reverse')
       AND invoiced_kobo=10000 AND balance_kobo=0 AND is_reversed IS TRUE$$, 1);
SELECT m07.cnt('receipt sequence gap is detected',
  $$SELECT 1 FROM public.cg_fee_receipt_sequence_status
     WHERE tenant_id='57000000-0000-4000-8000-0000000000a1'
       AND issued_count=3 AND first_number=1 AND last_number=4 AND gap_free IS FALSE
       AND (SELECT count(DISTINCT receipt_number) FROM public.cg_fee_receipt
             WHERE tenant_id='57000000-0000-4000-8000-0000000000a1')=3$$, 1);
SELECT m07.cnt('tenant A cannot read tenant B fees',
  $$SELECT 1 FROM public.cg_fee_invoice
     WHERE id='b7000000-0000-4000-8000-0000000000b2'$$, 0);
SELECT m07.denied('auditor cannot request a refund',
  $$SELECT public.cg_fee_request_refund((SELECT id FROM m07.ids WHERE label='payment-two'),100,'unauthorized','m07-auditor-refund')$$);
SELECT m07.logout();

SELECT m07.login('b7000000-0000-4000-8000-000000000001');
SELECT m07.cnt('tenant B cannot read tenant A fees',
  $$SELECT 1 FROM public.cg_fee_invoice WHERE tenant_id='57000000-0000-4000-8000-0000000000a1'$$, 0);
SELECT m07.logout();

SELECT m07.denied('schedule rejects UPDATE',
  $$UPDATE public.cg_fee_schedule SET label='M07 altered synthetic schedule' WHERE id=(SELECT id FROM m07.ids WHERE label='schedule')$$);
SELECT m07.denied('schedule rejects DELETE',
  $$DELETE FROM public.cg_fee_schedule WHERE id=(SELECT id FROM m07.ids WHERE label='schedule')$$);
SELECT m07.denied('invoice rejects UPDATE',
  $$UPDATE public.cg_fee_invoice SET amount_kobo=1 WHERE id=(SELECT id FROM m07.ids WHERE label='invoice')$$);
SELECT m07.denied('invoice rejects DELETE',
  $$DELETE FROM public.cg_fee_invoice WHERE id=(SELECT id FROM m07.ids WHERE label='invoice')$$);
SELECT m07.denied('payment rejects UPDATE',
  $$UPDATE public.cg_fee_payment SET amount_kobo=1 WHERE id=(SELECT id FROM m07.ids WHERE label='payment-one')$$);
SELECT m07.denied('payment rejects DELETE',
  $$DELETE FROM public.cg_fee_payment WHERE id=(SELECT id FROM m07.ids WHERE label='payment-one')$$);
SELECT m07.denied('refund request rejects UPDATE',
  $$UPDATE public.cg_fee_refund_request SET reason='altered' WHERE id=(SELECT id FROM m07.ids WHERE label='refund-request')$$);
SELECT m07.denied('refund request rejects DELETE',
  $$DELETE FROM public.cg_fee_refund_request WHERE id=(SELECT id FROM m07.ids WHERE label='refund-request')$$);
SELECT m07.denied('refund decision rejects UPDATE',
  $$UPDATE public.cg_fee_refund_decision SET decision='rejected' WHERE request_id=(SELECT id FROM m07.ids WHERE label='refund-request')$$);
SELECT m07.denied('refund decision rejects DELETE',
  $$DELETE FROM public.cg_fee_refund_decision WHERE request_id=(SELECT id FROM m07.ids WHERE label='refund-request')$$);
SELECT m07.denied('ledger posting rejects UPDATE',
  $$UPDATE public.cg_fee_ledger_posting SET amount_kobo=1 WHERE invoice_id=(SELECT id FROM m07.ids WHERE label='invoice')$$);
SELECT m07.denied('ledger posting rejects DELETE',
  $$DELETE FROM public.cg_fee_ledger_posting WHERE invoice_id=(SELECT id FROM m07.ids WHERE label='invoice')$$);
SELECT m07.denied('ledger line rejects UPDATE',
  $$UPDATE public.cg_fee_ledger_line SET debit_kobo=1 WHERE posting_id=(SELECT id FROM public.cg_fee_ledger_posting WHERE invoice_id=(SELECT id FROM m07.ids WHERE label='invoice') AND event_type='invoice')$$);
SELECT m07.denied('ledger line rejects DELETE',
  $$DELETE FROM public.cg_fee_ledger_line WHERE posting_id=(SELECT id FROM public.cg_fee_ledger_posting WHERE invoice_id=(SELECT id FROM m07.ids WHERE label='invoice') AND event_type='invoice')$$);
SELECT m07.denied('receipt rejects UPDATE',
  $$UPDATE public.cg_fee_receipt SET receipt_number=99 WHERE payment_id=(SELECT id FROM m07.ids WHERE label='payment-one')$$);
SELECT m07.denied('receipt rejects DELETE',
  $$DELETE FROM public.cg_fee_receipt WHERE payment_id=(SELECT id FROM m07.ids WHERE label='payment-one')$$);
SELECT m07.denied('audit event rejects UPDATE',
  $$UPDATE public.cg_fee_audit_event SET action='update' WHERE object_type='cg_fee_invoice'$$);
SELECT m07.denied('audit event rejects DELETE',
  $$DELETE FROM public.cg_fee_audit_event WHERE object_type='cg_fee_invoice'$$);

DO $$ BEGIN RAISE NOTICE 'M07 ALL PASS'; END $$;
ROLLBACK;
