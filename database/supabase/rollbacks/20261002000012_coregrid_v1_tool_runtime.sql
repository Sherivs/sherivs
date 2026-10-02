-- =============================================================================
-- Rollback: 20261002000012_coregrid_v1_tool_runtime.sql (J-008 / V1CAP-056)
-- Status: AUTHORED, NOT APPLIED.
-- WARNING: destructive — removes the tool-runtime substrate. After rollback,
-- persisted tool registrations and invocation records are unrecoverable: the
-- sandbox gate's "nothing executes outside the gate" audit trail (AGENTS §29)
-- loses its durable record, and lease-invalidation evidence (J-007) is lost.
-- The worker definitions, capability registry and delegation contracts the
-- runtime gates against remain untouched in their own substrates. For
-- retiring the schema, not for undoing individual invocations (matches the
-- memory-tier rollback style).
--
-- Rollback order matters: the migration authors two independent tables
-- (invocation records reference no tool row by FK), so the rollback drops
-- them in reverse creation order. Nothing else in the substrate references
-- these tables; no RPC bodies need restoring (the migration is
-- table-authoring only, redefinition-free).
-- =============================================================================

DROP TABLE IF EXISTS public.cg_tool_runtime_invocation;
DROP TABLE IF EXISTS public.cg_tool_runtime_tool;
