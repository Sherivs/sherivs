-- Rollback for 20261124170000_sherivs_push01b_rls_initplan.sql
-- Restores mobile_push_devices_read_own to bare auth.uid() (reverting initplan wrap),
-- drops service_role UPDATE/DELETE policies, and revokes the UPDATE/DELETE grants.

BEGIN;

-- Drop the new service_role write policies.
DROP POLICY IF EXISTS mobile_push_devices_service_update ON public.mobile_push_devices;
DROP POLICY IF EXISTS mobile_push_devices_service_delete ON public.mobile_push_devices;

-- Revoke UPDATE and DELETE from service_role (back to SELECT-only).
REVOKE UPDATE, DELETE ON TABLE public.mobile_push_devices FROM service_role;

-- Restore mobile_push_devices_read_own to bare auth.uid() (pre-PUSH-01b form).
DROP POLICY IF EXISTS mobile_push_devices_read_own ON public.mobile_push_devices;

CREATE POLICY mobile_push_devices_read_own
  ON public.mobile_push_devices
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

COMMIT;
