-- SHERIVS-026: Paystack wallet top-up initiation (intents + server-verified settlement) and the missing Igbo label.
BEGIN;
CREATE TABLE IF NOT EXISTS public.wallet_topup_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  reference text NOT NULL UNIQUE, amount numeric(14,2) NOT NULL CHECK (amount >= 100 AND amount <= 10000000), email text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed')), initiated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), paid_at timestamptz, failure_reason text);
CREATE INDEX IF NOT EXISTS wallet_topup_intents_school_idx ON public.wallet_topup_intents (school_id, created_at DESC);

-- Staff with wallet.topup create an intent; the server function then calls Paystack /transaction/initialize with this reference and amount.
CREATE OR REPLACE FUNCTION public.wallet_topup_intent_create(p_school uuid, p_amount numeric, p_email text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ref text; n int;
BEGIN
  IF NOT public.scholar_can(p_school, 'wallet.topup') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_amount IS NULL OR p_amount < 100 OR p_amount > 10000000 THEN RAISE EXCEPTION 'top-up must be between NGN100 and NGN10,000,000'; END IF;
  IF p_amount <> round(p_amount, 2) THEN RAISE EXCEPTION 'amount has too many decimals'; END IF;
  IF p_email IS NULL OR p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'valid email required'; END IF;
  SELECT count(*) INTO n FROM public.wallet_topup_intents WHERE school_id = p_school AND created_at > now() - interval '1 hour';
  IF n >= 20 THEN RAISE EXCEPTION 'too many top-up attempts; try again later'; END IF;
  v_ref := 'wtp_' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.wallet_topup_intents (school_id, reference, amount, email, initiated_by) VALUES (p_school, v_ref, p_amount, lower(p_email), auth.uid());
  RETURN jsonb_build_object('reference', v_ref, 'amount_kobo', (p_amount * 100)::bigint, 'school_id', p_school);
END $$;

-- Settlement: service role only (webhook / verify). Credits only when reference, status, currency and amount match the intent. Idempotent.
CREATE OR REPLACE FUNCTION public.wallet_topup_settle(p_reference text, p_status text, p_amount_kobo bigint, p_currency text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.wallet_topup_intents; bal numeric;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO i FROM public.wallet_topup_intents WHERE reference = p_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'ignored', 'reason', 'unknown reference'); END IF;
  IF i.status = 'paid' THEN RETURN jsonb_build_object('outcome', 'duplicate', 'school_id', i.school_id); END IF;
  IF coalesce(p_status, '') <> 'success' THEN RETURN jsonb_build_object('outcome', 'ignored', 'reason', 'not successful', 'school_id', i.school_id); END IF;
  IF coalesce(upper(p_currency), '') <> 'NGN' OR p_amount_kobo IS DISTINCT FROM (i.amount * 100)::bigint THEN
    UPDATE public.wallet_topup_intents SET status = 'failed', failure_reason = 'amount or currency mismatch' WHERE id = i.id;
    RETURN jsonb_build_object('outcome', 'rejected', 'reason', 'amount or currency mismatch', 'school_id', i.school_id);
  END IF;
  bal := public.wallet_credit_topup(i.school_id, i.amount, i.reference);
  UPDATE public.wallet_topup_intents SET status = 'paid', paid_at = now() WHERE id = i.id;
  RETURN jsonb_build_object('outcome', 'settled', 'school_id', i.school_id, 'balance', bal);
END $$;

ALTER TABLE public.wallet_topup_intents ENABLE ROW LEVEL SECURITY; ALTER TABLE public.wallet_topup_intents FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.wallet_topup_intents FROM anon, authenticated, service_role;
GRANT SELECT ON public.wallet_topup_intents TO authenticated, service_role;
DROP POLICY IF EXISTS wallet_topup_intents_read ON public.wallet_topup_intents;
CREATE POLICY wallet_topup_intents_read ON public.wallet_topup_intents FOR SELECT TO authenticated USING (public.scholar_can(school_id, 'wallet.view'));
DROP POLICY IF EXISTS wallet_topup_intents_svc ON public.wallet_topup_intents;
CREATE POLICY wallet_topup_intents_svc ON public.wallet_topup_intents FOR SELECT TO service_role USING (true);
DROP TRIGGER IF EXISTS trg_wallet_topup_intents_audit ON public.wallet_topup_intents;
CREATE TRIGGER trg_wallet_topup_intents_audit AFTER INSERT OR UPDATE OR DELETE ON public.wallet_topup_intents FOR EACH ROW EXECUTE FUNCTION public.scholar_audit();
REVOKE ALL ON FUNCTION public.wallet_topup_intent_create(uuid, numeric, text), public.wallet_topup_settle(text, text, bigint, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wallet_topup_intent_create(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_topup_settle(text, text, bigint, text) TO service_role;

-- Igbo dashboard label (was left in English). Still unreviewed: needs a native speaker.
UPDATE public.ui_translations SET text = 'Ebe nchịkwa', reviewed = false WHERE locale = 'ig' AND key = 'nav.dashboard';
COMMIT;
