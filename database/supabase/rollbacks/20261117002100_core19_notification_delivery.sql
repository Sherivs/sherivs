BEGIN;

DROP TRIGGER core19_notification_membership_guard ON public.notifications;

DROP FUNCTION public.core19_validate_notification_membership();

DROP INDEX public.notifications_school_user_idempotency_key_uq;

ALTER TABLE public.notifications
  DROP CONSTRAINT notifications_idempotency_key_length,
  DROP COLUMN idempotency_key;

-- Forced row-level security is NOT removed: both tables were already forced in production before
-- this migration (verified 2026-11-16), so removing it here would weaken them.

COMMIT;
