BEGIN;

ALTER TABLE public.notifications
  DROP CONSTRAINT notifications_recipient_school_fkey,
  DROP CONSTRAINT notifications_idempotency_key_length,
  DROP COLUMN idempotency_key;

DROP INDEX public.notifications_school_user_idempotency_key_uq;

ALTER TABLE public.users
  DROP CONSTRAINT users_id_school_notification_uq;

ALTER TABLE public.notifications NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences NO FORCE ROW LEVEL SECURITY;

COMMIT;
