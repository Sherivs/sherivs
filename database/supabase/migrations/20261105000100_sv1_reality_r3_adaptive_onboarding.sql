-- SV1-REALITY R3 (#334): adaptive V1 onboarding interview — storage hardening only.
--
-- The interview persists its save/resume state in the EXISTING domain-neutral
-- `public.cg_org_profile` store under profile key `reality.onboarding_interview`.
-- No new table, no duplicate response store. This migration only:
--   1. forces row-level security on cg_org_profile (it was enabled with zero
--      policies and no client grants; FORCE also binds the table owner), and
--   2. bounds the size of the interview payload for new and updated rows.
-- Tenant scoping and organization-admin authorization stay in the existing
-- get_org_profile / upsert_org_profile RPCs. This file does not change them.
--
-- Forward-only. Rollback: database/supabase/rollbacks/20261105000100_sv1_reality_r3_adaptive_onboarding.sql
-- NOT APPLIED to any database by this change; apply to staging first after owner approval.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.cg_org_profile') IS NULL THEN
    RAISE EXCEPTION 'SV1-REALITY R3 requires public.cg_org_profile (20260907000700_coregrid_org_profile_substrate.sql)'
      USING ERRCODE = '55000';
  END IF;
END $$;

ALTER TABLE public.cg_org_profile FORCE ROW LEVEL SECURITY;

-- NOT VALID: checks new and updated rows only, so existing profiles are untouched.
ALTER TABLE public.cg_org_profile
  DROP CONSTRAINT IF EXISTS cg_org_profile_reality_interview_size;
ALTER TABLE public.cg_org_profile
  ADD CONSTRAINT cg_org_profile_reality_interview_size
  CHECK (profile_key <> 'reality.onboarding_interview' OR pg_column_size(payload) <= 262144)
  NOT VALID;

COMMENT ON CONSTRAINT cg_org_profile_reality_interview_size ON public.cg_org_profile IS
  'SV1-REALITY R3: the onboarding interview payload may not exceed 256 KiB.';

COMMIT;
