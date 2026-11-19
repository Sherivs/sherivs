-- WF-02 STAGING PREREQUISITE SHIM. STAGING PROJECT ONLY. NEVER RUN ON PRODUCTION.
--
-- Why: the staging project holds only the WF-01 and M1 shims, not the application schema. The
-- WF-02 migration checks for, and writes to, the permission catalog and the M009 SoD helpers.
-- This file adds the smallest stand-ins so the real WF-02 migration file applies unchanged.
--
-- Fidelity:
--   * Copied verbatim from 20261024000240_sherivs_017_role_permission_catalog.sql:
--     role_catalog_guard() and trg_role_template_permissions_guard.
--   * Simplified stand-ins: permission_catalog, role_templates (6 codes the WF-02 test uses),
--     sod_permission_rules, role_assignment_delegations, workspace_responsibility_permissions,
--     and system role_catalog rows (one per template). Two extra columns on existing shim tables:
--     role_catalog.requires_verified_authority_link and user_role_assignments.assigned_by.
--   * workspace_role_sod_validate_schedule(uuid,uuid) is a no-op stand-in. The migration calls
--     it only for active assignments holding manage/approve; staging has none at apply time.
--   The full-fidelity proof is the CI "Migration dry-run" job (every migration in order + the
--   WF-02 integration file against the real helpers).
--
-- Guard: requires the WF-01 shim marker; refuses if real application tables exist.
-- Teardown (after the WF-02 rollback): wf02-staging-prereq-shim.teardown.sql
BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.wf01_staging_shim_marker') IS NULL THEN
    RAISE EXCEPTION 'WF02 SHIM: refusing: WF-01 staging shim marker not found (not the staging project?)';
  END IF;
  IF to_regclass('public.payment_intents') IS NOT NULL OR to_regclass('public.cg_tenant') IS NOT NULL THEN
    RAISE EXCEPTION 'WF02 SHIM: refusing: this database holds the real application schema';
  END IF;
  IF to_regclass('public.wf02_staging_shim_marker') IS NOT NULL THEN
    RAISE EXCEPTION 'WF02 SHIM: already installed';
  END IF;
END $guard$;

CREATE TABLE public.wf02_staging_shim_marker (
  installed_at timestamptz NOT NULL DEFAULT now(),
  note text NOT NULL DEFAULT 'WF-02 staging prerequisite shim; not application schema'
);
INSERT INTO public.wf02_staging_shim_marker DEFAULT VALUES;

CREATE TABLE public.permission_catalog (
  code text PRIMARY KEY, module text NOT NULL, label text NOT NULL,
  sensitivity text NOT NULL CHECK (sensitivity IN ('public','internal','confidential','restricted')),
  protected boolean NOT NULL DEFAULT false);
CREATE TABLE public.role_templates (
  code text PRIMARY KEY,
  default_scope text NOT NULL CHECK (default_scope IN ('org','campus','faculty','department','class','self')),
  data_sensitivity text NOT NULL CHECK (data_sensitivity IN ('public','internal','confidential','restricted')),
  approval_limit_ngn numeric(14,2),
  guardrails text[] NOT NULL DEFAULT '{}');
CREATE TABLE public.sod_permission_rules (
  permission_a text NOT NULL REFERENCES public.permission_catalog(code),
  permission_b text NOT NULL REFERENCES public.permission_catalog(code),
  description text NOT NULL, PRIMARY KEY (permission_a, permission_b));
CREATE TABLE public.role_assignment_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, assignment_id uuid NOT NULL,
  delegate_user_id uuid NOT NULL, revoked_at timestamptz);
CREATE TABLE public.workspace_responsibility_permissions (
  responsibility_id uuid NOT NULL, permission_code text NOT NULL REFERENCES public.permission_catalog(code),
  PRIMARY KEY (responsibility_id, permission_code));
ALTER TABLE public.role_catalog ADD COLUMN requires_verified_authority_link boolean NOT NULL DEFAULT false;
ALTER TABLE public.user_role_assignments ADD COLUMN assigned_by uuid;

ALTER TABLE public.wf02_staging_shim_marker ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permission_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sod_permission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_assignment_delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_responsibility_permissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wf02_staging_shim_marker, public.permission_catalog, public.role_templates,
  public.sod_permission_rules, public.role_assignment_delegations, public.workspace_responsibility_permissions
  FROM PUBLIC, anon, authenticated;

INSERT INTO public.role_templates (code, default_scope, data_sensitivity) VALUES
  ('proprietor', 'org', 'restricted'), ('head_of_institution', 'org', 'restricted'),
  ('governance_board', 'org', 'confidential'), ('auditor', 'org', 'restricted'),
  ('teacher', 'class', 'confidential'), ('parent', 'self', 'confidential');
INSERT INTO public.role_catalog (code, template_code, org_id) VALUES
  ('proprietor', 'proprietor', NULL), ('head_of_institution', 'head_of_institution', NULL),
  ('governance_board', 'governance_board', NULL), ('auditor', 'auditor', NULL),
  ('teacher', 'teacher', NULL), ('parent', 'parent', NULL)
ON CONFLICT (code) DO NOTHING;

-- Copied verbatim from 20261024000240_sherivs_017_role_permission_catalog.sql
CREATE OR REPLACE FUNCTION public.role_catalog_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'role_template_permissions' THEN
    IF TG_OP = 'DELETE' AND OLD.kind = 'mandatory' THEN RAISE EXCEPTION 'mandatory permission % on % cannot be removed', OLD.permission_code, OLD.template_code USING ERRCODE = '42501'; END IF;
    IF TG_OP = 'UPDATE' AND OLD.kind = 'mandatory' AND (NEW.kind <> 'mandatory' OR NEW.permission_code <> OLD.permission_code OR NEW.template_code <> OLD.template_code) THEN
      RAISE EXCEPTION 'mandatory permission % on % cannot be downgraded', OLD.permission_code, OLD.template_code USING ERRCODE = '42501'; END IF;
  ELSIF TG_TABLE_NAME = 'role_templates' THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'role templates cannot be deleted' USING ERRCODE = '42501'; END IF;
    IF NOT (OLD.guardrails <@ NEW.guardrails) THEN RAISE EXCEPTION 'guardrails on % cannot be removed', OLD.code USING ERRCODE = '42501'; END IF;
  ELSIF TG_TABLE_NAME = 'role_catalog' THEN
    IF TG_OP = 'UPDATE' AND OLD.org_id IS NOT NULL AND NEW.template_code <> OLD.template_code THEN
      RAISE EXCEPTION 'a custom role keeps its base role template' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS trg_role_template_permissions_guard ON public.role_template_permissions;
CREATE TRIGGER trg_role_template_permissions_guard BEFORE UPDATE OR DELETE ON public.role_template_permissions FOR EACH ROW EXECUTE FUNCTION public.role_catalog_guard();
REVOKE ALL ON FUNCTION public.role_catalog_guard() FROM PUBLIC, anon, authenticated;

-- No-op stand-in (see header).
CREATE FUNCTION public.workspace_role_sod_validate_schedule(p_org uuid, p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$ BEGIN RETURN; END $$;
REVOKE ALL ON FUNCTION public.workspace_role_sod_validate_schedule(uuid, uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
