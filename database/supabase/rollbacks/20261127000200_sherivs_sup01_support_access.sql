-- Rollback for SUP-01. Drops the grant and audit tables (their rows are lost: export them first if any exist).
DROP FUNCTION IF EXISTS public.support_audit_list(uuid, integer), public.support_grants_list(uuid),
  public.support_access_log(uuid, text, text, text, jsonb), public.support_grant_revoke(uuid),
  public.support_break_glass_open(uuid, text, text[]), public.support_grant_second_approve(uuid),
  public.support_grant_confirm(uuid), public.support_grant_request(uuid, text, text, text, text[], text, integer),
  public.support_audit_write(uuid, text, text, jsonb);
DROP TABLE IF EXISTS public.support_access_audit, public.support_access_grant;
DROP FUNCTION IF EXISTS public.support_audit_guard(), public.support_grant_guard();
ALTER TABLE public.wf_sensitive_step_up DROP CONSTRAINT IF EXISTS wf_sensitive_step_up_action_kind_check;
ALTER TABLE public.wf_sensitive_step_up ADD CONSTRAINT wf_sensitive_step_up_action_kind_check
  CHECK (action_kind IN ('agent_promotion', 'production_change'));
