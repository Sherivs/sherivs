-- Rollback SHERIVS-B01: head console. Head grants and their audit are dropped with their tables.
BEGIN;
DROP FUNCTION IF EXISTS public.head_console_overview(text), public.head_console_session(text), public._my_head_roles(uuid),
  public.head_role_revoke(uuid), public.head_role_grant(uuid, text, text, timestamptz), public._is_aal2();
DROP TABLE IF EXISTS public.head_console_audit;
DROP FUNCTION IF EXISTS public._head_console_audit_immutable();
DROP TABLE IF EXISTS public.institution_heads;
COMMIT;
