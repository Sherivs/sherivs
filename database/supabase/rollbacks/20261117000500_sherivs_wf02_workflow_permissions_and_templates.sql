-- Rollback for 20261117000500_sherivs_wf02_workflow_permissions_and_templates.sql (WF-02, ADR-104).
-- Removes WF-02 catalog entries and template data, and removes only WF-02 guard objects.
-- Existing workflow tables, guards, permissions, and audit records are retained.
BEGIN;

DROP TABLE IF EXISTS public.wf_template CASCADE;

DROP TRIGGER IF EXISTS wf_approval_20_sod_guard ON public.wf_approval;
DROP TRIGGER IF EXISTS wf_version_20_sod_guard ON public.wf_version;
DROP TRIGGER IF EXISTS wf_version_15_service_author_stamp ON public.wf_version;
DROP TRIGGER IF EXISTS wf_version_05_editor_stamp ON public.wf_version;

DROP FUNCTION IF EXISTS public.wf_approval_sod_guard();
DROP FUNCTION IF EXISTS public.wf_version_sod_guard();
DROP FUNCTION IF EXISTS public.wf_version_service_author_stamp();
DROP FUNCTION IF EXISTS public.wf_version_editor_stamp();

ALTER TABLE IF EXISTS public.wf_version DROP COLUMN IF EXISTS updated_by;

DELETE FROM public.org_role_permission_settings
 WHERE permission_code IN ('workflows.view', 'workflows.manage', 'workflows.run', 'workflows.approve');
DELETE FROM public.org_role_custom_grants
 WHERE permission_code IN ('workflows.view', 'workflows.manage', 'workflows.run', 'workflows.approve');
DELETE FROM public.workspace_responsibility_permissions
 WHERE permission_code IN ('workflows.view', 'workflows.manage', 'workflows.run', 'workflows.approve');
DELETE FROM public.role_template_permissions
 WHERE permission_code IN ('workflows.view', 'workflows.manage', 'workflows.run', 'workflows.approve');
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
        WHERE tgname IN ('wf_version_05_editor_stamp', 'wf_version_15_service_author_stamp',
                         'wf_version_20_sod_guard', 'wf_approval_20_sod_guard')
          AND NOT tgisinternal
     )
     OR EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('wf_version_editor_stamp', 'wf_version_service_author_stamp',
                            'wf_version_sod_guard', 'wf_approval_sod_guard')
     ) THEN
    RAISE EXCEPTION 'WF-02 rollback: WF-02 objects or permission entries remain';
  END IF;
END
$verify$;

COMMIT;
