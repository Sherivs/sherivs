-- Rollback SHERIVS-B04. consent_records/events written via consent_set are KEPT (they are legal evidence).
BEGIN;
DROP TRIGGER IF EXISTS trg_grades_authz_shadow ON public.grades;
DROP FUNCTION IF EXISTS public.grades_authz_shadow();
DROP FUNCTION IF EXISTS public.authz_shadow_v2(text, text, uuid, boolean);
DROP FUNCTION IF EXISTS public.authz_check_v2(uuid, text, text, uuid);
DROP FUNCTION IF EXISTS public.delegation_allows(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.delegations_mine();
DROP FUNCTION IF EXISTS public.delegation_revoke(uuid);
DROP FUNCTION IF EXISTS public.delegation_grant(uuid, text[], timestamptz, text, timestamptz);
DROP TABLE IF EXISTS public.authority_delegations;
DROP FUNCTION IF EXISTS public.break_glass_list();
DROP FUNCTION IF EXISTS public.break_glass_review(uuid, text, text);
DROP FUNCTION IF EXISTS public.break_glass_close(uuid);
DROP FUNCTION IF EXISTS public._is_school_dpo(uuid);
ALTER TABLE public.break_glass_grants DROP CONSTRAINT IF EXISTS break_glass_review_outcome_chk;
ALTER TABLE public.break_glass_grants DROP COLUMN IF EXISTS review_note, DROP COLUMN IF EXISTS review_outcome, DROP COLUMN IF EXISTS reviewed_at,
  DROP COLUMN IF EXISTS reviewed_by, DROP COLUMN IF EXISTS closed_by;
DROP FUNCTION IF EXISTS public.consent_overview();
DROP FUNCTION IF EXISTS public.consent_my_learners();
DROP FUNCTION IF EXISTS public.consent_status(uuid);
DROP FUNCTION IF EXISTS public.consent_gate(uuid, text);
DROP FUNCTION IF EXISTS public.consent_set(uuid, text, boolean, text, text);
DROP FUNCTION IF EXISTS public._student_is_adult(uuid);
DROP TABLE IF EXISTS public.safeguard_audit;
DROP FUNCTION IF EXISTS public._sg_is_aal2();
COMMIT;
