-- Rollback for 20261117000400_sherivs_wf01_workflow_engine_schema.sql (WF-01, ADR-103).
--
-- Removes every object the forward migration created, in dependency order, in one transaction.
-- It DROPS the workflow tables and their rows. Run it only while no organization depends on
-- workflows, after exporting any rows that must be kept. It does not touch audit_chain: entries
-- the workflow triggers appended stay, because that chain is append-only by design.
-- It does not touch any existing table, policy, helper or grant.
-- After applying it on a hosted project, delete the ledger row for version 20261117000400 (or the
-- apply-time version it was recorded under) so the ledger check stays accurate.
BEGIN;

DROP FUNCTION IF EXISTS public.wf_claim_due_steps(text, integer, integer);

-- Tables (CASCADE removes their policies, triggers, indexes and the cross-table foreign keys).
DROP TABLE IF EXISTS public.wf_approval CASCADE;
DROP TABLE IF EXISTS public.wf_run_event CASCADE;
DROP TABLE IF EXISTS public.wf_step_run CASCADE;
ALTER TABLE IF EXISTS public.wf_run DROP CONSTRAINT IF EXISTS wf_run_event_fk;
DROP TABLE IF EXISTS public.wf_event CASCADE;
DROP TABLE IF EXISTS public.wf_run CASCADE;
DROP TABLE IF EXISTS public.wf_trigger_binding CASCADE;
ALTER TABLE IF EXISTS public.wf_definition DROP CONSTRAINT IF EXISTS wf_definition_current_version_fk;
DROP TABLE IF EXISTS public.wf_version CASCADE;
DROP TABLE IF EXISTS public.wf_definition CASCADE;

DROP FUNCTION IF EXISTS public.wf_audit_row();
DROP FUNCTION IF EXISTS public.wf_audit_append(uuid, text, text, text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.wf_append_only();
DROP FUNCTION IF EXISTS public.wf_approval_guard();
DROP FUNCTION IF EXISTS public.wf_step_run_guard();
DROP FUNCTION IF EXISTS public.wf_run_guard();
DROP FUNCTION IF EXISTS public.wf_trigger_binding_guard();
DROP FUNCTION IF EXISTS public.wf_version_guard();
DROP FUNCTION IF EXISTS public.wf_definition_guard();
DROP FUNCTION IF EXISTS public.wf_guard_row();
DROP FUNCTION IF EXISTS public.wf_can(uuid, text);

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relname LIKE 'wf\_%' ESCAPE '\' AND c.relkind IN ('r', 'p'))
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname LIKE 'wf\_%' ESCAPE '\') THEN
    RAISE EXCEPTION 'WF-01 rollback: workflow objects remain';
  END IF;
END
$verify$;

COMMIT;
