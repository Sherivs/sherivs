BEGIN;

DO $triggers$
BEGIN
  IF to_regclass('public.cg_fee_invoice') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS wf05_cg_fee_invoice_event ON public.cg_fee_invoice';
  END IF;
  IF to_regclass('public.cg_fee_payment') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS wf05_cg_fee_payment_event ON public.cg_fee_payment';
  END IF;
  IF to_regclass('public.wallet_ledger') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS wf05_wallet_ledger_event ON public.wallet_ledger';
  END IF;
  IF to_regclass('public.wallet_alerts') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS wf05_wallet_alerts_event ON public.wallet_alerts';
  END IF;
  IF to_regclass('public.class_attendance_marks') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS wf05_class_attendance_marks_event ON public.class_attendance_marks';
  END IF;
  IF to_regclass('public.admission_stage_events') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS wf05_admission_stage_events_event ON public.admission_stage_events';
  END IF;
  IF to_regclass('public.grades') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS wf05_grades_event ON public.grades';
  END IF;
END
$triggers$;

DROP FUNCTION IF EXISTS public.wf05_on_cg_fee_invoice();
DROP FUNCTION IF EXISTS public.wf05_on_cg_fee_payment();
DROP FUNCTION IF EXISTS public.wf05_on_wallet_ledger();
DROP FUNCTION IF EXISTS public.wf05_on_wallet_alerts();
DROP FUNCTION IF EXISTS public.wf05_on_class_attendance_marks();
DROP FUNCTION IF EXISTS public.wf05_on_admission_stage_events();
DROP FUNCTION IF EXISTS public.wf05_on_grades();
DROP FUNCTION IF EXISTS public.wf_emit_event(uuid, text, text, text, text, jsonb);
DROP TABLE IF EXISTS public.wf_event_source;

COMMIT;
