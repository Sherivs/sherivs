-- Rollback SHERIVS-A07
DROP FUNCTION IF EXISTS public.attendance_conflict_resolve(uuid, text, text), public.attendance_conflicts_list(uuid, text), public.offline_attendance_sync_v2(text, jsonb, timestamptz);
DROP TABLE IF EXISTS public.attendance_sync_conflicts, public.attendance_sync_items;
DELETE FROM public.offline_sync_batches WHERE kind = 'attendance_v2';
ALTER TABLE public.offline_sync_batches DROP COLUMN IF EXISTS skew_seconds;
