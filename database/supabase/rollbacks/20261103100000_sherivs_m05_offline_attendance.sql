-- Rollback M05 offline attendance capture.
DROP FUNCTION IF EXISTS public.offline_attendance_capture_sync_m05(text, jsonb, timestamptz);
DROP POLICY IF EXISTS class_attendance_sync_conflicts_read_m05 ON public.class_attendance_sync_conflicts;
DROP POLICY IF EXISTS class_attendance_sync_items_read_m05 ON public.class_attendance_sync_items;
DROP POLICY IF EXISTS class_attendance_marks_read_m05 ON public.class_attendance_marks;
DROP FUNCTION IF EXISTS public.m05_teacher_assigned_to_class(uuid, uuid);
DROP TABLE IF EXISTS public.class_attendance_sync_conflicts;
DROP TABLE IF EXISTS public.class_attendance_sync_items;
DROP TABLE IF EXISTS public.class_attendance_marks;
DROP INDEX IF EXISTS public.school_shifts_id_school_m05_uq;
DROP INDEX IF EXISTS public.students_id_class_school_m05_uq;
DROP INDEX IF EXISTS public.classes_id_school_m05_uq;
