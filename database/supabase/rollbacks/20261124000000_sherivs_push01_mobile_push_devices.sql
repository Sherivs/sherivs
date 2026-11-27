-- Rollback for 20261124000000_sherivs_push01_mobile_push_devices.sql
-- Drops PUSH-01 device registry objects and preference extensions.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.register_push_device(text, text, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.unregister_push_device(text) FROM authenticated;

DROP FUNCTION IF EXISTS public.register_push_device(text, text, text, text);
DROP FUNCTION IF EXISTS public.unregister_push_device(text);

DROP TRIGGER IF EXISTS mobile_push_devices_touch ON public.mobile_push_devices;
DROP TABLE IF EXISTS public.mobile_push_devices CASCADE;

ALTER TABLE public.notification_preferences
  DROP COLUMN IF EXISTS push_messages,
  DROP COLUMN IF EXISTS push_announcements,
  DROP COLUMN IF EXISTS push_grades,
  DROP COLUMN IF EXISTS push_attendance,
  DROP COLUMN IF EXISTS push_fees,
  DROP COLUMN IF EXISTS timezone;

COMMIT;
