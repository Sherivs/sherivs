-- =============================================================================
-- Rollback: 20261002000005_coregrid_v1_reconciliation.sql (MISSION-R-14)
-- Status: AUTHORED, NOT APPLIED.
-- WARNING: destructive — removes the reconciliation verdict substrate. After
-- rollback, persisted reconciliation verdicts and their retained input facts
-- are unrecoverable: the explicit-rule resolution trail (E-029 / G-094) loses
-- its durable explainability record. For retiring the schema, not for undoing
-- individual reconciliations (matches the memory-tier rollback style).
--
-- Rollback order matters: reconciliation inputs reference verdicts
-- (composite-FK CASCADE), so the input table is dropped BEFORE the verdict
-- table. Nothing else in the substrate references these tables; no RPC bodies
-- need restoring (the migration is table-authoring only, redefinition-free).
-- =============================================================================

DROP TABLE IF EXISTS public.cg_reconciliation_input;
DROP TABLE IF EXISTS public.cg_reconciliation_verdict;