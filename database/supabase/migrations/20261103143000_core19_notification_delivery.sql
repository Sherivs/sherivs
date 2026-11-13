-- CORE-19: preserve the existing notification tables while enforcing replay
-- safety and recipient/school integrity. Authenticated delivery remains in-app.
-- Authored for review; do not apply without explicit non-production authorization.
BEGIN;

ALTER TABLE public.notifications
  ADD COLUMN idempotency_key text,
  ADD CONSTRAINT notifications_idempotency_key_length
    CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 128);

CREATE UNIQUE INDEX notifications_school_user_idempotency_key_uq
  ON public.notifications (school_id, user_id, idempotency_key);

CREATE OR REPLACE FUNCTION public.core19_validate_notification_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_memberships m
    WHERE m.user_id = NEW.user_id
      AND m.school_id = NEW.school_id
      AND m.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'notification recipient is not an active organization member'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.core19_validate_notification_membership() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER core19_notification_membership_guard
  BEFORE INSERT OR UPDATE OF user_id, school_id ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.core19_validate_notification_membership();

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences FORCE ROW LEVEL SECURITY;

COMMIT;
