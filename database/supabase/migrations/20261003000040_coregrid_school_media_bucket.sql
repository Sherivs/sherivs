-- =============================================================================
-- CoreGrid — school-media storage bucket provisioning (post-R-wave follow-up,
-- team T-C / STORAGE-PROVISION)
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED. Do not treat this file as a live database.
-- Apply only by the coordinator applying migrations canonically (the same
-- path as migrations 20261003000030 / 20261003000031):
--   supabase db push --workdir database/supabase
-- Rollback: database/supabase/rollbacks/20261003000040_coregrid_school_media_bucket.sql
-- (exact inverse, same basename).
--
-- Authority: post-R-wave follow-up wave, team T-C (STORAGE-PROVISION). The
-- R-wave's R1 remediation (progress/v1-wave/R1-report.md) typed-skipped the
-- gallery e2e case because the `school-media` bucket is absent from the
-- canonical Supabase backend (probed 2026-10-03: storage.listBuckets() →
-- only 'coregrid-files'; POST /storage/v1/object/school-media/... →
-- 400 "Bucket not found"). e2e must not create infrastructure; a migration
-- provisions it declaratively instead (§17/§28 — the database is the state
-- of record, application code is never the provisioning layer).
--
-- WHY THIS IS ONE STATEMENT (and not more):
--   The five storage.objects policies the gallery flow needs ALREADY exist
--   on the canonical backend — they are owned by the applied migration
--   20260707223958_421f2364-7989-4069-b78c-fd119f19daeb.sql and were
--   verified live (pg_policies, storage.objects):
--     • school-media read own school     SELECT  authenticated
--     • school-media insert own school   INSERT  authenticated
--     • school-media update own school   UPDATE  authenticated
--     • school-media delete own school   DELETE  authenticated
--     • school-media public read         SELECT  anon
--   each scoped to the tenant prefix: (storage.foldername(name))[1] =
--   public.get_my_school_id()::text (the anon SELECT is bucket-wide so the
--   signed/public URL render of gallery images works for visitors).
--   Re-declaring them here would either fail (CREATE POLICY has no IF NOT
--   EXISTS) or silently widen/duplicate another migration's grants — a
--   permission-expansion smell (§8). LEAST PRIVILEGE: this migration grants
--   NOTHING new; it only provisions the missing bucket row that makes the
--   already-authorized flow operable (§17: policies exist, the substrate
--   was missing).
--
-- BUCKET POSTURE (derived from the consuming code, not guessed):
--   • id/name 'school-media' — the exact id the frontend client and the
--     e2e upload interceptor require
--     (frontend/src/components/admin/crud-list.tsx ImageUploadField →
--     supabase.storage.from("school-media"); tests/e2e/gallery-upload.spec.ts
--     asserts /storage/v1/object/school-media/).
--   • public = false (PRIVATE). The frontend uploads with the authenticated
--     admin user and renders via createSignedUrl (10-year signed URL) —
--     the signed URL is the authorization artifact; the bucket itself
--     stays closed to direct public listing.
--   • file_size_limit = 8388608 (8 MB) and allowed_mime_types = image/* —
--     the exact envelope ImageUploadField already enforces client-side
--     ("image must be under 8 MB", accept="image/*"). Declaring it at the
--     bucket boundary moves the existing product contract into the
--     infrastructure so client validation is never the only guard (§34).
--   The scope is DELIBERATELY bounded to the gallery feature's needs; a
--   broader (e.g. unlimited, any-mime) declaration would be a permission
--   expansion beyond the authorized purpose (§7/§8/§16).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Idempotent bucket provisioning
-- -----------------------------------------------------------------------------
-- ON CONFLICT DO NOTHING makes the migration a no-op if the bucket was
-- provisioned out-of-band (e.g. manually during incident remediation), so the
-- canonical apply never errors on existing state and never overwrites an
-- operator's row (§28: idempotency; no destructive refactoring §39).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'school-media',
  'school-media',
  false,
  8388608, -- 8 MB — mirrors ImageUploadField's client-side ceiling
  ARRAY[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/avif'
  ]::text[]
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- End of migration. Verification (run after apply authorization):
--   • select id, public from storage.buckets where id = 'school-media'
--     → one row, public = false;
--   • re-running this file is a no-op (ON CONFLICT DO NOTHING);
--   • the five object policies above still exist unchanged in pg_policies;
--   • an authenticated user whose school matches the first path segment can
--     INSERT school-media/<school_id>/... ; a different school's prefix is
--     denied (tenant isolation, §13/§31).
-- =============================================================================

-- Component: database/supabase/migrations/20261003000040_coregrid_school_media_bucket.sql
-- Owner: post-R-wave follow-up wave team T-C (STORAGE-PROVISION) — school-media bucket provisioning
