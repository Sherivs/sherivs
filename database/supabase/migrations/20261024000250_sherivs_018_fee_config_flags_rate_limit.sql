-- SHERIVS-018 (Wave 1): configurable Paystack fee model (education rate default), feature flags
-- for provider adapters (live sends stubbed off; Paystack live locked), onboarding rate limiting,
-- and shared Scholar helpers (scholar_can, scholar_audit) used by later waves.
-- Writes only through SECURITY DEFINER RPCs; every change audited into audit_logs (chained by 016).
BEGIN;

-- Shared helpers ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scholar_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_org uuid; v_id uuid; v_actor uuid := auth.uid(); j jsonb := to_jsonb(coalesce(NEW, OLD));
BEGIN
  v_org := coalesce((j->>'school_id')::uuid, (j->>'org_id')::uuid);
  IF v_org IS NULL OR NOT EXISTS (SELECT 1 FROM public.schools WHERE id = v_org) THEN RETURN NULL; END IF;
  BEGIN v_id := (j->>'id')::uuid; EXCEPTION WHEN others THEN v_id := NULL; END;
  INSERT INTO public.audit_logs (school_id, user_id, action, table_name, record_id, old_value, new_value)
  VALUES (v_org, CASE WHEN EXISTS (SELECT 1 FROM public.users WHERE id = v_actor) THEN v_actor END,
          'scholar.' || TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME, v_id,
          CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) || jsonb_build_object('actor', v_actor) END);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.scholar_audit() FROM PUBLIC, anon, authenticated;

-- Legacy role -> permission bridge so schools that have not yet assigned catalog roles keep working.
CREATE OR REPLACE FUNCTION public.scholar_can(p_org uuid, p_perm text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r text;
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' OR coalesce(public.is_super_admin(), false) THEN RETURN true; END IF;
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF public.has_permission(p_org, p_perm) THEN RETURN true; END IF;
  IF public.get_my_school_id() IS DISTINCT FROM p_org THEN RETURN false; END IF;
  r := public.get_my_role();
  -- separation-of-duty permissions are never granted by the legacy bridge
  IF p_perm IN ('payroll.approve', 'audit.view', 'roles.assign', 'roles.configure', 'malpractice.decide') THEN RETURN false; END IF;
  RETURN CASE
    WHEN r IN ('admin', 'principal') THEN true
    WHEN r = 'bursar' THEN p_perm ~ '^(fees|payments|wallet|expenses|budget|payroll\.prepare|reports\.financial|procurement\.request|inventory|assets)'
    WHEN r = 'teacher' THEN p_perm IN ('attendance.take', 'attendance.view', 'grades.enter', 'grades.view', 'exams.invigilate', 'lesson_notes.submit',
                                       'timetable.view', 'students.view', 'comms.send_class', 'cbt.manage', 'hr.leave_request', 'payroll.view_own', 'self.view_own')
    WHEN r IN ('parent', 'student') THEN p_perm IN ('self.view_own', 'children.view', 'ai_tutor.use', 'timetable.view')
    ELSE false END;
END $$;
REVOKE ALL ON FUNCTION public.scholar_can(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scholar_can(uuid, text) TO authenticated, service_role;

-- 1. Payment fee configuration ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_fee_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.schools(id) ON DELETE CASCADE,          -- NULL = platform default
  mode text NOT NULL DEFAULT 'education' CHECK (mode IN ('education', 'standard')),
  edu_card_pct numeric NOT NULL DEFAULT 0.7 CHECK (edu_card_pct BETWEEN 0 AND 5),
  edu_card_cap numeric NOT NULL DEFAULT 1500 CHECK (edu_card_cap >= 0),
  edu_other_flat numeric NOT NULL DEFAULT 300 CHECK (edu_other_flat >= 0),
  std_pct numeric NOT NULL DEFAULT 1.5 CHECK (std_pct BETWEEN 0 AND 5),
  std_flat numeric NOT NULL DEFAULT 100 CHECK (std_flat >= 0),
  std_flat_waived_below numeric NOT NULL DEFAULT 2500,
  std_cap numeric NOT NULL DEFAULT 2000 CHECK (std_cap >= 0),
  fee_bearer text NOT NULL DEFAULT 'sherivs' CHECK (fee_bearer IN ('sherivs', 'school', 'payer')),
  note text,
  updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS payment_fee_config_scope ON public.payment_fee_config ((coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid)));
INSERT INTO public.payment_fee_config (org_id, note) SELECT NULL, 'Paystack education rate (assumption): 0.7% cap NGN1,500 local card; NGN300 flat other channels'
 WHERE NOT EXISTS (SELECT 1 FROM public.payment_fee_config WHERE org_id IS NULL);

CREATE OR REPLACE FUNCTION public.paystack_fee(p_org uuid, p_amount numeric, p_channel text DEFAULT 'card')
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.payment_fee_config;
BEGIN
  SELECT * INTO c FROM public.payment_fee_config WHERE org_id = p_org;
  IF NOT FOUND THEN SELECT * INTO c FROM public.payment_fee_config WHERE org_id IS NULL; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN 0; END IF;
  IF c.mode = 'education' THEN
    RETURN CASE WHEN p_channel = 'card' THEN round(least(p_amount * c.edu_card_pct / 100, c.edu_card_cap), 2) ELSE c.edu_other_flat END;
  END IF;
  RETURN round(least(p_amount * c.std_pct / 100 + CASE WHEN p_amount < c.std_flat_waived_below THEN 0 ELSE c.std_flat END, c.std_cap), 2);
END $$;
REVOKE ALL ON FUNCTION public.paystack_fee(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.paystack_fee(uuid, numeric, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_payment_fee_config(p_org uuid, p_config jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.payment_fee_config;
BEGIN
  IF NOT (coalesce(public.is_super_admin(), false) OR coalesce(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'not allowed: only Sherivs platform staff set payment fees' USING ERRCODE = '42501'; END IF;
  SELECT * INTO d FROM public.payment_fee_config WHERE org_id IS NULL;
  d := jsonb_populate_record(d, p_config - 'id' - 'org_id' - 'updated_at' - 'updated_by');
  INSERT INTO public.payment_fee_config (org_id, mode, edu_card_pct, edu_card_cap, edu_other_flat, std_pct, std_flat, std_flat_waived_below, std_cap, fee_bearer, note, updated_by)
  VALUES (p_org, d.mode, d.edu_card_pct, d.edu_card_cap, d.edu_other_flat, d.std_pct, d.std_flat, d.std_flat_waived_below, d.std_cap, d.fee_bearer, d.note, auth.uid())
  ON CONFLICT ((coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid))) DO UPDATE SET
    mode = EXCLUDED.mode, edu_card_pct = EXCLUDED.edu_card_pct, edu_card_cap = EXCLUDED.edu_card_cap, edu_other_flat = EXCLUDED.edu_other_flat,
    std_pct = EXCLUDED.std_pct, std_flat = EXCLUDED.std_flat, std_flat_waived_below = EXCLUDED.std_flat_waived_below, std_cap = EXCLUDED.std_cap,
    fee_bearer = EXCLUDED.fee_bearer, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = now();
END $$;
REVOKE ALL ON FUNCTION public.set_payment_fee_config(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_payment_fee_config(uuid, jsonb) TO authenticated, service_role;

-- 2. Feature flags (provider adapters stay stubbed until a live account exists) -------------
CREATE TABLE IF NOT EXISTS public.feature_flags (
  key text NOT NULL, org_id uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false, locked boolean NOT NULL DEFAULT false, description text,
  updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS feature_flags_scope ON public.feature_flags (key, (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid)));
INSERT INTO public.feature_flags (key, enabled, locked, description) VALUES
  ('paystack_live', false, true, 'Paystack stays on the test key. Unlock only by a reviewed migration.'),
  ('sms_live', false, false, 'Send SMS through the live gateway; off = stub adapter records the message only'),
  ('whatsapp_live', false, false, 'Send WhatsApp Cloud API messages; off = stub adapter'),
  ('voice_live', false, false, 'Place AI voice calls; off = stub'),
  ('ussd_live', false, false, 'Serve the USSD menu from the live aggregator; off = simulator only'),
  ('sentry', true, false, 'Client and server error reporting (no-op without a DSN)'),
  ('status_page', true, false, 'Public /status page'),
  ('leakage_blocks_results', false, false, 'Unsettled platform-fee leakage blocks result publishing (needs contract clause)')
ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION public.feature_flags_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.locked THEN RAISE EXCEPTION 'locked flag % cannot be removed', OLD.key; END IF; RETURN OLD; END IF;
  IF EXISTS (SELECT 1 FROM public.feature_flags f WHERE f.key = NEW.key AND f.org_id IS NULL AND f.locked)
     AND (TG_OP = 'INSERT' AND NEW.org_id IS NOT NULL OR TG_OP = 'UPDATE' AND (NEW.enabled IS DISTINCT FROM OLD.enabled OR NEW.locked IS DISTINCT FROM OLD.locked))
     AND current_setting('sherivs.unlock_flag', true) IS DISTINCT FROM NEW.key THEN
    RAISE EXCEPTION 'flag % is locked', NEW.key USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_feature_flags_guard ON public.feature_flags;
CREATE TRIGGER trg_feature_flags_guard BEFORE INSERT OR UPDATE OR DELETE ON public.feature_flags FOR EACH ROW EXECUTE FUNCTION public.feature_flags_guard();

CREATE OR REPLACE FUNCTION public.flag_on(p_key text, p_org uuid DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT enabled FROM public.feature_flags WHERE key = p_key AND org_id = p_org),
                  (SELECT enabled FROM public.feature_flags WHERE key = p_key AND org_id IS NULL), false);
$$;
CREATE OR REPLACE FUNCTION public.flag_set(p_key text, p_org uuid, p_enabled boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT (coalesce(public.is_super_admin(), false) OR coalesce(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.feature_flags WHERE key = p_key AND org_id IS NULL) THEN RAISE EXCEPTION 'unknown flag %', p_key; END IF;
  IF p_org IS NULL THEN UPDATE public.feature_flags SET enabled = p_enabled, updated_by = auth.uid(), updated_at = now() WHERE key = p_key AND org_id IS NULL;
  ELSE INSERT INTO public.feature_flags (key, org_id, enabled, updated_by) VALUES (p_key, p_org, p_enabled, auth.uid())
       ON CONFLICT (key, (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid))) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now();
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.flag_on(text, uuid), public.flag_set(text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.flag_on(text, uuid), public.flag_set(text, uuid, boolean) TO authenticated, service_role;

-- 3. Rate limiting (onboarding abuse) -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rate_limit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, bucket text NOT NULL, subject text NOT NULL, at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS rate_limit_events_lookup ON public.rate_limit_events (bucket, subject, at DESC);
CREATE OR REPLACE FUNCTION public.rate_limit_take(p_bucket text, p_subject text, p_max int, p_window interval) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_bucket || ':' || p_subject));
  SELECT count(*) INTO n FROM public.rate_limit_events WHERE bucket = p_bucket AND subject = p_subject AND at > now() - p_window;
  IF n >= p_max THEN RETURN false; END IF;
  INSERT INTO public.rate_limit_events (bucket, subject) VALUES (p_bucket, p_subject);
  DELETE FROM public.rate_limit_events WHERE bucket = p_bucket AND subject = p_subject AND at < now() - p_window * 4;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.rate_limit_take(text, text, int, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_take(text, text, int, interval) TO service_role;

CREATE OR REPLACE FUNCTION public.schools_onboarding_rate_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.is_super_admin(), false) THEN RETURN NEW; END IF;
  IF NOT public.rate_limit_take('onboarding.user', auth.uid()::text, 3, interval '1 day') THEN
    RAISE EXCEPTION 'rate_limited: at most 3 schools per account per day' USING ERRCODE = 'P0001'; END IF;
  IF NOT public.rate_limit_take('onboarding.global', 'all', 50, interval '1 hour') THEN
    RAISE EXCEPTION 'rate_limited: onboarding is busy, try again shortly' USING ERRCODE = 'P0001'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_schools_onboarding_rate_limit ON public.schools;
CREATE TRIGGER trg_schools_onboarding_rate_limit BEFORE INSERT ON public.schools FOR EACH ROW EXECUTE FUNCTION public.schools_onboarding_rate_limit();

-- RLS, grants, audit ------------------------------------------------------------------------
ALTER TABLE public.payment_fee_config ENABLE ROW LEVEL SECURITY; ALTER TABLE public.payment_fee_config FORCE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY; ALTER TABLE public.feature_flags FORCE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_events ENABLE ROW LEVEL SECURITY; ALTER TABLE public.rate_limit_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_fee_config, public.feature_flags, public.rate_limit_events FROM anon, authenticated, service_role;
GRANT SELECT ON public.payment_fee_config, public.feature_flags TO authenticated, service_role;
DROP POLICY IF EXISTS payment_fee_config_read ON public.payment_fee_config;
CREATE POLICY payment_fee_config_read ON public.payment_fee_config FOR SELECT TO authenticated
  USING (org_id IS NULL OR org_id = public.get_my_school_id() OR coalesce(public.is_super_admin(), false));
DROP POLICY IF EXISTS feature_flags_read ON public.feature_flags;
CREATE POLICY feature_flags_read ON public.feature_flags FOR SELECT TO authenticated
  USING (org_id IS NULL OR org_id = public.get_my_school_id() OR coalesce(public.is_super_admin(), false));

CREATE OR REPLACE FUNCTION public.platform_config_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.super_admin_logs (admin_id, action, details)
  SELECT auth.uid(), 'config.' || TG_TABLE_NAME || '.' || lower(TG_OP),
         jsonb_build_object('before', CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END, 'after', CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END)
  WHERE EXISTS (SELECT 1 FROM public.super_admins WHERE id = auth.uid());
  RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['payment_fee_config','feature_flags'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_audit ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.scholar_audit()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_platform_audit ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_platform_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.platform_config_audit()', t);
  END LOOP; END $$;
COMMIT;
