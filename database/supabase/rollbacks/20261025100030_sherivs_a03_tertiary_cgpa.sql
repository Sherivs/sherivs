-- Rollback SHERIVS-A03
BEGIN;
DROP FUNCTION IF EXISTS public.academic_standing_report(uuid);
DROP FUNCTION IF EXISTS public.academic_standing_rules_set(uuid, numeric, int);
DROP FUNCTION IF EXISTS public.degree_class_bands_set(uuid, jsonb);
DROP FUNCTION IF EXISTS public.semester_results(uuid);
DROP FUNCTION IF EXISTS public._a03_standing(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public._a03_sem_order(text, text);
DROP FUNCTION IF EXISTS public._a03_attempts(uuid);
DROP FUNCTION IF EXISTS public._a03_can_read(uuid);
DROP TABLE IF EXISTS public.academic_standing_rules;
DROP TABLE IF EXISTS public.degree_class_bands;
COMMIT;
