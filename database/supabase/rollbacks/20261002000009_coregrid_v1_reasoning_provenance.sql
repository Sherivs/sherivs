-- =============================================================================
-- Rollback: 20261002000009_coregrid_v1_reasoning_provenance.sql (MISSION-R-33)
-- Status: AUTHORED, NOT APPLIED.
-- WARNING: destructive — removes the intelligence-snapshot substrate. After
-- rollback, persisted reasoning provenance is unrecoverable: the gateway's
-- "WHICH model / WHICH context / WHICH routing decision" audit trail (§12
-- data provenance) loses its durable record and downstream Evidence/Verification
-- lose the AI-provenance anchor (E-017). For retiring the schema, not for
-- undoing individual snapshots (matches the memory-tier rollback style).
--
-- Rollback order matters: the migration authors a single table with no
-- dependents, so the rollback is a single DROP (reverse of creation). Nothing
-- else in the substrate references this table; no RPC bodies need restoring
-- (the migration is table-authoring only, redefinition-free).
-- =============================================================================

DROP TABLE IF EXISTS public.cg_reasoning_provenance_snapshot;
