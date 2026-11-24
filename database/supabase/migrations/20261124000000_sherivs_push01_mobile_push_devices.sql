-- PUSH-01: per-user Expo push device registry + push notification preferences.
-- Rollback: database/supabase/rollbacks/20261124000000_sherivs_push01_mobile_push_devices.sql
-- Related to Sherivs/sherivs#487

BEGIN;

CREATE TABLE IF NOT EXISTS public.mobile_push_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  expo_push_token text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  app_version text NOT NULL,
  build_number text NOT NULL,
  device_label text,
  enabled boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mobile_push_devices_expo_push_token_key UNIQUE (expo_push_token)
);

CREATE INDEX IF NOT EXISTS mobile_push_devices_user_idx
  ON public.mobile_push_devices (user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS mobile_push_devices_org_idx
  ON public.mobile_push_devices (org_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.mobile_push_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_push_devices FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mobile_push_devices FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.mobile_push_devices TO authenticated;
GRANT SELECT ON TABLE public.mobile_push_devices TO service_role;

CREATE POLICY mobile_push_devices_read_own
  ON public.mobile_push_devices
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY mobile_push_devices_service_read
  ON public.mobile_push_devices
  FOR SELECT
  TO service_role
  USING (true);

DROP TRIGGER IF EXISTS mobile_push_devices_touch ON public.mobile_push_devices;
CREATE TRIGGER mobile_push_devices_touch
  BEFORE UPDATE ON public.mobile_push_devices
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.register_push_device(
  p_token text,
  p_platform text,
  p_app_version text,
  p_build text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_device_id uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'authenticated' OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION 'token is required' USING ERRCODE = '22023';
  END IF;
  IF p_platform IS NULL OR p_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'platform must be ios or android' USING ERRCODE = '22023';
  END IF;
  IF p_app_version IS NULL OR length(trim(p_app_version)) = 0 THEN
    RAISE EXCEPTION 'app_version is required' USING ERRCODE = '22023';
  END IF;
  IF p_build IS NULL OR length(trim(p_build)) = 0 THEN
    RAISE EXCEPTION 'build is required' USING ERRCODE = '22023';
  END IF;

  SELECT public.get_my_organization_id() INTO v_org_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'caller has no tenant context' USING ERRCODE = '42501';
  END IF;

  IF (
    SELECT count(*)
    FROM public.mobile_push_devices d
    WHERE d.user_id = v_user_id
      AND d.revoked_at IS NULL
      AND d.expo_push_token <> p_token
  ) >= 10 THEN
    RAISE EXCEPTION 'device cap reached (10)' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.mobile_push_devices (
    user_id,
    org_id,
    expo_push_token,
    platform,
    app_version,
    build_number,
    enabled,
    last_seen_at,
    revoked_at
  )
  VALUES (
    v_user_id,
    v_org_id,
    p_token,
    p_platform,
    p_app_version,
    p_build,
    true,
    now(),
    NULL
  )
  ON CONFLICT (expo_push_token)
  DO UPDATE SET
    user_id = EXCLUDED.user_id,
    org_id = EXCLUDED.org_id,
    platform = EXCLUDED.platform,
    app_version = EXCLUDED.app_version,
    build_number = EXCLUDED.build_number,
    enabled = true,
    revoked_at = NULL,
    last_seen_at = now(),
    updated_at = now()
  RETURNING id INTO v_device_id;

  RETURN v_device_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.unregister_push_device(p_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_rows integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'authenticated' OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION 'token is required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.mobile_push_devices
     SET enabled = false,
         revoked_at = now(),
         updated_at = now()
   WHERE user_id = v_user_id
     AND expo_push_token = p_token
     AND revoked_at IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.register_push_device(text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.unregister_push_device(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_push_device(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unregister_push_device(text) TO authenticated;

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS push_messages boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS push_announcements boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS push_grades boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS push_attendance boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS push_fees boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Africa/Lagos';

COMMIT;
