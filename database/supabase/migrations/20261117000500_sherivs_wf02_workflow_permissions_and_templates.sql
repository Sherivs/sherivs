-- WF-02: workflow permissions, version-level separation of duties and global templates.
-- Scope: V1 organizational workflows; this migration is additive and is not an apply record.
BEGIN;

DO $prereq$
BEGIN
  IF to_regclass('public.wf_version') IS NULL
     OR to_regclass('public.wf_run') IS NULL
     OR to_regclass('public.wf_approval') IS NULL
     OR to_regclass('public.permission_catalog') IS NULL
     OR to_regclass('public.role_templates') IS NULL
     OR to_regclass('public.role_template_permissions') IS NULL
     OR to_regclass('public.sod_permission_rules') IS NULL
     OR to_regclass('public.org_role_permission_settings') IS NULL
     OR to_regclass('public.user_role_assignments') IS NULL
     OR to_regprocedure('public.wf_version_guard()') IS NULL
     OR to_regprocedure('public.wf_approval_guard()') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'WF-02: prerequisite workflow, permission or SoD objects are missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.role_templates WHERE code = 'proprietor')
     OR NOT EXISTS (SELECT 1 FROM public.role_templates WHERE code = 'head_of_institution')
     OR NOT EXISTS (SELECT 1 FROM public.role_templates WHERE code = 'governance_board')
     OR NOT EXISTS (SELECT 1 FROM public.role_templates WHERE code = 'auditor') THEN
    RAISE EXCEPTION 'WF-02: required role templates are missing';
  END IF;
  IF to_regclass('public.wf_template') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM public.permission_catalog
        WHERE code IN ('workflows.view', 'workflows.manage', 'workflows.run', 'workflows.approve')
     ) THEN
    RAISE EXCEPTION 'WF-02: one or more WF-02 objects or permissions already exist';
  END IF;
END
$prereq$;

-- -----------------------------------------------------------------------------
-- 1. Workflow permissions in the existing catalog
-- -----------------------------------------------------------------------------
INSERT INTO public.permission_catalog (code, module, label, sensitivity, protected) VALUES
  ('workflows.view', 'workflow', 'View workflows', 'internal', true),
  ('workflows.manage', 'workflow', 'Create and edit workflow drafts', 'restricted', true),
  ('workflows.run', 'workflow', 'Run workflows', 'restricted', true),
  ('workflows.approve', 'workflow', 'Approve workflow requests', 'restricted', true);

-- Managers can edit, while independent governance roles can approve. The two
-- capabilities are deliberately not assigned to the same template.
INSERT INTO public.role_template_permissions (template_code, permission_code, kind, default_on) VALUES
  ('proprietor', 'workflows.view', 'optional', true),
  ('proprietor', 'workflows.manage', 'optional', true),
  ('proprietor', 'workflows.run', 'optional', true),
  ('head_of_institution', 'workflows.view', 'mandatory', true),
  ('head_of_institution', 'workflows.manage', 'mandatory', true),
  ('head_of_institution', 'workflows.run', 'mandatory', true),
  ('governance_board', 'workflows.view', 'optional', true),
  ('governance_board', 'workflows.approve', 'optional', true),
  ('auditor', 'workflows.view', 'mandatory', true),
  ('auditor', 'workflows.approve', 'optional', true);

INSERT INTO public.sod_permission_rules (permission_a, permission_b, description) VALUES
  ('workflows.manage', 'workflows.approve',
   'Workflow editors and approvers must be different people for the same workflow version');

-- M009 does not revalidate role holders when global template grants are inserted.
-- Reject this migration rather than silently activating a conflicting assignment.
DO $sod_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.user_role_assignments a
      JOIN public.role_catalog r ON r.code = a.role_code
      JOIN public.role_template_permissions tp ON tp.template_code = r.template_code
      LEFT JOIN public.org_role_permission_settings s
        ON s.org_id = a.org_id AND s.role_code = a.role_code AND s.permission_code = tp.permission_code
     WHERE a.status = 'active'
       AND (tp.kind = 'mandatory' OR coalesce(s.enabled, tp.default_on))
       AND tp.permission_code IN ('workflows.manage', 'workflows.approve')
     GROUP BY a.org_id, a.user_id
    HAVING count(DISTINCT tp.permission_code) = 2
  ) THEN
    RAISE EXCEPTION 'WF-02: an active assignment would combine workflow editing and approval';
  END IF;
END
$sod_preflight$;

-- -----------------------------------------------------------------------------
-- 2. Durable editor identity and database-enforced version SoD
-- -----------------------------------------------------------------------------
ALTER TABLE public.wf_version ADD COLUMN updated_by uuid;
UPDATE public.wf_version SET updated_by = created_by WHERE updated_by IS NULL;

CREATE FUNCTION public.wf_version_editor_stamp()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL THEN
      NEW.updated_by := auth.uid();
    ELSE
      NEW.updated_by := coalesce(NEW.updated_by, NEW.created_by);
    END IF;
  ELSIF OLD.state = 'draft' AND NEW.state = 'draft' THEN
    NEW.updated_by := coalesce(auth.uid(), NEW.updated_by, OLD.updated_by);
    IF NEW.updated_by IS NULL THEN
      RAISE EXCEPTION 'wf_version: draft edits require a recorded person' USING ERRCODE = '42501';
    END IF;
  ELSE
    NEW.updated_by := OLD.updated_by;
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION public.wf_version_service_author_stamp()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    NEW.created_by := coalesce(NEW.created_by, NEW.updated_by);
    NEW.updated_by := coalesce(NEW.updated_by, NEW.created_by);
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION public.wf_version_sod_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.state = 'draft' AND NEW.state = 'published' THEN
    IF NEW.published_by IS NULL THEN
      RAISE EXCEPTION 'wf_version: publishing requires a recorded person' USING ERRCODE = '42501';
    END IF;
    IF NEW.published_by IS NOT DISTINCT FROM OLD.created_by
       OR NEW.published_by IS NOT DISTINCT FROM OLD.updated_by THEN
      RAISE EXCEPTION 'wf_version: the author or last editor cannot publish this version' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION public.wf_approval_sod_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IN ('approved', 'rejected') THEN
    IF EXISTS (
      SELECT 1
        FROM public.wf_run r
        JOIN public.wf_version v
          ON v.org_id = r.org_id AND v.definition_id = r.definition_id AND v.id = r.version_id
       WHERE r.org_id = NEW.org_id AND r.id = NEW.run_id
         AND (NEW.decided_by = v.created_by OR NEW.decided_by = v.updated_by)
    ) THEN
      RAISE EXCEPTION 'wf_approval: the version author or last editor cannot decide this request'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER wf_version_05_editor_stamp
  BEFORE INSERT OR UPDATE ON public.wf_version
  FOR EACH ROW EXECUTE FUNCTION public.wf_version_editor_stamp();
CREATE TRIGGER wf_version_15_service_author_stamp
  BEFORE INSERT ON public.wf_version
  FOR EACH ROW EXECUTE FUNCTION public.wf_version_service_author_stamp();
CREATE TRIGGER wf_version_20_sod_guard
  BEFORE INSERT OR UPDATE ON public.wf_version
  FOR EACH ROW EXECUTE FUNCTION public.wf_version_sod_guard();
CREATE TRIGGER wf_approval_20_sod_guard
  BEFORE UPDATE ON public.wf_approval
  FOR EACH ROW EXECUTE FUNCTION public.wf_approval_sod_guard();

REVOKE ALL ON FUNCTION public.wf_version_editor_stamp(), public.wf_version_service_author_stamp(),
  public.wf_version_sod_guard(), public.wf_approval_sod_guard()
  FROM PUBLIC, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Global, versioned template catalogue
-- -----------------------------------------------------------------------------
CREATE TABLE public.wf_template (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key  text NOT NULL CHECK (template_key ~ '^[a-z][a-z0-9_-]{1,62}$'),
  version       integer NOT NULL CHECK (version BETWEEN 1 AND 100000),
  name          text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  description   text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 2000),
  graph         jsonb NOT NULL CHECK (jsonb_typeof(graph) = 'object' AND pg_column_size(graph) <= 262144),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  CONSTRAINT wf_template_key_version_uniq UNIQUE (template_key, version)
);

ALTER TABLE public.wf_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf_template FORCE ROW LEVEL SECURITY;
CREATE POLICY wf_template_read ON public.wf_template FOR SELECT TO authenticated USING (true);
CREATE POLICY wf_template_service_write ON public.wf_template FOR ALL TO service_role
  USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.wf_template FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.wf_template TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.wf_template TO service_role;

INSERT INTO public.wf_template (template_key, version, name, description, graph) VALUES
  ('payment_due_reminder_ladder', 1, 'Payment due reminder ladder',
   'A staged reminder sequence for an unpaid invoice: initial notice, follow-up, and final notice.',
   '{"steps":[{"id":"initial","kind":"notification"},{"id":"follow_up","kind":"delay"},{"id":"final_notice","kind":"notification"}]}'),
  ('paystack_payment_receipt', 1, 'Paystack payment receipt',
   'A receipt notification sequence after a confirmed payment.',
   '{"steps":[{"id":"confirmed","kind":"event"},{"id":"receipt","kind":"notification"}]}'),
  ('member_absence_alert', 1, 'Member absence alert',
   'A notification sequence when a member absence is recorded.',
   '{"steps":[{"id":"absence_recorded","kind":"event"},{"id":"alert","kind":"notification"}]}');

COMMIT;
