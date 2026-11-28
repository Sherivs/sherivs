-- PSA-01c: bound the school wallet on the cash path.
-- Creator: Claude Code agent, mission PSA-01c (gap W-028); AI-generated.
-- Finding from PSA-01: record_cash_payment took the platform share from the school wallet with no limit, so a
-- school that never topped up could go arbitrarily negative. Now the cash is always recorded (it was received),
-- and the share is taken only while the wallet stays within platform_share_policy.debt_limit (default 0).
-- Otherwise the share stays pending and is reported as paid-at-school, share-not-taken. Same signature, same
-- grants; the only change in the result is a new key, share_parked. Requires PSA-01 (20261128000700) and the
-- cash path (20261127000900). Not applied anywhere. Rollback restores the cash-path body.
BEGIN;

CREATE OR REPLACE FUNCTION public.record_cash_payment(p_school uuid, p_student uuid, p_year text, p_term text, p_amount numeric,
  p_method text DEFAULT 'cash', p_receipt_url text DEFAULT NULL, p_receipt_no text DEFAULT NULL, p_fee uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_share numeric; v_new boolean := false; v_bal numeric; v_cur numeric; v_limit numeric; v_parked boolean := false;
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
  -- A levy is a legacy fee row with no M07 invoice: its cash is recorded as before and is not applied to the student's fee invoice.
  IF p_fee IS NOT NULL THEN SELECT f.fee_type LIKE 'levy:%' INTO v_levy FROM public.fees f WHERE f.id = p_fee; END IF;
  IF NOT v_levy THEN
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
