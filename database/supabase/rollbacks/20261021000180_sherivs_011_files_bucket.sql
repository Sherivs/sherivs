-- Rollback for SHERIVS-011: remove the `sherivs-files` bucket, but only while
-- it is empty (never deletes stored files). Switch FILE_BUCKET back to
-- 'coregrid-files' in the app before running this.
-- Also delete the ledger row: DELETE FROM supabase_migrations.schema_migrations
--   WHERE version = '20261021000180';
BEGIN;

-- Supabase blocks direct deletes from storage tables unless this is set.
SET LOCAL storage.allow_delete_query = 'true';

DO $rb$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'sherivs-files') THEN
    RAISE EXCEPTION 'sherivs-files is not empty; refusing to drop it';
  END IF;
  DELETE FROM storage.buckets WHERE id = 'sherivs-files';
END
$rb$;

COMMIT;
