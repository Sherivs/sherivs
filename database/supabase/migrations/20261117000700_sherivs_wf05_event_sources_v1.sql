-- WF-05: V1 organizational workflow event sources.
-- Only source rows with verified, applied lifecycle columns are registered.
BEGIN;

DO $prereq$
BEGIN
  IF to_regclass('public.wf_definition') IS NULL
     OR to_regclass('public.wf_version') IS NULL
     OR to_regclass('public.wf_trigger_binding') IS NULL
     OR to_regclass('public.wf_event') IS NULL
     OR to_regclass('public.wf_run') IS NULL
     OR to_regclass('public.wf_step_run') IS NULL
     OR to_regclass('public.wf_run_event') IS NULL
     OR to_regclass('public.wf_approval') IS NULL
     OR to_regclass('public.wf_template') IS NULL
     OR to_regclass('public.wf_org_settings') IS NULL
     OR to_regprocedure('public.wf_can(uuid,text)') IS NULL
     OR to_regprocedure('public.wf_version_sod_guard()') IS NULL
     OR to_regprocedure('public.wf_claim_due_events(text,integer,integer)') IS NULL
     OR to_regprocedure('public.wf_claim_due_steps(text,integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'WF-05: WF-01, WF-02 or WF-03 prerequisites are missing';
  END IF;
  IF to_regclass('public.wf_event_source') IS NOT NULL
     OR to_regprocedure('public.wf_emit_event(uuid,text,text,text,text,jsonb)') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_proc
        WHERE pronamespace = 'public'::regnamespace
          AND proname LIKE 'wf05_on_%'
     ) THEN
    RAISE EXCEPTION 'WF-05: one or more WF-05 objects already exist';
  END IF;
END
$prereq$;

CREATE TABLE public.wf_event_source (
  event_type   text PRIMARY KEY CHECK (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,5}$'),
  domain       text NOT NULL CHECK (domain ~ '^[a-z][a-z0-9_]{1,63}$'),
  source_table text NOT NULL CHECK (source_table ~ '^[a-z][a-z0-9_]{1,63}$'),
  description  text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 500),
  payload_keys text[] NOT NULL CHECK (
    cardinality(payload_keys) > 0
    AND array_position(payload_keys, '') IS NULL
    AND array_position(payload_keys, NULL) IS NULL
  ),
  enabled      boolean NOT NULL DEFAULT true
);
ALTER TABLE public.wf_event_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_event_source FORCE ROW LEVEL SECURITY;
CREATE POLICY wf_event_source_read ON public.wf_event_source
  FOR SELECT TO authenticated USING (true);
CREATE POLICY wf_event_source_service ON public.wf_event_source
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.wf_event_source FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.wf_event_source TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON TABLE public.wf_event_source TO service_role;

DO $seed$
BEGIN
  IF to_regclass('public.cg_fee_invoice') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cg_fee_invoice' AND column_name IN ('id', 'school_id', 'amount_kobo') GROUP BY table_name HAVING count(*) = 3) THEN
    INSERT INTO public.wf_event_source (event_type, domain, source_table, description, payload_keys)
    VALUES ('fees.invoice_issued', 'fees', 'cg_fee_invoice', 'A fee invoice was issued.', ARRAY['amount_kobo', 'invoice_id']);
  ELSE
    RAISE NOTICE 'WF-05 deferred fees.invoice_issued: verified invoice columns are unavailable';
  END IF;

  IF to_regclass('public.cg_fee_payment') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cg_fee_payment' AND column_name IN ('id', 'school_id', 'invoice_id', 'amount_kobo', 'method') GROUP BY table_name HAVING count(*) = 5) THEN
    INSERT INTO public.wf_event_source (event_type, domain, source_table, description, payload_keys)
    VALUES ('payment.succeeded', 'payment', 'cg_fee_payment', 'A fee payment was recorded.', ARRAY['amount_kobo', 'invoice_id', 'method', 'payment_id']);
  ELSE
    RAISE NOTICE 'WF-05 deferred payment.succeeded: verified payment columns are unavailable';
  END IF;

  IF to_regclass('public.wallet_ledger') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'wallet_ledger' AND column_name IN ('id', 'school_id', 'kind', 'amount') GROUP BY table_name HAVING count(*) = 4) THEN
    INSERT INTO public.wf_event_source (event_type, domain, source_table, description, payload_keys)
    VALUES ('wallet.topup_succeeded', 'wallet', 'wallet_ledger', 'A wallet top-up was credited.', ARRAY['amount_minor', 'ledger_id']);
  ELSE
    RAISE NOTICE 'WF-05 deferred wallet.topup_succeeded: verified wallet ledger columns are unavailable';
  END IF;

  IF to_regclass('public.wallet_alerts') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'wallet_alerts' AND column_name IN ('id', 'school_id', 'kind') GROUP BY table_name HAVING count(*) = 3) THEN
    INSERT INTO public.wf_event_source (event_type, domain, source_table, description, payload_keys)
    VALUES ('wallet.low_balance', 'wallet', 'wallet_alerts', 'A low-balance wallet alert was recorded.', ARRAY['alert_id', 'kind']);
  ELSE
    RAISE NOTICE 'WF-05 deferred wallet.low_balance: verified wallet alert columns are unavailable';
  END IF;

  IF to_regclass('public.class_attendance_marks') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'class_attendance_marks' AND column_name IN ('id', 'school_id', 'status') GROUP BY table_name HAVING count(*) = 3) THEN
    INSERT INTO public.wf_event_source (event_type, domain, source_table, description, payload_keys)
    VALUES ('attendance.marked_absent', 'attendance', 'class_attendance_marks', 'An attendance mark changed to absent.', ARRAY['attendance_id', 'status']);
  ELSE
    RAISE NOTICE 'WF-05 deferred attendance.marked_absent: verified attendance columns are unavailable';
  END IF;

  IF to_regclass('public.admission_stage_events') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'admission_stage_events' AND column_name IN ('id', 'school_id', 'application_id', 'from_stage', 'to_stage') GROUP BY table_name HAVING count(*) = 5) THEN
    INSERT INTO public.wf_event_source (event_type, domain, source_table, description, payload_keys)
    VALUES ('admissions.stage_changed', 'admissions', 'admission_stage_events', 'An admissions stage transition was recorded.', ARRAY['application_id', 'from_stage', 'to_stage']);
  ELSE
    RAISE NOTICE 'WF-05 deferred admissions.stage_changed: verified admissions columns are unavailable';
  END IF;

  IF to_regclass('public.grades') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'grades' AND column_name IN ('id', 'school_id', 'is_published') GROUP BY table_name HAVING count(*) = 3) THEN
    INSERT INTO public.wf_event_source (event_type, domain, source_table, description, payload_keys)
    VALUES ('results.published', 'results', 'grades', 'A grade record was published.', ARRAY['grades_id']);
  ELSE
    RAISE NOTICE 'WF-05 deferred results.published: verified publication columns are unavailable';
  END IF;
END
$seed$;

CREATE FUNCTION public.wf_emit_event(
  p_org uuid,
  p_type text,
  p_source text,
  p_dedupe text,
  p_subject text,
  p_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_enabled boolean;
  v_payload_keys text[];
  v_actual_keys text[];
BEGIN
  SELECT s.workflows_enabled INTO v_enabled
    FROM public.wf_org_settings s
   WHERE s.org_id = p_org;
  IF coalesce(v_enabled, false) IS NOT TRUE THEN
    RETURN;
  END IF;

  SELECT e.payload_keys INTO v_payload_keys
    FROM public.wf_event_source e
   WHERE e.event_type = p_type AND e.enabled;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'WF-05 event payload must be an object';
  END IF;

  SELECT ARRAY(SELECT key FROM jsonb_object_keys(p_payload) AS keys(key) ORDER BY key)
    INTO v_actual_keys;
  SELECT ARRAY(SELECT key FROM unnest(v_payload_keys) AS expected(key) ORDER BY key)
    INTO v_payload_keys;
  IF v_actual_keys IS DISTINCT FROM v_payload_keys THEN
    RAISE EXCEPTION 'WF-05 event payload keys do not match the catalog';
  END IF;

  INSERT INTO public.wf_event (org_id, event_type, source, dedupe_key, subject_ref, payload)
  VALUES (p_org, p_type, p_source, p_dedupe, p_subject, p_payload)
  ON CONFLICT (org_id, dedupe_key) DO NOTHING;
END
$$;
REVOKE ALL ON FUNCTION public.wf_emit_event(uuid, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wf_emit_event(uuid, text, text, text, text, jsonb) TO service_role;

CREATE FUNCTION public.wf05_on_cg_fee_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.wf_emit_event(
      NEW.school_id, 'fees.invoice_issued', 'cg_fee_invoice',
      'fees.invoice_issued:cg_fee_invoice:' || NEW.id::text || ':issued',
      NEW.id::text, jsonb_build_object('invoice_id', NEW.id, 'amount_kobo', NEW.amount_kobo)
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'WF-05 event emission failed in trigger %', TG_NAME;
  RETURN NEW;
END
$$;

CREATE FUNCTION public.wf05_on_cg_fee_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.wf_emit_event(
      NEW.school_id, 'payment.succeeded', 'cg_fee_payment',
      'payment.succeeded:cg_fee_payment:' || NEW.id::text || ':recorded',
      NEW.id::text,
      jsonb_build_object('payment_id', NEW.id, 'invoice_id', NEW.invoice_id,
                         'amount_kobo', NEW.amount_kobo, 'method', NEW.method)
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'WF-05 event emission failed in trigger %', TG_NAME;
  RETURN NEW;
END
$$;

CREATE FUNCTION public.wf05_on_wallet_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.kind = 'topup' AND NEW.amount > 0 THEN
    PERFORM public.wf_emit_event(
      NEW.school_id, 'wallet.topup_succeeded', 'wallet_ledger',
      'wallet.topup_succeeded:wallet_ledger:' || NEW.id::text || ':topup',
      NEW.id::text,
      jsonb_build_object('ledger_id', NEW.id, 'amount_minor', round(NEW.amount * 100)::bigint)
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'WF-05 event emission failed in trigger %', TG_NAME;
  RETURN NEW;
END
$$;

CREATE FUNCTION public.wf05_on_wallet_alerts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.kind = 'low_balance' THEN
    PERFORM public.wf_emit_event(
      NEW.school_id, 'wallet.low_balance', 'wallet_alerts',
      'wallet.low_balance:wallet_alerts:' || NEW.id::text || ':low_balance',
      NEW.id::text, jsonb_build_object('alert_id', NEW.id, 'kind', NEW.kind)
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'WF-05 event emission failed in trigger %', TG_NAME;
  RETURN NEW;
END
$$;

CREATE FUNCTION public.wf05_on_class_attendance_marks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'absent' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.wf_emit_event(
      NEW.school_id, 'attendance.marked_absent', 'class_attendance_marks',
      'attendance.marked_absent:class_attendance_marks:' || NEW.id::text || ':absent:' ||
        txid_current()::text || ':' || NEW.ctid::text,
      NEW.id::text, jsonb_build_object('attendance_id', NEW.id, 'status', NEW.status)
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'WF-05 event emission failed in trigger %', TG_NAME;
  RETURN NEW;
END
$$;

CREATE FUNCTION public.wf05_on_admission_stage_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.wf_emit_event(
      NEW.school_id, 'admissions.stage_changed', 'admission_stage_events',
      'admissions.stage_changed:admission_stage_events:' || NEW.id::text || ':' || NEW.to_stage,
      NEW.application_id::text,
      jsonb_build_object('application_id', NEW.application_id,
                         'from_stage', NEW.from_stage, 'to_stage', NEW.to_stage)
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'WF-05 event emission failed in trigger %', TG_NAME;
  RETURN NEW;
END
$$;

CREATE FUNCTION public.wf05_on_grades()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.is_published IS TRUE
     AND (TG_OP = 'INSERT' OR OLD.is_published IS DISTINCT FROM NEW.is_published) THEN
    PERFORM public.wf_emit_event(
      NEW.school_id, 'results.published', 'grades',
      'results.published:grades:' || NEW.id::text || ':published:' ||
        txid_current()::text || ':' || NEW.ctid::text,
      NEW.id::text, jsonb_build_object('grades_id', NEW.id)
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'WF-05 event emission failed in trigger %', TG_NAME;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.wf05_on_cg_fee_invoice(),
  public.wf05_on_cg_fee_payment(), public.wf05_on_wallet_ledger(),
  public.wf05_on_wallet_alerts(), public.wf05_on_class_attendance_marks(),
  public.wf05_on_admission_stage_events(), public.wf05_on_grades()
  FROM PUBLIC, anon, authenticated;

DO $triggers$
BEGIN
  IF EXISTS (SELECT 1 FROM public.wf_event_source WHERE event_type = 'fees.invoice_issued') THEN
    EXECUTE 'CREATE TRIGGER wf05_cg_fee_invoice_event AFTER INSERT OR UPDATE ON public.cg_fee_invoice FOR EACH ROW EXECUTE FUNCTION public.wf05_on_cg_fee_invoice()';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wf_event_source WHERE event_type = 'payment.succeeded') THEN
    EXECUTE 'CREATE TRIGGER wf05_cg_fee_payment_event AFTER INSERT OR UPDATE ON public.cg_fee_payment FOR EACH ROW EXECUTE FUNCTION public.wf05_on_cg_fee_payment()';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wf_event_source WHERE event_type = 'wallet.topup_succeeded') THEN
    EXECUTE 'CREATE TRIGGER wf05_wallet_ledger_event AFTER INSERT OR UPDATE ON public.wallet_ledger FOR EACH ROW EXECUTE FUNCTION public.wf05_on_wallet_ledger()';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wf_event_source WHERE event_type = 'wallet.low_balance') THEN
    EXECUTE 'CREATE TRIGGER wf05_wallet_alerts_event AFTER INSERT OR UPDATE ON public.wallet_alerts FOR EACH ROW EXECUTE FUNCTION public.wf05_on_wallet_alerts()';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wf_event_source WHERE event_type = 'attendance.marked_absent') THEN
    EXECUTE 'CREATE TRIGGER wf05_class_attendance_marks_event AFTER INSERT OR UPDATE ON public.class_attendance_marks FOR EACH ROW EXECUTE FUNCTION public.wf05_on_class_attendance_marks()';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wf_event_source WHERE event_type = 'admissions.stage_changed') THEN
    EXECUTE 'CREATE TRIGGER wf05_admission_stage_events_event AFTER INSERT OR UPDATE ON public.admission_stage_events FOR EACH ROW EXECUTE FUNCTION public.wf05_on_admission_stage_events()';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wf_event_source WHERE event_type = 'results.published') THEN
    EXECUTE 'CREATE TRIGGER wf05_grades_event AFTER INSERT OR UPDATE ON public.grades FOR EACH ROW EXECUTE FUNCTION public.wf05_on_grades()';
  END IF;
END
$triggers$;

COMMENT ON TABLE public.wf_event_source IS
  'WF-05 / ADR-111: verified V1 source event types, safe payload keys and per-type enablement.';
COMMENT ON FUNCTION public.wf_emit_event(uuid, text, text, text, text, jsonb) IS
  'WF-05 / ADR-111: inserts a catalogued event only for organizations with workflows enabled.';

COMMIT;
