-- =============================================================================
-- SHERIVS-011 — Rename phase 3: private file bucket `sherivs-files`.
--
-- Creates the bucket the storage adapter now uses (FILE_BUCKET = 'sherivs-files').
-- It matches the former `coregrid-files` bucket exactly, as found on prod
-- (read-only, 2026-10-21):
--   public = false, file_size_limit = NULL, allowed_mime_types = NULL,
--   avif_autodetection = false, type STANDARD; 0 objects; no storage.objects
--   policies reference it (all access goes through the service role).
-- So no storage policies are created here. `coregrid-files` is NOT dropped;
-- removing it (only if still empty) is a separate, later step.
-- Idempotent: re-running is a no-op apart from re-asserting the settings.
-- Rollback: database/supabase/rollbacks/20261021000180_sherivs_011_files_bucket.sql
-- =============================================================================
BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types, avif_autodetection)
VALUES ('sherivs-files', 'sherivs-files', false, NULL, NULL, false)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = NULL,
      allowed_mime_types = NULL,
      avif_autodetection = false;

COMMIT;
