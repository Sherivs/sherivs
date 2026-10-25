-- Rollback SHERIVS-A02: drop the structure/period RPCs and academic_periods. Shifts, levels and section columns (SHERIVS-021) stay.
BEGIN;
DROP FUNCTION IF EXISTS public.current_academic_period(uuid);
DROP FUNCTION IF EXISTS public.academic_period_close(uuid);
DROP FUNCTION IF EXISTS public.academic_period_set_current(uuid);
DROP FUNCTION IF EXISTS public.academic_period_upsert(uuid, text, text, int, text, date, date);
DROP FUNCTION IF EXISTS public.class_set_structure(uuid, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.section_set_profile(uuid, text, text);
DROP FUNCTION IF EXISTS public.level_delete(uuid);
DROP FUNCTION IF EXISTS public.level_upsert(uuid, text, text, int);
DROP FUNCTION IF EXISTS public.shift_delete(uuid);
DROP FUNCTION IF EXISTS public.shift_upsert(uuid, uuid, text, text, time, time);
DROP FUNCTION IF EXISTS public._structure_in_use(text, uuid);
DROP FUNCTION IF EXISTS public._structure_audit(uuid, text, text, uuid, jsonb);
DROP TABLE IF EXISTS public.academic_periods;
COMMIT;
