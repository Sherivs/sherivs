-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.
-- M22 (ADR-151): communications completion. Depends on COMMS-03 (20261117002600, PR #351: _comms_refund_charge,
-- outbound status 'blocked_plan') and on the production comms fabric (20261024000270, 20261101001000).
--
-- What this migration does:
--   1. Delivery evidence: cg_delivery_evidence accepts the 'sms' and 'whatsapp' channels (the table's own comment
--      reserved this for "a follow-up migration - never silently"). Append-only and service-role-only as before.
--   2. WhatsApp template registry: comms_templates gains wa_param_count. An APPROVED WhatsApp template must carry a valid
--      Meta template name and a parameter count equal to the number of {{placeholders}} in its body (the same list
--      comms_send turns into outbound_messages.template_parameters). Existing rows are backfilled first.
--   3. WhatsApp dispatch write path: service_role-only compare-and-set functions comms_wa_claim / comms_wa_settle /
--      comms_wa_hold (outbound_messages has no write grant for service_role). A row is claimable only while the
--      organization's whatsapp_live flag is on AND its template is registered, approved and has the right parameter
--      count, so the provider is never called for an unregistered template. Refunds reuse COMMS-03's
--      _comms_refund_charge and only for a message the provider provably never accepted.
--   4. USSD: ussd_handle gains "4. Results" (choose child, card serial, card PIN), answered ONLY through the existing
--      public.check_result rules (serial + PIN + the chosen linked child's admission number, per-serial rate limit,
--      use count, uniform failures). A second per-phone limit (5 result attempts per hour) slows PIN guessing. The
--      existing options 1-3 are unchanged. EXECUTE on ussd_handle is narrowed to service_role (it already refused
--      every other caller inside).
--
-- Nothing here enables a channel, stores a credential or schedules anything. Voice is untouched (founder pause).

DO $guard$
BEGIN
  IF to_regprocedure('public._comms_refund_charge(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'M22 requires COMMS-03 (20261117002600) to be applied first';
  END IF;
  IF to_regclass('public.cg_delivery_evidence') IS NULL OR to_regclass('public.comms_templates') IS NULL THEN
    RAISE EXCEPTION 'M22 requires the delivery-evidence substrate and the comms fabric';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Delivery evidence for SMS and WhatsApp
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.cg_delivery_evidence DROP CONSTRAINT IF EXISTS cg_delivery_evidence_channel_check;
ALTER TABLE public.cg_delivery_evidence ADD CONSTRAINT cg_delivery_evidence_channel_check
  CHECK (channel IN ('email','voice','sms','whatsapp'));
REVOKE ALL ON public.cg_delivery_evidence FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.cg_delivery_evidence TO service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. WhatsApp template registry (name, language, parameter count)
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.comms_templates ADD COLUMN IF NOT EXISTS wa_param_count smallint;
ALTER TABLE public.comms_templates DROP CONSTRAINT IF EXISTS comms_templates_wa_param_count_range;
ALTER TABLE public.comms_templates ADD CONSTRAINT comms_templates_wa_param_count_range
  CHECK (wa_param_count IS NULL OR wa_param_count BETWEEN 0 AND 20);

-- Number of {{placeholders}} exactly as comms_send extracts them (every match, in order).
CREATE OR REPLACE FUNCTION public.comms_template_param_count(p_body text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT count(*)::int FROM regexp_matches(coalesce(p_body, ''), '\{\{([a-z_]+)\}\}', 'g')
$$;
REVOKE ALL ON FUNCTION public.comms_template_param_count(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comms_template_param_count(text) TO service_role;

UPDATE public.comms_templates
   SET wa_param_count = public.comms_template_param_count(body)
 WHERE channel = 'whatsapp' AND wa_param_count IS NULL;

CREATE OR REPLACE FUNCTION public.comms_templates_wa_registry_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.channel = 'whatsapp' AND NEW.status = 'approved' THEN
    IF NEW.wa_template_name IS NULL OR NEW.wa_template_name !~ '^[a-z0-9_]+$' OR length(NEW.wa_template_name) > 512 THEN
      RAISE EXCEPTION 'an approved WhatsApp template needs its approved template name' USING ERRCODE = '23514';
    END IF;
    IF NEW.wa_param_count IS NULL OR NEW.wa_param_count <> public.comms_template_param_count(NEW.body) THEN
      RAISE EXCEPTION 'an approved WhatsApp template needs a parameter count equal to its placeholders' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.comms_templates_wa_registry_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS comms_templates_wa_registry_guard ON public.comms_templates;
CREATE TRIGGER comms_templates_wa_registry_guard
  BEFORE INSERT OR UPDATE ON public.comms_templates
  FOR EACH ROW EXECUTE FUNCTION public.comms_templates_wa_registry_guard();

-- True when this queued WhatsApp row's template is registered, approved and its parameters match the registered count.
CREATE OR REPLACE FUNCTION public._comms_wa_template_ok(p_message uuid, p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.outbound_messages m
    JOIN LATERAL (
      SELECT t.* FROM public.comms_templates t
       WHERE t.code = m.template_code AND t.channel = 'whatsapp' AND t.language = m.language
         AND (t.org_id = m.org_id OR t.org_id IS NULL)
       ORDER BY (t.org_id IS NOT NULL) DESC LIMIT 1
    ) t ON true
    WHERE m.id = p_message AND m.org_id = p_org AND m.channel = 'whatsapp'
      AND t.status = 'approved' AND t.wa_template_name IS NOT NULL AND t.wa_param_count IS NOT NULL
      AND t.wa_param_count = coalesce(cardinality(m.template_parameters), 0))
$$;
REVOKE ALL ON FUNCTION public._comms_wa_template_ok(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. WhatsApp dispatcher write path (service_role only, compare-and-set; mirrors COMMS-03's SMS functions)
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.comms_wa_claim(p_message uuid, p_org uuid, p_claim text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n int;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_claim IS NULL OR p_claim !~ '^claim:[0-9a-f-]{36}$' THEN RAISE EXCEPTION 'invalid claim'; END IF;
  IF NOT public.flag_on('whatsapp_live', p_org) THEN RETURN false; END IF;
  IF NOT public._comms_wa_template_ok(p_message, p_org) THEN RETURN false; END IF;
  UPDATE public.outbound_messages SET provider = 'meta_cloud', provider_ref = p_claim, updated_at = now()
   WHERE id = p_message AND org_id = p_org AND channel = 'whatsapp' AND status = 'queued' AND provider_ref IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END $$;

-- p_status: 'sent' (needs the provider message id), 'failed', or 'queued' (release a claim; nothing was sent).
-- p_refund_reason only for a message the provider provably never accepted.
CREATE OR REPLACE FUNCTION public.comms_wa_settle(
  p_message uuid, p_org uuid, p_expected_ref text, p_status text, p_provider_ref text, p_error text,
  p_refund_reason text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ref text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('queued','sent','failed') THEN RAISE EXCEPTION 'invalid status'; END IF;
  IF p_status = 'sent' AND (p_provider_ref IS NULL OR p_provider_ref LIKE 'claim:%') THEN
    RAISE EXCEPTION 'a sent message needs the provider message id';
  END IF;
  IF p_status <> 'sent' AND p_provider_ref IS NOT NULL THEN RAISE EXCEPTION 'only a sent message carries a provider id'; END IF;
  IF p_refund_reason IS NOT NULL AND (p_status <> 'failed' OR p_refund_reason NOT IN
     ('rejected_before_submission','provider_rejected')) THEN
    RAISE EXCEPTION 'invalid refund request';
  END IF;
  UPDATE public.outbound_messages
     SET status = p_status, provider_ref = p_provider_ref, error = left(p_error, 200), updated_at = now()
   WHERE id = p_message AND org_id = p_org AND channel = 'whatsapp' AND status = 'queued'
     AND provider_ref IS NOT DISTINCT FROM p_expected_ref
  RETURNING reference INTO v_ref;
  IF v_ref IS NULL THEN RETURN false; END IF;
  IF p_refund_reason IS NOT NULL THEN PERFORM public._comms_refund_charge(p_org, v_ref, p_refund_reason); END IF;
  RETURN true;
END $$;

-- Ambiguous outcome: keep the claim (never resent), refund nothing, mark and audit for operator reconciliation.
CREATE OR REPLACE FUNCTION public.comms_wa_hold(p_message uuid, p_org uuid, p_expected_ref text, p_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n int;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_expected_ref IS NULL OR p_expected_ref !~ '^claim:[0-9a-f-]{36}$' THEN RAISE EXCEPTION 'invalid claim'; END IF;
  IF p_code IS NULL OR p_code !~ '^[a-z0-9_]{1,40}$' THEN RAISE EXCEPTION 'invalid hold code'; END IF;
  UPDATE public.outbound_messages SET error = 'held:' || p_code, updated_at = now()
   WHERE id = p_message AND org_id = p_org AND channel = 'whatsapp' AND status = 'queued' AND provider_ref = p_expected_ref;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 1 THEN
    INSERT INTO public.audit_logs (school_id, user_id, action, table_name, record_id, new_value)
    VALUES (p_org, NULL, 'whatsapp.hold', 'outbound_messages', p_message, jsonb_build_object('code', p_code, 'claim', p_expected_ref));
  END IF;
  RETURN v_n = 1;
END $$;

REVOKE ALL ON FUNCTION public.comms_wa_claim(uuid, uuid, text),
  public.comms_wa_settle(uuid, uuid, text, text, text, text, text),
  public.comms_wa_hold(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comms_wa_claim(uuid, uuid, text),
  public.comms_wa_settle(uuid, uuid, text, text, text, text, text),
  public.comms_wa_hold(uuid, uuid, text, text) TO service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. USSD: result check (PIN-protected, through check_result) next to the existing fee balance and attendance menus
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ussd_handle(p_session text, p_phone text, p_text text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ph text := public._norm_phone(p_phone); par uuid; parts text[] := string_to_array(coalesce(p_text, ''), '*'); kids record; menu text := ''; i int := 0;
        kid uuid; bal numeric; pres int; tot int; sch uuid; adm text; res jsonb; v_serial text; v_pin text; v_line text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed: provider webhook only' USING ERRCODE = '42501'; END IF;
  IF NOT public.rate_limit_take('ussd.phone', ph, 30, interval '1 hour') THEN RETURN 'END Too many requests. Try again later.'; END IF;
  INSERT INTO public.ussd_sessions (session_id, phone) VALUES (p_session, ph) ON CONFLICT (session_id) DO UPDATE SET hits = public.ussd_sessions.hits + 1, updated_at = now();
  SELECT id, school_id INTO par, sch FROM public.users WHERE role = 'parent' AND public._norm_phone(phone) = ph LIMIT 1;
  IF par IS NULL THEN RETURN 'END This number is not registered with a school. Ask the school office to add it.'; END IF;
  IF p_text IS NULL OR p_text = '' THEN RETURN E'CON Sherivs\n1. Fee balance\n2. Attendance (last 7 days)\n3. Talk to the school\n4. Results'; END IF;
  IF parts[1] NOT IN ('1','2','3','4') THEN RETURN 'END Invalid choice.'; END IF;
  IF parts[1] = '3' THEN RETURN 'END The school office will call you back. Thank you.'; END IF;
  IF cardinality(parts) = 1 THEN
    FOR kids IN SELECT s.id, coalesce(u.full_name, s.admission_number) nm FROM public.students s LEFT JOIN public.users u ON u.id = s.user_id
                 WHERE s.parent_id = par OR s.id IN (SELECT student_id FROM public.parent_student_map WHERE parent_id = par) ORDER BY s.admission_number LIMIT 5 LOOP
      i := i + 1; menu := menu || E'\n' || i || '. ' || kids.nm;
    END LOOP;
    IF i = 0 THEN RETURN 'END No children linked to this number.'; END IF;
    RETURN 'CON Choose child' || menu;
  END IF;
  SELECT id, admission_number INTO kid, adm FROM (SELECT s.id, s.admission_number, row_number() OVER (ORDER BY s.admission_number) rn FROM public.students s
                            WHERE s.parent_id = par OR s.id IN (SELECT student_id FROM public.parent_student_map WHERE parent_id = par)) x WHERE rn::text = parts[2];
  IF kid IS NULL THEN RETURN 'END Invalid choice.'; END IF;
  IF parts[1] = '1' THEN
    SELECT coalesce(sum(amount - coalesce(paid_amount, 0)), 0) INTO bal FROM public.fees WHERE student_id = kid AND coalesce(status, '') <> 'paid';
    RETURN 'END Outstanding fees: NGN ' || to_char(bal, 'FM999,999,999') || '. Pay at the bursary or online.';
  END IF;
  IF parts[1] = '4' THEN
    -- Read-only except the card's own use counter, which check_result maintains. Nothing is shown unless the card's
    -- serial and PIN are valid for THIS linked child under check_result's rules; every failure reads the same.
    IF cardinality(parts) = 2 THEN RETURN 'CON Enter the serial number on the result card'; END IF;
    IF cardinality(parts) = 3 THEN RETURN 'CON Enter the result card PIN'; END IF;
    IF cardinality(parts) <> 4 THEN RETURN 'END Invalid choice.'; END IF;
    v_serial := upper(left(trim(parts[3]), 32));
    v_pin := left(regexp_replace(parts[4], '\D', '', 'g'), 32);
    IF NOT public.rate_limit_take('ussd.result.phone', ph, 5, interval '1 hour') THEN
      RETURN 'END Too many attempts. Try again later.';
    END IF;
    res := public.check_result(v_serial, v_pin, adm);
    IF res IS NULL OR coalesce((res->>'ok')::boolean, false) IS NOT TRUE THEN
      IF res->>'error' = 'rate_limited' THEN RETURN 'END Too many attempts. Try again later.'; END IF;
      IF res->>'error' = 'card exhausted' THEN RETURN 'END This card has no checks left.'; END IF;
      RETURN 'END Invalid serial or PIN.';
    END IF;
    SELECT string_agg((s->>'subject') || ' ' || coalesce(s->>'grade', '-'), ', ' ORDER BY s->>'subject')
      INTO v_line FROM jsonb_array_elements(coalesce(res->'subjects', '[]'::jsonb)) s;
    IF v_line IS NULL THEN RETURN 'END No published results for this term yet.'; END IF;
    RETURN left('END ' || coalesce(res->>'term', '') || ' ' || coalesce(res->>'academic_year', '') || ': ' || v_line, 182);
  END IF;
  SELECT count(*) FILTER (WHERE status IN ('present','late')), count(*) INTO pres, tot FROM public.attendance WHERE student_id = kid AND date >= current_date - 7;
  RETURN 'END Present ' || pres || ' of ' || tot || ' school days in the last 7 days.';
END $$;
REVOKE ALL ON FUNCTION public.ussd_handle(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ussd_handle(text, text, text) TO service_role;
