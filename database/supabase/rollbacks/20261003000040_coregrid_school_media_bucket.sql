-- =============================================================================
-- Rollback of 20261003000040_coregrid_school_media_bucket.sql
-- (post-R-wave follow-up, team T-C / STORAGE-PROVISION — school-media bucket)
-- =============================================================================
-- GENUINE INVERSE: the migration performs exactly one state change — an
-- idempotent INSERT of one row into storage.buckets (id 'school-media'). Its
-- inverse deletes that row. It creates no tables, functions, triggers or
-- policies, so there is nothing else to drop: the five storage.objects
-- policies referenced by the migration belong to
-- 20260707223958_421f2364-7989-4069-b78c-fd119f19daeb.sql and MUST survive
-- this rollback (this file must not touch them, §39 no destructive
-- refactoring).
--
-- ROLLBACK PLAN (Constitution §38):
--   1. quiesce the gallery upload path (admin CMS gallery tab); the frontend
--      upload fails NON-silently on a missing bucket ("Upload failed" toast),
--      so rollback is safe while the rest of the CMS continues;
--   2. run this file in one transaction;
--   3. verify: storage.buckets has no 'school-media' row and no other bucket
--      is touched.
--
-- DATA NOTE: deleting the bucket row makes every object stored under it
-- unreachable through the storage API (404 Bucket not found). BEFORE running
-- this file, verify the bucket is empty or export its objects, e.g.:
--   node -e "…supabase.storage.from('school-media').list(<school_id>)…"
-- Leftover object rows in storage.objects referencing the deleted bucket are
-- orphans and unrecoverable through the API — treat rollback as an explicit
-- acceptance of that loss (the school_gallery rows that reference signed
-- URLs survive, but their images will no longer resolve).

BEGIN;

DELETE FROM storage.buckets WHERE id = 'school-media';

COMMIT;
