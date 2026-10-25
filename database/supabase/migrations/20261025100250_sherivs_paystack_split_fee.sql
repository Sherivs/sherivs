-- SHERIVS-PAY-SPLIT: fee checkout through Paystack split (school subaccount + Sherivs main account).
--   * the parent is charged exactly fee_amount_due(fee) (A05b relief-aware amount; unchanged)
--   * Sherivs' per-student per-term fee (plan tier: starter 2000, growth 3000, professional 5000,
--     enterprise negotiated in school_platform_pricing) goes to the main account as transaction_charge,
--     at most ONCE per student per term (reserved in student_platform_fee_ledger, fee_type 'platform_share')
--   * bearer = 'account': the main (Sherivs) account absorbs the Paystack processing fee, so the
--     school's subaccount receives exactly (amount charged - Sherivs fee) with no processing deduction
--   * cash/offline payments keep debiting the school wallet once per student per term (record_cash_payment),
--     now using the same per-student price (negotiated enterprise price included)
-- Rollback: database/supabase/rollbacks/20261025100250_sherivs_paystack_split_fee.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.school_platform_pricing (
  school_id uuid PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,
  per_student_fee numeric NOT NULL CHECK (per_student_fee >= 0),
  note text, set_by uuid, updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.school_platform_pricing ENABLE ROW LEVEL SECURITY; ALTER TABLE public.school_platform_pricing FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.school_platform_pricing FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.school_platform_pricing TO service_role;

-- Negotiated (enterprise) price: platform staff only.
CREATE OR REPLACE FUNCTION public.set_school_platform_price(p_school uuid, p_fee numeric, p_note text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT (coalesce(public.is_super_admin(), false) OR coalesce(auth.role(), '') = 'service_role') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_fee IS NULL OR p_fee < 0 THEN RAISE EXCEPTION 'invalid fee'; END IF;
  INSERT INTO public.school_platform_pricing (school_id, per_student_fee, note, set_by) VALUES (p_school, p_fee, p_note, auth.uid())
  ON CONFLICT (school_id) DO UPDATE SET per_student_fee = EXCLUDED.per_student_fee, note = EXCLUDED.note, set_by = EXCLUDED.set_by, updated_at = now();
END $$;
REVOKE ALL ON FUNCTION public.set_school_platform_price(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_school_platform_price(uuid, numeric, text) TO authenticated, service_role;

-- Per-student per-term Sherivs fee in naira: negotiated price wins, else the plan tier price (trial = 0).
CREATE OR REPLACE FUNCTION public.platform_share_per_student(p_school uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(
    (SELECT per_student_fee FROM public.school_platform_pricing WHERE school_id = p_school),
    (SELECT a.per_student_fee FROM public.schools s JOIN public.plan_allowances a ON a.tier = coalesce(s.subscription_tier, 'trial') WHERE s.id = p_school),
    0);
$$;
REVOKE ALL ON FUNCTION public.platform_share_per_student(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_share_per_student(uuid) TO service_role;

-- Checkout plan for one fee row (service_role only; called by the server after the caller's own RLS checks).
-- Reserves the term share for this reference when it is still owed, so concurrent checkouts for the same
-- student/term cannot both take it. A reservation older than p_hold expires and can be taken again.
CREATE OR REPLACE FUNCTION public.fee_checkout_split(p_fee uuid, p_reference text, p_hold interval DEFAULT interval '45 minutes')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE f public.fees; sub public.org_payment_subaccounts; due numeric; share numeric; amt_k bigint; share_k bigint := 0; l public.student_platform_fee_ledger;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_reference IS NULL OR length(p_reference) < 6 THEN RAISE EXCEPTION 'invalid reference'; END IF;
  SELECT * INTO f FROM public.fees WHERE id = p_fee;
  IF f.id IS NULL THEN RAISE EXCEPTION 'fee not found'; END IF;
  due := public.fee_amount_due(p_fee);
  amt_k := round(coalesce(due, 0) * 100);
  IF amt_k < 100 THEN RAISE EXCEPTION 'nothing to pay on this invoice'; END IF;
  SELECT * INTO sub FROM public.org_payment_subaccounts WHERE org_id = f.school_id AND active;
  IF sub.org_id IS NULL THEN
    RETURN jsonb_build_object('split', false, 'amount_kobo', amt_k, 'share_kobo', 0, 'school_id', f.school_id, 'student_id', f.student_id);
  END IF;
  share := public.platform_share_per_student(f.school_id);
  IF share > 0 THEN
    -- one row per student/term; lock it so concurrent checkouts serialize
    INSERT INTO public.student_platform_fee_ledger (school_id, student_id, academic_year, term, fee_type, amount, status)
    VALUES (f.school_id, f.student_id, f.academic_year, f.term, 'platform_share', share, 'pending')
    ON CONFLICT (school_id, student_id, academic_year, term, fee_type) DO NOTHING;
    SELECT * INTO l FROM public.student_platform_fee_ledger
     WHERE school_id = f.school_id AND student_id = f.student_id AND academic_year = f.academic_year AND term = f.term AND fee_type = 'platform_share' FOR UPDATE;
    IF l.status = 'pending' AND (l.payment_reference IS NULL OR NOT l.payment_reference LIKE 'paystack:%'
        OR l.payment_reference = 'paystack:' || p_reference OR l.updated_at <= now() - p_hold) THEN
      share_k := round(share * 100);
      -- the school must receive something: if this payment is too small to carry the share, leave it for a later one
      IF share_k >= amt_k THEN share_k := 0;
      ELSE UPDATE public.student_platform_fee_ledger SET payment_reference = 'paystack:' || p_reference, amount = share, updated_at = now() WHERE id = l.id;
      END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object('split', true, 'amount_kobo', amt_k, 'share_kobo', share_k, 'subaccount_code', sub.subaccount_code,
                            'bearer', 'account', 'school_id', f.school_id, 'student_id', f.student_id,
                            'academic_year', f.academic_year, 'term', f.term);
END $$;
REVOKE ALL ON FUNCTION public.fee_checkout_split(uuid, text, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fee_checkout_split(uuid, text, interval) TO service_role;

-- Settlement of the split part (service_role; called after settlePaystackCharge marked the fee paid).
-- Checks the subaccount Paystack reports, marks the term share collected. If the share had meanwhile been
-- debited from the wallet by a cash payment, that wallet debit is refunded (the share is never taken twice).
CREATE OR REPLACE FUNCTION public.fee_split_settle(p_reference text, p_subaccount text, p_share_kobo bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE f public.fees; sub public.org_payment_subaccounts; l public.student_platform_fee_ledger; v_ref text := 'paystack:' || p_reference; refunded boolean := false;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO f FROM public.fees WHERE paystack_reference = p_reference;
  IF f.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unknown_reference'); END IF;
  IF p_subaccount IS NOT NULL THEN
    SELECT * INTO sub FROM public.org_payment_subaccounts WHERE org_id = f.school_id;
    IF sub.subaccount_code IS DISTINCT FROM p_subaccount THEN RETURN jsonb_build_object('ok', false, 'reason', 'subaccount_mismatch'); END IF;
  END IF;
  IF coalesce(p_share_kobo, 0) <= 0 THEN RETURN jsonb_build_object('ok', true, 'share_collected', false); END IF;
  SELECT * INTO l FROM public.student_platform_fee_ledger
   WHERE school_id = f.school_id AND student_id = f.student_id AND academic_year = f.academic_year AND term = f.term AND fee_type = 'platform_share' FOR UPDATE;
  IF l.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_reservation'); END IF;
  IF l.status = 'collected' AND l.payment_reference = v_ref THEN RETURN jsonb_build_object('ok', true, 'share_collected', true, 'duplicate', true); END IF;
  IF l.status IN ('collected', 'waived') AND l.payment_reference LIKE 'paystack:%' THEN
    -- another checkout already took this term's share (e.g. an expired hold completed late): credit it back to the school
    PERFORM public._wallet_post(f.school_id, 'refund', p_share_kobo / 100.0, 'share-dup:' || p_reference, NULL, 1, f.student_id,
                                jsonb_build_object('reason', 'term share already collected', 'kept', l.payment_reference), true);
    RETURN jsonb_build_object('ok', true, 'share_collected', false, 'wallet_refunded', true, 'reason', 'share_already_collected');
  END IF;
  IF l.status = 'collected' AND l.payment_reference LIKE 'wallet:%' THEN
    PERFORM public._wallet_post(f.school_id, 'refund', l.amount, 'share-refund:' || f.student_id || ':' || f.academic_year || ':' || f.term, NULL, 1, f.student_id,
                                jsonb_build_object('reason', 'share taken by Paystack split', 'reference', p_reference), true);
    refunded := true;
  END IF;
  UPDATE public.student_platform_fee_ledger SET status = 'collected', collected_at = now(), payment_reference = v_ref,
         amount = p_share_kobo / 100.0, updated_at = now() WHERE id = l.id;
  RETURN jsonb_build_object('ok', true, 'share_collected', true, 'wallet_refunded', refunded);
END $$;
REVOKE ALL ON FUNCTION public.fee_split_settle(text, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fee_split_settle(text, text, bigint) TO service_role;

-- Cash tracker: same per-student price as checkout (negotiated enterprise price included);
-- a share reserved by a pending online checkout does not block the wallet debit (the online settle refunds it).
CREATE OR REPLACE FUNCTION public.record_cash_payment(p_school uuid, p_student uuid, p_year text, p_term text, p_amount numeric,
  p_method text DEFAULT 'cash', p_receipt_url text DEFAULT NULL, p_receipt_no text DEFAULT NULL, p_fee uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_share numeric; v_new boolean := false; v_bal numeric;
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
  v_share := public.platform_share_per_student(p_school);
  IF coalesce(v_share, 0) > 0 AND NOT EXISTS (SELECT 1 FROM public.student_platform_fee_ledger
       WHERE school_id = p_school AND student_id = p_student AND academic_year = p_year AND term = p_term AND fee_type = 'platform_share' AND status IN ('collected', 'waived')) THEN
    v_bal := public._wallet_post(p_school, 'platform_share', -v_share, 'share:' || p_student || ':' || p_year || ':' || p_term, NULL, 1, p_student,
                                 jsonb_build_object('offline_payment', v_id), true);
    INSERT INTO public.student_platform_fee_ledger (school_id, student_id, academic_year, term, fee_type, amount, status, collected_at, payment_reference)
    VALUES (p_school, p_student, p_year, p_term, 'platform_share', v_share, 'collected', now(), 'wallet:' || v_id)
    ON CONFLICT (school_id, student_id, academic_year, term, fee_type) DO UPDATE SET status = 'collected', collected_at = now(), payment_reference = EXCLUDED.payment_reference, amount = EXCLUDED.amount;
    v_new := true;
  END IF;
  RETURN jsonb_build_object('offline_payment', v_id, 'share_debited', v_new, 'share', CASE WHEN v_new THEN v_share ELSE 0 END, 'balance', v_bal);
END $$;

COMMIT;
