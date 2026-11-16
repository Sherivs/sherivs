-- APPLIED TO PRODUCTION 2026-11-16 22:22 UTC (project nwrflbpbhyiqdptmlccm) on the founder's written instruction.
-- M12B: the retention policy audit trigger must not block the first organization a person creates.
-- Origin: Claude Code agent, mission E-003 (M0). Found by CI on 2026-11-16, the first run since
-- the retention migration (20261104014000) merged: integration test ENT-01 D2 fails with
--   insert or update on table "retention_policy_audit_events" violates foreign key constraint
--   "retention_policy_audit_events_actor_id_fkey"
-- Cause: creating an organization seeds its default retention policies, and the audit trigger
-- records auth.uid() as the actor. actor_id references public.users, and a person creating their
-- first organization has no row there yet, so the whole creation fails.
-- Fix: record the actor only when that person has a row; otherwise leave it empty (the column is
-- nullable and the action is 'default_seeded', a system seed). Nothing else in the function
-- changes. CREATE OR REPLACE keeps the function's owner and privileges.

CREATE OR REPLACE FUNCTION public.retention_policy_audit_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before jsonb;
  v_after jsonb := jsonb_build_object(
    'policy_ref', NEW.policy_ref,
    'category', NEW.category,
    'target_table', NEW.target_table,
    'retention_days', NEW.retention_days,
    'enabled', NEW.enabled
  );
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_before := jsonb_build_object(
      'policy_ref', OLD.policy_ref,
      'category', OLD.category,
      'target_table', OLD.target_table,
      'retention_days', OLD.retention_days,
      'enabled', OLD.enabled
    );
  END IF;
  INSERT INTO public.retention_policy_audit_events (
    org_id, policy_id, policy_ref, actor_id, action, before_state, after_state
  ) VALUES (
    NEW.org_id, NEW.id, NEW.policy_ref,
    (SELECT u.id FROM public.users u WHERE u.id = auth.uid()),
    CASE WHEN TG_OP = 'INSERT' THEN 'default_seeded' ELSE 'updated' END,
    v_before, v_after
  );
  RETURN NEW;
END
$$;
