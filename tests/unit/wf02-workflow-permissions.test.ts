import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION =
  "database/supabase/migrations/20261117000500_sherivs_wf02_workflow_permissions_and_templates.sql";
const ROLLBACK =
  "database/supabase/rollbacks/20261117000500_sherivs_wf02_workflow_permissions_and_templates.sql";
const WF01 =
  "database/supabase/migrations/20261117000400_sherivs_wf01_workflow_engine_schema.sql";

const sql = readFileSync(MIGRATION, "utf8");
const body = sql.replace(/--.*$/gm, "");
const policyBlock = body.slice(body.indexOf("CREATE TABLE public.wf_template"));

describe("WF-02 workflow permissions and templates (static posture)", () => {
  it("adds workflow capabilities only to the existing permission catalog", () => {
    for (const permission of [
      "workflows.view",
      "workflows.manage",
      "workflows.run",
      "workflows.approve",
    ]) {
      expect(body).toMatch(new RegExp(`\\('${permission.replace(".", "\\.")}',\\s*'workflow'`));
    }

    const mappings = body.slice(
      body.indexOf("INSERT INTO public.role_template_permissions"),
      body.indexOf("INSERT INTO public.sod_permission_rules"),
    );
    expect(mappings).toContain("('proprietor', 'workflows.manage'");
    expect(mappings).toContain("('head_of_institution', 'workflows.manage'");
    expect(mappings).toContain("('governance_board', 'workflows.approve'");
    expect(mappings).toContain("('auditor', 'workflows.approve'");
    for (const role of ["teacher", "form_teacher", "teaching_support", "early_years_carer", "parent"]) {
      expect(mappings).not.toMatch(
        new RegExp(`\\('${role}',\\s*'workflows\\.(?:manage|approve)'`),
      );
    }
    const roleCapabilities = new Map<string, Set<string>>();
    for (const [, role, permission] of mappings.matchAll(
      /\('([^']+)',\s*'(workflows\.(?:manage|approve))'/g,
    )) {
      const permissions = roleCapabilities.get(role) ?? new Set<string>();
      permissions.add(permission);
      roleCapabilities.set(role, permissions);
    }
    for (const permissions of roleCapabilities.values()) {
      expect(permissions.has("workflows.manage") && permissions.has("workflows.approve")).toBe(false);
    }
    expect(body).toContain(
      "('workflows.manage', 'workflows.approve',",
    );
    expect(readFileSync(WF01, "utf8")).toContain(
      "'workflows.view', 'workflows.manage', 'workflows.run', 'workflows.approve'",
    );
  });

  it("stamps draft editors and enforces publish and approval SoD in the database", () => {
    expect(body).toContain("ALTER TABLE public.wf_version ADD COLUMN updated_by uuid");
    expect(body).toContain("CREATE TRIGGER wf_version_05_editor_stamp");
    expect(body).toContain("NEW.updated_by := auth.uid()");
    expect(body).toContain("NEW.published_by IS NOT DISTINCT FROM OLD.created_by");
    expect(body).toContain("NEW.published_by IS NOT DISTINCT FROM OLD.updated_by");
    expect(body).toContain("CREATE TRIGGER wf_version_20_sod_guard");
    expect(body).toContain("CREATE TRIGGER wf_approval_20_sod_guard");
    expect(body).toContain("NEW.decided_by = v.created_by OR NEW.decided_by = v.updated_by");
    expect(body).toContain("FROM PUBLIC, anon, authenticated, service_role");
    expect(body).toContain("WF-02: an active assignment would combine workflow editing and approval");
  });

  it("creates a global versioned catalogue with forced RLS and explicit privileges", () => {
    const create = policyBlock.slice(0, policyBlock.indexOf(");"));
    expect(create).not.toMatch(/\borg_id\b/);
    expect(create).toContain("version");
    expect(body).toContain("ALTER TABLE public.wf_template ENABLE ROW LEVEL SECURITY");
    expect(body).toContain("ALTER TABLE public.wf_template FORCE ROW LEVEL SECURITY");
    expect(body).toContain("CREATE POLICY wf_template_read ON public.wf_template FOR SELECT TO authenticated");
    expect(body).toContain("CREATE POLICY wf_template_service_write ON public.wf_template FOR ALL TO service_role");
    expect(body).toContain("REVOKE ALL ON TABLE public.wf_template FROM PUBLIC, anon, authenticated, service_role");
    expect(body).toContain("GRANT SELECT ON TABLE public.wf_template TO authenticated");
    expect(body).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.wf_template TO service_role");
    expect(body.match(/INSERT INTO public\.wf_template \(template_key, version, name, description, graph\) VALUES/g))
      .toHaveLength(1);
    for (const template of [
      "payment_due_reminder_ladder",
      "paystack_payment_receipt",
      "member_absence_alert",
    ]) {
      expect(body).toContain(`('${template}', 1,`);
    }
  });

  it("ships a complete rollback, ADR, progress note, and local integration test wiring", () => {
    expect(existsSync(ROLLBACK)).toBe(true);
    const rollback = readFileSync(ROLLBACK, "utf8");
    expect(rollback).toContain("DROP TABLE IF EXISTS public.wf_template CASCADE");
    expect(rollback).toContain("DROP COLUMN IF EXISTS updated_by");
    expect(rollback).toContain("WF-02 rollback: WF-02 objects or permission entries remain");
    expect(rollback).not.toContain("audit_chain");
    expect(existsSync("architecture/adr/ADR-104_WF02_WORKFLOW_PERMISSIONS_AND_TEMPLATES.md")).toBe(
      true,
    );
    expect(existsSync("progress/missions/WF-02.md")).toBe(true);
    expect(
      readFileSync("tests/integration/wf02-workflow-permissions.local.sql", "utf8"),
    ).toContain("WF02 ALL PASS");
    expect(readFileSync(".github/workflows/verify.yml", "utf8")).toContain(
      "tests/integration/wf02-workflow-permissions.local.sql",
    );
  });
});
