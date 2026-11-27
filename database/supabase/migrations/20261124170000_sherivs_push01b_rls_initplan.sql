-- PUSH-01b: RLS initplan fix + service_role prune grant for mobile_push_devices
-- Rollback: database/supabase/rollbacks/20261124170000_sherivs_push01b_rls_initplan.sql
-- Related to Sherivs/sherivs#501
-- Follows PUSH-01 migration 20261124000000_sherivs_push01_mobile_push_devices.sql

BEGIN;

-- Drop and recreate mobile_push_devices_read_own to wrap auth.uid() in (select auth.uid())
-- This clears the WARN auth_rls_initplan warning.
DROP POLICY IF EXISTS mobile_push_devices_read_own ON public.mobile_push_devices;

CREATE POLICY mobile_push_devices_read_own
  ON public.mobile_push_devices
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

-- Grant UPDATE and DELETE to service_role (in addition to existing SELECT).
GRANT UPDATE, DELETE ON TABLE public.mobile_push_devices TO service_role;

-- Add UPDATE policy for service_role to allow pruning (set revoked_at, disable, etc).
CREATE POLICY mobile_push_devices_service_update
  ON public.mobile_push_devices
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Add DELETE policy for service_role to allow pruning (delete rows).
CREATE POLICY mobile_push_devices_service_delete
  ON public.mobile_push_devices
  FOR DELETE
  TO service_role
  USING (true);

COMMIT;
