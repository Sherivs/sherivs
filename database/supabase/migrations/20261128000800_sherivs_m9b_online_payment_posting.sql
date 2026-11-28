-- M9B: post settled Paystack (online) payments into the M07 fee ledger (ADR-163). TEST MODE ONLY (ADR-150 item 6).
-- Until now a Paystack charge updated the legacy fees row and the cg_financial_* engine but never the M07 ledger,
-- so the ledger showed an online payer as still owing. This adds a service-role-only function that posts the payment
-- against the student's single open invoice for the fee's year and term, using an online clearing account (the money
-- sits with Paystack or the school subaccount, not in a till). When the payment cannot be mapped safely it is
-- parked in a queue with a reason instead of being guessed: no open invoice, several open invoices, an amount above
-- the outstanding balance, or a levy (levies are legacy fee rows with no M07 invoice yet).
-- Online payments are never recorded by a person: they are attributed to one configured system user (an ops step: create the
-- user, then insert it into cg_fee_online_actor; until then payments are parked, nothing is guessed), and the M07 refund
-- request path refuses them (online refunds follow the second-person approval path of ADR-155).

ALTER TABLE public.cg_fee_payment DROP CONSTRAINT IF EXISTS cg_fee_payment_method_check;
ALTER TABLE public.cg_fee_payment ADD CONSTRAINT cg_fee_payment_method_check
  CHECK (method = ANY (ARRAY['cash'::text, 'bank_transfer'::text, 'pos'::text, 'online'::text]));
ALTER TABLE public.cg_fee_ledger_line DROP CONSTRAINT IF EXISTS cg_fee_ledger_line_account_code_check;
ALTER TABLE public.cg_fee_ledger_line ADD CONSTRAINT cg_fee_ledger_line_account_code_check
  CHECK (account_code = ANY (ARRAY['accounts_receivable'::text, 'fee_revenue'::text, 'cash'::text, 'fee_relief'::text, 'online_clearing'::text]));

CREATE TABLE IF NOT EXISTS public.cg_fee_online_actor (
  singleton  boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  user_id    uuid NOT NULL REFERENCES public.users(id),
  set_by     uuid,
  set_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cg_fee_online_actor ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_fee_online_actor FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cg_fee_online_actor FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.cg_fee_online_actor TO service_role;

CREATE TABLE IF NOT EXISTS public.cg_fee_online_posting (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  fee_id         uuid NOT NULL,
  reference      text NOT NULL UNIQUE CHECK (length(btrim(reference)) BETWEEN 6 AND 200),
  amount_kobo    bigint NOT NULL CHECK (amount_kobo > 0),
  status         text NOT NULL CHECK (status IN ('posted', 'unposted')),
  reason         text CHECK (reason IN ('levy_not_in_ledger', 'no_open_invoice', 'ambiguous_invoices', 'exceeds_outstanding', 'actor_not_configured')),
  invoice_id     uuid,
  payment_id     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cg_fee_online_posting_shape CHECK ((status = 'posted' AND payment_id IS NOT NULL AND reason IS NULL) OR (status = 'unposted' AND payment_id IS NULL AND reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS cg_fee_online_posting_school_status ON public.cg_fee_online_posting (school_id, status, created_at DESC);
ALTER TABLE public.cg_fee_online_posting ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_fee_online_posting FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.cg_fee_online_posting FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.cg_fee_online_posting TO service_role;

CREATE OR REPLACE FUNCTION public.cg_fee_post_online_payment(p_fee uuid, p_reference text, p_amount_kobo bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  c_actor uuid;
  f public.fees;
  v_existing public.cg_fee_online_posting;
  v_invoices uuid[];
  v_invoice public.cg_fee_invoice%ROWTYPE;
  v_balance bigint;
  v_payment uuid; v_posting uuid; v_receipt bigint; v_reason text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_reference IS NULL OR length(btrim(p_reference)) NOT BETWEEN 6 AND 200 OR p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN
    RAISE EXCEPTION 'invalid online payment' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_existing FROM public.cg_fee_online_posting WHERE reference = btrim(p_reference);
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.fee_id IS DISTINCT FROM p_fee OR v_existing.amount_kobo IS DISTINCT FROM p_amount_kobo THEN
      RAISE EXCEPTION 'online payment reference conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('status', v_existing.status, 'reason', v_existing.reason, 'payment_id', v_existing.payment_id, 'duplicate', true);
  END IF;
  SELECT * INTO f FROM public.fees WHERE id = p_fee FOR SHARE;
  IF f.id IS NULL THEN RAISE EXCEPTION 'fee not found' USING ERRCODE = '42704'; END IF;

  SELECT a.user_id INTO c_actor FROM public.cg_fee_online_actor a;
  IF c_actor IS NULL THEN
    v_reason := 'actor_not_configured';
  ELSIF f.fee_type LIKE 'levy:%' THEN
    v_reason := 'levy_not_in_ledger';
  ELSE
    SELECT array_agg(i.id ORDER BY i.id) INTO v_invoices
      FROM public.cg_fee_invoice i JOIN public.cg_fee_schedule s ON s.id = i.schedule_id
     WHERE i.school_id = f.school_id AND i.subject_ref = f.student_id::text AND s.academic_year = f.academic_year AND s.term = f.term
       AND coalesce((SELECT sum(l.debit_kobo - l.credit_kobo) FROM public.cg_fee_ledger_posting p JOIN public.cg_fee_ledger_line l ON l.posting_id = p.id
                      WHERE p.invoice_id = i.id AND l.account_code = 'accounts_receivable'), 0) > 0;
    IF v_invoices IS NULL THEN v_reason := 'no_open_invoice';
    ELSIF array_length(v_invoices, 1) > 1 THEN v_reason := 'ambiguous_invoices';
    END IF;
  END IF;

  IF v_reason IS NULL THEN
    SELECT * INTO v_invoice FROM public.cg_fee_invoice WHERE id = v_invoices[1] FOR UPDATE;
    SELECT coalesce(sum(l.debit_kobo - l.credit_kobo), 0)::bigint INTO v_balance
      FROM public.cg_fee_ledger_posting p JOIN public.cg_fee_ledger_line l ON l.posting_id = p.id
     WHERE p.invoice_id = v_invoice.id AND l.account_code = 'accounts_receivable';
    IF p_amount_kobo > v_balance THEN v_reason := 'exceeds_outstanding'; END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    INSERT INTO public.cg_fee_online_posting (school_id, fee_id, reference, amount_kobo, status, reason, invoice_id)
    VALUES (f.school_id, f.id, btrim(p_reference), p_amount_kobo, 'unposted', v_reason, v_invoices[1]);
    RETURN jsonb_build_object('status', 'unposted', 'reason', v_reason, 'duplicate', false);
  END IF;

  INSERT INTO public.cg_fee_payment (scope_ref, tenant_id, org_ref, invoice_id, campus_id, subject_ref, principal_ref, amount_kobo, method,
                                     external_reference, idempotency_key, recorded_by)
  VALUES (v_invoice.scope_ref, v_invoice.tenant_id, v_invoice.org_ref, v_invoice.id, v_invoice.campus_id, v_invoice.subject_ref,
          v_invoice.principal_ref, p_amount_kobo, 'online', btrim(p_reference), 'paystack:' || btrim(p_reference), c_actor)
  RETURNING id INTO v_payment;
  INSERT INTO public.cg_fee_ledger_posting (scope_ref, tenant_id, org_ref, invoice_id, payment_id, campus_id, subject_ref, principal_ref, event_type, amount_kobo, actor_id)
  VALUES (v_invoice.scope_ref, v_invoice.tenant_id, v_invoice.org_ref, v_invoice.id, v_payment, v_invoice.campus_id, v_invoice.subject_ref,
          v_invoice.principal_ref, 'payment', p_amount_kobo, c_actor)
  RETURNING id INTO v_posting;
  INSERT INTO public.cg_fee_ledger_line (posting_id, tenant_id, campus_id, principal_ref, account_code, debit_kobo, credit_kobo) VALUES
    (v_posting, v_invoice.tenant_id, v_invoice.campus_id, v_invoice.principal_ref, 'online_clearing', p_amount_kobo, 0),
    (v_posting, v_invoice.tenant_id, v_invoice.campus_id, v_invoice.principal_ref, 'accounts_receivable', 0, p_amount_kobo);
  INSERT INTO public.cg_fee_receipt_counter (tenant_id, last_number) VALUES (v_invoice.tenant_id, 1)
  ON CONFLICT (tenant_id) DO UPDATE SET last_number = public.cg_fee_receipt_counter.last_number + 1
  RETURNING last_number INTO v_receipt;
  INSERT INTO public.cg_fee_receipt (scope_ref, tenant_id, org_ref, payment_id, invoice_id, campus_id, subject_ref, principal_ref, receipt_number, amount_kobo, issued_by)
  VALUES (v_invoice.scope_ref, v_invoice.tenant_id, v_invoice.org_ref, v_payment, v_invoice.id, v_invoice.campus_id, v_invoice.subject_ref,
          v_invoice.principal_ref, v_receipt, p_amount_kobo, c_actor);
  INSERT INTO public.cg_fee_online_posting (school_id, fee_id, reference, amount_kobo, status, invoice_id, payment_id)
  VALUES (f.school_id, f.id, btrim(p_reference), p_amount_kobo, 'posted', v_invoice.id, v_payment);
  RETURN jsonb_build_object('status', 'posted', 'payment_id', v_payment, 'receipt_number', v_receipt, 'duplicate', false);
END $$;
REVOKE ALL ON FUNCTION public.cg_fee_post_online_payment(uuid, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cg_fee_post_online_payment(uuid, text, bigint) TO service_role;

-- A refund of an online payment follows the second-person approval path (ADR-155), never the cashier refund request.
CREATE OR REPLACE FUNCTION public.cg_fee_refund_request_online_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.cg_fee_payment p WHERE p.id = NEW.payment_id AND p.method = 'online') THEN
    RAISE EXCEPTION 'an online payment is refunded through the online refund approval path' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cg_fee_refund_request_online_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_cg_fee_refund_request_online_guard ON public.cg_fee_refund_request;
CREATE TRIGGER trg_cg_fee_refund_request_online_guard BEFORE INSERT ON public.cg_fee_refund_request
  FOR EACH ROW EXECUTE FUNCTION public.cg_fee_refund_request_online_guard();
