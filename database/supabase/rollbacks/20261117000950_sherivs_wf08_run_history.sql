-- NOT APPLIED. Rollback for 20261117000950 (WF-08 run history, retry and cancel, ADR-123).
-- Drops the WF-08 functions, the outbox run guard and the retry linkage on wf_run. WF-08 adds no table, so no
-- evidence table is lost. Run rows, step rows, timeline events and audit_chain entries that WF-08 wrote stay
-- (the timeline and the chain are append-only). It refuses to run while retry runs exist, because dropping the
-- linkage would silently lose which run continued which: export the links
--   SELECT id, retry_of_run_id, retry_of_step_id, retry_generation FROM public.wf_run WHERE retry_of_run_id IS NOT NULL
-- and remove the retry runs (or keep WF-08) first.
BEGIN;

DO $prereq$
BEGIN
  IF to_regprocedure('public.wf_run_cancel(uuid,uuid,text)') IS NULL
     OR to_regprocedure('public.wf_run_retry(uuid,uuid,text)') IS NULL
     OR to_regprocedure('public.wf_run_history_list(uuid,text,text,timestamp with time zone,integer)') IS NULL
     OR to_regprocedure('public.wf_run_history_detail(uuid,uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'wf_run' AND column_name = 'retry_of_run_id') THEN
    RAISE EXCEPTION 'WF-08 rollback: one or more WF-08 objects are missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wf_run WHERE retry_of_run_id IS NOT NULL OR retry_of_step_id IS NOT NULL) THEN
    RAISE EXCEPTION 'WF-08 rollback: retry runs exist; export their links and remove them first';
  END IF;
END
$prereq$;

DROP FUNCTION public.wf_run_history_detail(uuid, uuid);
DROP FUNCTION public.wf_run_history_list(uuid, text, text, timestamptz, integer);
DROP FUNCTION public.wf_run_retry(uuid, uuid, text);
DROP FUNCTION public.wf_run_cancel(uuid, uuid, text);
DROP FUNCTION public.wf_retry_blockers(uuid, uuid);
DROP FUNCTION public.wf_run_control_reason_ok(text);
DROP FUNCTION public.wf_redact_event_detail(jsonb);

DROP TRIGGER wf_action_sandbox_outbox_20_run_guard ON public.wf_action_sandbox_outbox;
DROP FUNCTION public.wf_action_sandbox_outbox_run_guard();

DROP TRIGGER wf_run_20_retry_guard ON public.wf_run;
DROP FUNCTION public.wf_run_retry_guard();

DROP INDEX public.wf_run_retry_source_idx;
DROP INDEX public.wf_run_one_retry_per_step;
ALTER TABLE public.wf_run
  DROP CONSTRAINT wf_run_retry_fields,
  DROP CONSTRAINT wf_run_retry_step_fk,
  DROP CONSTRAINT wf_run_retry_run_fk;
ALTER TABLE public.wf_run
  DROP COLUMN retry_generation,
  DROP COLUMN retry_of_step_id,
  DROP COLUMN retry_of_run_id;

COMMIT;
