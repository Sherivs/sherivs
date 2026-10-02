-- =============================================================================
-- Rollback: 20261002000011_coregrid_v1_knowledge_currency.sql
-- (J-019 / V1CAP-040 / MISSION-R-71)
-- Status: AUTHORED, NOT APPLIED.
-- WARNING: destructive — removes the knowledge-currency substrate. After
-- rollback, freshness contracts, explicit invalidation acts and reliability
-- downgrade acts are unrecoverable: staleness reverts to being evaluated
-- only in the pure contract over an unregisterable substrate, and the
-- append-only tombstone/act ledger (ADR-005) loses its durable record. The
-- memory records themselves remain untouched in the phase-36 memory tier.
-- For retiring the schema, not for undoing individual acts (matches the
-- memory-tier rollback style).
--
-- Rollback order matters: freshness contracts reference sources, invalidation
-- acts reference contracts, downgrade acts reference sources — dependents are
-- dropped BEFORE the tables they reference (reverse of creation). Nothing
-- else in the substrate references these tables; no RPC bodies need
-- restoring (the migration is table-authoring only, redefinition-free).
-- =============================================================================

DROP TABLE IF EXISTS public.cg_knowledge_downgrade;
DROP TABLE IF EXISTS public.cg_knowledge_invalidation;
DROP TABLE IF EXISTS public.cg_knowledge_freshness_contract;
DROP TABLE IF EXISTS public.cg_knowledge_source;
