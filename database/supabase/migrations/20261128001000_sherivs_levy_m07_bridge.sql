-- LEVY-M07: levies get an M07 fee-ledger invoice, and the cash path posts levy cash to it.
-- Creator: Claude Code agent, mission LEVY-M07 (gap W-029); AI-generated.
-- A levy (fee_levy_create) is a legacy fees row with no M07 invoice, so its cash never reached the ledger that the
-- cashier day close reads. fee_levy_ledger_issue(levy, scope, campus) lets a bursar issue one M07 schedule per levy and
-- one invoice per charged student, idempotently. The campus and scope are chosen by the caller because students carry
-- no campus; nothing is guessed. record_cash_payment then posts levy cash to the levy invoice when one exists.
-- Requires the cash path (20261127000900), PSA-01c (20261128000900) and M07. Not applied anywhere.
BEGIN;

CREATE TABLE IF NOT EXISTS public.fee_levy_ledger_schedule (
  levy_id uuid PRIMARY KEY REFERENCES public.fee_levies(id),
  school_id uuid NOT NULL REFERENCES public.schools(id),
  scope_ref text NOT NULL,
  campus_id uuid NOT NULL,
  schedule_id uuid NOT NULL REFERENCES public.cg_fee_schedule(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.fee_levy_ledger_invoice (
  fee_id uuid PRIMARY KEY REFERENCES public.fees(id),
  levy_id uuid NOT NULL REFERENCES public.fee_levies(id),
  school_id uuid NOT NULL REFERENCES public.schools(id),
  invoice_id uuid NOT NULL UNIQUE REFERENCES public.cg_fee_invoice(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fee_levy_ledger_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_levy_ledger_invoice ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fee_levy_ledger_schedule, public.fee_levy_ledger_invoice FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.fee_levy_ledger_schedule, public.fee_levy_ledger_invoice TO service_role;

CREATE OR REPLACE FUNCTION public.fee_levy_ledger_issue(p_levy uuid, p_scope_ref text, p_campus uuid, p_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE l public.fee_levies; v_sched uuid; r record; v_inv uuid; v_issued integer := 0; v_left integer;
BEGIN
  SELECT * INTO l FROM public.fee_levies WHERE id = p_levy;
  IF l.id IS NULL OR l.school_id IS DISTINCT FROM public.get_my_school_id() OR NOT public.scholar_can(l.school_id, 'fees.manage_plans') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'invalid limit' USING ERRCODE = '22023'; END IF;
  IF p_campus IS NULL OR NOT EXISTS (SELECT 1 FROM public.campuses c WHERE c.id = p_campus AND c.school_id = l.school_id) THEN
    RAISE EXCEPTION 'campus is not in this school' USING ERRCODE = '22023';
  END IF;
  -- The ledger's own authorisation (a bursar for this campus) applies to every call, including repeats that issue nothing.
  PERFORM public.cg_fee_authorize(p_scope_ref, 'fees.manage_plans', 'bursar', 'campus', p_campus::text);
  SELECT s.schedule_id INTO v_sched FROM public.fee_levy_ledger_schedule s WHERE s.levy_id = l.id;
  IF v_sched IS NULL THEN
    v_sched := public.cg_fee_create_schedule(p_scope_ref, 'LEVY-' || upper(left(replace(l.id::text, '-', ''), 12)), 'Levy: ' || left(l.name, 140),
                                             l.academic_year, l.term, round(l.amount * 100)::bigint, current_date, NULL);
    INSERT INTO public.fee_levy_ledger_schedule (levy_id, school_id, scope_ref, campus_id, schedule_id, created_by)
    VALUES (l.id, l.school_id, p_scope_ref, p_campus, v_sched, auth.uid());
  ELSIF NOT EXISTS (SELECT 1 FROM public.fee_levy_ledger_schedule s WHERE s.levy_id = l.id AND s.scope_ref = p_scope_ref AND s.campus_id = p_campus) THEN
    RAISE EXCEPTION 'this levy was issued under a different scope or campus' USING ERRCODE = '22023';
  END IF;
  FOR r IN
    SELECT f.id AS fee_id, f.student_id, st.parent_id
      FROM public.fees f JOIN public.students st ON st.id = f.student_id AND st.school_id = l.school_id
     WHERE f.school_id = l.school_id AND f.fee_type = 'levy:' || l.name AND f.term = l.term AND f.academic_year = l.academic_year
       AND NOT EXISTS (SELECT 1 FROM public.fee_levy_ledger_invoice li WHERE li.fee_id = f.id)
     ORDER BY f.id LIMIT p_limit
  LOOP
    v_inv := public.cg_fee_issue_invoice(p_scope_ref, v_sched, p_campus, r.student_id::text,
                                         coalesce(r.parent_id::text, 'student:' || r.student_id::text),
                                         coalesce(l.due_date::timestamptz, now() + interval '30 days'));
    INSERT INTO public.fee_levy_ledger_invoice (fee_id, levy_id, school_id, invoice_id) VALUES (r.fee_id, l.id, l.school_id, v_inv);
    v_issued := v_issued + 1;
  END LOOP;
  SELECT count(*) INTO v_left FROM public.fees f
   WHERE f.school_id = l.school_id AND f.fee_type = 'levy:' || l.name AND f.term = l.term AND f.academic_year = l.academic_year
     AND NOT EXISTS (SELECT 1 FROM public.fee_levy_ledger_invoice li WHERE li.fee_id = f.id);
  RETURN jsonb_build_object('levy', l.id, 'issued', v_issued, 'remaining', v_left, 'schedule', v_sched);
END $$;
REVOKE ALL ON FUNCTION public.fee_levy_ledger_issue(uuid, text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fee_levy_ledger_issue(uuid, text, uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_cash_payment(p_school uuid, p_student uuid, p_year text, p_term text, p_amount numeric,
  p_method text DEFAULT 'cash', p_receipt_url text DEFAULT NULL, p_receipt_no text DEFAULT NULL, p_fee uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_share numeric; v_new boolean := false; v_bal numeric; v_cur numeric; v_limit numeric; v_parked boolean := false; v_levy_inv uuid;
  v_method text; v_invoices uuid[]; v_ledger jsonb; v_levy boolean := false;
BEGIN
  IF NOT public.scholar_can(p_school, 'payments.record_cash') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.students WHERE id = p_student AND school_id = p_school) THEN RAISE EXCEPTION 'student not in this school'; END IF;
  IF p_fee IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.fees WHERE id = p_fee AND school_id = p_school AND student_id = p_student) THEN RAISE EXCEPTION 'fee does not belong to this student'; END IF;
  IF p_receipt_url IS NULL AND p_receipt_no IS NULL THEN RAISE EXCEPTION 'receipt photo or receipt number required'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'amount must be positive and in whole kobo' USING ERRCODE = '22023';
  END IF;
  v_method := CASE p_method WHEN 'cash' THEN 'cash' WHEN 'pos' THEN 'pos' WHEN 'bank_deposit' THEN 'bank_transfer' END;
  IF v_method IS NULL THEN
    RAISE EXCEPTION 'payment method % cannot be posted to the fee ledger', p_method USING ERRCODE = '22023';
  END IF;
  -- A levy is a legacy fee row. If the bursar has issued its M07 invoice (fee_levy_ledger_issue), the cash is posted to that
  -- invoice, never to the student's tuition invoice; if not, it is recorded as before and is not posted to the ledger.
  IF p_fee IS NOT NULL THEN SELECT f.fee_type LIKE 'levy:%' INTO v_levy FROM public.fees f WHERE f.id = p_fee; END IF;
  IF v_levy THEN
    SELECT li.invoice_id INTO v_levy_inv FROM public.fee_levy_ledger_invoice li WHERE li.fee_id = p_fee AND li.school_id = p_school;
    IF v_levy_inv IS NOT NULL THEN
      IF coalesce((SELECT sum(l.debit_kobo - l.credit_kobo)
                     FROM public.cg_fee_ledger_posting p JOIN public.cg_fee_ledger_line l ON l.posting_id = p.id
                    WHERE p.invoice_id = v_levy_inv AND l.account_code = 'accounts_receivable'), 0) <= 0 THEN
        RAISE EXCEPTION 'the levy invoice has nothing outstanding' USING ERRCODE = 'P0002';
      END IF;
      v_invoices := ARRAY[v_levy_inv];
      v_levy := false;
    END IF;
  END IF;
  IF NOT v_levy AND v_invoices IS NULL THEN
    SELECT array_agg(i.id ORDER BY i.id) INTO v_invoices
      FROM public.cg_fee_invoice i
      JOIN public.cg_fee_schedule s ON s.id = i.schedule_id
     WHERE i.school_id = p_school AND i.subject_ref = p_student::text
       AND s.academic_year = p_year AND s.term = p_term
       AND coalesce((SELECT sum(l.debit_kobo - l.credit_kobo)
                       FROM public.cg_fee_ledger_posting p JOIN public.cg_fee_ledger_line l ON l.posting_id = p.id
                      WHERE p.invoice_id = i.id AND l.account_code = 'accounts_receivable'), 0) > 0;
    IF v_invoices IS NULL THEN
      RAISE EXCEPTION 'no open fee invoice for this student, year and term' USING ERRCODE = 'P0002';
    END IF;
    IF array_length(v_invoices, 1) > 1 THEN
      RAISE EXCEPTION 'more than one open fee invoice for this student, year and term' USING ERRCODE = '22023';
    END IF;
  END IF;
  INSERT INTO public.offline_payments (school_id, student_id, fee_id, academic_year, term, amount, method, receipt_url, receipt_no, recorded_by)
  VALUES (p_school, p_student, p_fee, p_year, p_term, p_amount, p_method, p_receipt_url, p_receipt_no, auth.uid()) RETURNING id INTO v_id;
  IF NOT v_levy THEN
    v_ledger := public.cg_fee_record_payment(v_invoices[1], round(p_amount * 100)::bigint, v_method, 'legacy-cash:' || v_id::text, nullif(btrim(p_receipt_no), ''));
  END IF;
  IF p_fee IS NOT NULL THEN
    UPDATE public.fees SET paid_amount = coalesce(paid_amount, 0) + p_amount,
           status = CASE WHEN coalesce(paid_amount, 0) + p_amount >= amount THEN 'paid' ELSE 'partial' END,
           paid_at = CASE WHEN coalesce(paid_amount, 0) + p_amount >= amount THEN now() ELSE paid_at END WHERE id = p_fee;
  END IF;
  v_share := public.platform_share_per_student(p_school);
  IF coalesce(v_share, 0) > 0 AND NOT EXISTS (SELECT 1 FROM public.student_platform_fee_ledger
       WHERE school_id = p_school AND student_id = p_student AND academic_year = p_year AND term = p_term AND fee_type = 'platform_share' AND status IN ('collected', 'waived')) THEN
    -- Bound (PSA-01c): the cash is always recorded, but the share is taken from the wallet only while the
    -- wallet stays within the school's debt limit (platform_share_policy.debt_limit, default 0). Otherwise the
    -- share stays pending, so it shows in the operator report and is taken once the wallet is topped up.
    SELECT w.balance INTO v_cur FROM public.school_wallets w WHERE w.school_id = p_school FOR UPDATE;
    v_cur := coalesce(v_cur, 0);
    v_limit := coalesce((SELECT p.debt_limit FROM public.platform_share_policy p WHERE p.school_id = p_school), 0);
    IF v_cur - v_share >= -v_limit THEN
      v_bal := public._wallet_post(p_school, 'platform_share', -v_share, 'share:' || p_student || ':' || p_year || ':' || p_term, NULL, 1, p_student,
                                   jsonb_build_object('offline_payment', v_id), true);
      INSERT INTO public.student_platform_fee_ledger (school_id, student_id, academic_year, term, fee_type, amount, status, collected_at, payment_reference)
      VALUES (p_school, p_student, p_year, p_term, 'platform_share', v_share, 'collected', now(), 'wallet:' || v_id)
      ON CONFLICT (school_id, student_id, academic_year, term, fee_type) DO UPDATE SET status = 'collected', collected_at = now(), payment_reference = EXCLUDED.payment_reference, amount = EXCLUDED.amount;
      v_new := true;
    ELSE
      INSERT INTO public.student_platform_fee_ledger (school_id, student_id, academic_year, term, fee_type, amount, status)
      VALUES (p_school, p_student, p_year, p_term, 'platform_share', v_share, 'pending')
      ON CONFLICT (school_id, student_id, academic_year, term, fee_type) DO NOTHING;
      v_bal := v_cur;
      v_parked := true;
    END IF;
  END IF;
  RETURN jsonb_build_object('offline_payment', v_id, 'share_debited', v_new, 'share', CASE WHEN v_new THEN v_share ELSE 0 END, 'share_parked', v_parked, 'balance', v_bal,
                            'ledger_payment', v_ledger->'payment_id', 'receipt_number', v_ledger->'receipt_number', 'ledger_posted', NOT v_levy);
END $$;

COMMIT;
