-- Rollback for SV1-REALITY R3 (#334). Restores the pre-R3 table posture.
-- Stored interview rows (profile_key = 'reality.onboarding_interview') are left in place.
BEGIN;

ALTER TABLE public.cg_org_profile
  DROP CONSTRAINT IF EXISTS cg_org_profile_reality_interview_size;

ALTER TABLE public.cg_org_profile NO FORCE ROW LEVEL SECURITY;

COMMIT;
