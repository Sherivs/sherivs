-- PSA-01: platform share accrual, settlement and collections reporting (ADR-162).
-- Sherivs's per-student, per-term share is accrued for every active student when a term opens, as a
-- 'pending' row in student_platform_fee_ledger (the row the Paystack split and the cash path already use).
-- It is then settled by whichever happens first: the Paystack split, a recorded cash payment (wallet
-- debit, existing path), or, only for a school with a recorded agreement and after its grace period,
-- an automatic wallet debit. Whether a school may be auto-debited is a recorded agreement, not a code
-- decision: platform_share_policy refuses auto_debit without an agreement reference and date.
-- Nothing here locks a school feature. Reports are for Sherivs operators (service_role or super admin).

CREATE TABLE IF NOT EXISTS public.platform_share_policy (
  school_id      uuid PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,
  grace_days     integer NOT NULL DEFAULT 14 CHECK (grace_days BETWEEN 0 AND 180),
  auto_debit     boolean NOT NULL DEFAULT false,
  debt_limit     numeric NOT NULL DEFAULT 0 CHECK (debt_limit >= 0),
  agreement_ref  text,
  agreed_at      timestamptz,
  set_by         uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_share_policy_agreement_required CHECK (
    NOT auto_debit OR (agreement_ref IS NOT NULL AND length(btrim(agreement_ref)) BETWEEN 3 AND 200 AND agreed_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.platform_share_event (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid REFERENCES public.schools(id) ON DELETE SET NULL,
  kind           text NOT NULL CHECK (kind IN ('accrue', 'settle', 'waive', 'policy')),
  academic_year  text,
  term           text,
  detail         jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor          uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_share_event_school_time ON public.platform_share_event (school_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.platform_share_event_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  RAISE EXCEPTION 'platform_share_event is append-only' USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS trg_platform_share_event_append_only ON public.platform_share_event;
CREATE TRIGGER trg_platform_share_event_append_only BEFORE UPDATE OR DELETE ON public.platform_share_event
  FOR EACH ROW EXECUTE FUNCTION public.platform_share_event_append_only();

ALTER TABLE public.platform_share_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_share_policy FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_share_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_share_event FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_share_policy, public.platform_share_event FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.platform_share_policy TO service_role;
GRANT SELECT, INSERT ON public.platform_share_event TO service_role;

-- Operators: the service role or a super admin. Schools never reach these functions' data.
CREATE OR REPLACE FUNCTION public.platform_share_is_operator() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(auth.role(), '') = 'service_role' OR coalesce(public.is_super_admin(), false)
$$;

CREATE OR REPLACE FUNCTION public.platform_share_set_policy(
  p_school uuid, p_grace_days integer, p_auto_debit boolean, p_debt_limit numeric,
  p_agreement_ref text, p_agreed_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NOT public.platform_share_is_operator() THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.schools s WHERE s.id = p_school) THEN
    RAISE EXCEPTION 'school not found' USING ERRCODE = '42704';
  END IF;
  IF p_auto_debit AND (p_agreement_ref IS NULL OR length(btrim(p_agreement_ref)) NOT BETWEEN 3 AND 200 OR p_agreed_at IS NULL) THEN
    RAISE EXCEPTION 'auto debit needs a recorded agreement reference and date' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.platform_share_policy (school_id, grace_days, auto_debit, debt_limit, agreement_ref, agreed_at, set_by, updated_at)
  VALUES (p_school, p_grace_days, p_auto_debit, coalesce(p_debt_limit, 0), nullif(btrim(p_agreement_ref), ''), p_agreed_at, auth.uid(), now())
  ON CONFLICT (school_id) DO UPDATE SET grace_days = EXCLUDED.grace_days, auto_debit = EXCLUDED.auto_debit, debt_limit = EXCLUDED.debt_limit,
    agreement_ref = EXCLUDED.agreement_ref, agreed_at = EXCLUDED.agreed_at, set_by = EXCLUDED.set_by, updated_at = now();
  INSERT INTO public.platform_share_event (school_id, kind, detail, actor)
  VALUES (p_school, 'policy', jsonb_build_object('grace_days', p_grace_days, 'auto_debit', p_auto_debit, 'debt_limit', coalesce(p_debt_limit, 0),
          'agreement_ref', nullif(btrim(p_agreement_ref), ''), 'agreed_at', p_agreed_at), auth.uid());
  RETURN jsonb_build_object('school_id', p_school, 'grace_days', p_grace_days, 'auto_debit', p_auto_debit);
END $$;

-- Accrue the term's share for every active student (one school, or all when p_school is null). Idempotent.
CREATE OR REPLACE FUNCTION public.platform_share_accrue(p_school uuid, p_year text, p_term text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_rows integer; v_schools integer; v_amount numeric;
BEGIN
  IF NOT public.platform_share_is_operator() THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_year IS NULL OR length(btrim(p_year)) NOT BETWEEN 1 AND 40 OR p_term IS NULL OR length(btrim(p_term)) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'invalid academic year or term' USING ERRCODE = '22023';
  END IF;
  WITH sc AS (
    SELECT s.id, public.platform_share_per_student(s.id) AS share FROM public.schools s WHERE p_school IS NULL OR s.id = p_school
  ), ins AS (
    INSERT INTO public.student_platform_fee_ledger (school_id, student_id, academic_year, term, fee_type, amount, status)
    SELECT st.school_id, st.id, p_year, p_term, 'platform_share', sc.share, 'pending'
      FROM public.students st JOIN sc ON sc.id = st.school_id
     WHERE st.status = 'active' AND sc.share > 0
    ON CONFLICT (school_id, student_id, academic_year, term, fee_type) DO NOTHING
    RETURNING school_id, amount
  ), ev AS (
    INSERT INTO public.platform_share_event (school_id, kind, academic_year, term, detail, actor)
    SELECT i.school_id, 'accrue', p_year, p_term, jsonb_build_object('rows', count(*), 'amount', sum(i.amount)), auth.uid()
      FROM ins i GROUP BY i.school_id
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM ins), (SELECT count(DISTINCT school_id) FROM ins), (SELECT coalesce(sum(amount), 0) FROM ins)
    INTO v_rows, v_schools, v_amount;
  RETURN jsonb_build_object('rows_created', v_rows, 'schools', v_schools, 'amount', v_amount);
END $$;

-- Automatic wallet debit of overdue shares, only for schools whose recorded agreement allows it.
CREATE OR REPLACE FUNCTION public.platform_share_settle_overdue(p_school uuid, p_year text, p_term text, p_limit integer DEFAULT 500) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r record; v_bal numeric; v_debited integer := 0; v_unfunded integer := 0; v_amount numeric := 0; v_ref text;
BEGIN
  IF NOT public.platform_share_is_operator() THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'invalid limit' USING ERRCODE = '22023'; END IF;
  FOR r IN
    SELECT l.id, l.school_id, l.student_id, l.amount, p.debt_limit
      FROM public.student_platform_fee_ledger l
      JOIN public.platform_share_policy p ON p.school_id = l.school_id AND p.auto_debit
      JOIN public.students st ON st.id = l.student_id AND st.school_id = l.school_id AND st.status = 'active'
     WHERE l.fee_type = 'platform_share' AND l.status = 'pending' AND l.academic_year = p_year AND l.term = p_term
       AND (p_school IS NULL OR l.school_id = p_school)
       AND l.created_at <= now() - make_interval(days => p.grace_days)
       AND (l.payment_reference IS NULL OR l.payment_reference NOT LIKE 'paystack:%' OR l.updated_at <= now() - interval '45 minutes')
     ORDER BY l.created_at, l.id
     LIMIT p_limit
     FOR UPDATE OF l SKIP LOCKED
  LOOP
    SELECT coalesce((SELECT w.balance FROM public.school_wallets w WHERE w.school_id = r.school_id), 0) INTO v_bal;
    IF v_bal - r.amount < -r.debt_limit THEN
      v_unfunded := v_unfunded + 1;
      CONTINUE;
    END IF;
    v_ref := 'share:' || r.student_id || ':' || p_year || ':' || p_term;
    BEGIN
      PERFORM public._wallet_post(r.school_id, 'platform_share', -r.amount, v_ref, NULL, 1, r.student_id,
                                  jsonb_build_object('auto', true, 'ledger', r.id), true);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      v_unfunded := v_unfunded + 1;
      CONTINUE;
    END;
    UPDATE public.student_platform_fee_ledger SET status = 'collected', collected_at = now(),
           payment_reference = 'wallet:auto:' || r.id, updated_at = now() WHERE id = r.id;
    v_debited := v_debited + 1;
    v_amount := v_amount + r.amount;
    INSERT INTO public.platform_share_event (school_id, kind, academic_year, term, detail, actor)
    VALUES (r.school_id, 'settle', p_year, p_term, jsonb_build_object('ledger', r.id, 'student', r.student_id, 'amount', r.amount), auth.uid());
  END LOOP;
  RETURN jsonb_build_object('debited', v_debited, 'unfunded', v_unfunded, 'amount', v_amount);
END $$;

-- A Sherivs operator waives a pending share (scholarship, staff child, error). Schools cannot waive.
CREATE OR REPLACE FUNCTION public.platform_share_waive(p_ledger uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE l public.student_platform_fee_ledger; v_event uuid;
BEGIN
  IF NOT public.platform_share_is_operator() THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 5 AND 300 THEN
    RAISE EXCEPTION 'a reason of 5 to 300 characters is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO l FROM public.student_platform_fee_ledger WHERE id = p_ledger AND fee_type = 'platform_share' FOR UPDATE;
  IF l.id IS NULL THEN RAISE EXCEPTION 'share not found' USING ERRCODE = '42704'; END IF;
  IF l.status <> 'pending' THEN RAISE EXCEPTION 'only a pending share can be waived' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.platform_share_event (school_id, kind, academic_year, term, detail, actor)
  VALUES (l.school_id, 'waive', l.academic_year, l.term,
          jsonb_build_object('ledger', l.id, 'student', l.student_id, 'amount', l.amount, 'reason', btrim(p_reason)), auth.uid())
  RETURNING id INTO v_event;
  UPDATE public.student_platform_fee_ledger SET status = 'waived', payment_reference = 'waiver:' || v_event, updated_at = now() WHERE id = l.id;
  RETURN jsonb_build_object('ledger', l.id, 'status', 'waived');
END $$;

-- Per-school collections for a term (all schools when p_school is null).
CREATE OR REPLACE FUNCTION public.platform_share_collections(p_school uuid, p_year text, p_term text) RETURNS TABLE (
  school_id uuid, enrolled_active bigint, accrued bigint, accrued_amount numeric, collected_online bigint, collected_wallet_cash bigint,
  collected_wallet_auto bigint, waived bigint, pending bigint, overdue bigint, overdue_amount numeric,
  paid_share_not_taken bigint, wallet_balance numeric, wallet_cover_gap numeric
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NOT public.platform_share_is_operator() THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH led AS (
    SELECT l.school_id, l.student_id, l.amount, l.status, l.payment_reference, l.created_at, coalesce(p.grace_days, 14) AS grace
      FROM public.student_platform_fee_ledger l LEFT JOIN public.platform_share_policy p ON p.school_id = l.school_id
     WHERE l.fee_type = 'platform_share' AND l.academic_year = p_year AND l.term = p_term AND (p_school IS NULL OR l.school_id = p_school)
  ), enr AS (
    SELECT st.school_id, count(*) AS n FROM public.students st
     WHERE st.status = 'active' AND (p_school IS NULL OR st.school_id = p_school) GROUP BY st.school_id
  ), agg AS (
    SELECT led.school_id,
           count(*) AS accrued, sum(led.amount) AS accrued_amount,
           count(*) FILTER (WHERE led.status = 'collected' AND led.payment_reference LIKE 'paystack:%') AS collected_online,
           count(*) FILTER (WHERE led.status = 'collected' AND led.payment_reference LIKE 'wallet:%' AND led.payment_reference NOT LIKE 'wallet:auto:%') AS collected_wallet_cash,
           count(*) FILTER (WHERE led.status = 'collected' AND led.payment_reference LIKE 'wallet:auto:%') AS collected_wallet_auto,
           count(*) FILTER (WHERE led.status = 'waived') AS waived,
           count(*) FILTER (WHERE led.status = 'pending') AS pending,
           count(*) FILTER (WHERE led.status = 'pending' AND led.created_at <= now() - make_interval(days => led.grace)) AS overdue,
           coalesce(sum(led.amount) FILTER (WHERE led.status = 'pending' AND led.created_at <= now() - make_interval(days => led.grace)), 0) AS overdue_amount,
           count(*) FILTER (WHERE led.status NOT IN ('collected', 'waived') AND (
              EXISTS (SELECT 1 FROM public.fees f WHERE f.school_id = led.school_id AND f.student_id = led.student_id
                         AND f.academic_year = p_year AND f.term = p_term AND f.status IN ('paid', 'partial'))
              OR EXISTS (SELECT 1 FROM public.offline_payments o WHERE o.school_id = led.school_id AND o.student_id = led.student_id
                         AND o.academic_year = p_year AND o.term = p_term))) AS paid_share_not_taken
      FROM led GROUP BY led.school_id
  )
  SELECT a.school_id, coalesce(e.n, 0), a.accrued, a.accrued_amount, a.collected_online, a.collected_wallet_cash, a.collected_wallet_auto,
         a.waived, a.pending, a.overdue, a.overdue_amount, a.paid_share_not_taken,
         coalesce(w.balance, 0), greatest(a.overdue_amount - greatest(coalesce(w.balance, 0), 0), 0)
    FROM agg a LEFT JOIN enr e ON e.school_id = a.school_id LEFT JOIN public.school_wallets w ON w.school_id = a.school_id
   ORDER BY a.overdue_amount DESC, a.school_id;
END $$;

-- Per-student view for one school and term: ids only, no names.
CREATE OR REPLACE FUNCTION public.platform_share_student_list(p_school uuid, p_year text, p_term text, p_limit integer DEFAULT 1000) RETURNS TABLE (
  student_id uuid, channel text, amount numeric, has_recorded_payment boolean, overdue boolean
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NOT public.platform_share_is_operator() THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'invalid limit' USING ERRCODE = '22023'; END IF;
  RETURN QUERY
  SELECT l.student_id,
         CASE WHEN l.status = 'collected' AND l.payment_reference LIKE 'paystack:%' THEN 'online'
              WHEN l.status = 'collected' AND l.payment_reference LIKE 'wallet:auto:%' THEN 'wallet_auto'
              WHEN l.status = 'collected' THEN 'wallet_cash'
              WHEN l.status = 'waived' THEN 'waived' ELSE l.status END,
         l.amount,
         (EXISTS (SELECT 1 FROM public.fees f WHERE f.school_id = l.school_id AND f.student_id = l.student_id
                     AND f.academic_year = p_year AND f.term = p_term AND f.status IN ('paid', 'partial'))
          OR EXISTS (SELECT 1 FROM public.offline_payments o WHERE o.school_id = l.school_id AND o.student_id = l.student_id
                     AND o.academic_year = p_year AND o.term = p_term)),
         (l.status = 'pending' AND l.created_at <= now() - make_interval(days => coalesce(p.grace_days, 14)))
    FROM public.student_platform_fee_ledger l LEFT JOIN public.platform_share_policy p ON p.school_id = l.school_id
   WHERE l.school_id = p_school AND l.fee_type = 'platform_share' AND l.academic_year = p_year AND l.term = p_term
   ORDER BY l.created_at, l.id LIMIT p_limit;
END $$;

REVOKE ALL ON FUNCTION public.platform_share_is_operator() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_share_event_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_share_set_policy(uuid, integer, boolean, numeric, text, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_share_accrue(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_share_settle_overdue(uuid, text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_share_waive(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_share_collections(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_share_student_list(uuid, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_share_set_policy(uuid, integer, boolean, numeric, text, timestamptz),
  public.platform_share_accrue(uuid, text, text), public.platform_share_settle_overdue(uuid, text, text, integer),
  public.platform_share_waive(uuid, text), public.platform_share_collections(uuid, text, text),
  public.platform_share_student_list(uuid, text, text, integer) TO authenticated, service_role;
