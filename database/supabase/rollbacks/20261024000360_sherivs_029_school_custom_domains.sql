-- Rollback SHERIVS-029. Custom-domain rows and their audit are dropped with their tables; schools.domain (legacy) is untouched.
BEGIN;
DROP FUNCTION IF EXISTS public.school_domain_login_allowed(text), public.resolve_school_by_host(text), public.school_domain_for_check(uuid),
  public.school_domain_record_check(uuid, boolean, text, text), public.school_domain_remove(uuid), public.school_domain_set_primary(uuid),
  public.school_domain_add(text, text), public._is_platform_hostname(text);
DROP TABLE IF EXISTS public.school_domain_audit;
DROP FUNCTION IF EXISTS public._school_domain_audit_immutable();
DROP TABLE IF EXISTS public.school_domains;
COMMIT;
