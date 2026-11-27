-- NOT APPLIED. Rollback for 20261117000996 (AIN-05 agent console read models, ADR-129).
-- Drops the three read functions. They hold no data and nothing else depends on them, so there is nothing to export first.
BEGIN;

DO $prereq$
BEGIN
  IF to_regprocedure('public.wf_console_agents(uuid)') IS NULL
     OR to_regprocedure('public.wf_console_memory_list(uuid,text,timestamp with time zone,uuid,integer)') IS NULL
     OR to_regprocedure('public.wf_console_safety_list(uuid,text,timestamp with time zone,uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'AIN-05 rollback: one or more AIN-05 objects are missing';
  END IF;
END
$prereq$;

DROP FUNCTION public.wf_console_safety_list(uuid, text, timestamptz, uuid, integer);
DROP FUNCTION public.wf_console_memory_list(uuid, text, timestamptz, uuid, integer);
DROP FUNCTION public.wf_console_agents(uuid);

COMMIT;
