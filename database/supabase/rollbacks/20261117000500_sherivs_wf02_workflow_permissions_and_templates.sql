-- Rollback for 20261117000500_sherivs_wf02_workflow_permissions_and_templates.sql (WF-02, ADR-104).
-- Removes WF-02 catalog entries and template data, and removes only WF-02 guard objects.
-- Existing workflow tables, guards, permissions, and audit records are retained.
BEGIN;

DROP TABLE IF EXISTS public.wf_template CASCADE;

DROP TRIGGER IF EXISTS wf_approval_20_sod_guard ON public.wf_approval;
DROP TRIGGER IF EXISTS wf_version_20_sod_guard ON public.wf_version;
DROP TRIGGER IF EXISTS wf_version_05_editor_stamp ON public.wf_version;

DROP FUNCTION IF EXISTS public.wf_approval_sod_guard();
DROP FUNCTION IF EXISTS public.wf_version_sod_guard();
DROP FUNCTION IF EXISTS public.wf_version_editor_stamp();

CREATE OR REPLACE FUNCTION public.wf_version_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'draft' THEN
      RAISE EXCEPTION 'wf_version: published versions are never deleted' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'draft' THEN
      RAISE EXCEPTION 'wf_version: a version starts as a draft' USING ERRCODE = '42501';
    END IF;
    NEW.created_by := auth.uid();
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF NEW.definition_id IS DISTINCT FROM OLD.definition_id OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'wf_version: identity fields are immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.state = 'draft' THEN
    IF NEW.state = 'draft' THEN
      NEW.published_at := NULL; NEW.published_by := NULL; NEW.graph_digest := NULL; NEW.retired_at := NULL;
      RETURN NEW;
    ELSIF NEW.state = 'published' THEN
      IF auth.uid() IS NOT NULL THEN
        RAISE EXCEPTION 'wf_version: publishing goes through the service publish path' USING ERRCODE = '42501';
      END IF;
      NEW.published_at := now();
      NEW.graph_digest := encode(sha256(convert_to(NEW.graph::text, 'UTF8')), 'hex');
      NEW.retired_at := NULL;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'wf_version: a draft can only be published' USING ERRCODE = '42501';
  END IF;
  IF OLD.state = 'published' AND NEW.state = 'retired' AND auth.uid() IS NULL
     AND (NEW.graph, NEW.graph_digest, NEW.max_steps_per_run, NEW.max_run_depth, NEW.max_loop_iterations,
          NEW.default_max_attempts, NEW.run_timeout_seconds, NEW.published_at, NEW.published_by)
         IS NOT DISTINCT FROM
         (OLD.graph, OLD.graph_digest, OLD.max_steps_per_run, OLD.max_run_depth, OLD.max_loop_iterations,
          OLD.default_max_attempts, OLD.run_timeout_seconds, OLD.published_at, OLD.published_by) THEN
    NEW.retired_at := now();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'wf_version: published versions are immutable' USING ERRCODE = '42501';
END
$$;

ALTER TABLE IF EXISTS public.wf_version DROP COLUMN IF EXISTS updated_by;
ALTER TABLE IF EXISTS public.wf_approval DROP COLUMN IF EXISTS target_version_id;

DELETE FROM public.org_role_permission_settings
 WHERE permission_code IN ('workflows.view', 'workflows.manage', 'workflows.run', 'workflows.approve');
DELETE FROM public.org_role_custom_grants
 WHERE permission_code IN ('workflows.view', 'workflows.manage', 'workflows.run', 'workflows.approve');
DELETE FROM public.workspace_responsibility_permissions
 WHERE permission_code IN ('workflows.view', 'workflows.manage', 'workflows.run', 'workflows.approve');
DROP TRIGGER IF EXISTS trg_role_template_permissions_guard ON public.role_template_permissions;
DELETE FROM public.role_template_permissions
 WHERE permission_code IN ('workflows.view', 'workflows.manage', 'workflows.run', 'workflows.approve');
CREATE TRIGGER trg_role_template_permissions_guard
  BEFORE UPDATE OR DELETE ON public.role_template_permissions
  FOR EACH ROW EXECUTE FUNCTION public.role_catalog_guard();
DELETE FROM public.sod_permission_rules
 WHERE permission_a = 'workflows.manage' AND permission_b = 'workflows.approve';
DELETE FROM public.permission_catalog
 WHERE code IN ('workflows.view', 'workflows.manage', 'workflows.run', 'workflows.approve');

DO $verify$
BEGIN
  IF to_regclass('public.wf_template') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'wf_version' AND column_name = 'updated_by'
     )
     OR EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'wf_approval' AND column_name = 'target_version_id'
     )
     OR EXISTS (
       SELECT 1 FROM public.permission_catalog
        WHERE code IN ('workflows.view', 'workflows.manage', 'workflows.run', 'workflows.approve')
     )
     OR EXISTS (
       SELECT 1 FROM public.role_template_permissions
        WHERE permission_code IN ('workflows.view', 'workflows.manage', 'workflows.run', 'workflows.approve')
     )
     OR EXISTS (
       SELECT 1 FROM public.sod_permission_rules
        WHERE permission_a = 'workflows.manage' AND permission_b = 'workflows.approve'
     )
     OR EXISTS (
       SELECT 1 FROM pg_trigger
        WHERE tgname IN ('wf_version_05_editor_stamp', 'wf_version_20_sod_guard', 'wf_approval_20_sod_guard')
          AND NOT tgisinternal
     )
     OR EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('wf_version_editor_stamp', 'wf_version_sod_guard', 'wf_approval_sod_guard')
     ) THEN
    RAISE EXCEPTION 'WF-02 rollback: WF-02 objects or permission entries remain';
  END IF;
END
$verify$;

COMMIT;
