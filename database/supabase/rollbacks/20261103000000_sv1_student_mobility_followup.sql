-- Rollback for 20261103000000_sv1_student_mobility_followup.sql.
-- Removes only objects introduced by that migration.
BEGIN;

DROP TRIGGER IF EXISTS student_mobility_fee_allocations_append_only
  ON public.student_mobility_fee_allocations;
DROP TRIGGER IF EXISTS student_mobility_fee_proration
  ON public.student_mobility_events;
DROP TRIGGER IF EXISTS student_mobility_request_notification
  ON public.student_mobility_requests;
DROP TRIGGER IF EXISTS student_mobility_approval_notification
  ON public.student_mobility_approvals;
DROP TRIGGER IF EXISTS trg_student_mobility_fee_allocations_audit
  ON public.student_mobility_fee_allocations;

DROP FUNCTION IF EXISTS public.student_mobility_reschedule(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.student_mobility_approval_notification();
DROP FUNCTION IF EXISTS public.student_mobility_request_notification();
DROP FUNCTION IF EXISTS public.student_mobility_notify_approvers(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.student_mobility_fee_proration();
DROP FUNCTION IF EXISTS public.student_mobility_append_only();

DROP TABLE IF EXISTS public.student_mobility_fee_allocations;

COMMIT;
