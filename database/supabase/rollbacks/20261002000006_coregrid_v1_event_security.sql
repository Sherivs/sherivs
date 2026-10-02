-- =============================================================================
-- Rollback: 20261002000006_coregrid_v1_event_security.sql (MISSION-R-81)
-- Status: AUTHORED, NOT APPLIED.
-- WARNING: destructive — removes the per-event security contract substrate.
-- After rollback, persisted security contracts and the consumption gate's
-- denial/redaction audit are unrecoverable: the fail-closed delivery evidence
-- (AGENTS §35 — every denial leaves evidence) is destroyed and events revert
-- to carrying their contracts only in-flight. For retiring the schema, not
-- for undoing individual gate decisions (matches the memory-tier rollback
-- style).
--
-- Rollback order matters: the contract table is independent; the denial and
-- redaction audit tables are independent of it and of each other. Nothing
-- else in the substrate references these tables; no RPC bodies need
-- restoring (the migration is table-authoring only, redefinition-free).
-- =============================================================================

DROP TABLE IF EXISTS public.cg_event_security_redaction;
DROP TABLE IF EXISTS public.cg_event_security_denial;
DROP TABLE IF EXISTS public.cg_event_security;