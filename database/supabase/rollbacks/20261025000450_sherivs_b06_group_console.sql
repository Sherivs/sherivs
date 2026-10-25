BEGIN;
DROP FUNCTION IF EXISTS public.group_admins_list(uuid), public.group_overview(uuid), public.group_console_session(text), public.group_school_leave(uuid),
  public.school_group_decide(uuid, boolean), public.school_group_requests(), public.group_join_request(uuid, uuid), public.group_admin_set(uuid, uuid, text),
  public.group_create(text, text, uuid), public._grp_school_admin(uuid), public._grp_guard(uuid, text[]), public._grp_role(uuid),
  public._grp_is_platform_admin(), public._grp_is_aal2();
DROP TABLE IF EXISTS public.org_group_audit, public.org_group_join_requests, public.org_group_admins;
DROP FUNCTION IF EXISTS public._grp_audit_append_only();
DROP INDEX IF EXISTS public.org_groups_host_label_uq;
ALTER TABLE public.org_groups DROP CONSTRAINT IF EXISTS org_groups_host_label_chk, DROP COLUMN IF EXISTS host_label;
COMMIT;
