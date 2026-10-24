-- SHERIVS-025 (Wave 7): USSD + IVR (stubbed behind ussd_live / voice_live), alumni + donations, government dashboards
-- (opt-in, aggregated, small-cell suppression), and Hausa / Yoruba / Igbo / Pidgin UI strings.
BEGIN;
-- ===== USSD =====
CREATE TABLE IF NOT EXISTS public.ussd_sessions (
  session_id text PRIMARY KEY, phone text NOT NULL, state text NOT NULL DEFAULT 'menu', chosen_student uuid, hits int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION public._norm_phone(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN d ~ '^0\d{10}$' THEN '234' || substr(d, 2) WHEN d ~ '^234\d{10}$' THEN d ELSE d END FROM (SELECT regexp_replace(coalesce(p, ''), '\D', '', 'g') d) x $$;
-- Africa's Talking style: text is the '*'-joined input so far. Returns 'CON ...' (continue) or 'END ...'.
-- Only the provider webhook (service role) calls this; the caller's phone must match a parent account.
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

-- ===== IVR absence calls (queued; voice adapter stubbed while voice_live is off) =====
CREATE TABLE IF NOT EXISTS public.ivr_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL, student_id uuid REFERENCES public.students(id) ON DELETE CASCADE, to_phone text NOT NULL,
  script text NOT NULL, language text NOT NULL DEFAULT 'en', for_date date NOT NULL, status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent_stub','answered','failed')),
  provider text NOT NULL DEFAULT 'stub', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (student_id, for_date));
CREATE OR REPLACE FUNCTION public.ivr_queue_absence_calls(p_school uuid, p_date date DEFAULT current_date, p_language text DEFAULT 'en') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n int; live boolean := public.flag_on('voice_live', p_school);
BEGIN
  IF NOT (public.scholar_can(p_school, 'comms.broadcast') OR public.scholar_can(p_school, 'attendance.edit_past')) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_language NOT IN ('en','ha','yo','ig','pcm') THEN RAISE EXCEPTION 'unsupported language'; END IF;
  INSERT INTO public.ivr_calls (school_id, student_id, to_phone, script, language, for_date, status, provider)
  SELECT p_school, a.student_id, public._norm_phone(u.phone),
         CASE p_language WHEN 'ha' THEN 'Sannu. Yaronku bai zo makaranta yau ba.' WHEN 'yo' THEN 'E kaaro. Omo yin ko wa si ile-iwe loni.'
                         WHEN 'ig' THEN 'Ndewo. Nwa unu abiaghi ulo akwukwo taa.' WHEN 'pcm' THEN 'Hello. Your pikin no come school today.'
                         ELSE 'Hello. Your child was marked absent from school today.' END,
         p_language, p_date, CASE WHEN live THEN 'queued' ELSE 'sent_stub' END, CASE WHEN live THEN 'voice' ELSE 'stub' END
    FROM public.attendance a JOIN public.students s ON s.id = a.student_id JOIN public.users u ON u.id = s.parent_id
   WHERE a.school_id = p_school AND a.date = p_date AND a.status = 'absent' AND u.phone IS NOT NULL
  ON CONFLICT (student_id, for_date) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('queued', n, 'live', live);
END $$;

-- ===== Alumni + donations =====
CREATE TABLE IF NOT EXISTS public.alumni_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE, user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL, full_name text NOT NULL, grad_year int CHECK (grad_year BETWEEN 1900 AND 2100),
  email text, phone text, occupation text, contact_consent boolean NOT NULL DEFAULT false, verified boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, student_id));
CREATE TABLE IF NOT EXISTS public.donation_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE, title text NOT NULL, goal numeric NOT NULL CHECK (goal > 0),
  starts_on date NOT NULL DEFAULT current_date, ends_on date, status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')), created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.donations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL, campaign_id uuid NOT NULL REFERENCES public.donation_campaigns(id) ON DELETE CASCADE,
  alumni_id uuid REFERENCES public.alumni_profiles(id) ON DELETE SET NULL, donor_name text, anonymous boolean NOT NULL DEFAULT false, amount numeric NOT NULL CHECK (amount > 0),
  channel text NOT NULL CHECK (channel IN ('paystack','transfer','cash')), reference text NOT NULL UNIQUE, recorded_by uuid, confirmed_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION public.alumni_register(p_school uuid, p_name text, p_grad_year int, p_email text DEFAULT NULL, p_phone text DEFAULT NULL, p_consent boolean DEFAULT false, p_student uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid; adm boolean := public.scholar_can(p_school, 'alumni.manage');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_student IS NOT NULL AND NOT (adm OR EXISTS (SELECT 1 FROM public.students WHERE id = p_student AND user_id = auth.uid() AND school_id = p_school)) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.alumni_profiles (school_id, user_id, student_id, full_name, grad_year, email, phone, contact_consent, verified)
  VALUES (p_school, CASE WHEN adm THEN NULL ELSE auth.uid() END, p_student, p_name, p_grad_year, p_email, public._norm_phone(p_phone), p_consent, adm OR p_student IS NOT NULL) RETURNING id INTO v;
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.donation_campaign_create(p_school uuid, p_title text, p_goal numeric, p_ends date DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid;
BEGIN
  IF NOT public.scholar_can(p_school, 'alumni.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.donation_campaigns (school_id, title, goal, ends_on, created_by) VALUES (p_school, p_title, p_goal, p_ends, auth.uid()) RETURNING id INTO v;
  RETURN v;
END $$;
-- online gifts arrive only through the verified Paystack webhook (service role, test key); idempotent on reference
CREATE OR REPLACE FUNCTION public.donation_confirm_online(p_campaign uuid, p_amount numeric, p_reference text, p_donor text DEFAULT NULL, p_alumni uuid DEFAULT NULL, p_anonymous boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.donation_campaigns; ex public.donations;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed: payment webhook only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO ex FROM public.donations WHERE reference = p_reference;
  IF ex.id IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'replay', true, 'amount', ex.amount); END IF;
  SELECT * INTO c FROM public.donation_campaigns WHERE id = p_campaign;
  IF c.id IS NULL OR c.status <> 'open' THEN RETURN jsonb_build_object('ok', false, 'error', 'campaign_closed'); END IF;
  INSERT INTO public.donations (school_id, campaign_id, alumni_id, donor_name, anonymous, amount, channel, reference) VALUES (c.school_id, c.id, p_alumni, p_donor, p_anonymous, p_amount, 'paystack', p_reference);
  RETURN jsonb_build_object('ok', true);
END $$;
CREATE OR REPLACE FUNCTION public.donation_record_offline(p_campaign uuid, p_amount numeric, p_channel text, p_reference text, p_donor text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.donation_campaigns; v uuid;
BEGIN
  SELECT * INTO c FROM public.donation_campaigns WHERE id = p_campaign;
  IF c.id IS NULL OR NOT public.scholar_can(c.school_id, 'payments.record') AND NOT public.scholar_can(c.school_id, 'fees.manage') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_channel NOT IN ('transfer','cash') THEN RAISE EXCEPTION 'online gifts come from the payment webhook'; END IF;
  INSERT INTO public.donations (school_id, campaign_id, donor_name, amount, channel, reference, recorded_by) VALUES (c.school_id, c.id, p_donor, p_amount, p_channel, p_reference, auth.uid()) RETURNING id INTO v;
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.donation_campaign_progress(p_campaign uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('title', c.title, 'goal', c.goal, 'raised', coalesce(sum(d.amount), 0), 'donors', count(d.id),
         'recent', coalesce((SELECT jsonb_agg(x) FROM (SELECT CASE WHEN anonymous THEN 'Anonymous' ELSE coalesce(donor_name, 'Alumnus') END nm, amount FROM public.donations
                    WHERE campaign_id = c.id ORDER BY confirmed_at DESC LIMIT 5) x), '[]'::jsonb))
    FROM public.donation_campaigns c LEFT JOIN public.donations d ON d.campaign_id = c.id WHERE c.id = p_campaign GROUP BY c.id $$;

-- ===== Government dashboards (opt-in, aggregated, k=10 suppression) =====
CREATE TABLE IF NOT EXISTS public.school_locations (school_id uuid PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE, state text NOT NULL, lga text NOT NULL, ownership text CHECK (ownership IN ('public','private','mission','community')));
CREATE TABLE IF NOT EXISTS public.gov_jurisdictions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, state text NOT NULL, lga text, UNIQUE (state, lga));
CREATE TABLE IF NOT EXISTS public.gov_viewers (user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE, jurisdiction_id uuid NOT NULL REFERENCES public.gov_jurisdictions(id) ON DELETE CASCADE,
  granted_by uuid, granted_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, jurisdiction_id));
CREATE TABLE IF NOT EXISTS public.gov_data_sharing (school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE, jurisdiction_id uuid NOT NULL REFERENCES public.gov_jurisdictions(id) ON DELETE CASCADE,
  consented_by uuid NOT NULL, consented_at timestamptz NOT NULL DEFAULT now(), withdrawn_at timestamptz, PRIMARY KEY (school_id, jurisdiction_id));
CREATE OR REPLACE FUNCTION public.gov_viewer_grant(p_user uuid, p_jurisdiction uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT coalesce(public.is_super_admin(), false) THEN RAISE EXCEPTION 'not allowed: Sherivs staff only' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.gov_viewers (user_id, jurisdiction_id, granted_by) VALUES (p_user, p_jurisdiction, auth.uid()) ON CONFLICT DO NOTHING;
END $$;
CREATE OR REPLACE FUNCTION public.gov_sharing_set(p_school uuid, p_jurisdiction uuid, p_share boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.can_administer_org(p_school) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_share THEN INSERT INTO public.gov_data_sharing (school_id, jurisdiction_id, consented_by) VALUES (p_school, p_jurisdiction, auth.uid())
    ON CONFLICT (school_id, jurisdiction_id) DO UPDATE SET withdrawn_at = NULL, consented_by = auth.uid(), consented_at = now();
  ELSE UPDATE public.gov_data_sharing SET withdrawn_at = now() WHERE school_id = p_school AND jurisdiction_id = p_jurisdiction; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.gov_dashboard(p_jurisdiction uuid, p_year text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb;
BEGIN
  IF NOT (EXISTS (SELECT 1 FROM public.gov_viewers WHERE user_id = auth.uid() AND jurisdiction_id = p_jurisdiction) OR coalesce(public.is_super_admin(), false)) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  WITH sch AS (SELECT ds.school_id FROM public.gov_data_sharing ds WHERE ds.jurisdiction_id = p_jurisdiction AND ds.withdrawn_at IS NULL),
  per AS (
    SELECT s.school_id,
      (SELECT count(*) FROM public.students st WHERE st.school_id = s.school_id) enrolled,
      (SELECT count(*) FROM public.students st WHERE st.school_id = s.school_id AND st.gender = 'female') girls,
      (SELECT round(100.0 * count(*) FILTER (WHERE status IN ('present','late')) / nullif(count(*), 0), 1) FROM public.attendance a WHERE a.school_id = s.school_id AND a.date >= current_date - 30) att,
      (SELECT round(100.0 * count(*) FILTER (WHERE total_score >= 50) / nullif(count(*), 0), 1) FROM public.grades g WHERE g.school_id = s.school_id AND (p_year IS NULL OR g.academic_year = p_year)) pass_rate
    FROM sch s)
  SELECT jsonb_build_object('schools', count(*), 'enrolled', sum(enrolled), 'girls_pct', round(100.0 * sum(girls) / nullif(sum(enrolled), 0), 1),
    'attendance_pct_30d', round(avg(att), 1), 'pass_rate_pct', round(avg(pass_rate), 1),
    'per_school', coalesce(jsonb_agg(jsonb_build_object('school', (SELECT name FROM public.schools WHERE id = per.school_id),
        'enrolled', CASE WHEN enrolled < 10 THEN NULL ELSE enrolled END, 'attendance_pct', CASE WHEN enrolled < 10 THEN NULL ELSE att END,
        'pass_rate_pct', CASE WHEN enrolled < 10 THEN NULL ELSE pass_rate END, 'suppressed', enrolled < 10)), '[]'::jsonb))
    INTO r FROM per;
  RETURN r;
END $$;

-- ===== i18n =====
CREATE TABLE IF NOT EXISTS public.ui_translations (locale text NOT NULL CHECK (locale IN ('en','ha','yo','ig','pcm')), key text NOT NULL, text text NOT NULL, reviewed boolean NOT NULL DEFAULT false, PRIMARY KEY (locale, key));
INSERT INTO public.ui_translations (locale, key, text) VALUES
 ('en','nav.dashboard','Dashboard'),('ha','nav.dashboard','Allon bayani'),('yo','nav.dashboard','Pátákó'),('ig','nav.dashboard','Dashboard'),('pcm','nav.dashboard','Dashboard'),
 ('en','nav.attendance','Attendance'),('ha','nav.attendance','Halarta'),('yo','nav.attendance','Wíwá sí ilé-ìwé'),('ig','nav.attendance','Ọbịbịa'),('pcm','nav.attendance','Who come school'),
 ('en','nav.fees','Fees'),('ha','nav.fees','Kuɗin makaranta'),('yo','nav.fees','Owó ilé-ìwé'),('ig','nav.fees','Ụgwọ akwụkwọ'),('pcm','nav.fees','School fees'),
 ('en','nav.results','Results'),('ha','nav.results','Sakamako'),('yo','nav.results','Èsì'),('ig','nav.results','Nsonaazụ'),('pcm','nav.results','Result'),
 ('en','action.pay','Pay now'),('ha','action.pay','Biya yanzu'),('yo','action.pay','San owó báyìí'),('ig','action.pay','Kwụọ ugbu a'),('pcm','action.pay','Pay now now'),
 ('en','action.save','Save'),('ha','action.save','Ajiye'),('yo','action.save','Fi pamọ́'),('ig','action.save','Chekwaa'),('pcm','action.save','Save am'),
 ('en','msg.absent','Your child was absent today'),('ha','msg.absent','Yaronku bai zo makaranta yau ba'),('yo','msg.absent','Ọmọ yín kò wá sí ilé-ìwé lónìí'),('ig','msg.absent','Nwa gị abịaghị ụlọ akwụkwọ taa'),('pcm','msg.absent','Your pikin no come school today'),
 ('en','msg.offline','You are offline. Changes will sync.'),('ha','msg.offline','Ba ka kan layi. Za a daidaita canje-canje.'),('yo','msg.offline','O kò sí lórí ayélujára. Àwọn ìyípadà yóò ṣiṣẹ́pọ̀.'),('ig','msg.offline','Ị nọghị n''ịntanetị. A ga-emekọrịta mgbanwe.'),('pcm','msg.offline','Network no dey. We go sync am later.')
ON CONFLICT (locale, key) DO NOTHING;
CREATE TABLE IF NOT EXISTS public.user_locales (user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE, locale text NOT NULL CHECK (locale IN ('en','ha','yo','ig','pcm')), updated_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION public.set_my_locale(p_locale text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.user_locales (user_id, locale) VALUES (auth.uid(), p_locale) ON CONFLICT (user_id) DO UPDATE SET locale = EXCLUDED.locale, updated_at = now();
END $$;
CREATE OR REPLACE FUNCTION public.ui_strings(p_locale text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_object_agg(e.key, coalesce(l.text, e.text)), '{}'::jsonb) FROM public.ui_translations e
    LEFT JOIN public.ui_translations l ON l.key = e.key AND l.locale = p_locale WHERE e.locale = 'en' $$;

-- ===== RLS / grants / audit =====
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['ussd_sessions','ivr_calls','alumni_profiles','donation_campaigns','donations','school_locations','gov_jurisdictions','gov_viewers','gov_data_sharing','ui_translations','user_locales'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t); EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated, service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_read ON public.%1$I', t);
    IF t <> 'ussd_sessions' THEN EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', t); END IF;
    IF t NOT IN ('ussd_sessions','ui_translations') THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_audit ON public.%1$I', t);
      EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.scholar_audit()', t);
    END IF;
  END LOOP; END $$;
GRANT SELECT ON public.ui_translations TO anon;
CREATE POLICY ivr_calls_read ON public.ivr_calls FOR SELECT TO authenticated USING (public.scholar_can(school_id, 'comms.broadcast'));
CREATE POLICY alumni_profiles_read ON public.alumni_profiles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.scholar_can(school_id, 'alumni.manage'));
CREATE POLICY donation_campaigns_read ON public.donation_campaigns FOR SELECT TO authenticated USING (school_id = public.get_my_school_id() OR EXISTS (SELECT 1 FROM public.alumni_profiles a WHERE a.school_id = donation_campaigns.school_id AND a.user_id = auth.uid()));
CREATE POLICY donations_read ON public.donations FOR SELECT TO authenticated USING (public.scholar_can(school_id, 'alumni.manage') OR public.scholar_can(school_id, 'reports.financial'));
CREATE POLICY school_locations_read ON public.school_locations FOR SELECT TO authenticated USING (true);
CREATE POLICY gov_jurisdictions_read ON public.gov_jurisdictions FOR SELECT TO authenticated USING (true);
CREATE POLICY gov_viewers_read ON public.gov_viewers FOR SELECT TO authenticated USING (user_id = auth.uid() OR coalesce(public.is_super_admin(), false));
CREATE POLICY gov_data_sharing_read ON public.gov_data_sharing FOR SELECT TO authenticated USING (public.can_administer_org(school_id) OR coalesce(public.is_super_admin(), false));
CREATE POLICY ui_translations_read ON public.ui_translations FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY user_locales_read ON public.user_locales FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP TRIGGER IF EXISTS trg_donations_append_only ON public.donations;
CREATE TRIGGER trg_donations_append_only BEFORE UPDATE OR DELETE ON public.donations FOR EACH ROW EXECUTE FUNCTION public.append_only_guard();
REVOKE ALL ON FUNCTION public._norm_phone(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ussd_handle(text, text, text), public.ivr_queue_absence_calls(uuid, date, text), public.alumni_register(uuid, text, int, text, text, boolean, uuid),
  public.donation_campaign_create(uuid, text, numeric, date), public.donation_confirm_online(uuid, numeric, text, text, uuid, boolean), public.donation_record_offline(uuid, numeric, text, text, text),
  public.donation_campaign_progress(uuid), public.gov_viewer_grant(uuid, uuid), public.gov_sharing_set(uuid, uuid, boolean), public.gov_dashboard(uuid, text), public.set_my_locale(text), public.ui_strings(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ussd_handle(text, text, text), public.donation_confirm_online(uuid, numeric, text, text, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.ivr_queue_absence_calls(uuid, date, text), public.alumni_register(uuid, text, int, text, text, boolean, uuid), public.donation_campaign_create(uuid, text, numeric, date),
  public.donation_record_offline(uuid, numeric, text, text, text), public.gov_viewer_grant(uuid, uuid), public.gov_sharing_set(uuid, uuid, boolean), public.gov_dashboard(uuid, text), public.set_my_locale(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.donation_campaign_progress(uuid), public.ui_strings(text) TO anon, authenticated;
COMMIT;
