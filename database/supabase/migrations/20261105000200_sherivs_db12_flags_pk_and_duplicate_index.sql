-- DB-12: structural clean-up found by the production database advisors (audit finding R-12).
-- Status: AUTHORED, NOT APPLIED. Do not apply to production from the pull request.
-- Rollback: database/supabase/rollbacks/20261105000200_sherivs_db12_flags_pk_and_duplicate_index.sql
-- ADR-073. Forward-only and idempotent. It changes no policy, grant, trigger, function or row value.
--
-- Evidence (read-only production queries, 2026-11-14):
--   * public.feature_flags has no primary key (advisor 0004). Its only uniqueness rule is the
--     functional unique index feature_flags_scope on (key, coalesce(org_id, zero uuid)). A
--     primary key on (key, org_id) is impossible because org_id is nullable (a NULL org_id is the
--     platform-wide default), so a surrogate id is added and feature_flags_scope is kept as the
--     rule that stops duplicate flags. flag_set() depends on it for ON CONFLICT inference.
--   * public.teacher_biometrics carries two identical indexes on (user_id, school_id):
--     idx_teacher_biometrics_user and idx_biometrics_user (advisor 0009). The second is dropped.
--
-- Apply order: no dependencies. The table is small (9 rows in production), so the rewrite is brief.

SET LOCAL lock_timeout = '5s';

DO $db12_guard$
BEGIN
  IF to_regclass('public.feature_flags') IS NULL
     OR to_regclass('public.feature_flags_scope') IS NULL
     OR to_regclass('public.teacher_biometrics') IS NULL
  THEN
    RAISE EXCEPTION 'DB-12 requires feature_flags (with feature_flags_scope) and teacher_biometrics';
  END IF;
END
$db12_guard$;

-- 1. Surrogate primary key for feature_flags. Existing rows receive a generated id.
DO $db12_pk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.feature_flags'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE public.feature_flags
      ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
    ALTER TABLE public.feature_flags
      ADD CONSTRAINT feature_flags_pkey PRIMARY KEY (id);
  END IF;
END
$db12_pk$;

-- 2. Drop the redundant index, but only when it is provably identical to the one that is kept
--    (same table, columns, operator classes, ordering, uniqueness and predicate).
DO $db12_idx$
BEGIN
  IF to_regclass('public.idx_biometrics_user') IS NOT NULL
     AND to_regclass('public.idx_teacher_biometrics_user') IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM pg_index dup
         JOIN pg_index keep
           ON keep.indrelid = dup.indrelid
          AND keep.indexrelid <> dup.indexrelid
          AND keep.indkey = dup.indkey
          AND keep.indclass = dup.indclass
          AND keep.indcollation = dup.indcollation
          AND keep.indoption = dup.indoption
          AND keep.indisunique = dup.indisunique
          AND keep.indpred::text IS NOT DISTINCT FROM dup.indpred::text
          AND keep.indexprs::text IS NOT DISTINCT FROM dup.indexprs::text
        WHERE dup.indexrelid = to_regclass('public.idx_biometrics_user')
          AND keep.indexrelid = to_regclass('public.idx_teacher_biometrics_user')
     )
  THEN
    DROP INDEX public.idx_biometrics_user;
  END IF;
END
$db12_idx$;
