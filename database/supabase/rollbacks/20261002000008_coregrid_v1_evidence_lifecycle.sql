-- =============================================================================
-- Rollback: 20261002000008_coregrid_v1_evidence_lifecycle.sql (MISSION-R-90/91)
-- Status: AUTHORED, NOT APPLIED.
-- WARNING: destructive — removes the evidence lifecycle substrate. After
-- rollback, captured evidence records and the lifecycle act ledger are
-- unrecoverable: the canonical-truth chain (Constitution §9), the promotion
-- validation acts (J-034) and the authorized revocation audit (E-018) lose
-- their durable records, and claims audited against them lose their support
-- evidence. For retiring the schema, not for revoking individual records
-- (matches the memory-tier rollback style).
--
-- Rollback order matters: lifecycle acts reference evidence records
-- (composite-FK RESTRICT), so the act table is dropped BEFORE the record
-- table. Self-referencing FKs (supersedes, revokes) vanish with their table.
-- Nothing else in the substrate references these tables (the pre-existing
-- foundation evidence substrate is untouched); no RPC bodies need restoring
-- (the migration is table-authoring only, redefinition-free).
-- =============================================================================

DROP TABLE IF EXISTS public.cg_evidence_lifecycle_act;
DROP TABLE IF EXISTS public.cg_evidence_record;