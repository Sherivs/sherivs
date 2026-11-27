-- Rollback for 20261117001400_sherivs_m11_admissions_model.sql (M11 part A, ADR-115).
-- NOT APPLIED. Run only with the founder's written approval, after the migration was applied.
--
-- Leaves admission_applications as it was before the migration:
--   * removes the seven added columns: cycle_id, programme_id, form_version, jamb_reg_no,
--     utme_score, caps_status, entry_mode (with their checks, foreign keys and index);
--   * removes the link-guard trigger and its function;
--   * removes the added UNIQUE (id, school_id) constraint;
--   * restores table-level SELECT for authenticated (the production state read on
--     2026-11-17), replacing the column-level SELECT the migration granted.
-- The anon INSERT grant and every existing policy on admission_applications were never
-- touched, so nothing is restored there.
-- Data in the nine new tables is DELETED by this rollback; export it first if it matters.
-- Objects in the admission-documents bucket are not deleted here; the bucket is removed
-- only when it is empty (Supabase refuses to drop a bucket that holds objects).

DO $storage$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "admission documents clean read" ON storage.objects';
  END IF;
  IF to_regclass('storage.buckets') IS NOT NULL AND to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE $b$
      DELETE FROM storage.buckets b WHERE b.id = 'admission-documents'
        AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'admission-documents')
    $b$;
  END IF;
END
$storage$;

DROP FUNCTION IF EXISTS public.admission_blind_applications(uuid);
DROP FUNCTION IF EXISTS public.admission_application_tertiary(uuid);

-- Detach admission_applications from the new tables before dropping them.
DROP TRIGGER IF EXISTS trg_admission_applications_link_guard ON public.admission_applications;
DROP FUNCTION IF EXISTS public.admission_applications_link_guard();
ALTER TABLE public.admission_applications DROP CONSTRAINT IF EXISTS admission_applications_form_fkey;
ALTER TABLE public.admission_applications DROP CONSTRAINT IF EXISTS admission_applications_programme_fkey;
ALTER TABLE public.admission_applications DROP CONSTRAINT IF EXISTS admission_applications_cycle_fkey;
ALTER TABLE public.admission_applications DROP CONSTRAINT IF EXISTS admission_applications_link_check;
ALTER TABLE public.admission_applications DROP CONSTRAINT IF EXISTS admission_applications_jamb_reg_no_check;
ALTER TABLE public.admission_applications DROP CONSTRAINT IF EXISTS admission_applications_utme_score_check;
ALTER TABLE public.admission_applications DROP CONSTRAINT IF EXISTS admission_applications_caps_status_check;
ALTER TABLE public.admission_applications DROP CONSTRAINT IF EXISTS admission_applications_entry_mode_check;
DROP INDEX IF EXISTS public.admission_applications_cycle_idx;

-- Scores are append-only; the guard must go before the table can be dropped with its rows.
DROP TRIGGER IF EXISTS trg_admission_scores_append_only ON public.admission_scores;

DROP TABLE IF EXISTS public.admission_documents;
DROP TABLE IF EXISTS public.admission_offers;
DROP TABLE IF EXISTS public.admission_scores;
DROP TABLE IF EXISTS public.admission_screenings;
DROP TABLE IF EXISTS public.admission_question_bank;
DROP TABLE IF EXISTS public.admission_forms;
DROP TABLE IF EXISTS public.admission_programmes;
DROP TABLE IF EXISTS public.admission_cycles;
DROP TABLE IF EXISTS public.admission_settings;

DROP FUNCTION IF EXISTS public.admission_offers_guard();
DROP FUNCTION IF EXISTS public.admission_scores_guard();
DROP FUNCTION IF EXISTS public.admission_screenings_guard();
DROP FUNCTION IF EXISTS public.admission_forms_guard();
DROP FUNCTION IF EXISTS public.admission_cycles_guard();
DROP FUNCTION IF EXISTS public.admission_set_actor();

ALTER TABLE public.admission_applications DROP COLUMN IF EXISTS entry_mode;
ALTER TABLE public.admission_applications DROP COLUMN IF EXISTS caps_status;
ALTER TABLE public.admission_applications DROP COLUMN IF EXISTS utme_score;
ALTER TABLE public.admission_applications DROP COLUMN IF EXISTS jamb_reg_no;
ALTER TABLE public.admission_applications DROP COLUMN IF EXISTS form_version;
ALTER TABLE public.admission_applications DROP COLUMN IF EXISTS programme_id;
ALTER TABLE public.admission_applications DROP COLUMN IF EXISTS cycle_id;
ALTER TABLE public.admission_applications DROP CONSTRAINT IF EXISTS admission_applications_id_school_id_key;

-- Table-level REVOKE also clears the column-level SELECT grants; then restore the table grant.
REVOKE SELECT ON TABLE public.admission_applications FROM authenticated;
GRANT SELECT ON TABLE public.admission_applications TO authenticated;
