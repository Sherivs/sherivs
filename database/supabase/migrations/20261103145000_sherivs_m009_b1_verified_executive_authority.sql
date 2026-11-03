-- M009 Stage B-1: keep tertiary executive authority behind an explicit, verified tenant link.
-- A relationship is eligibility evidence only; role-template permissions remain the authority.
DO $guard$
BEGIN
  IF to_regclass('public.role_catalog') IS NULL
     OR to_regclass('public.role_templates') IS NULL
     OR to_regclass('public.role_template_permissions') IS NULL
     OR to_regclass('public.user_role_assignments') IS NULL
     OR to_regclass('public.institution_authority_links') IS NULL
     OR to_regprocedure('public.workspace_effective_permission_rows_at(uuid,uuid,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'M009-B1 requires M009-A1 and M04 role and authority-link contracts'
      USING ERRCODE = '55000';
  END IF;
END
$guard$;

BEGIN;

ALTER TABLE public.role_catalog
  ADD COLUMN IF NOT EXISTS requires_verified_authority_link boolean NOT NULL DEFAULT false;

INSERT INTO public.role_templates (code, default_scope, data_sensitivity, approval_limit_ngn, guardrails)
VALUES (
  'm009_tertiary_executive_read_only',
  'institution',
  'confidential',
  NULL,
  ARRAY['tenant_isolation','audited','verified_institution_authority_link','read_only']::text[]
)
ON CONFLICT (code) DO UPDATE
  SET default_scope = EXCLUDED.default_scope,
      data_sensitivity = EXCLUDED.data_sensitivity,
      approval_limit_ngn = EXCLUDED.approval_limit_ngn,
      guardrails = EXCLUDED.guardrails;

INSERT INTO public.role_template_permissions (template_code, permission_code, kind, default_on)
VALUES
  ('m009_tertiary_executive_read_only','analytics.institution','mandatory',true),
  ('m009_tertiary_executive_read_only','reports.academic','mandatory',true),
  ('m009_tertiary_executive_read_only','reports.financial','mandatory',true)
ON CONFLICT (template_code, permission_code) DO UPDATE
  SET kind = EXCLUDED.kind, default_on = EXCLUDED.default_on;

UPDATE public.role_catalog
   SET template_code = 'm009_tertiary_executive_read_only',
       requires_verified_authority_link = true
 WHERE org_id IS NULL
   AND code IN (
     'ng.vice_chancellor',
     'ng.acting_vice_chancellor',
     'ng.deputy_vice_chancellor_academic',
     'ng.deputy_vice_chancellor_research_innovation_and_development',
     'ng.deputy_vice_chancellor_administration',
     'ng.deputy_vice_chancellor_management_services',
     'ng.rector',
     'ng.acting_rector',
     'ng.deputy_rector_academics',
     'ng.deputy_rector_administration',
     'ng.provost',
     'ng.acting_provost',
     'ng.deputy_provost_academics',
     'ng.deputy_provost_administration',
     'ng.provost_of_college_university',
     'ng.provost_postgraduate_college'
   );

UPDATE public.role_catalog
   SET requires_verified_authority_link = true
 WHERE org_id IS NULL
   AND code IN (
    'ng.proprietor',
    'ng.proprietress',
    'ng.founder_chairman_private_institution',
    'ng.group_managing_director_schools_group',
    'ng.group_executive_director',
    'ng.chief_executive_officer_schools_group',
    'ng.board_of_governors_chairman',
    'ng.board_of_governors_member',
    'ng.school_management_board_member',
    'ng.visitor_university',
    'ng.pro_chancellor_chairman_of_council',
    'ng.governing_council_member',
    'ng.trustee_faith_mission_school',
    'ng.mission_education_secretary',
    'ng.diocesan_mission_education_director',
    'ng.proprietor_s_representative',
    'ng.group_director_of_education',
    'ng.campus_director',
    'ng.director_of_studies_private',
    'ng.principal',
    'ng.principal_senior_school',
    'ng.principal_junior_school',
    'ng.head_of_school_executive_principal',
    'ng.director_private_school',
    'ng.dean_of_faculty',
    'ng.dean_of_school_polytechnic',
    'ng.dean_of_college',
    'ng.dean_postgraduate_school'
   );

CREATE OR REPLACE FUNCTION public.workspace_authority_link_evidence_is_verified(
  p_org uuid,
  p_evidence text[],
  p_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.organization_memberships m
         JOIN public.users u ON u.id = m.user_id
        WHERE m.school_id = p_org AND m.user_id = auth.uid()
          AND m.is_active AND u.is_active IS TRUE
     )
     AND (
       SELECT count(*) = 1
         FROM unnest(coalesce(p_evidence, '{}'::text[])) AS evidence(value)
        WHERE left(evidence.value, 15) = 'authority_link:'
     )
     AND EXISTS (
       SELECT 1
         FROM unnest(coalesce(p_evidence, '{}'::text[])) AS evidence(value)
         JOIN public.institution_authority_links l
           ON lower(l.id::text) = lower(substring(evidence.value FROM 16))
        WHERE evidence.value ~ '^authority_link:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          AND l.school_id = p_org
          AND l.verification_status = 'verified'
          AND l.effective_from <= p_at
          AND (l.effective_until IS NULL OR l.effective_until > p_at)
     )
$$;

CREATE OR REPLACE FUNCTION public.workspace_authority_role_assignment_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'active'
     AND EXISTS (
       SELECT 1 FROM public.role_catalog r
        WHERE r.code = NEW.role_code
          AND r.requires_verified_authority_link
          AND (r.org_id IS NULL OR r.org_id = NEW.org_id)
     )
     AND NOT public.workspace_authority_link_evidence_is_verified(
       NEW.org_id, NEW.evidence, NEW.started_at
     ) THEN
    RAISE EXCEPTION 'authority-dependent role assignments require one verified, effective institution-authority link in evidence'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_workspace_authority_role_assignment ON public.user_role_assignments;
CREATE TRIGGER trg_workspace_authority_role_assignment
  BEFORE INSERT OR UPDATE OF org_id, role_code, status, started_at, evidence
  ON public.user_role_assignments
  FOR EACH ROW EXECUTE FUNCTION public.workspace_authority_role_assignment_guard();

REVOKE ALL ON FUNCTION public.workspace_authority_link_evidence_is_verified(uuid,text[],timestamptz)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_authority_link_evidence_is_verified(uuid,text[],timestamptz)
  TO authenticated;
REVOKE ALL ON FUNCTION public.workspace_authority_role_assignment_guard()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.workspace_effective_permission_rows_at(
  p_org uuid, p_user uuid, p_at timestamptz
)
RETURNS TABLE (
  permission_code text, kind text, role_code text, assignment_id uuid,
  scope_type text, scope_ref text, scope_values jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH assigned AS (
    SELECT e.*
      FROM public.workspace_effective_assignments_at(p_org, p_user, p_at) e
      JOIN public.user_role_assignments a ON a.id = e.assignment_id
      JOIN public.role_catalog role ON role.code = e.role_code
     WHERE NOT role.requires_verified_authority_link
        OR public.workspace_authority_link_evidence_is_verified(p_org, a.evidence, p_at)
  ), grants AS (
    SELECT tp.permission_code, tp.kind, a.role_code, a.assignment_id, a.scope_type, a.scope_ref
      FROM assigned a
      JOIN public.role_catalog r ON r.code = a.role_code
      JOIN public.role_template_permissions tp ON tp.template_code = r.template_code
      LEFT JOIN public.org_role_permission_settings s
        ON s.org_id = p_org AND s.role_code = a.role_code AND s.permission_code = tp.permission_code
     WHERE tp.kind = 'mandatory' OR coalesce(s.enabled, tp.default_on)
    UNION ALL
    SELECT rp.permission_code, r.kind, a.role_code, a.assignment_id, a.scope_type, a.scope_ref
      FROM assigned a
      JOIN public.workspace_role_responsibilities rr
        ON rr.org_id = p_org AND rr.role_code = a.role_code
      JOIN public.workspace_responsibility_catalog r ON r.id = rr.responsibility_id
      JOIN public.workspace_responsibility_permissions rp ON rp.responsibility_id = r.id
     WHERE r.kind IN ('core','custom') AND (r.org_id IS NULL OR r.org_id = p_org)
    UNION ALL
    SELECT coalesce(cg.permission_code, cg.custom_key), 'custom', a.role_code, a.assignment_id, a.scope_type, a.scope_ref
      FROM assigned a
      JOIN public.org_role_custom_grants cg ON cg.org_id = p_org AND cg.role_code = a.role_code
    UNION ALL
    SELECT rp.permission_code, 'responsibility', a.role_code, a.assignment_id, a.scope_type, a.scope_ref
      FROM assigned a
      JOIN public.role_assignment_responsibility_grants g ON g.assignment_id = a.assignment_id
      JOIN public.workspace_role_responsibilities rr
        ON rr.org_id = p_org AND rr.role_code = a.role_code AND rr.responsibility_id = g.responsibility_id
      JOIN public.workspace_responsibility_permissions rp ON rp.responsibility_id = g.responsibility_id
     WHERE g.org_id = p_org AND g.valid_from <= p_at
       AND (g.valid_until IS NULL OR g.valid_until > p_at)
       AND (g.revoked_at IS NULL OR g.revoked_at > p_at)
  )
  SELECT g.permission_code, min(g.kind), g.role_code, g.assignment_id, g.scope_type, g.scope_ref,
         CASE WHEN EXISTS (
           SELECT 1 FROM public.role_assignment_scope_sets s WHERE s.assignment_id = g.assignment_id
         ) THEN coalesce((
           SELECT jsonb_agg(DISTINCT jsonb_build_object('type', x.dim, 'ref', x.ref))
             FROM public.role_assignment_scope_sets s
             JOIN public.role_assignment_scopes x ON x.set_id = s.id
            WHERE s.assignment_id = g.assignment_id
         ), '[]'::jsonb)
         ELSE jsonb_build_array(jsonb_build_object(
           'type', CASE WHEN g.scope_type = 'org' THEN 'institution' ELSE g.scope_type END,
           'ref', g.scope_ref
         )) END
    FROM grants g
   GROUP BY g.permission_code, g.role_code, g.assignment_id, g.scope_type, g.scope_ref
$$;

COMMIT;
