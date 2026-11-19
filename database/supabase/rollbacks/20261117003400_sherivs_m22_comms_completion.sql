-- NOT APPLIED. Rollback for 20261117003400_sherivs_m22_comms_completion.sql (M22, ADR-120). Founder approval required.
-- Restores the pre-M22 definitions. Evidence rows already written for sms/whatsapp are append-only and are KEPT: the
-- restored channel check is NOT VALID, so it binds new rows only.

-- 4. USSD: back to the SHERIVS-025 menu (options 1-3), with the production grant set it had before M22.
CREATE OR REPLACE FUNCTION public.ussd_handle(p_session text, p_phone text, p_text text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ph text := public._norm_phone(p_phone); par uuid; parts text[] := string_to_array(coalesce(p_text, ''), '*'); kids record; menu text := ''; i int := 0;
        kid uuid; bal numeric; pres int; tot int; sch uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed: provider webhook only' USING ERRCODE = '42501'; END IF;
  IF NOT public.rate_limit_take('ussd.phone', ph, 30, interval '1 hour') THEN RETURN 'END Too many requests. Try again later.'; END IF;
  INSERT INTO public.ussd_sessions (session_id, phone) VALUES (p_session, ph) ON CONFLICT (session_id) DO UPDATE SET hits = public.ussd_sessions.hits + 1, updated_at = now();
  SELECT id, school_id INTO par, sch FROM public.users WHERE role = 'parent' AND public._norm_phone(phone) = ph LIMIT 1;
  IF par IS NULL THEN RETURN 'END This number is not registered with a school. Ask the school office to add it.'; END IF;
  IF p_text IS NULL OR p_text = '' THEN RETURN E'CON Sherivs\n1. Fee balance\n2. Attendance (last 7 days)\n3. Talk to the school'; END IF;
  IF parts[1] NOT IN ('1','2','3') THEN RETURN 'END Invalid choice.'; END IF;
  IF parts[1] = '3' THEN RETURN 'END The school office will call you back. Thank you.'; END IF;
  IF cardinality(parts) = 1 THEN
    FOR kids IN SELECT s.id, coalesce(u.full_name, s.admission_number) nm FROM public.students s LEFT JOIN public.users u ON u.id = s.user_id
                 WHERE s.parent_id = par OR s.id IN (SELECT student_id FROM public.parent_student_map WHERE parent_id = par) ORDER BY s.admission_number LIMIT 5 LOOP
      i := i + 1; menu := menu || E'\n' || i || '. ' || kids.nm;
    END LOOP;
    IF i = 0 THEN RETURN 'END No children linked to this number.'; END IF;
    RETURN 'CON Choose child' || menu;
  END IF;
  SELECT id INTO kid FROM (SELECT s.id, row_number() OVER (ORDER BY s.admission_number) rn FROM public.students s
                            WHERE s.parent_id = par OR s.id IN (SELECT student_id FROM public.parent_student_map WHERE parent_id = par)) x WHERE rn::text = parts[2];
  IF kid IS NULL THEN RETURN 'END Invalid choice.'; END IF;
  IF parts[1] = '1' THEN
    SELECT coalesce(sum(amount - coalesce(paid_amount, 0)), 0) INTO bal FROM public.fees WHERE student_id = kid AND coalesce(status, '') <> 'paid';
    RETURN 'END Outstanding fees: NGN ' || to_char(bal, 'FM999,999,999') || '. Pay at the bursary or online.';
  END IF;
  SELECT count(*) FILTER (WHERE status IN ('present','late')), count(*) INTO pres, tot FROM public.attendance WHERE student_id = kid AND date >= current_date - 7;
  RETURN 'END Present ' || pres || ' of ' || tot || ' school days in the last 7 days.';
END $$;
GRANT EXECUTE ON FUNCTION public.ussd_handle(text, text, text) TO authenticated, service_role;

-- 3. WhatsApp dispatcher write path
DROP FUNCTION IF EXISTS public.comms_wa_hold(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.comms_wa_settle(uuid, uuid, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.comms_wa_claim(uuid, uuid, text);
DROP FUNCTION IF EXISTS public._comms_wa_template_ok(uuid, uuid);

-- 2. WhatsApp template registry
DROP TRIGGER IF EXISTS comms_templates_wa_registry_guard ON public.comms_templates;
DROP FUNCTION IF EXISTS public.comms_templates_wa_registry_guard();
ALTER TABLE public.comms_templates DROP CONSTRAINT IF EXISTS comms_templates_wa_param_count_range;
ALTER TABLE public.comms_templates DROP COLUMN IF EXISTS wa_param_count;
DROP FUNCTION IF EXISTS public.comms_template_param_count(text);

-- 1. Delivery evidence channel vocabulary
ALTER TABLE public.cg_delivery_evidence DROP CONSTRAINT IF EXISTS cg_delivery_evidence_channel_check;
ALTER TABLE public.cg_delivery_evidence ADD CONSTRAINT cg_delivery_evidence_channel_check
  CHECK (channel IN ('email','voice')) NOT VALID;
