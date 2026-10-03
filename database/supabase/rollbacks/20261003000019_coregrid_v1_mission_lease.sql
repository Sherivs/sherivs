-- =============================================================================
-- Rollback of 20261003000019_coregrid_v1_mission_lease.sql
-- (V1-003 — mission lease substrate: cg_mission_lease, cg_worker_delegation_grant, cg_worker_quarantine)
-- =============================================================================
-- GENUINE INVERSE: the migration creates three tables, their indexes, one
-- trigger, and three privilege revocations. Its inverse drops the tables in
-- child-before-parent order (the delegation-grant and quarantine tables carry
-- FKs into cg_worker_definition; the lease table carries a composite FK into
-- cg_execution_record) — DROP TABLE removes their indexes, trigger, and RLS
-- properties as catalog consequences of the table itself. The re-asserted
-- DEFAULT PRIVILEGES grants below restore the pre-migration privilege state
-- the project's ALTER DEFAULT PRIVILEGES confers on new public tables (the
-- posture 20261003000018 documents), so the inverse is exact.
--
-- ROLLBACK PLAN (Constitution §38):
--   1. quiesce the workforce host (no runWorkerHost instance may hold an
--      active lease; the lease rows are execution bookkeeping, not canonical
--      truth — canonical mission state lives in cg_execution_record);
--   2. run this file in one transaction;
--   3. verify: the three tables absent, cg_execution_record untouched.
-- DATA NOTE: dropping cg_mission_lease discards lease bookkeeping (attempt
-- counters, retry_not_before). cg_execution_record retains the admitted /
-- denied / rolled_back canonical state, so no canonical truth is lost.

BEGIN;

DROP TRIGGER IF EXISTS cg_mission_lease_touch ON public.cg_mission_lease;
DROP TABLE IF EXISTS public.cg_worker_quarantine;
DROP TABLE IF EXISTS public.cg_worker_delegation_grant;
DROP TABLE IF EXISTS public.cg_mission_lease;

-- Restore the pre-migration privilege posture: the project's ALTER DEFAULT
-- PRIVILEGES confers ALL on new public tables to anon/authenticated (the
-- defective-but-real state 20261003000018 documented); the inverse of this
-- migration's REVOKEs re-asserts exactly that per table.
GRANT ALL ON TABLE public.cg_mission_lease TO anon, authenticated;
GRANT ALL ON TABLE public.cg_worker_delegation_grant TO anon, authenticated;
GRANT ALL ON TABLE public.cg_worker_quarantine TO anon, authenticated;

COMMIT;
