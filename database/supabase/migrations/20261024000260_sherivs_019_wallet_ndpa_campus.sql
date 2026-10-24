-- SHERIVS-019 (Wave 2): school wallet + pay-as-you-go metering + cash tracker + leakage check
-- (pricing model of the Scope Lock Page), NDPA 2023 pack, and campus/section/arm/house model.
-- All writes go through SECURITY DEFINER RPCs; ledgers are append-only; changes audited.
BEGIN;

-- ============ A. Pricing book (Scope Lock Page) ============
CREATE TABLE IF NOT EXISTS public.plan_allowances (
  tier text PRIMARY KEY CHECK (tier IN ('trial','starter','growth','professional','enterprise')),
  registration_fee numeric, per_student_fee numeric NOT NULL,
  sms_per_student int NOT NULL, wa_per_student int NOT NULL, ai_msgs_per_day int NOT NULL,
  voice_min_per_student numeric NOT NULL, sms_daily_cap int NOT NULL, wa_daily_cap int NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.plan_allowances VALUES
  ('trial',        NULL,      0,    2,  5,  2, 0,    1, 1, now()),
  ('starter',      750000,    2000, 6,  15, 3, 0,    1, 2, now()),
  ('growth',       1250000,   3000, 8,  25, 5, 0.25, 1, 3, now()),
  ('professional', 2000000,   5000, 12, 40, 10, 0.5, 2, 4, now()),
  ('enterprise',   NULL,      5000, 15, 50, 12, 1,   2, 5, now())
ON CONFLICT (tier) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.usage_price_book (
  item text PRIMARY KEY, unit text NOT NULL, price numeric NOT NULL CHECK (price >= 0), unit_cost numeric, note text,
  updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.usage_price_book (item, unit, price, unit_cost, note) VALUES
  ('sms', 'page', 10, 6.98, 'BulkSMSNigeria NGN6.49 + VAT'),
  ('whatsapp_utility', 'message', 14, 9.12, 'Meta NG utility/auth'),
  ('whatsapp_marketing', 'message', 100, 70.25, 'Meta NG marketing'),
  ('voice_min', 'minute', 700, 495, 'Vapi + Twilio NG mobile'),
  ('voice_min_sip', 'minute', 300, 0, 'Vapi + local SIP'),
  ('ai_tutor', 'message', 3, 1.63, 'NGN300 per 100 messages')
ON CONFLICT (item) DO NOTHING;

CREATE OR REPLACE FUNCTION public.set_usage_price(p_item text, p_price numeric) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT (coalesce(public.is_super_admin(), false) OR coalesce(auth.role(), '') = 'service_role') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  UPDATE public.usage_price_book SET price = p_price, updated_at = now() WHERE item = p_item;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown item %', p_item; END IF;
END $$;

-- ============ B. Wallet ============
CREATE TABLE IF NOT EXISTS public.school_wallets (
  school_id uuid PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,
  balance numeric NOT NULL DEFAULT 0, low_balance_pct numeric NOT NULL DEFAULT 20 CHECK (low_balance_pct BETWEEN 0 AND 100),
  reference_balance numeric NOT NULL DEFAULT 0,           -- balance right after the last top-up (base for the 20% alert)
  low_alert_sent_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('topup','usage','platform_share','adjustment','refund')),
  amount numeric NOT NULL CHECK (amount <> 0), balance_after numeric NOT NULL,
  reference text NOT NULL, item text, quantity numeric, student_id uuid, meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, kind, reference));
CREATE INDEX IF NOT EXISTS wallet_ledger_school_time ON public.wallet_ledger (school_id, created_at DESC);
CREATE TABLE IF NOT EXISTS public.wallet_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('low_balance','negative_balance','pool_exhausted','leakage')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());

CREATE OR REPLACE FUNCTION public.append_only_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501'; END $$;
DROP TRIGGER IF EXISTS trg_wallet_ledger_append_only ON public.wallet_ledger;
CREATE TRIGGER trg_wallet_ledger_append_only BEFORE UPDATE OR DELETE ON public.wallet_ledger FOR EACH ROW EXECUTE FUNCTION public.append_only_guard();

-- internal: post one ledger line atomically; returns the new balance (idempotent on reference)
CREATE OR REPLACE FUNCTION public._wallet_post(p_school uuid, p_kind text, p_amount numeric, p_reference text, p_item text DEFAULT NULL,
  p_qty numeric DEFAULT NULL, p_student uuid DEFAULT NULL, p_meta jsonb DEFAULT '{}'::jsonb, p_allow_negative boolean DEFAULT false)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE w public.school_wallets; v_new numeric; v_prev numeric;
BEGIN
  SELECT balance_after INTO v_prev FROM public.wallet_ledger WHERE school_id = p_school AND kind = p_kind AND reference = p_reference;
  IF FOUND THEN RETURN v_prev; END IF;                                      -- idempotent replay
  INSERT INTO public.school_wallets (school_id) VALUES (p_school) ON CONFLICT DO NOTHING;
  SELECT * INTO w FROM public.school_wallets WHERE school_id = p_school FOR UPDATE;
  v_new := w.balance + p_amount;
  IF p_amount < 0 AND v_new < 0 AND NOT p_allow_negative THEN
    RAISE EXCEPTION 'insufficient_wallet: balance % is below %', w.balance, -p_amount USING ERRCODE = 'P0001'; END IF;
  INSERT INTO public.wallet_ledger (school_id, kind, amount, balance_after, reference, item, quantity, student_id, meta, created_by)
  VALUES (p_school, p_kind, p_amount, v_new, p_reference, p_item, p_qty, p_student, coalesce(p_meta, '{}'::jsonb), auth.uid());
  UPDATE public.school_wallets SET balance = v_new, updated_at = now(),
         reference_balance = CASE WHEN p_kind = 'topup' THEN v_new ELSE reference_balance END,
         low_alert_sent_at = CASE WHEN p_kind = 'topup' THEN NULL ELSE low_alert_sent_at END
   WHERE school_id = p_school;
  IF p_amount < 0 THEN
    IF v_new < 0 THEN INSERT INTO public.wallet_alerts (school_id, kind, detail) VALUES (p_school, 'negative_balance', jsonb_build_object('balance', v_new, 'reference', p_reference)); END IF;
    IF w.low_alert_sent_at IS NULL AND w.reference_balance > 0 AND v_new <= w.reference_balance * w.low_balance_pct / 100 THEN
      INSERT INTO public.wallet_alerts (school_id, kind, detail) VALUES (p_school, 'low_balance', jsonb_build_object('balance', v_new, 'threshold_pct', w.low_balance_pct));
      UPDATE public.school_wallets SET low_alert_sent_at = now() WHERE school_id = p_school;
    END IF;
  END IF;
  RETURN v_new;
END $$;
REVOKE ALL ON FUNCTION public._wallet_post(uuid, text, numeric, text, text, numeric, uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated, service_role;

-- Top-up credit: only the verified Paystack webhook (service_role) credits; idempotent on the Paystack reference.
CREATE OR REPLACE FUNCTION public.wallet_credit_topup(p_school uuid, p_amount numeric, p_paystack_reference text) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed: top-ups are credited by the verified payment webhook only' USING ERRCODE = '42501'; END IF;
  IF p_amount IS NULL OR p_amount < 100 THEN RAISE EXCEPTION 'minimum top-up is NGN100'; END IF;
  IF p_paystack_reference IS NULL OR length(p_paystack_reference) < 6 THEN RAISE EXCEPTION 'paystack reference required'; END IF;
  RETURN public._wallet_post(p_school, 'topup', p_amount, p_paystack_reference, NULL, NULL, NULL, jsonb_build_object('channel', 'paystack'));
END $$;
-- Staff adjustment (platform staff only, with reason)
CREATE OR REPLACE FUNCTION public.wallet_adjust(p_school uuid, p_amount numeric, p_reason text) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT coalesce(public.is_super_admin(), false) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF coalesce(length(trim(p_reason)), 0) < 5 THEN RAISE EXCEPTION 'reason required'; END IF;
  RETURN public._wallet_post(p_school, 'adjustment', p_amount, 'adj:' || gen_random_uuid(), NULL, NULL, NULL, jsonb_build_object('reason', p_reason), true);
END $$;

-- ============ C. Term usage pools + metering ============
CREATE TABLE IF NOT EXISTS public.term_usage_pools (
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE, academic_year text NOT NULL, term text NOT NULL,
  item text NOT NULL REFERENCES public.usage_price_book(item), allowance numeric NOT NULL, used numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (school_id, academic_year, term, item));
CREATE TABLE IF NOT EXISTS public.usage_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  item text NOT NULL, quantity numeric NOT NULL CHECK (quantity > 0), from_pool numeric NOT NULL, charged numeric NOT NULL,
  student_id uuid, priority text NOT NULL CHECK (priority IN ('normal','safety')), reference text NOT NULL,
  academic_year text NOT NULL, term text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (school_id, reference));
CREATE INDEX IF NOT EXISTS usage_events_student_day ON public.usage_events (school_id, student_id, item, created_at);
DROP TRIGGER IF EXISTS trg_usage_events_append_only ON public.usage_events;
CREATE TRIGGER trg_usage_events_append_only BEFORE UPDATE OR DELETE ON public.usage_events FOR EACH ROW EXECUTE FUNCTION public.append_only_guard();

-- Open the term pools from the plan allowances x active students (SMS/WA/voice pooled; AI is a per-student daily cap).
CREATE OR REPLACE FUNCTION public.open_term_pools(p_school uuid, p_year text, p_term text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.plan_allowances; n int; v_tier text;
BEGIN
  IF NOT public.scholar_can(p_school, 'wallet.view') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(subscription_tier, 'trial') INTO v_tier FROM public.schools WHERE id = p_school;
  SELECT * INTO a FROM public.plan_allowances WHERE tier = v_tier;
  SELECT count(*) INTO n FROM public.students WHERE school_id = p_school AND coalesce(is_active, true);
  INSERT INTO public.term_usage_pools (school_id, academic_year, term, item, allowance) VALUES
    (p_school, p_year, p_term, 'sms', n * a.sms_per_student), (p_school, p_year, p_term, 'whatsapp_utility', n * a.wa_per_student),
    (p_school, p_year, p_term, 'voice_min', n * a.voice_min_per_student)
  ON CONFLICT (school_id, academic_year, term, item) DO UPDATE SET allowance = EXCLUDED.allowance, updated_at = now();
  RETURN jsonb_build_object('tier', v_tier, 'students', n, 'sms', n * a.sms_per_student, 'whatsapp', n * a.wa_per_student, 'voice_min', n * a.voice_min_per_student);
END $$;

-- Meter one send. Pool first, then wallet at the price book. Safety/OTP may take the wallet negative; optional sends stop at zero.
CREATE OR REPLACE FUNCTION public.meter_usage(p_school uuid, p_item text, p_qty numeric, p_reference text,
  p_student uuid DEFAULT NULL, p_priority text DEFAULT 'normal', p_year text DEFAULT NULL, p_term text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pool public.term_usage_pools; price numeric; v_from_pool numeric := 0; v_charge numeric := 0; v_bal numeric;
        v_year text := p_year; v_term text := p_term; v_tier text; cap int; used_today numeric; a public.plan_allowances; prev public.usage_events;
BEGIN
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR public.scholar_can(p_school, 'comms.send_class') OR public.scholar_can(p_school, 'ai_tutor.use')) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_priority NOT IN ('normal', 'safety') THEN RAISE EXCEPTION 'bad priority'; END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'quantity must be positive'; END IF;
  SELECT * INTO prev FROM public.usage_events WHERE school_id = p_school AND reference = p_reference;
  IF FOUND THEN RETURN jsonb_build_object('replay', true, 'from_pool', prev.from_pool, 'charged', prev.charged); END IF;
  SELECT u.price INTO price FROM public.usage_price_book u WHERE u.item = p_item;
  IF price IS NULL THEN RAISE EXCEPTION 'unknown usage item %', p_item; END IF;
  IF v_year IS NULL THEN SELECT academic_year, term INTO v_year, v_term FROM public.term_usage_pools WHERE school_id = p_school ORDER BY updated_at DESC LIMIT 1; END IF;
  v_year := coalesce(v_year, 'unscoped'); v_term := coalesce(v_term, 'unscoped');
  -- per-student daily caps (normal sends only)
  IF p_student IS NOT NULL AND p_priority = 'normal' THEN
    SELECT coalesce(subscription_tier, 'trial') INTO v_tier FROM public.schools WHERE id = p_school;
    SELECT * INTO a FROM public.plan_allowances WHERE tier = v_tier;
    cap := CASE p_item WHEN 'sms' THEN a.sms_daily_cap WHEN 'whatsapp_utility' THEN a.wa_daily_cap WHEN 'ai_tutor' THEN a.ai_msgs_per_day END;
    IF cap IS NOT NULL THEN
      SELECT coalesce(sum(quantity), 0) INTO used_today FROM public.usage_events
       WHERE school_id = p_school AND student_id = p_student AND item = p_item AND created_at >= date_trunc('day', now());
      IF p_item = 'ai_tutor' AND used_today + p_qty <= cap THEN
        INSERT INTO public.usage_events (school_id, item, quantity, from_pool, charged, student_id, priority, reference, academic_year, term)
        VALUES (p_school, p_item, p_qty, p_qty, 0, p_student, p_priority, p_reference, v_year, v_term);
        RETURN jsonb_build_object('from_pool', p_qty, 'charged', 0);
      ELSIF p_item <> 'ai_tutor' AND used_today + p_qty > cap THEN
        RAISE EXCEPTION 'daily_cap: % per student per day on this plan', cap USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;
  SELECT * INTO pool FROM public.term_usage_pools WHERE school_id = p_school AND academic_year = v_year AND term = v_term AND item = p_item FOR UPDATE;
  IF FOUND THEN
    v_from_pool := least(p_qty, greatest(pool.allowance - pool.used, 0));
    UPDATE public.term_usage_pools SET used = used + v_from_pool, updated_at = now() WHERE school_id = p_school AND academic_year = v_year AND term = v_term AND item = p_item;
    IF v_from_pool < p_qty AND pool.used < pool.allowance THEN
      INSERT INTO public.wallet_alerts (school_id, kind, detail) VALUES (p_school, 'pool_exhausted', jsonb_build_object('item', p_item, 'term', v_term)); END IF;
  END IF;
  v_charge := round((p_qty - v_from_pool) * price, 2);
  IF v_charge > 0 THEN
    v_bal := public._wallet_post(p_school, 'usage', -v_charge, p_reference, p_item, p_qty - v_from_pool, p_student,
                                 jsonb_build_object('priority', p_priority, 'unit_price', price), p_priority = 'safety');
  END IF;
  INSERT INTO public.usage_events (school_id, item, quantity, from_pool, charged, student_id, priority, reference, academic_year, term)
  VALUES (p_school, p_item, p_qty, v_from_pool, v_charge, p_student, p_priority, p_reference, v_year, v_term);
  RETURN jsonb_build_object('from_pool', v_from_pool, 'charged', v_charge, 'balance', v_bal);
END $$;

-- ============ D. Cash-payment tracker ============
CREATE TABLE IF NOT EXISTS public.offline_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE, fee_id uuid REFERENCES public.fees(id) ON DELETE SET NULL,
  academic_year text NOT NULL, term text NOT NULL, amount numeric NOT NULL CHECK (amount > 0),
  method text NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','bank_deposit','pos','cheque','other')),
  receipt_url text, receipt_no text, recorded_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS offline_payments_student ON public.offline_payments (school_id, student_id, academic_year, term);
DROP TRIGGER IF EXISTS trg_offline_payments_append_only ON public.offline_payments;
CREATE TRIGGER trg_offline_payments_append_only BEFORE UPDATE OR DELETE ON public.offline_payments FOR EACH ROW EXECUTE FUNCTION public.append_only_guard();

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

CREATE OR REPLACE FUNCTION public.student_paid_offline(p_school uuid, p_student uuid, p_year text, p_term text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (p_school = public.get_my_school_id() OR coalesce(public.is_super_admin(), false))
     AND EXISTS (SELECT 1 FROM public.offline_payments WHERE school_id = p_school AND student_id = p_student AND academic_year = p_year AND term = p_term);
$$;

-- ============ E. Leakage check ============
CREATE OR REPLACE FUNCTION public.platform_fee_leakage(p_school uuid, p_year text, p_term text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE paid int; collected int;
BEGIN
  IF NOT (public.scholar_can(p_school, 'reports.financial') OR coalesce(public.is_super_admin(), false) OR coalesce(auth.role(), '') = 'service_role'
          OR (auth.uid() IS NULL AND session_user NOT IN ('authenticator', 'anon', 'authenticated'))) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT count(DISTINCT student_id) INTO paid FROM (
    SELECT student_id FROM public.fees WHERE school_id = p_school AND academic_year = p_year AND term = p_term AND status IN ('paid', 'partial')
    UNION SELECT student_id FROM public.offline_payments WHERE school_id = p_school AND academic_year = p_year AND term = p_term) x;
  SELECT count(DISTINCT student_id) INTO collected FROM public.student_platform_fee_ledger
   WHERE school_id = p_school AND academic_year = p_year AND term = p_term AND status IN ('collected', 'waived');
  RETURN jsonb_build_object('students_paid', paid, 'shares_collected', collected, 'gap', greatest(paid - collected, 0));
END $$;

CREATE OR REPLACE FUNCTION public.grades_publish_leakage_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g int;
BEGIN
  IF NOT public.flag_on('leakage_blocks_results', NEW.school_id) THEN RETURN NEW; END IF;
  g := (public.platform_fee_leakage(NEW.school_id, NEW.academic_year, NEW.term)->>'gap')::int;
  IF g > 0 THEN RAISE EXCEPTION 'results_blocked: % students paid without a Sherivs share this term; settle before publishing', g USING ERRCODE = 'P0001'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_grades_publish_leakage_gate ON public.grades;
CREATE TRIGGER trg_grades_publish_leakage_gate BEFORE UPDATE OF is_published ON public.grades FOR EACH ROW
  WHEN (NEW.is_published AND NOT coalesce(OLD.is_published, false)) EXECUTE FUNCTION public.grades_publish_leakage_gate();

-- ============ F. Plan change ============
CREATE TABLE IF NOT EXISTS public.plan_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  from_tier text NOT NULL, to_tier text NOT NULL, registration_difference numeric NOT NULL DEFAULT 0,
  effective_from text NOT NULL DEFAULT 'next_term', status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','cancelled')),
  requested_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION public.request_plan_change(p_school uuid, p_to text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE f text; df numeric; v_id uuid;
BEGIN
  IF NOT public.scholar_can(p_school, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(subscription_tier, 'trial') INTO f FROM public.schools WHERE id = p_school;
  IF NOT EXISTS (SELECT 1 FROM public.plan_allowances WHERE tier = p_to) OR p_to = f THEN RAISE EXCEPTION 'invalid target plan'; END IF;
  SELECT greatest(coalesce(t.registration_fee, 0) - coalesce(s.registration_fee, 0), 0) INTO df
    FROM public.plan_allowances t, public.plan_allowances s WHERE t.tier = p_to AND s.tier = f;
  INSERT INTO public.plan_change_requests (school_id, from_tier, to_tier, registration_difference, requested_by)
  VALUES (p_school, f, p_to, df, auth.uid()) RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'registration_difference', df, 'refund', 0, 'effective', 'next_term');
END $$;

-- ============ G. NDPA 2023 pack ============
CREATE TABLE IF NOT EXISTS public.ndpa_controller_profiles (
  school_id uuid PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,
  dpo_name text, dpo_email text, dpo_phone text, dpo_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ndpc_registration_no text, ndpc_category text CHECK (ndpc_category IN ('major_importance_ultra_high','major_importance_extra_high','major_importance_ordinary')),
  registered_at date, annual_audit_due date, privacy_notice_url text, updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.dpia_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  title text NOT NULL, processing_activity text NOT NULL, data_categories text[] NOT NULL DEFAULT '{}',
  risk_level text NOT NULL CHECK (risk_level IN ('low','medium','high')), mitigations text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')), prepared_by uuid, approved_by uuid, approved_at timestamptz,
  review_due date, created_at timestamptz NOT NULL DEFAULT now(), CHECK (approved_by IS NULL OR approved_by <> prepared_by));
CREATE TABLE IF NOT EXISTS public.data_retention_policies (
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE, data_category text NOT NULL,
  retain_months int NOT NULL CHECK (retain_months BETWEEN 1 AND 1200), action text NOT NULL CHECK (action IN ('delete','anonymise','archive')),
  legal_basis text, updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (school_id, data_category));
CREATE TABLE IF NOT EXISTS public.ndpa_audit_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  year int NOT NULL, filed_at date, ndpc_reference text, auditor text, filed_by uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (school_id, year));

CREATE OR REPLACE FUNCTION public.ndpa_upsert_profile(p_school uuid, p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.scholar_can(p_school, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.ndpa_controller_profiles (school_id, dpo_name, dpo_email, dpo_phone, dpo_user_id, ndpc_registration_no, ndpc_category, registered_at, annual_audit_due, privacy_notice_url, updated_by)
  VALUES (p_school, p->>'dpo_name', p->>'dpo_email', p->>'dpo_phone', (p->>'dpo_user_id')::uuid, p->>'ndpc_registration_no', p->>'ndpc_category',
          (p->>'registered_at')::date, (p->>'annual_audit_due')::date, p->>'privacy_notice_url', auth.uid())
  ON CONFLICT (school_id) DO UPDATE SET dpo_name = EXCLUDED.dpo_name, dpo_email = EXCLUDED.dpo_email, dpo_phone = EXCLUDED.dpo_phone,
    dpo_user_id = EXCLUDED.dpo_user_id, ndpc_registration_no = EXCLUDED.ndpc_registration_no, ndpc_category = EXCLUDED.ndpc_category,
    registered_at = EXCLUDED.registered_at, annual_audit_due = EXCLUDED.annual_audit_due, privacy_notice_url = EXCLUDED.privacy_notice_url,
    updated_by = EXCLUDED.updated_by, updated_at = now();
END $$;
CREATE OR REPLACE FUNCTION public.dpia_save(p_school uuid, p_title text, p_activity text, p_categories text[], p_risk text, p_mitigations text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid;
BEGIN
  IF NOT public.scholar_can(p_school, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.dpia_records (school_id, title, processing_activity, data_categories, risk_level, mitigations, prepared_by, review_due)
  VALUES (p_school, p_title, p_activity, coalesce(p_categories, '{}'), p_risk, p_mitigations, auth.uid(), current_date + 365) RETURNING id INTO v;
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.dpia_approve(p_dpia uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.dpia_records;
BEGIN
  SELECT * INTO d FROM public.dpia_records WHERE id = p_dpia;
  IF d.id IS NULL OR NOT (public.scholar_can(d.school_id, 'ndpa.dsar') OR public.scholar_can(d.school_id, 'settings.manage')) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF d.prepared_by = auth.uid() THEN RAISE EXCEPTION 'sod: the preparer cannot approve their own DPIA' USING ERRCODE = '42501'; END IF;
  UPDATE public.dpia_records SET status = 'approved', approved_by = auth.uid(), approved_at = now() WHERE id = p_dpia;
END $$;
CREATE OR REPLACE FUNCTION public.ndpa_seed_retention(p_school uuid) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n int;
BEGIN
  IF NOT public.scholar_can(p_school, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.data_retention_policies (school_id, data_category, retain_months, action, legal_basis, updated_by)
  SELECT p_school, c, m, a, b, auth.uid() FROM (VALUES
    ('academic_records', 1200, 'archive', 'Transcripts and certificates are permanent records'),
    ('financial_records', 72, 'archive', 'Tax and audit: 6 years'),
    ('attendance', 36, 'anonymise', 'Operational; aggregate after 3 years'),
    ('health_records', 84, 'delete', 'Sensitive personal data: minimum needed'),
    ('cctv_visitor_logs', 3, 'delete', 'Security only'),
    ('messages', 24, 'delete', 'Communication logs'),
    ('applicants_not_admitted', 12, 'delete', 'Admissions: purpose ends'),
    ('biometrics', 12, 'delete', 'Delete when the person leaves; review yearly')) v(c, m, a, b)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
CREATE OR REPLACE FUNCTION public.ndpa_file_audit_return(p_school uuid, p_year int, p_filed date, p_ref text, p_auditor text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid;
BEGIN
  IF NOT public.scholar_can(p_school, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.ndpa_audit_returns (school_id, year, filed_at, ndpc_reference, auditor, filed_by) VALUES (p_school, p_year, p_filed, p_ref, p_auditor, auth.uid())
  ON CONFLICT (school_id, year) DO UPDATE SET filed_at = EXCLUDED.filed_at, ndpc_reference = EXCLUDED.ndpc_reference, auditor = EXCLUDED.auditor, filed_by = EXCLUDED.filed_by
  RETURNING id INTO v; RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.ndpa_compliance_status(p_school uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.ndpa_controller_profiles; n_students int; n_consent int; open_dsar int;
BEGIN
  IF NOT (public.scholar_can(p_school, 'settings.manage') OR public.scholar_can(p_school, 'ndpa.dsar')) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.ndpa_controller_profiles WHERE school_id = p_school;
  SELECT count(*) INTO n_students FROM public.students WHERE school_id = p_school AND coalesce(is_active, true);
  SELECT count(DISTINCT student_id) INTO n_consent FROM public.consent_records WHERE school_id = p_school AND purpose = 'core_education' AND status = 'granted';
  SELECT count(*) INTO open_dsar FROM public.data_subject_requests WHERE school_id = p_school AND status NOT IN ('completed', 'rejected', 'closed');
  RETURN jsonb_build_array(
    jsonb_build_object('item', 'DPO appointed', 'ok', p.dpo_name IS NOT NULL AND p.dpo_email IS NOT NULL),
    jsonb_build_object('item', 'NDPC registration', 'ok', p.ndpc_registration_no IS NOT NULL),
    jsonb_build_object('item', 'Privacy notice published', 'ok', p.privacy_notice_url IS NOT NULL),
    jsonb_build_object('item', 'Approved DPIA in date', 'ok', EXISTS (SELECT 1 FROM public.dpia_records WHERE school_id = p_school AND status = 'approved' AND review_due >= current_date)),
    jsonb_build_object('item', 'Retention schedule', 'ok', EXISTS (SELECT 1 FROM public.data_retention_policies WHERE school_id = p_school)),
    jsonb_build_object('item', 'Guardian consent (core education)', 'ok', n_students > 0 AND n_consent >= n_students, 'detail', n_consent || '/' || n_students),
    jsonb_build_object('item', 'Annual audit return filed', 'ok', EXISTS (SELECT 1 FROM public.ndpa_audit_returns WHERE school_id = p_school AND year >= extract(year FROM current_date)::int - 1 AND filed_at IS NOT NULL)),
    jsonb_build_object('item', 'No overdue data-subject requests', 'ok', open_dsar = 0, 'detail', open_dsar || ' open'));
END $$;

-- ============ H. Campus / section / arm / house ============
CREATE TABLE IF NOT EXISTS public.campuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  name text NOT NULL, code text, address text, term_dates jsonb, grading_scale_id uuid, fee_overrides jsonb,
  is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (school_id, name));
CREATE TABLE IF NOT EXISTS public.school_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  campus_id uuid REFERENCES public.campuses(id) ON DELETE CASCADE, name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('early_years','nursery','primary','junior_secondary','senior_secondary','technical','tertiary','day','boarding','other')),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (school_id, campus_id, name));
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS campus_id uuid REFERENCES public.campuses(id) ON DELETE SET NULL;
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS section_id uuid REFERENCES public.school_sections(id) ON DELETE SET NULL;
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS arm text;
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS stream text CHECK (stream IS NULL OR stream IN ('science','arts','commercial','technical','general'));
CREATE TABLE IF NOT EXISTS public.student_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  campus_id uuid REFERENCES public.campuses(id) ON DELETE CASCADE, name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('house','club','tutorial_group','society','team')), colour text, patron_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (school_id, kind, name));
CREATE TABLE IF NOT EXISTS public.student_group_members (
  group_id uuid NOT NULL REFERENCES public.student_groups(id) ON DELETE CASCADE, student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  school_id uuid NOT NULL, added_by uuid, added_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (group_id, student_id));

CREATE OR REPLACE FUNCTION public.campus_upsert(p_school uuid, p_name text, p_code text DEFAULT NULL, p_address text DEFAULT NULL,
  p_term_dates jsonb DEFAULT NULL, p_fee_overrides jsonb DEFAULT NULL, p_grading_scale uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid;
BEGIN
  IF NOT public.scholar_can(p_school, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.campuses (school_id, name, code, address, term_dates, fee_overrides, grading_scale_id)
  VALUES (p_school, p_name, p_code, p_address, p_term_dates, p_fee_overrides, p_grading_scale)
  ON CONFLICT (school_id, name) DO UPDATE SET code = EXCLUDED.code, address = EXCLUDED.address, term_dates = EXCLUDED.term_dates,
    fee_overrides = EXCLUDED.fee_overrides, grading_scale_id = EXCLUDED.grading_scale_id RETURNING id INTO v;
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.section_upsert(p_school uuid, p_campus uuid, p_name text, p_kind text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid;
BEGIN
  IF NOT public.scholar_can(p_school, 'classes.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_campus IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.campuses WHERE id = p_campus AND school_id = p_school) THEN RAISE EXCEPTION 'campus not in this school'; END IF;
  INSERT INTO public.school_sections (school_id, campus_id, name, kind) VALUES (p_school, p_campus, p_name, p_kind)
  ON CONFLICT (school_id, campus_id, name) DO UPDATE SET kind = EXCLUDED.kind RETURNING id INTO v;
  RETURN v;
END $$;
-- A-Z quick generate: JSS1 A .. JSS1 F (or named arms). Skips names that already exist.
CREATE OR REPLACE FUNCTION public.generate_class_arms(p_school uuid, p_level text, p_from text DEFAULT 'A', p_to text DEFAULT 'C',
  p_names text[] DEFAULT NULL, p_section uuid DEFAULT NULL, p_campus uuid DEFAULT NULL, p_stream text DEFAULT NULL,
  p_academic_year text DEFAULT NULL, p_capacity int DEFAULT 40) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE arms text[]; a text; n int := 0; v_name text;
BEGIN
  IF NOT public.scholar_can(p_school, 'classes.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_section IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.school_sections WHERE id = p_section AND school_id = p_school) THEN RAISE EXCEPTION 'section not in this school'; END IF;
  IF p_campus IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.campuses WHERE id = p_campus AND school_id = p_school) THEN RAISE EXCEPTION 'campus not in this school'; END IF;
  IF p_names IS NOT NULL THEN arms := p_names;
  ELSE
    IF p_from !~ '^[A-Z]$' OR p_to !~ '^[A-Z]$' OR ascii(p_to) < ascii(p_from) THEN RAISE EXCEPTION 'arms must be a single letter range A-Z'; END IF;
    SELECT array_agg(chr(c) ORDER BY c) INTO arms FROM generate_series(ascii(p_from), ascii(p_to)) c;
  END IF;
  FOREACH a IN ARRAY arms LOOP
    v_name := trim(p_level || ' ' || a || CASE WHEN p_stream IS NOT NULL THEN ' (' || initcap(p_stream) || ')' ELSE '' END);
    IF NOT EXISTS (SELECT 1 FROM public.classes WHERE school_id = p_school AND name = v_name AND campus_id IS NOT DISTINCT FROM p_campus) THEN
      INSERT INTO public.classes (school_id, name, grade_level, academic_year, capacity, campus_id, section_id, arm, stream)
      VALUES (p_school, v_name, p_level, p_academic_year, p_capacity, p_campus, p_section, a, p_stream); n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;
CREATE OR REPLACE FUNCTION public.group_upsert(p_school uuid, p_name text, p_kind text, p_colour text DEFAULT NULL, p_campus uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid;
BEGIN
  IF NOT public.scholar_can(p_school, 'classes.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.student_groups (school_id, name, kind, colour, campus_id) VALUES (p_school, p_name, p_kind, p_colour, p_campus)
  ON CONFLICT (school_id, kind, name) DO UPDATE SET colour = EXCLUDED.colour RETURNING id INTO v;
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.group_add_students(p_group uuid, p_students uuid[]) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid; n int;
BEGIN
  SELECT school_id INTO s FROM public.student_groups WHERE id = p_group;
  IF s IS NULL OR NOT public.scholar_can(s, 'classes.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.student_group_members (group_id, student_id, school_id, added_by)
  SELECT p_group, st.id, s, auth.uid() FROM public.students st WHERE st.id = ANY (p_students) AND st.school_id = s ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n < coalesce(array_length(p_students, 1), 0) AND EXISTS (SELECT 1 FROM public.students st WHERE st.id = ANY (p_students) AND st.school_id <> s) THEN
    RAISE EXCEPTION 'student not in this school'; END IF;
  RETURN n;
END $$;

-- ============ RLS / grants / audit ============
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['plan_allowances','usage_price_book','school_wallets','wallet_ledger','wallet_alerts','term_usage_pools','usage_events',
    'offline_payments','plan_change_requests','ndpa_controller_profiles','dpia_records','data_retention_policies','ndpa_audit_returns',
    'campuses','school_sections','student_groups','student_group_members'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_read ON public.%1$I', t);
  END LOOP; END $$;
CREATE POLICY plan_allowances_read ON public.plan_allowances FOR SELECT TO authenticated USING (true);
CREATE POLICY usage_price_book_read ON public.usage_price_book FOR SELECT TO authenticated USING (true);
DO $$ DECLARE t text; BEGIN
  -- money and compliance: staff with the right permission only
  FOREACH t IN ARRAY ARRAY['school_wallets','wallet_ledger','wallet_alerts','term_usage_pools','usage_events','plan_change_requests'] LOOP
    EXECUTE format('CREATE POLICY %1$s_read ON public.%1$I FOR SELECT TO authenticated USING (public.scholar_can(school_id, ''wallet.view''))', t); END LOOP;
  EXECUTE 'CREATE POLICY offline_payments_read ON public.offline_payments FOR SELECT TO authenticated USING (public.scholar_can(school_id, ''fees.view'') OR public.scholar_can(school_id, ''payments.reconcile''))';
  FOREACH t IN ARRAY ARRAY['ndpa_controller_profiles','dpia_records','data_retention_policies','ndpa_audit_returns'] LOOP
    EXECUTE format('CREATE POLICY %1$s_read ON public.%1$I FOR SELECT TO authenticated USING (public.scholar_can(school_id, ''settings.manage'') OR public.scholar_can(school_id, ''ndpa.dsar''))', t); END LOOP;
  -- structure: anyone in the school can read
  FOREACH t IN ARRAY ARRAY['campuses','school_sections','student_groups'] LOOP
    EXECUTE format('CREATE POLICY %1$s_read ON public.%1$I FOR SELECT TO authenticated USING (school_id = public.get_my_school_id() OR coalesce(public.is_super_admin(), false))', t); END LOOP;
  EXECUTE 'CREATE POLICY student_group_members_read ON public.student_group_members FOR SELECT TO authenticated USING (public.scholar_can(school_id, ''students.view''))';
  FOREACH t IN ARRAY ARRAY['school_wallets','wallet_ledger','offline_payments','plan_change_requests','ndpa_controller_profiles','dpia_records',
    'data_retention_policies','ndpa_audit_returns','campuses','school_sections','student_groups','student_group_members'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_audit ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.scholar_audit()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['plan_allowances','usage_price_book'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_platform_audit ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_platform_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.platform_config_audit()', t);
  END LOOP; END $$;

REVOKE ALL ON FUNCTION public.set_usage_price(text, numeric), public.wallet_credit_topup(uuid, numeric, text), public.wallet_adjust(uuid, numeric, text),
  public.open_term_pools(uuid, text, text), public.meter_usage(uuid, text, numeric, text, uuid, text, text, text),
  public.record_cash_payment(uuid, uuid, text, text, numeric, text, text, text, uuid), public.student_paid_offline(uuid, uuid, text, text),
  public.platform_fee_leakage(uuid, text, text), public.request_plan_change(uuid, text), public.ndpa_upsert_profile(uuid, jsonb),
  public.dpia_save(uuid, text, text, text[], text, text), public.dpia_approve(uuid), public.ndpa_seed_retention(uuid),
  public.ndpa_file_audit_return(uuid, int, date, text, text), public.ndpa_compliance_status(uuid),
  public.campus_upsert(uuid, text, text, text, jsonb, jsonb, uuid), public.section_upsert(uuid, uuid, text, text),
  public.generate_class_arms(uuid, text, text, text, text[], uuid, uuid, text, text, int), public.group_upsert(uuid, text, text, text, uuid),
  public.group_add_students(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_usage_price(text, numeric), public.wallet_credit_topup(uuid, numeric, text), public.wallet_adjust(uuid, numeric, text),
  public.open_term_pools(uuid, text, text), public.meter_usage(uuid, text, numeric, text, uuid, text, text, text),
  public.record_cash_payment(uuid, uuid, text, text, numeric, text, text, text, uuid), public.student_paid_offline(uuid, uuid, text, text),
  public.platform_fee_leakage(uuid, text, text), public.request_plan_change(uuid, text), public.ndpa_upsert_profile(uuid, jsonb),
  public.dpia_save(uuid, text, text, text[], text, text), public.dpia_approve(uuid), public.ndpa_seed_retention(uuid),
  public.ndpa_file_audit_return(uuid, int, date, text, text), public.ndpa_compliance_status(uuid),
  public.campus_upsert(uuid, text, text, text, jsonb, jsonb, uuid), public.section_upsert(uuid, uuid, text, text),
  public.generate_class_arms(uuid, text, text, text, text[], uuid, uuid, text, text, int), public.group_upsert(uuid, text, text, text, uuid),
  public.group_add_students(uuid, uuid[]) TO authenticated, service_role;
COMMIT;
