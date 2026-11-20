-- NOT APPLIED. Rollback for 20261117000990 (AIN-03 tenant memory and context scopes, ADR-127).
-- Removes the three memory tables, the guards and every AIN-03 function. It refuses to run while a memory item or a ledger
-- row exists: items are tenant data and the ledger is a recorded history (the audit chain keeps its copy either way).
-- Export and remove them deliberately first (retire the items, let the retention pass delete them, or delete them as the
-- owner with the guards disabled). Nothing outside AIN-03 is touched.
BEGIN;

DO $prereq$
BEGIN
  IF to_regclass('public.wf_memory_item') IS NULL
     OR to_regclass('public.wf_memory_change') IS NULL
     OR to_regclass('public.wf_memory_scope_kind') IS NULL
     OR to_regprocedure('public.wf_memory_put(uuid,text,text,text,text,jsonb,integer,boolean)') IS NULL THEN
    RAISE EXCEPTION 'AIN-03 rollback: one or more AIN-03 objects are missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wf_memory_item) OR EXISTS (SELECT 1 FROM public.wf_memory_change) THEN
    RAISE EXCEPTION 'AIN-03 rollback: memory items or ledger rows exist; export them and remove them deliberately first';
  END IF;
END
$prereq$;

DROP TABLE public.wf_memory_change;
DROP TABLE public.wf_memory_item;
DROP TABLE public.wf_memory_scope_kind;

DROP FUNCTION public.wf_memory_put(uuid, text, text, text, text, jsonb, integer, boolean);
DROP FUNCTION public.wf_memory_agent_propose(uuid, text, text, text, jsonb, integer);
DROP FUNCTION public.wf_memory_decide(uuid, uuid, text);
DROP FUNCTION public.wf_memory_retire(uuid, uuid);
DROP FUNCTION public.wf_memory_agent_read(uuid, text, integer);
DROP FUNCTION public.wf_memory_purge_expired(integer);
DROP FUNCTION public.wf_memory_item_guard();
DROP FUNCTION public.wf_memory_item_delete_guard();
DROP FUNCTION public.wf_memory_item_audit();
DROP FUNCTION public.wf_memory_open(text);
DROP FUNCTION public.wf_memory_close();
DROP FUNCTION public.wf_memory_value_ok(text, jsonb);
DROP FUNCTION public.wf_memory_agent_daily_proposals();
DROP FUNCTION public.wf_memory_org_item_cap();

COMMIT;
