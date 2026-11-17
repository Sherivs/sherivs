-- Rollback for 20261104050000_sherivs_fin01_wallet_authorization.sql (FIN-01).
-- READ BEFORE RUNNING. Rolling this back RE-OPENS the vulnerabilities FIN-01 closed:
--   * any authenticated user (parent, student, teacher, admin) can call meter_usage again and debit or overdraw the school wallet;
--   * wallet_credit_topup is executable by authenticated again (its in-function service_role check still refuses non-service callers);
--   * the safety overdraft is unbounded again; usage events are no longer audited; ledger direction rules are gone.
-- Only run it if the forward migration itself causes an incident, and prefer a forward fix. Data written while FIN-01 was live is
-- not deleted: ledger lines, usage events and audit rows stay. The only data this removes is the per-wallet safety_overdraft_limit
-- values (record them first: SELECT school_id, safety_overdraft_limit FROM public.school_wallets WHERE safety_overdraft_limit <> 1000).
-- The functions below are the exact definitions from migration 20261024000260.
-- Re-applying the forward migration afterwards is safe.

DROP TRIGGER IF EXISTS trg_usage_events_audit ON public.usage_events;

DROP FUNCTION IF EXISTS public.wallet_set_safety_overdraft_limit(uuid, numeric, text);

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

-- Grants exactly as 20261024000260 left them (REVOKE ... FROM PUBLIC, anon; GRANT ... TO authenticated, service_role).
REVOKE ALL ON FUNCTION public.meter_usage(uuid, text, numeric, text, uuid, text, text, text), public.wallet_credit_topup(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meter_usage(uuid, text, numeric, text, uuid, text, text, text), public.wallet_credit_topup(uuid, numeric, text) TO authenticated, service_role;

ALTER TABLE public.wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_direction_check;
ALTER TABLE public.school_wallets DROP CONSTRAINT IF EXISTS school_wallets_safety_overdraft_limit_check;
ALTER TABLE public.school_wallets DROP COLUMN IF EXISTS safety_overdraft_limit;
