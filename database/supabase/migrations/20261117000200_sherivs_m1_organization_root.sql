-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.
-- M1: foundation convergence (ADR-102). Origin: Claude Code agent, mission E-004 (M1).
-- The canonical organization root stays public.schools (founder decision, 2026-11-17). Nothing
-- in any existing policy or helper changes. This migration only adds:
--   1. get_my_organization_id(): a neutral name for the existing root helper.
--   2. More unit types on the one unit tree (workspace_org_units) and a no-self-parent check. The
--      tree already forbids a parent in another organization through its composite foreign key.
--   3. institution_profile: what kind of institution an organization is, effective-dated.
--   4. organization_root_gaps(): lists organizations whose kernel or console record is missing,
--      so provisioning and audits can prove the three records stay 1:1.

-- 1. Neutral alias. Same answer as the root helper, by construction.
CREATE OR REPLACE FUNCTION public.get_my_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $function$ SELECT public.get_my_school_id() $function$;
REVOKE ALL ON FUNCTION public.get_my_organization_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_organization_id() TO authenticated, service_role;

-- 2. One generic unit tree.
ALTER TABLE public.workspace_org_units DROP CONSTRAINT IF EXISTS workspace_org_units_unit_type_check;
ALTER TABLE public.workspace_org_units ADD CONSTRAINT workspace_org_units_unit_type_check
  CHECK (unit_type = ANY (ARRAY[
    'institution', 'group', 'campus', 'shift', 'faculty', 'department', 'class', 'subject',
    'section', 'school_college', 'programme', 'level', 'class_arm', 'house', 'hostel',
    'clinical_site', 'farm_unit', 'directorate', 'agency', 'zone', 'lga', 'lgea']));
ALTER TABLE public.workspace_org_units DROP CONSTRAINT IF EXISTS workspace_org_units_not_own_parent;
ALTER TABLE public.workspace_org_units ADD CONSTRAINT workspace_org_units_not_own_parent
  CHECK (parent_unit_id IS NULL OR parent_unit_id <> id);

-- 3. Institution profile.
CREATE TABLE IF NOT EXISTS public.institution_profile (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  institution_type     text NOT NULL CHECK (institution_type ~ '^[a-z][a-z0-9_]{1,60}$'),
  ownership            text NOT NULL CHECK (ownership IN (
                         'public_federal', 'public_state', 'public_lga', 'private', 'mission',
                         'community', 'military', 'ngo')),
  regulators           text[] NOT NULL DEFAULT '{}' CHECK (cardinality(regulators) <= 12),
  accreditation_status text NOT NULL DEFAULT 'not_stated' CHECK (accreditation_status IN (
                         'not_stated', 'unaccredited', 'interim', 'accredited', 'expired')),
  calendar_model       text NOT NULL CHECK (calendar_model IN ('term', 'semester', 'trimester')),
  grading_system       text NOT NULL CHECK (grading_system ~ '^[a-z][a-z0-9_]{1,60}$'),
  curricula            text[] NOT NULL DEFAULT '{}' CHECK (cardinality(curricula) <= 12),
  languages            text[] NOT NULL DEFAULT ARRAY['en'] CHECK (cardinality(languages) BETWEEN 1 AND 12),
  effective_from       date NOT NULL DEFAULT CURRENT_DATE,
  effective_to         date,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT institution_profile_period CHECK (effective_to IS NULL OR effective_to > effective_from)
);
-- One current profile per organization; history is kept by closing the old row.
CREATE UNIQUE INDEX IF NOT EXISTS institution_profile_one_current
  ON public.institution_profile (org_id) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS institution_profile_org_idx ON public.institution_profile (org_id, effective_from DESC);

ALTER TABLE public.institution_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institution_profile FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.institution_profile FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.institution_profile TO authenticated;
GRANT ALL ON TABLE public.institution_profile TO service_role;

DROP POLICY IF EXISTS institution_profile_read ON public.institution_profile;
CREATE POLICY institution_profile_read ON public.institution_profile
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_my_school_id()) OR (SELECT public.is_super_admin()));
-- Writes are service-role only (provisioning, and the console after approval). Every change is audited.
DROP TRIGGER IF EXISTS trg_institution_profile_audit ON public.institution_profile;
CREATE TRIGGER trg_institution_profile_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.institution_profile
  FOR EACH ROW EXECUTE FUNCTION public.scholar_audit();

-- 4. Proof that the three records of an organization stay 1:1.
CREATE OR REPLACE FUNCTION public.organization_root_gaps()
RETURNS TABLE (org_id uuid, missing text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT s.id, 'kernel_record'::text
    FROM public.schools s
   WHERE NOT EXISTS (SELECT 1 FROM public.school_tenant_map m WHERE m.school_id = s.id)
  UNION ALL
  SELECT s.id, 'console_record'::text
    FROM public.schools s
   WHERE NOT EXISTS (SELECT 1 FROM public.platform_organization p WHERE p.school_id = s.id)
  UNION ALL
  SELECT s.id, 'current_profile'::text
    FROM public.schools s
   WHERE NOT EXISTS (SELECT 1 FROM public.institution_profile i
                      WHERE i.org_id = s.id AND i.effective_to IS NULL);
$function$;
REVOKE ALL ON FUNCTION public.organization_root_gaps() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organization_root_gaps() TO service_role;

-- Verification after an apply (read-only):
--   SELECT public.get_my_organization_id() IS NOT DISTINCT FROM public.get_my_school_id();  [true]
--   SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.institution_profile'::regclass; [true]
--   SELECT count(*) FROM public.organization_root_gaps();          [0 while there are no organizations]
