-- Rollback for 20261102180300_sherivs_m04_tenant_authority_links.sql.
BEGIN;

DROP FUNCTION IF EXISTS public.read_my_tenant_hierarchy();

DROP POLICY IF EXISTS institution_authority_links_read ON public.institution_authority_links;
DROP POLICY IF EXISTS institution_authority_links_insert ON public.institution_authority_links;
DROP POLICY IF EXISTS institution_authority_links_update ON public.institution_authority_links;
DROP POLICY IF EXISTS institution_authority_links_delete ON public.institution_authority_links;
DROP POLICY IF EXISTS institution_authority_link_audit_read ON public.institution_authority_link_audit;

DROP TRIGGER IF EXISTS institution_authority_link_actor_guard ON public.institution_authority_links;
DROP TRIGGER IF EXISTS institution_authority_link_audit ON public.institution_authority_links;
DROP TRIGGER IF EXISTS institution_authority_link_audit_immutable ON public.institution_authority_link_audit;
DROP TRIGGER IF EXISTS institution_authority_link_audit_immutable_truncate ON public.institution_authority_link_audit;

DROP FUNCTION IF EXISTS public.institution_authority_link_actor_guard();
DROP FUNCTION IF EXISTS public.institution_authority_link_audit();
DROP FUNCTION IF EXISTS public.institution_authority_link_audit_immutable();

DROP TABLE IF EXISTS public.institution_authority_links;
DROP TABLE IF EXISTS public.institution_authority_link_audit;

ALTER TABLE public.school_shifts
  DROP CONSTRAINT IF EXISTS school_shifts_campus_school_m04_fk;
DROP INDEX IF EXISTS public.campuses_id_school_id_m04_uq;

COMMIT;
