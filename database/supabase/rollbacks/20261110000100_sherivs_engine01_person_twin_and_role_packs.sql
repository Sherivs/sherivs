-- Rollback of 20261110000100_sherivs_engine01_person_twin_and_role_packs.sql.
-- Exact inverse. Drops triggers before functions and children before parents.
-- Memory scopes created by the engine (declared_by = 'twin-engine') are removed
-- only if no memory record references them.

DROP TRIGGER IF EXISTS cg_twin_on_staff_role_change_trg ON public.platform_staff_roles;
DROP TRIGGER IF EXISTS cg_twin_on_staff_change_trg ON public.platform_staff;
DROP TRIGGER IF EXISTS cg_twin_on_membership_change_trg ON public.organization_memberships;
DROP TRIGGER IF EXISTS cg_role_pack_after_publish_trg ON public.cg_role_pack;

DROP FUNCTION IF EXISTS public.cg_twin_reconcile();
DROP FUNCTION IF EXISTS public.cg_twin_on_staff_role_change();
DROP FUNCTION IF EXISTS public.cg_twin_on_staff_change();
DROP FUNCTION IF EXISTS public.cg_twin_on_membership_change();
DROP FUNCTION IF EXISTS public.cg_role_pack_after_publish();
DROP FUNCTION IF EXISTS public.cg_twin_bind_pending_contexts();
DROP FUNCTION IF EXISTS public.cg_twin_ensure_context(uuid, text, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.cg_twin_audit(uuid, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.cg_twin_seed_trust(uuid, text, text);
DROP FUNCTION IF EXISTS public.cg_twin_ensure_person(uuid);
DROP FUNCTION IF EXISTS public.cg_twin_platform_tenant();

DROP TABLE IF EXISTS public.cg_twin_trust;
DROP TABLE IF EXISTS public.cg_twin_context;
DROP TABLE IF EXISTS public.cg_twin_person;

DROP FUNCTION IF EXISTS public.cg_twin_latest_pack(text, text);
DROP TABLE IF EXISTS public.cg_role_pack;
DROP FUNCTION IF EXISTS public.cg_twin_trust_guard();
DROP FUNCTION IF EXISTS public.cg_role_pack_guard();

DELETE FROM public.cg_memory_scope s
 WHERE s.declared_by = 'twin-engine'
   AND NOT EXISTS (SELECT 1 FROM public.cg_memory_record r WHERE r.scope_id = s.id);
