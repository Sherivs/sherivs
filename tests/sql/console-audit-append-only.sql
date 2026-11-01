-- Behavioral proof (LOCAL disposable Supabase stack, as postgres, after
-- SHERIVS-016). The shared audit log rejects UPDATE and DELETE. Rolls back.
BEGIN;

CREATE TEMP TABLE phase_f_audit_test (id uuid) ON COMMIT DROP;

WITH inserted AS (
  INSERT INTO public.audit_logs (action, table_name, record_id, old_value, new_value)
  VALUES (
    'test.phase_f.append_only',
    'platform_organization',
    gen_random_uuid(),
    '{"lifecycle_state":"under_review"}'::jsonb,
    '{"lifecycle_state":"active","outcome":"succeeded"}'::jsonb
  )
  RETURNING id
)
INSERT INTO phase_f_audit_test (id)
SELECT id FROM inserted;

DO $test$
DECLARE
  v_id uuid;
  v_update_rejected boolean := false;
  v_delete_rejected boolean := false;
BEGIN
  SELECT id INTO v_id FROM pg_temp.phase_f_audit_test;

  BEGIN
    UPDATE public.audit_logs
       SET new_value = '{"lifecycle_state":"suspended"}'::jsonb
     WHERE id = v_id;
  EXCEPTION WHEN insufficient_privilege THEN
    v_update_rejected := true;
  END;
  IF NOT v_update_rejected THEN
    RAISE EXCEPTION 'audit_logs accepted UPDATE';
  END IF;

  BEGIN
    DELETE FROM public.audit_logs WHERE id = v_id;
  EXCEPTION WHEN insufficient_privilege THEN
    v_delete_rejected := true;
  END;
  IF NOT v_delete_rejected THEN
    RAISE EXCEPTION 'audit_logs accepted DELETE';
  END IF;
END
$test$;

ROLLBACK;
