-- =============================================================================
-- Rollback: 20261002000010_coregrid_v1_cost_attribution.sql (J-043 / V1CAP-078)
-- Status: AUTHORED, NOT APPLIED.
-- WARNING: destructive — removes the cost-attribution substrate. After
-- rollback, persisted usage roll-ups and their partition buckets are
-- unrecoverable: quota evaluation (J-031), billing and per-tenant rate limits
-- lose their durable metering substrate (the underlying usage-ledger records
-- remain in their own substrate; only the roll-ups are lost). For retiring
-- the schema, not for undoing individual roll-ups (matches the memory-tier
-- rollback style).
--
-- Rollback order matters: buckets reference roll-ups (composite-FK CASCADE),
-- so the bucket table is dropped BEFORE the roll-up table. Nothing else in
-- the substrate references these tables; no RPC bodies need restoring (the
-- migration is table-authoring only, redefinition-free).
-- =============================================================================

DROP TABLE IF EXISTS public.cg_usage_attribution_bucket;
DROP TABLE IF EXISTS public.cg_usage_attribution_rollup;
