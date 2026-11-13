-- FIN-01: wallet authorization and financial integrity.
-- Status: AUTHORED, NOT APPLIED. Do not apply this file to production from the pull request.
-- ADR-070. Rollback: database/supabase/rollbacks/20261104050000_sherivs_fin01_wallet_authorization.sql
-- Tests: tests/integration/fin-01-wallet-authorization.local.sql and tests/integration/fin-01-wallet-concurrency.local.mjs
--
-- What this closes (each reproduced on a database built from the repository migrations before this change):
--  1. Any signed-in account could call meter_usage directly through the API and debit the organization wallet. The in-function
--     check admitted `ai_tutor.use`, which the legacy permission bridge grants to every parent-facing and learner-facing account,
--     and the caller chose the priority and the quantity: `safety` may take the wallet negative, so one such call overdrew a funded
--     wallet by NGN 999,000.
--  2. wallet_credit_topup was executable by `authenticated` and relied on an in-function check alone.
--  3. The safety overdraft was unbounded.
--  4. Two concurrent calls with the same reference raised a unique violation instead of replaying; the per-recipient daily cap
--     could be exceeded under concurrency (9 of 12 concurrent sends were metered on a 1-per-day plan).
--  5. Usage could be attributed to a recipient of another organization; blank references were accepted.
--  6. The ledger allowed a `usage` line that adds money and a `topup` line that removes it; usage events were not audited.
--
-- Not changed: prices, allowances, pools, refunds, plan entitlements (ENT-01), simulated-send charging and SMS dispatch
-- (COMMS-03). Existing balances, ledger lines and usage events are not touched. No data is rewritten.
--
-- Apply order: after 20261104033000. Re-applying this file is safe (CREATE OR REPLACE, IF NOT EXISTS, drop-and-create).
-- No top-level BEGIN or COMMIT: the migration runner wraps each file in its own transaction.

-- ============ 1. Grants: metering and top-up are server-side operations ============
-- meter_usage is called by comms_send (SECURITY DEFINER, same owner, so the revoke does not affect it) and by trusted server code
-- using the service role. No browser or mobile client has a reason to call it.
REVOKE ALL ON FUNCTION public.meter_usage(uuid, text, numeric, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meter_usage(uuid, text, numeric, text, uuid, text, text, text) TO service_role;
-- Top-up credit is the verified payment webhook's alone. Its in-function service_role check stays as defense in depth.
REVOKE ALL ON FUNCTION public.wallet_credit_topup(uuid, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_credit_topup(uuid, numeric, text) TO service_role;

-- ============ 2. Bounded safety overdraft ============
-- Safety and authentication sends (OTP, emergency notices) may go through on an empty wallet, so they keep a bounded overdraft.
-- The bound is per wallet. 1000 (NGN, 100 SMS pages at the NGN 10 price) is the default; set it to 0 for "never negative".
ALTER TABLE public.school_wallets
  ADD COLUMN IF NOT EXISTS safety_overdraft_limit numeric NOT NULL DEFAULT 1000;
ALTER TABLE public.school_wallets DROP CONSTRAINT IF EXISTS school_wallets_safety_overdraft_limit_check;
ALTER TABLE public.school_wallets
  ADD CONSTRAINT school_wallets_safety_overdraft_limit_check CHECK (safety_overdraft_limit >= 0);

-- ============ 3. Ledger direction rules (new rows only) ============
-- NOT VALID: enforced for every new line without scanning or rejecting history. After the read-only production check shows no
-- violating row, run: ALTER TABLE public.wallet_ledger VALIDATE CONSTRAINT wallet_ledger_direction_check;
ALTER TABLE public.wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_direction_check;
ALTER TABLE public.wallet_ledger
  ADD CONSTRAINT wallet_ledger_direction_check
  CHECK ((kind = 'usage' AND amount < 0) OR (kind = 'topup' AND amount > 0) OR kind IN ('platform_share', 'adjustment', 'refund')) NOT VALID;

-- ============ 4. _wallet_post: same contract, plus replay after the lock and the bounded safety overdraft ============
-- Internal, executable by no API role (the REVOKE below). One ledger line per (organization, kind, reference).
CREATE OR REPLACE FUNCTION public._wallet_post(p_school uuid, p_kind text, p_amount numeric, p_reference text, p_item text DEFAULT NULL,
  p_qty numeric DEFAULT NULL, p_student uuid DEFAULT NULL, p_meta jsonb DEFAULT '{}'::jsonb, p_allow_negative boolean DEFAULT false)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE w public.school_wallets; v_new numeric; v_prev numeric;
BEGIN
  IF p_school IS NULL OR p_kind IS NULL OR p_amount IS NULL OR coalesce(btrim(p_reference), '') = '' THEN
    RAISE EXCEPTION 'invalid wallet posting' USING ERRCODE = '22023'; END IF;
  SELECT balance_after INTO v_prev FROM public.wallet_ledger WHERE school_id = p_school AND kind = p_kind AND reference = p_reference;
  IF FOUND THEN RETURN v_prev; END IF;                                      -- idempotent replay
  INSERT INTO public.school_wallets (school_id) VALUES (p_school) ON CONFLICT DO NOTHING;
  SELECT * INTO w FROM public.school_wallets WHERE school_id = p_school FOR UPDATE;
  -- a concurrent twin of this posting has committed by the time the lock is ours: replay it instead of failing on the unique key
  SELECT balance_after INTO v_prev FROM public.wallet_ledger WHERE school_id = p_school AND kind = p_kind AND reference = p_reference;
  IF FOUND THEN RETURN v_prev; END IF;
  v_new := w.balance + p_amount;
  IF p_amount < 0 AND v_new < 0 THEN
    IF NOT p_allow_negative THEN
      RAISE EXCEPTION 'insufficient_wallet: balance % is below %', w.balance, -p_amount USING ERRCODE = 'P0001';
    -- the only negative path a send can take is a safety or authentication usage line, and it stops at the wallet's limit
    ELSIF p_kind = 'usage' AND v_new < -w.safety_overdraft_limit THEN
      RAISE EXCEPTION 'insufficient_wallet: safety overdraft limit % reached (balance %, needs %)', w.safety_overdraft_limit, w.balance, -p_amount
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
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

-- ============ 5. meter_usage ============
-- Pool first, then wallet at the price book. Callers: comms_send (definer chain, under the approver's session) and trusted server
-- code (service role). Everything for one organization is serialized on its wallet row, taken first and always in that order
-- (wallet, then pool), so the replay check, the per-recipient cap and the pool arithmetic cannot race and no lock cycle can form.
CREATE OR REPLACE FUNCTION public.meter_usage(p_school uuid, p_item text, p_qty numeric, p_reference text,
  p_student uuid DEFAULT NULL, p_priority text DEFAULT 'normal', p_year text DEFAULT NULL, p_term text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pool public.term_usage_pools; price numeric; v_from_pool numeric := 0; v_charge numeric := 0; v_bal numeric;
        v_year text := p_year; v_term text := p_term; v_tier text; cap int; used_today numeric; a public.plan_allowances; prev public.usage_events;
BEGIN
  IF p_school IS NULL THEN RAISE EXCEPTION 'organization required' USING ERRCODE = '22023'; END IF;
  -- authorization: the platform, or the sending path of a member who may send for this organization. `ai_tutor.use` is not enough:
  -- the legacy bridge gives it to every parent-facing and learner-facing account.
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR public.scholar_can(p_school, 'comms.send_class')) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_priority IS NULL OR p_priority NOT IN ('normal', 'safety') THEN RAISE EXCEPTION 'bad priority' USING ERRCODE = '22023'; END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'quantity must be positive' USING ERRCODE = '22023'; END IF;
  IF p_item IS NULL OR coalesce(btrim(p_reference), '') = '' THEN RAISE EXCEPTION 'item and reference required' USING ERRCODE = '22023'; END IF;
  IF p_student IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.students WHERE id = p_student AND school_id = p_school) THEN
    RAISE EXCEPTION 'recipient does not belong to this organization' USING ERRCODE = '22023'; END IF;
  -- serialize this organization's metering (also creates the wallet row on first use, as _wallet_post does)
  INSERT INTO public.school_wallets (school_id) VALUES (p_school) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM public.school_wallets WHERE school_id = p_school FOR UPDATE;
  SELECT * INTO prev FROM public.usage_events WHERE school_id = p_school AND reference = p_reference;
  IF FOUND THEN RETURN jsonb_build_object('replay', true, 'from_pool', prev.from_pool, 'charged', prev.charged); END IF;
  SELECT u.price INTO price FROM public.usage_price_book u WHERE u.item = p_item;
  IF price IS NULL THEN RAISE EXCEPTION 'unknown usage item %', p_item; END IF;
  IF v_year IS NULL THEN SELECT academic_year, term INTO v_year, v_term FROM public.term_usage_pools WHERE school_id = p_school ORDER BY updated_at DESC LIMIT 1; END IF;
  v_year := coalesce(v_year, 'unscoped'); v_term := coalesce(v_term, 'unscoped');
  -- per-recipient daily caps (normal sends only)
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
REVOKE ALL ON FUNCTION public.meter_usage(uuid, text, numeric, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meter_usage(uuid, text, numeric, text, uuid, text, text, text) TO service_role;

-- ============ 6. A sanctioned way to change the safety overdraft limit ============
-- Platform staff only, with a reason; the change is audited by trg_school_wallets_audit (old and new row).
CREATE OR REPLACE FUNCTION public.wallet_set_safety_overdraft_limit(p_school uuid, p_limit numeric, p_reason text) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT coalesce(public.is_super_admin(), false) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_school IS NULL OR p_limit IS NULL OR p_limit < 0 THEN RAISE EXCEPTION 'a non-negative limit is required' USING ERRCODE = '22023'; END IF;
  IF coalesce(length(trim(p_reason)), 0) < 5 THEN RAISE EXCEPTION 'reason required'; END IF;
  INSERT INTO public.school_wallets (school_id) VALUES (p_school) ON CONFLICT DO NOTHING;
  UPDATE public.school_wallets SET safety_overdraft_limit = p_limit, updated_at = now() WHERE school_id = p_school;
  RETURN p_limit;
END $$;
REVOKE ALL ON FUNCTION public.wallet_set_safety_overdraft_limit(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wallet_set_safety_overdraft_limit(uuid, numeric, text) TO authenticated, service_role;

-- ============ 7. Audit: every usage event (including pool-covered ones) is in the audit trail ============
-- usage_events is append-only; wallet_ledger and school_wallets were already audited by migration 20261024000260.
DROP TRIGGER IF EXISTS trg_usage_events_audit ON public.usage_events;
CREATE TRIGGER trg_usage_events_audit AFTER INSERT ON public.usage_events FOR EACH ROW EXECUTE FUNCTION public.scholar_audit();
