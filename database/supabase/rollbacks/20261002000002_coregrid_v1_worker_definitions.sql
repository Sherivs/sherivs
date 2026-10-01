-- =============================================================================
-- Rollback: 20261002000002_coregrid_v1_worker_definitions.sql (MISSION-R-40)
-- Status: AUTHORED, NOT APPLIED.
-- WARNING: destructive — removes the persistent governed worker definition
-- substrate. After rollback, capability declarations, authority bounds and
-- the append-only delegation history are unrecoverable: Delegation ->
-- Worker Execution attribution (CTO RULING-3 chain) and G-014 survival
-- evidence is destroyed. For retiring the schema, not for undoing single
-- executions (matches the org-model / workspace-persistence rollback
-- discipline).
--
-- Rollback order matters: delegation history and capability declarations
-- reference the definition (composite-FK CASCADE), so the definition table
-- is dropped LAST. Nothing else in the substrate references these tables;
-- no RPC bodies need restoring (the migration is table-authoring only,
-- redefinition-free).
-- =============================================================================

DROP TABLE IF EXISTS public.cg_worker_delegation;
DROP TABLE IF EXISTS public.cg_worker_capability;
DROP TABLE IF EXISTS public.cg_worker_definition;
