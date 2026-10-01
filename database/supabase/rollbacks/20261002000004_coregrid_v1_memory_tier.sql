-- =============================================================================
-- Rollback: 20261002000004_coregrid_v1_memory_tier.sql (MISSION-R-36)
-- Status: AUTHORED, NOT APPLIED.
-- WARNING: destructive — removes the durable practical/organizational memory
-- tier. After rollback, durable memory records, declared scopes and the
-- append-only access audit are unrecoverable: the Outcome -> Memory ->
-- Observation loop tail (J-016) loses its only durable node and J-017 access
-- evidence is destroyed. For retiring the schema, not for undoing single
-- retrievals (matches the worker-definitions / org-model rollback discipline).
--
-- Rollback order matters: memory records reference scopes (composite-FK
-- RESTRICT), so the record table is dropped BEFORE the scope table. The
-- access log is independent. Nothing else in the substrate references these
-- tables; no RPC bodies need restoring (the migration is table-authoring
-- only, redefinition-free).
-- =============================================================================

DROP TABLE IF EXISTS public.cg_memory_access_log;
DROP TABLE IF EXISTS public.cg_memory_record;
DROP TABLE IF EXISTS public.cg_memory_scope;
