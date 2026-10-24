-- SHERIVS-020 (Wave 3): school comms (SMS + WhatsApp adapters stubbed behind flags, templates,
-- opt-in, delivery log, inbound STOP), result checker scratch-card PINs, transcript requests,
-- and the admissions funnel (entrance exam, interview, offer, acceptance fee, enrolment).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ============ A. Templates, opt-in, delivery log ============
CREATE TABLE IF NOT EXISTS public.comms_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  code text NOT NULL, channel text NOT NULL CHECK (channel IN ('sms','whatsapp','email','voice')),
  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en','ha','yo','ig','pcm')),
  category text NOT NULL CHECK (category IN ('utility','marketing','authentication','safety')),
  body text NOT NULL, wa_template_name text, status text NOT NULL DEFAULT 'approved' CHECK (status IN ('draft','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS comms_templates_key ON public.comms_templates ((coalesce(school_id, '00000000-0000-0000-0000-000000000000'::uuid)), code, channel, language);
INSERT INTO public.comms_templates (school_id, code, channel, language, category, body, wa_template_name) VALUES
 (NULL,'fee_reminder','sms','en','utility','Dear parent, {{student}} has an outstanding balance of {{amount}} at {{school}}. Pay at {{link}}.',NULL),
 (NULL,'fee_reminder','whatsapp','en','utility','Dear parent, {{student}} has an outstanding balance of {{amount}} at {{school}}. Pay securely: {{link}}','fee_reminder_v1'),
 (NULL,'fee_reminder','sms','pcm','utility','Oga/Madam, {{student}} still get {{amount}} wey remain for {{school}}. Pay for {{link}}.',NULL),
 (NULL,'fee_reminder','sms','ha','utility','Iyaye, {{student}} yana da sauran kuɗin makaranta {{amount}} a {{school}}. Biya a {{link}}.',NULL),
 (NULL,'fee_reminder','sms','yo','utility','Òbí, {{student}} ṣì ní gbèsè owó ilé-ìwé {{amount}} ní {{school}}. Sanwó ní {{link}}.',NULL),
 (NULL,'fee_reminder','sms','ig','utility','Nne na nna, {{student}} ka nwere ego akwụkwọ {{amount}} na {{school}}. Kwụọ na {{link}}.',NULL),
 (NULL,'absence_alert','sms','en','safety','{{school}}: {{student}} was marked absent today ({{date}}). Please contact the school.',NULL),
 (NULL,'absence_alert','whatsapp','en','utility','{{school}}: {{student}} was marked absent today ({{date}}). Reply if this is expected.','absence_alert_v1'),
 (NULL,'absence_alert','sms','pcm','safety','{{school}}: {{student}} no come school today ({{date}}). Abeg call the school.',NULL),
 (NULL,'absence_alert','sms','ha','safety','{{school}}: {{student}} bai zo makaranta ba yau ({{date}}). Don Allah ku tuntuɓi makaranta.',NULL),
 (NULL,'absence_alert','sms','yo','safety','{{school}}: {{student}} kò wá sí ilé-ìwé lónìí ({{date}}). Ẹ jọ̀wọ́ ẹ kàn sí ilé-ìwé.',NULL),
 (NULL,'absence_alert','sms','ig','safety','{{school}}: {{student}} abịaghị ụlọ akwụkwọ taa ({{date}}). Biko kpọtụrụ ụlọ akwụkwọ.',NULL),
 (NULL,'result_ready','sms','en','utility','{{school}}: {{term}} results for {{student}} are ready. Check with your PIN at {{link}}.',NULL),
 (NULL,'result_ready','whatsapp','en','utility','{{school}}: {{term}} results for {{student}} are ready. View: {{link}}','result_ready_v1'),
 (NULL,'otp','sms','en','authentication','Your {{school}} code is {{code}}. It expires in 10 minutes. Do not share it.',NULL),
 (NULL,'emergency','sms','en','safety','URGENT from {{school}}: {{message}}',NULL),
 (NULL,'open_day','whatsapp','en','marketing','{{school}} open day is on {{date}}. Admissions are open: {{link}}','open_day_v1')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.comms_optins (
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE, phone text NOT NULL CHECK (phone ~ '^\+?[0-9]{10,15}$'),
  channel text NOT NULL CHECK (channel IN ('sms','whatsapp','voice')), status text NOT NULL CHECK (status IN ('opted_in','opted_out')),
  source text NOT NULL CHECK (source IN ('web_form','paper_signed','whatsapp_reply','sms_reply','admin_entry','admission_form')),
  captured_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (school_id, phone, channel));

CREATE TABLE IF NOT EXISTS public.outbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('sms','whatsapp','email','voice')), to_address text NOT NULL,
  template_code text, language text, category text NOT NULL, body text NOT NULL, priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL CHECK (status IN ('queued','sent_stub','sent','delivered','failed','blocked_optout','blocked_wallet','blocked_cap')),
  provider text NOT NULL DEFAULT 'stub', provider_ref text, segments int NOT NULL DEFAULT 1, cost numeric NOT NULL DEFAULT 0,
  student_id uuid, reference text NOT NULL, error text, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, reference));
CREATE INDEX IF NOT EXISTS outbound_messages_school_time ON public.outbound_messages (school_id, created_at DESC);
CREATE TABLE IF NOT EXISTS public.comms_sender_numbers (
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE, channel text NOT NULL CHECK (channel IN ('sms','whatsapp','voice','ussd')),
  provider_number text NOT NULL, provider text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (channel, provider_number));
CREATE TABLE IF NOT EXISTS public.inbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('sms','whatsapp','voice','ussd')), from_address text NOT NULL, body text,
  provider_ref text, action text, received_at timestamptz NOT NULL DEFAULT now(), UNIQUE (channel, provider_ref));

CREATE OR REPLACE FUNCTION public.comms_render(p_body text, p_vars jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE k text; v text; out text := p_body;
BEGIN
  FOR k, v IN SELECT key, value FROM jsonb_each_text(coalesce(p_vars, '{}'::jsonb)) LOOP out := replace(out, '{{' || k || '}}', left(v, 200)); END LOOP;
  RETURN regexp_replace(out, '\{\{[a-z_]+\}\}', '', 'g');
END $$;

CREATE OR REPLACE FUNCTION public.comms_set_optin(p_school uuid, p_phone text, p_channel text, p_status text, p_source text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR public.scholar_can(p_school, 'comms.send_class')
          OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.school_id = p_school AND regexp_replace(coalesce(u.phone, ''), '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g'))) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.comms_optins (school_id, phone, channel, status, source, captured_by) VALUES (p_school, p_phone, p_channel, p_status, p_source, auth.uid())
  ON CONFLICT (school_id, phone, channel) DO UPDATE SET status = EXCLUDED.status, source = EXCLUDED.source, captured_by = EXCLUDED.captured_by, updated_at = now();
END $$;

-- Send through the adapter. Live providers are off by flag -> 'sent_stub' (recorded, metered, not delivered).
CREATE OR REPLACE FUNCTION public.comms_send(p_school uuid, p_channel text, p_to text, p_template text, p_vars jsonb DEFAULT '{}'::jsonb,
  p_student uuid DEFAULT NULL, p_priority text DEFAULT 'normal', p_reference text DEFAULT NULL, p_language text DEFAULT 'en') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tpl public.comms_templates; v_body text; v_ref text := coalesce(p_reference, gen_random_uuid()::text); v_status text; v_seg int := 1;
        v_item text; v_cost numeric := 0; v_opt text; v_id uuid; v_err text; m jsonb; v_live boolean;
BEGIN
  SELECT * INTO tpl FROM public.comms_templates t WHERE t.code = p_template AND t.channel = p_channel AND t.status = 'approved'
     AND (t.school_id = p_school OR t.school_id IS NULL) ORDER BY (t.language = p_language) DESC, (t.school_id IS NOT NULL) DESC, (t.language = 'en') DESC LIMIT 1;
  IF tpl.id IS NULL THEN RAISE EXCEPTION 'no approved % template %', p_channel, p_template; END IF;
  IF tpl.category = 'marketing' AND NOT public.scholar_can(p_school, 'comms.broadcast') THEN RAISE EXCEPTION 'not allowed: marketing needs comms.broadcast' USING ERRCODE = '42501'; END IF;
  IF tpl.category = 'safety' AND p_priority <> 'safety' THEN p_priority := 'safety'; END IF;
  IF p_priority = 'safety' AND tpl.category NOT IN ('safety', 'authentication') THEN p_priority := 'normal'; END IF;   -- cannot dress a normal message up as safety
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR public.scholar_can(p_school, 'comms.send_class') OR public.scholar_can(p_school, 'comms.broadcast')) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_student IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.students WHERE id = p_student AND school_id = p_school) THEN RAISE EXCEPTION 'student not in this school'; END IF;
  IF EXISTS (SELECT 1 FROM public.outbound_messages WHERE school_id = p_school AND reference = v_ref) THEN
    SELECT jsonb_build_object('id', id, 'status', status, 'replay', true) INTO m FROM public.outbound_messages WHERE school_id = p_school AND reference = v_ref; RETURN m; END IF;
  v_body := public.comms_render(tpl.body, coalesce(p_vars, '{}'::jsonb) || jsonb_build_object('school', (SELECT name FROM public.schools WHERE id = p_school)));
  SELECT status INTO v_opt FROM public.comms_optins WHERE school_id = p_school AND phone = p_to AND channel = p_channel;
  IF p_channel = 'sms' THEN v_seg := greatest(1, ceil(length(v_body) / 160.0)::int); v_item := 'sms';
  ELSIF p_channel = 'whatsapp' THEN v_item := CASE WHEN tpl.category = 'marketing' THEN 'whatsapp_marketing' ELSE 'whatsapp_utility' END; END IF;
  -- consent rules: STOP always wins for non-safety; WhatsApp and marketing need an explicit opt-in
  IF p_priority <> 'safety' AND (v_opt = 'opted_out' OR (p_channel = 'whatsapp' OR tpl.category = 'marketing') AND v_opt IS DISTINCT FROM 'opted_in') THEN
    v_status := 'blocked_optout';
  ELSE
    BEGIN
      IF v_item IS NOT NULL THEN
        m := public.meter_usage(p_school, v_item, v_seg, 'msg:' || v_ref, p_student, p_priority);
        v_cost := coalesce((m->>'charged')::numeric, 0);
      END IF;
      v_live := public.flag_on(p_channel || '_live', p_school);
      v_status := CASE WHEN v_live THEN 'queued' ELSE 'sent_stub' END;
    EXCEPTION WHEN others THEN
      v_err := SQLERRM; v_status := CASE WHEN v_err LIKE 'insufficient_wallet%' THEN 'blocked_wallet' WHEN v_err LIKE 'daily_cap%' THEN 'blocked_cap' ELSE NULL END;
      IF v_status IS NULL THEN RAISE; END IF;
    END;
  END IF;
  INSERT INTO public.outbound_messages (school_id, channel, to_address, template_code, language, category, body, priority, status, provider, segments, cost, student_id, reference, error, created_by)
  VALUES (p_school, p_channel, p_to, p_template, tpl.language, tpl.category, v_body, p_priority, v_status,
          CASE WHEN v_status = 'queued' THEN CASE p_channel WHEN 'whatsapp' THEN 'meta_cloud' WHEN 'sms' THEN 'bulksmsnigeria' ELSE p_channel END ELSE 'stub' END,
          v_seg, v_cost, p_student, v_ref, v_err, auth.uid()) RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'status', v_status, 'segments', v_seg, 'cost', v_cost, 'language', tpl.language);
END $$;

-- Provider delivery receipts and inbound replies (verified webhook only)
CREATE OR REPLACE FUNCTION public.comms_delivery_receipt(p_message uuid, p_status text, p_provider_ref text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('sent', 'delivered', 'failed') THEN RAISE EXCEPTION 'bad status'; END IF;
  UPDATE public.outbound_messages SET status = p_status, provider_ref = p_provider_ref, updated_at = now() WHERE id = p_message;
END $$;
CREATE OR REPLACE FUNCTION public.comms_inbound(p_school uuid, p_channel text, p_from text, p_body text, p_provider_ref text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_action text := 'logged'; kw text := upper(trim(coalesce(p_body, '')));
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed: inbound is accepted from the verified provider webhook only' USING ERRCODE = '42501'; END IF;
  IF kw IN ('STOP', 'UNSUBSCRIBE', 'END', 'DAINA', 'DURO', 'KWUSI') THEN
    INSERT INTO public.comms_optins (school_id, phone, channel, status, source) VALUES (p_school, p_from, CASE WHEN p_channel = 'whatsapp' THEN 'whatsapp' ELSE 'sms' END, 'opted_out', CASE WHEN p_channel = 'whatsapp' THEN 'whatsapp_reply' ELSE 'sms_reply' END)
    ON CONFLICT (school_id, phone, channel) DO UPDATE SET status = 'opted_out', source = EXCLUDED.source, updated_at = now();
    v_action := 'opted_out';
  ELSIF kw IN ('START', 'YES', 'JOIN') THEN
    INSERT INTO public.comms_optins (school_id, phone, channel, status, source) VALUES (p_school, p_from, CASE WHEN p_channel = 'whatsapp' THEN 'whatsapp' ELSE 'sms' END, 'opted_in', CASE WHEN p_channel = 'whatsapp' THEN 'whatsapp_reply' ELSE 'sms_reply' END)
    ON CONFLICT (school_id, phone, channel) DO UPDATE SET status = 'opted_in', source = EXCLUDED.source, updated_at = now();
    v_action := 'opted_in';
  END IF;
  INSERT INTO public.inbound_messages (school_id, channel, from_address, body, provider_ref, action) VALUES (p_school, p_channel, p_from, left(p_body, 2000), p_provider_ref, v_action)
  ON CONFLICT (channel, provider_ref) DO NOTHING;
  RETURN v_action;
END $$;

-- ============ B. Result checker (scratch-card PINs) ============
CREATE TABLE IF NOT EXISTS public.result_pin_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  academic_year text NOT NULL, term text NOT NULL, quantity int NOT NULL CHECK (quantity BETWEEN 1 AND 20000), max_uses int NOT NULL DEFAULT 5,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.result_pins (
  serial text PRIMARY KEY, batch_id uuid NOT NULL REFERENCES public.result_pin_batches(id) ON DELETE CASCADE,
  school_id uuid NOT NULL, pin_hash text NOT NULL, student_id uuid REFERENCES public.students(id) ON DELETE CASCADE,
  uses int NOT NULL DEFAULT 0, max_uses int NOT NULL, academic_year text NOT NULL, term text NOT NULL, first_used_at timestamptz, last_used_at timestamptz);
CREATE INDEX IF NOT EXISTS result_pins_school ON public.result_pins (school_id, academic_year, term);

CREATE OR REPLACE FUNCTION public.generate_result_pins(p_school uuid, p_year text, p_term text, p_quantity int, p_max_uses int DEFAULT 5)
RETURNS TABLE (serial text, pin text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE b uuid; i int; s text; pn text;
BEGIN
  IF NOT public.scholar_can(p_school, 'results.publish') AND NOT public.scholar_can(p_school, 'settings.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_quantity < 1 OR p_quantity > 20000 THEN RAISE EXCEPTION 'quantity must be 1-20000'; END IF;
  INSERT INTO public.result_pin_batches (school_id, academic_year, term, quantity, max_uses, created_by) VALUES (p_school, p_year, p_term, p_quantity, p_max_uses, auth.uid()) RETURNING id INTO b;
  FOR i IN 1..p_quantity LOOP
    s := 'SRV' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    pn := lpad((('x' || substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 15))::bit(60)::bigint % 1000000000000)::text, 12, '0');
    INSERT INTO public.result_pins (serial, batch_id, school_id, pin_hash, max_uses, academic_year, term)
    VALUES (s, b, p_school, extensions.crypt(pn, extensions.gen_salt('bf', 6)), p_max_uses, p_year, p_term);
    serial := s; pin := pn; RETURN NEXT;
  END LOOP;
END $$;

-- Public checker: serial + PIN + admission number. PIN binds to the first student; limited uses; rate limited per serial.
CREATE OR REPLACE FUNCTION public.check_result(p_serial text, p_pin text, p_admission_number text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.result_pins; st public.students; res jsonb;
BEGIN
  -- failures RETURN (not raise) so the attempt counter is kept: a raise would roll back the rate-limit row and allow brute force
  IF NOT public.rate_limit_take('result_checker.serial', coalesce(p_serial, '?'), 10, interval '1 hour') THEN RETURN jsonb_build_object('ok', false, 'error', 'rate_limited'); END IF;
  SELECT * INTO r FROM public.result_pins WHERE serial = p_serial FOR UPDATE;
  IF r.serial IS NULL OR r.pin_hash <> extensions.crypt(coalesce(p_pin, ''), r.pin_hash) THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid serial or PIN'); END IF;
  SELECT * INTO st FROM public.students WHERE school_id = r.school_id AND admission_number = p_admission_number;
  IF st.id IS NULL THEN RAISE EXCEPTION 'student not found for this card' USING ERRCODE = 'P0001'; END IF;
  IF r.student_id IS NOT NULL AND r.student_id <> st.id THEN RAISE EXCEPTION 'this card is already used by another student' USING ERRCODE = 'P0001'; END IF;
  IF r.uses >= r.max_uses THEN RAISE EXCEPTION 'card exhausted (% uses)', r.max_uses USING ERRCODE = 'P0001'; END IF;
  UPDATE public.result_pins SET student_id = st.id, uses = uses + 1, first_used_at = coalesce(first_used_at, now()), last_used_at = now() WHERE serial = r.serial;
  SELECT jsonb_build_object('ok', true, 'school', (SELECT name FROM public.schools WHERE id = r.school_id), 'admission_number', st.admission_number,
           'term', r.term, 'academic_year', r.academic_year, 'uses_left', r.max_uses - r.uses - 1,
           'subjects', coalesce(jsonb_agg(jsonb_build_object('subject', g.subject, 'ca', g.ca_score, 'exam', g.exam_score, 'total', g.total_score, 'grade', g.grade) ORDER BY g.subject), '[]'::jsonb))
    INTO res FROM public.grades g WHERE g.student_id = st.id AND g.term = r.term AND g.academic_year = r.academic_year AND g.is_published;
  RETURN res;
END $$;

-- ============ C. Transcripts ============
CREATE TABLE IF NOT EXISTS public.transcript_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE, requested_by uuid NOT NULL,
  destination text NOT NULL, copies int NOT NULL DEFAULT 1 CHECK (copies BETWEEN 1 AND 10), delivery text NOT NULL DEFAULT 'email' CHECK (delivery IN ('email','courier','pickup')),
  fee numeric NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','issued','rejected')),
  approved_by uuid, issued_at timestamptz, verification_code text UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (approved_by IS NULL OR approved_by <> requested_by));
CREATE OR REPLACE FUNCTION public.request_transcript(p_school uuid, p_student uuid, p_destination text, p_copies int DEFAULT 1, p_delivery text DEFAULT 'email') RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.students WHERE id = p_student AND school_id = p_school) THEN RAISE EXCEPTION 'student not in this school'; END IF;
  IF NOT (public.scholar_can(p_school, 'students.edit')
          OR EXISTS (SELECT 1 FROM public.students s WHERE s.id = p_student AND (s.user_id = auth.uid() OR s.parent_id = auth.uid()))
          OR EXISTS (SELECT 1 FROM public.parent_student_map m WHERE m.student_id = p_student AND m.parent_id = auth.uid())) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.transcript_requests (school_id, student_id, requested_by, destination, copies, delivery) VALUES (p_school, p_student, auth.uid(), p_destination, p_copies, p_delivery) RETURNING id INTO v;
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.issue_transcript(p_request uuid, p_approve boolean DEFAULT true) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.transcript_requests; code text;
BEGIN
  SELECT * INTO t FROM public.transcript_requests WHERE id = p_request FOR UPDATE;
  IF t.id IS NULL OR NOT public.scholar_can(t.school_id, 'transcripts.issue') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF t.requested_by = auth.uid() THEN RAISE EXCEPTION 'sod: the requester cannot issue their own transcript' USING ERRCODE = '42501'; END IF;
  IF t.status <> 'requested' THEN RAISE EXCEPTION 'already %', t.status; END IF;
  IF NOT p_approve THEN UPDATE public.transcript_requests SET status = 'rejected', approved_by = auth.uid() WHERE id = p_request; RETURN NULL; END IF;
  code := upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 12));
  UPDATE public.transcript_requests SET status = 'issued', approved_by = auth.uid(), issued_at = now(), verification_code = code WHERE id = p_request;
  RETURN code;
END $$;
CREATE OR REPLACE FUNCTION public.verify_transcript(p_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb;
BEGIN
  IF NOT public.rate_limit_take('transcript.verify', coalesce(p_code, '?'), 20, interval '1 hour') THEN RETURN jsonb_build_object('valid', false, 'error', 'rate_limited'); END IF;
  SELECT jsonb_build_object('valid', true, 'school', s.name, 'admission_number', st.admission_number, 'issued_at', t.issued_at::date)
    INTO r FROM public.transcript_requests t JOIN public.schools s ON s.id = t.school_id JOIN public.students st ON st.id = t.student_id
   WHERE t.verification_code = upper(p_code) AND t.status = 'issued';
  RETURN coalesce(r, jsonb_build_object('valid', false));
END $$;

-- ============ D. Admissions funnel ============
ALTER TABLE public.admission_applications ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'applied'
  CHECK (stage IN ('applied','exam_scheduled','exam_taken','interview','offered','accepted','enrolled','rejected','withdrawn'));
ALTER TABLE public.admission_applications ADD COLUMN IF NOT EXISTS entrance_exam_at timestamptz;
ALTER TABLE public.admission_applications ADD COLUMN IF NOT EXISTS entrance_exam_score numeric CHECK (entrance_exam_score IS NULL OR entrance_exam_score BETWEEN 0 AND 100);
ALTER TABLE public.admission_applications ADD COLUMN IF NOT EXISTS scored_by uuid;
ALTER TABLE public.admission_applications ADD COLUMN IF NOT EXISTS offer_letter jsonb;
ALTER TABLE public.admission_applications ADD COLUMN IF NOT EXISTS offered_by uuid;
ALTER TABLE public.admission_applications ADD COLUMN IF NOT EXISTS offer_expires_at timestamptz;
ALTER TABLE public.admission_applications ADD COLUMN IF NOT EXISTS acceptance_fee numeric;
ALTER TABLE public.admission_applications ADD COLUMN IF NOT EXISTS acceptance_fee_paid_at timestamptz;
ALTER TABLE public.admission_applications ADD COLUMN IF NOT EXISTS acceptance_reference text;
CREATE TABLE IF NOT EXISTS public.admission_stage_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, application_id uuid NOT NULL REFERENCES public.admission_applications(id) ON DELETE CASCADE,
  school_id uuid NOT NULL, from_stage text, to_stage text NOT NULL, actor uuid, detail jsonb, at timestamptz NOT NULL DEFAULT now());

CREATE OR REPLACE FUNCTION public._adm_move(p_app uuid, p_allowed_from text[], p_to text, p_perm text, p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS public.admission_applications LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.admission_applications;
BEGIN
  SELECT * INTO a FROM public.admission_applications WHERE id = p_app FOR UPDATE;
  IF a.id IS NULL OR NOT (coalesce(auth.role(), '') = 'service_role' OR public.scholar_can(a.school_id, p_perm)) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT (a.stage = ANY (p_allowed_from)) THEN RAISE EXCEPTION 'cannot move from % to %', a.stage, p_to; END IF;
  UPDATE public.admission_applications SET stage = p_to, updated_at = now() WHERE id = p_app RETURNING * INTO a;
  INSERT INTO public.admission_stage_events (application_id, school_id, from_stage, to_stage, actor, detail) VALUES (p_app, a.school_id, NULL, p_to, auth.uid(), p_detail);
  RETURN a;
END $$;
REVOKE ALL ON FUNCTION public._adm_move(uuid, text[], text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.admissions_schedule_exam(p_app uuid, p_at timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN PERFORM public._adm_move(p_app, ARRAY['applied','exam_scheduled'], 'exam_scheduled', 'admissions.process', jsonb_build_object('at', p_at));
  UPDATE public.admission_applications SET entrance_exam_at = p_at WHERE id = p_app; END $$;
CREATE OR REPLACE FUNCTION public.admissions_record_score(p_app uuid, p_score numeric) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN PERFORM public._adm_move(p_app, ARRAY['exam_scheduled','exam_taken'], 'exam_taken', 'admissions.process', jsonb_build_object('score', p_score));
  UPDATE public.admission_applications SET entrance_exam_score = p_score, scored_by = auth.uid() WHERE id = p_app; END $$;
CREATE OR REPLACE FUNCTION public.admissions_interview(p_app uuid, p_at timestamptz, p_notes text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN PERFORM public._adm_move(p_app, ARRAY['exam_taken','interview','applied'], 'interview', 'admissions.process', jsonb_build_object('at', p_at));
  UPDATE public.admission_applications SET interview_date = p_at, interview_notes = coalesce(p_notes, interview_notes) WHERE id = p_app; END $$;
CREATE OR REPLACE FUNCTION public.admissions_offer(p_app uuid, p_acceptance_fee numeric, p_expires timestamptz, p_class text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.admission_applications;
BEGIN
  SELECT * INTO a FROM public.admission_applications WHERE id = p_app;
  IF a.scored_by = auth.uid() THEN RAISE EXCEPTION 'sod: the officer who scored the entrance exam cannot also make the offer' USING ERRCODE = '42501'; END IF;
  a := public._adm_move(p_app, ARRAY['exam_taken','interview'], 'offered', 'admissions.offer', jsonb_build_object('fee', p_acceptance_fee));
  UPDATE public.admission_applications SET offered_by = auth.uid(), acceptance_fee = p_acceptance_fee, offer_expires_at = p_expires,
    offer_letter = jsonb_build_object('class', coalesce(p_class, a.applying_for_class), 'session', a.academic_year_applying, 'fee', p_acceptance_fee, 'expires', p_expires, 'issued_at', now())
   WHERE id = p_app;
END $$;
-- Acceptance fee: paid by Paystack (webhook, service role) or recorded as cash by the bursar.
CREATE OR REPLACE FUNCTION public.admissions_record_acceptance(p_app uuid, p_reference text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.admission_applications;
BEGIN
  SELECT * INTO a FROM public.admission_applications WHERE id = p_app;
  IF a.offer_expires_at IS NOT NULL AND a.offer_expires_at < now() THEN RAISE EXCEPTION 'offer expired'; END IF;
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR public.scholar_can(a.school_id, 'payments.record_cash')) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM public._adm_move(p_app, ARRAY['offered'], 'accepted', CASE WHEN coalesce(auth.role(), '') = 'service_role' THEN 'admissions.view' ELSE 'payments.record_cash' END, jsonb_build_object('reference', p_reference));
  UPDATE public.admission_applications SET acceptance_fee_paid_at = now(), acceptance_reference = p_reference WHERE id = p_app;
END $$;
CREATE OR REPLACE FUNCTION public.admissions_enroll(p_app uuid, p_admission_number text, p_class uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.admission_applications; v uuid;
BEGIN
  SELECT * INTO a FROM public.admission_applications WHERE id = p_app;
  IF a.id IS NULL OR NOT public.scholar_can(a.school_id, 'students.create') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF a.acceptance_fee IS NOT NULL AND a.acceptance_fee > 0 AND a.acceptance_fee_paid_at IS NULL THEN RAISE EXCEPTION 'acceptance fee not paid'; END IF;
  IF p_class IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.classes WHERE id = p_class AND school_id = a.school_id) THEN RAISE EXCEPTION 'class not in this school'; END IF;
  PERFORM public._adm_move(p_app, ARRAY['accepted'], 'enrolled', 'students.create');
  INSERT INTO public.students (school_id, admission_number, class_id, date_of_birth, gender, home_address, religion, nationality, medical_conditions,
                               parent_name, parent_phone, parent_email, previous_school)
  VALUES (a.school_id, p_admission_number, p_class, a.student_date_of_birth, a.student_gender, a.student_address, a.student_religion, coalesce(a.student_nationality, 'Nigerian'),
          a.medical_conditions, a.parent_one_name, a.parent_one_phone, a.parent_one_email, a.previous_school_name) RETURNING id INTO v;
  UPDATE public.admission_applications SET student_id = v WHERE id = p_app;
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.admissions_funnel(p_school uuid, p_session text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb;
BEGIN
  IF NOT public.scholar_can(p_school, 'admissions.view') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(jsonb_object_agg(stage, n), '{}'::jsonb) INTO r FROM (SELECT stage, count(*) n FROM public.admission_applications
    WHERE school_id = p_school AND (p_session IS NULL OR academic_year_applying = p_session) GROUP BY stage) x;
  RETURN r;
END $$;

-- ============ RLS / grants / audit ============
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['comms_templates','comms_optins','outbound_messages','inbound_messages','result_pin_batches','result_pins','transcript_requests','admission_stage_events','comms_sender_numbers'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t); EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated, service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_read ON public.%1$I', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['comms_templates','comms_optins','outbound_messages','inbound_messages','result_pin_batches','transcript_requests','admission_stage_events'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', t); END LOOP;
  -- result_pins: never readable (hashes); only via RPCs
END $$;
GRANT SELECT ON public.comms_sender_numbers TO service_role;
CREATE POLICY comms_sender_numbers_svc ON public.comms_sender_numbers FOR SELECT TO service_role USING (true);
CREATE POLICY comms_templates_read ON public.comms_templates FOR SELECT TO authenticated USING (school_id IS NULL OR school_id = public.get_my_school_id());
CREATE POLICY comms_optins_read ON public.comms_optins FOR SELECT TO authenticated USING (public.scholar_can(school_id, 'comms.send_class'));
CREATE POLICY outbound_messages_read ON public.outbound_messages FOR SELECT TO authenticated USING (public.scholar_can(school_id, 'comms.broadcast') OR created_by = auth.uid());
CREATE POLICY inbound_messages_read ON public.inbound_messages FOR SELECT TO authenticated USING (public.scholar_can(school_id, 'comms.broadcast'));
CREATE POLICY result_pin_batches_read ON public.result_pin_batches FOR SELECT TO authenticated USING (public.scholar_can(school_id, 'results.publish'));
CREATE POLICY transcript_requests_read ON public.transcript_requests FOR SELECT TO authenticated
  USING (requested_by = auth.uid() OR public.scholar_can(school_id, 'transcripts.issue') OR public.scholar_can(school_id, 'students.edit'));
CREATE POLICY admission_stage_events_read ON public.admission_stage_events FOR SELECT TO authenticated USING (public.scholar_can(school_id, 'admissions.view'));
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['comms_templates','comms_optins','result_pin_batches','transcript_requests','admission_stage_events'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_audit ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.scholar_audit()', t);
  END LOOP; END $$;
DROP TRIGGER IF EXISTS trg_admission_stage_events_append_only ON public.admission_stage_events;
CREATE TRIGGER trg_admission_stage_events_append_only BEFORE UPDATE OR DELETE ON public.admission_stage_events FOR EACH ROW EXECUTE FUNCTION public.append_only_guard();

REVOKE ALL ON FUNCTION public.comms_render(text, jsonb), public.comms_set_optin(uuid, text, text, text, text),
  public.comms_send(uuid, text, text, text, jsonb, uuid, text, text, text), public.comms_delivery_receipt(uuid, text, text), public.comms_inbound(uuid, text, text, text, text),
  public.generate_result_pins(uuid, text, text, int, int), public.check_result(text, text, text), public.request_transcript(uuid, uuid, text, int, text),
  public.issue_transcript(uuid, boolean), public.verify_transcript(text), public.admissions_schedule_exam(uuid, timestamptz), public.admissions_record_score(uuid, numeric),
  public.admissions_interview(uuid, timestamptz, text), public.admissions_offer(uuid, numeric, timestamptz, text), public.admissions_record_acceptance(uuid, text),
  public.admissions_enroll(uuid, text, uuid), public.admissions_funnel(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comms_set_optin(uuid, text, text, text, text),
  public.comms_send(uuid, text, text, text, jsonb, uuid, text, text, text), public.comms_delivery_receipt(uuid, text, text), public.comms_inbound(uuid, text, text, text, text),
  public.generate_result_pins(uuid, text, text, int, int), public.request_transcript(uuid, uuid, text, int, text),
  public.issue_transcript(uuid, boolean), public.admissions_schedule_exam(uuid, timestamptz), public.admissions_record_score(uuid, numeric),
  public.admissions_interview(uuid, timestamptz, text), public.admissions_offer(uuid, numeric, timestamptz, text), public.admissions_record_acceptance(uuid, text),
  public.admissions_enroll(uuid, text, uuid), public.admissions_funnel(uuid, text) TO authenticated, service_role;
-- public endpoints (scratch-card checker, transcript verification) are callable by anon, rate limited inside
GRANT EXECUTE ON FUNCTION public.check_result(text, text, text), public.verify_transcript(text) TO anon, authenticated, service_role;
COMMIT;
