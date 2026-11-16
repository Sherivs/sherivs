-- APPLIED TO PRODUCTION 2026-11-15. The exact SQL that ran is in ops/2026-11-15-apply-engine20-engine22/.
-- Kept here as the reviewed source. Not in the migrations directory: the neutrality guard rejects school vocabulary there.
-- ENGINE-22 (ADR-100): who holds the roles the organization agents answer to.
-- Code side: frontend/src/lib/org-workforce/agent-state-loader.ts and activation.ts.
-- Applied to production directly (no staging, by the owner's decision), AFTER ENGINE-20 (it reads org_agent_catalog); rollback is in the ops folder.
--
-- Why a function and not a plain read of organization_memberships:
--  The table's policy lets a school administrator read other people's rows, and everyone else
--  read only their own. Someone who may switch agents on (settings.manage) is not always a school
--  administrator, so a plain read would show them no holders and the roster would wrongly say
--  an agent is waiting for someone to hold its role.
--
-- What it adds:
--  * org_agent_holders(p_org)  the active members of one organization whose role is one that some
--                              agent is accountable to (read from org_agent_catalog). Needs the
--                              caller to hold settings.manage in that organization. Returns an
--                              id and a role, nothing else, and never learners or parents.
--
-- Rules:
--  * The caller must be signed in and hold settings.manage in the organization; the platform
--    sheriff passes that test through scholar_can. Anyone else is refused.
--  * A membership counts only while is_active is true.
--  * There is no pending-invitation state to read: this repository's invite path writes an active
--    membership straight away, so an active membership is treated as an accepted invitation. If a
--    pending state is ever introduced, this function and the app's mapping must change together.
--
-- Depends on existing objects: public.organization_memberships(user_id, school_id, role,
-- is_active), public.org_agent_catalog (ENGINE-20), public.scholar_can(uuid, text), auth.uid().

BEGIN;

CREATE OR REPLACE FUNCTION public.org_agent_holders(p_org uuid)
RETURNS TABLE (holder_id uuid, holder_role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_org IS NULL OR NOT public.scholar_can(p_org, 'settings.manage') THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT m.user_id, m.role
    FROM public.organization_memberships m
   WHERE m.school_id = p_org
     AND m.is_active
     AND m.role IN (SELECT DISTINCT c.accountable FROM public.org_agent_catalog c)
   ORDER BY m.role, m.user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.org_agent_holders(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_agent_holders(uuid) TO authenticated;

COMMIT;

-- Rollback (for the migration that adopts this proposal):
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.org_agent_holders(uuid);
-- COMMIT;
