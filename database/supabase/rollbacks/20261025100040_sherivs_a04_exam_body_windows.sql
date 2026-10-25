-- Rollback SHERIVS-A04
BEGIN;
DROP FUNCTION IF EXISTS public.exam_window_summary(uuid);
DROP FUNCTION IF EXISTS public.exam_candidate_withdraw(uuid);
DROP FUNCTION IF EXISTS public.exam_candidate_register(uuid, uuid, text[]);
DROP FUNCTION IF EXISTS public.exam_window_upsert(uuid, text, int, date, date, date, numeric, numeric, text[]);
DROP TABLE IF EXISTS public.exam_body_candidates;
DROP TABLE IF EXISTS public.exam_body_windows;
DROP TABLE IF EXISTS public.exam_bodies;
COMMIT;
