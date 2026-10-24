-- Rollback SHERIVS-027. gov_viewers rows whose user has no public.users row would block restoring the old FK; those are removed first.
BEGIN;
DROP FUNCTION IF EXISTS public.gov_attendance_trend(uuid, int), public.gov_overview(uuid, text), public.gov_my_jurisdictions(), public._gov_guard(uuid, text);
DROP TABLE IF EXISTS public.gov_view_log;
ALTER TABLE public.gov_viewers DROP CONSTRAINT IF EXISTS gov_viewers_user_id_fkey;
DELETE FROM public.gov_viewers v WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = v.user_id);
ALTER TABLE public.gov_viewers ADD CONSTRAINT gov_viewers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
COMMIT;
