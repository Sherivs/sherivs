-- =============================================================================
-- Rollback of 20261103141000_coregrid_v1_worker_delegation_expiry.sql
-- CORE-05 / ADR-020 — removes only the added expiry metadata and index.
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.cg_worker_revoke_delegation(
  text, text, text, text, text, timestamptz, text
);
DROP FUNCTION IF EXISTS public.cg_worker_grant_delegation(
  text, text, text, text, jsonb, text, text, timestamptz, timestamptz, text
);

DROP INDEX IF EXISTS public.cg_worker_delegation_grant_active_expiry_idx;

ALTER TABLE public.cg_worker_delegation_grant
  DROP CONSTRAINT IF EXISTS cg_worker_delegation_grant_expiry_after_granted,
  DROP COLUMN IF EXISTS expires_at;

ALTER TABLE public.cg_worker_delegation
  DROP CONSTRAINT IF EXISTS cg_worker_delegation_expiry_after_recorded,
  DROP COLUMN IF EXISTS expires_at;

COMMIT;
