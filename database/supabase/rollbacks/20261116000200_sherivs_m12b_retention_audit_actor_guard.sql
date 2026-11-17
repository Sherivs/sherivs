-- Rollback for M12B (20261116000200): restores the retention policy audit trigger function as
-- 20261104014000 defined it. This brings back the failure it fixed: creating an organization as a
-- person with no public.users row fails on the audit foreign key.

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
    NEW.org_id, NEW.id, NEW.policy_ref, auth.uid(),
    CASE WHEN TG_OP = 'INSERT' THEN 'default_seeded' ELSE 'updated' END,
    v_before, v_after
  );
  RETURN NEW;
END
$$;
