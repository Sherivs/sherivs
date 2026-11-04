-- Rollback of 20261104016000_sv1_sched_data_model.sql.
-- Apply only to a disposable database or under an approved rollback plan.

DROP TABLE IF EXISTS public.cg_schedule_placement;
DROP TABLE IF EXISTS public.cg_schedule_version;
DROP TABLE IF EXISTS public.cg_schedule_constraint;
DROP TABLE IF EXISTS public.cg_schedule_participant_availability;
DROP TABLE IF EXISTS public.cg_schedule_participant_qualification;
DROP TABLE IF EXISTS public.cg_schedule_teaching_load;
DROP TABLE IF EXISTS public.cg_schedule_room;
DROP TABLE IF EXISTS public.cg_schedule_period;
DROP TABLE IF EXISTS public.cg_schedule_bell_schedule;

DROP FUNCTION IF EXISTS public.cg_schedule_placement_guard();
DROP FUNCTION IF EXISTS public.cg_schedule_version_immutable();
DROP FUNCTION IF EXISTS public.cg_schedule_publication_guard();
DROP FUNCTION IF EXISTS public.cg_schedule_period_overlap_guard();
