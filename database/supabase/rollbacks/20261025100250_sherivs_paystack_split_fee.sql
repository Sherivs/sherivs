-- Rollback for 20261025100250_sherivs_paystack_split_fee: drop split helpers; restore SHERIVS-019 record_cash_payment (plan tier price).
BEGIN;
DROP FUNCTION IF EXISTS public.fee_split_settle(text, text, bigint);
DROP FUNCTION IF EXISTS public.fee_checkout_split(uuid, text, interval);
DROP FUNCTION IF EXISTS public.set_school_platform_price(uuid, numeric, text);
CREATE OR REPLACE FUNCTION public.record_cash_payment(p_school uuid, p_student uuid, p_year text, p_term text, p_amount numeric,
  p_method text DEFAULT 'cash', p_receipt_url text DEFAULT NULL, p_receipt_no text DEFAULT NULL, p_fee uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_share numeric; v_tier text; v_new boolean := false; v_bal numeric;
BEGIN
  IF NOT public.scholar_can(p_school, 'payments.record_cash') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.students WHERE id = p_student AND school_id = p_school) THEN RAISE EXCEPTION 'student not in this school'; END IF;
  IF p_fee IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.fees WHERE id = p_fee AND school_id = p_school AND student_id = p_student) THEN RAISE EXCEPTION 'fee does not belong to this student'; END IF;
  IF p_receipt_url IS NULL AND p_receipt_no IS NULL THEN RAISE EXCEPTION 'receipt photo or receipt number required'; END IF;
  INSERT INTO public.offline_payments (school_id, student_id, fee_id, academic_year, term, amount, method, receipt_url, receipt_no, recorded_by)
  VALUES (p_school, p_student, p_fee, p_year, p_term, p_amount, p_method, p_receipt_url, p_receipt_no, auth.uid()) RETURNING id INTO v_id;
  IF p_fee IS NOT NULL THEN
    UPDATE public.fees SET paid_amount = coalesce(paid_amount, 0) + p_amount,
           status = CASE WHEN coalesce(paid_amount, 0) + p_amount >= amount THEN 'paid' ELSE 'partial' END,
           paid_at = CASE WHEN coalesce(paid_amount, 0) + p_amount >= amount THEN now() ELSE paid_at END WHERE id = p_fee;
  END IF;
  -- Sherivs share once per student per term
  SELECT coalesce(subscription_tier, 'trial') INTO v_tier FROM public.schools WHERE id = p_school;
  SELECT per_student_fee INTO v_share FROM public.plan_allowances WHERE tier = v_tier;
  IF coalesce(v_share, 0) > 0 AND NOT EXISTS (SELECT 1 FROM public.student_platform_fee_ledger
       WHERE school_id = p_school AND student_id = p_student AND academic_year = p_year AND term = p_term AND fee_type = 'platform_share' AND status = 'collected') THEN
    v_bal := public._wallet_post(p_school, 'platform_share', -v_share, 'share:' || p_student || ':' || p_year || ':' || p_term, NULL, 1, p_student,
                                 jsonb_build_object('offline_payment', v_id), true);
    INSERT INTO public.student_platform_fee_ledger (school_id, student_id, academic_year, term, fee_type, amount, status, collected_at, payment_reference)
    VALUES (p_school, p_student, p_year, p_term, 'platform_share', v_share, 'collected', now(), 'wallet:' || v_id)
    ON CONFLICT (school_id, student_id, academic_year, term, fee_type) DO UPDATE SET status = 'collected', collected_at = now(), payment_reference = EXCLUDED.payment_reference, amount = EXCLUDED.amount;
    v_new := true;
  END IF;
  RETURN jsonb_build_object('offline_payment', v_id, 'share_debited', v_new, 'share', CASE WHEN v_new THEN v_share ELSE 0 END, 'balance', v_bal);
END $$;

DROP FUNCTION IF EXISTS public.platform_share_per_student(uuid);
DROP TABLE IF EXISTS public.school_platform_pricing;
COMMIT;
