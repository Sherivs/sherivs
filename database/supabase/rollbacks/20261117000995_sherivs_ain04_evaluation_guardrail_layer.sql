-- NOT APPLIED. Rollback for 20261117000995 (AIN-04 evaluation and guardrail layer, ADR-128).
-- Removes the six safety tables, the guards and every AIN-04 function. It refuses to run while a check or a review row
-- exists: those are a recorded history of what was screened and who cleared it (the audit chain keeps its copy either way).
-- Export and remove them deliberately first (as the owner, with the append-only triggers disabled). The reviewed data and
-- the eval runs are reproducible from the migration and are removed without a check. Nothing outside AIN-04 is touched.
BEGIN;

DO $prereq$
BEGIN
  IF to_regclass('public.wf_safety_check') IS NULL
     OR to_regclass('public.wf_safety_review') IS NULL
     OR to_regclass('public.wf_safety_pattern') IS NULL
     OR to_regprocedure('public.wf_safety_check_text(uuid,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'AIN-04 rollback: one or more AIN-04 objects are missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wf_safety_check) OR EXISTS (SELECT 1 FROM public.wf_safety_review) THEN
    RAISE EXCEPTION 'AIN-04 rollback: check or review rows exist; export them and remove them deliberately first';
  END IF;
END
$prereq$;

DROP TABLE public.wf_safety_review;
DROP TABLE public.wf_safety_check;
DROP TABLE public.wf_safety_eval_run;
DROP TABLE public.wf_safety_eval_case;
DROP TABLE public.wf_safety_eval_suite;
DROP TABLE public.wf_safety_pattern;

DROP FUNCTION public.wf_safety_run_eval();
DROP FUNCTION public.wf_safety_check_text(uuid, text, text, text);
DROP FUNCTION public.wf_safety_review_check(uuid, uuid, text, text);
DROP FUNCTION public.wf_safety_check_usable(uuid, text, text);
DROP FUNCTION public.wf_safety_eval_run_guard();
DROP FUNCTION public.wf_safety_check_guard();
DROP FUNCTION public.wf_safety_review_guard();
DROP FUNCTION public.wf_safety_audit();
DROP FUNCTION public.wf_safety_verified();
DROP FUNCTION public.wf_safety_eval_compute(text, integer);
DROP FUNCTION public.wf_safety_suite_sha(text, integer);
DROP FUNCTION public.wf_safety_screen(text, text);
DROP FUNCTION public.wf_safety_norm(text);
DROP FUNCTION public.wf_safety_open(text);
DROP FUNCTION public.wf_safety_close();
DROP FUNCTION public.wf_safety_max_text_chars();
DROP FUNCTION public.wf_safety_run_check_cap();
DROP FUNCTION public.wf_safety_org_daily_cap();
DROP FUNCTION public.wf_safety_eval_daily_cap();

COMMIT;
