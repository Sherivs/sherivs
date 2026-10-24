-- Rollback SHERIVS-023. Drops only objects added by 023.
BEGIN;
DROP FUNCTION IF EXISTS public.early_warning_resolve(uuid, text), public.compute_early_warnings(uuid, text, text, text), public.siwes_supervisor_verify(uuid, text, int, text),
  public.siwes_log(uuid, int, text), public.siwes_place(uuid, text, text, text, date, date), public.course_reg_decide(uuid, boolean, text), public.course_drop(uuid),
  public.course_register(uuid, text, text), public.course_prereq_set(uuid, uuid, numeric), public.registration_window_set(uuid, text, text, timestamptz, timestamptz, int, int);
DROP TABLE IF EXISTS public.learning_gap_flags, public.siwes_logbook, public.siwes_placements, public.course_registrations, public.registration_windows, public.course_prerequisites;
DELETE FROM public.rate_limit_events WHERE bucket = 'siwes.verify';
COMMIT;
