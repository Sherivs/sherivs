-- CORE-19: preserve the existing notification tables while enforcing replay
-- safety and recipient/school integrity. Authenticated delivery remains in-app.
-- Authored for review; do not apply without explicit non-production authorization.
BEGIN;

ALTER TABLE public.users
  ADD CONSTRAINT users_id_school_notification_uq UNIQUE (id, school_id);

ALTER TABLE public.notifications
  ADD COLUMN idempotency_key text,
  ADD CONSTRAINT notifications_idempotency_key_length
    CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 128),
  ADD CONSTRAINT notifications_recipient_school_fkey
    FOREIGN KEY (user_id, school_id)
    REFERENCES public.users (id, school_id)
    ON DELETE CASCADE;

CREATE UNIQUE INDEX notifications_school_user_idempotency_key_uq
  ON public.notifications (school_id, user_id, idempotency_key);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences FORCE ROW LEVEL SECURITY;

COMMIT;
