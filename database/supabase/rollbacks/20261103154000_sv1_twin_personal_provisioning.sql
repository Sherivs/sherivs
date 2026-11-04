-- Rollback: 20261103154000_sv1_twin_personal_provisioning.sql
-- Destructive: drops personal-twin identity rows. Existing cg_memory_* scopes
-- and records are intentionally retained; their lifecycle remains CORE-06-owned.

BEGIN;

DROP FUNCTION IF EXISTS public.cg_personal_twin_provision(uuid, uuid);
DROP POLICY IF EXISTS cg_personal_twin_select_own_active_tenant ON public.cg_personal_twin;
DROP TABLE IF EXISTS public.cg_personal_twin;

COMMIT;
