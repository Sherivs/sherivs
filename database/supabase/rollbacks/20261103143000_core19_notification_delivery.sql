BEGIN;

DROP TRIGGER core19_notification_membership_guard ON public.notifications;

DROP FUNCTION public.core19_validate_notification_membership();

ALTER TABLE public.notifications
  DROP CONSTRAINT notifications_idempotency_key_length,
  DROP COLUMN idempotency_key;

DROP INDEX public.notifications_school_user_idempotency_key_uq;

ALTER TABLE public.notifications NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences NO FORCE ROW LEVEL SECURITY;

COMMIT;
