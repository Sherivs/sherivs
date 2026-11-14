-- Rollback for DB-12 (20261105000200). It restores the earlier structure.
-- Removing the surrogate id also removes feature_flags_pkey. feature_flags_scope is untouched,
-- so flag_set() and flag_on() behave exactly as before. The duplicate index is recreated.

ALTER TABLE public.feature_flags DROP CONSTRAINT IF EXISTS feature_flags_pkey;
ALTER TABLE public.feature_flags DROP COLUMN IF EXISTS id;

CREATE INDEX IF NOT EXISTS idx_biometrics_user ON public.teacher_biometrics (user_id, school_id);
