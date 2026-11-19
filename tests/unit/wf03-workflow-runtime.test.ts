import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION = "database/supabase/migrations/20261117000600_sherivs_wf03_runtime_core.sql";
const ROLLBACK = "database/supabase/rollbacks/20261117000600_sherivs_wf03_runtime_core.sql";
const sql = readFileSync(MIGRATION, "utf8");
const body = sql.replace(/--.*$/gm, "");

describe("WF-03 workflow runtime schema (static posture)", () => {
  it("adds forced-RLS organization settings and service-only earned autonomy", () => {
    for (const table of ["wf_org_settings", "wf_agent_autonomy"]) {
      expect(body).toContain(`CREATE TABLE public.${table} (`);
      expect(body).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(body).toContain(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`);
      expect(body).toContain(
        `REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated, service_role`,
      );
    }
    expect(body).toContain("workflows_enabled  boolean NOT NULL DEFAULT false");
    expect(body).toContain(
      "GRANT SELECT, INSERT, UPDATE ON TABLE public.wf_agent_autonomy TO service_role",
    );
    expect(body).not.toMatch(/GRANT[^;]*wf_agent_autonomy[^;]*TO authenticated/);
    expect(body).toContain("public.wf_can(org_id, 'workflows.view')");
    expect(body).toContain("public.wf_can(org_id, 'workflows.manage')");
  });

  it("pins invoker functions and restricts event claims to enabled organizations", () => {
    expect(body).toContain("CREATE FUNCTION public.wf_claim_due_events");
    expect(body).toContain("FOR UPDATE SKIP LOCKED");
    expect(body).toContain("SECURITY INVOKER SET search_path = ''");
    expect(body).toContain(
      "GRANT EXECUTE ON FUNCTION public.wf_claim_due_events(text, integer, integer) TO service_role",
    );
    expect(body).not.toMatch(/GRANT[^;]*wf_claim_due_events[^;]*TO anon/);
    expect(body).toContain("CREATE FUNCTION public.wf_runtime_settings_audit()");
    expect(body).toContain("CREATE TRIGGER wf_org_settings_90_audit");
    expect(body).toMatch(
      /CREATE FUNCTION public\.wf_runtime_settings_audit\(\)[\s\S]*?SECURITY DEFINER SET search_path = ''/,
    );
    expect(body).toContain("AND s.workflows_enabled");
  });

  it("adds constrained autonomy and budget fields with a database-enforced hard cap", () => {
    for (const level of ["suggest", "draft", "act_with_approval", "act_and_report"]) {
      expect(body).toContain(`'${level}'`);
    }
    for (const action of [
      "money_movement",
      "safeguarding",
      "credential_change",
      "public_publish",
      "mass_message",
      "external_authority_share",
    ]) {
      expect(body).toContain(`'${action}'`);
    }
    expect(body).toContain(
      "spent_units integer NOT NULL DEFAULT 0 CHECK (spent_units BETWEEN 0 AND budget_units)",
    );
    expect(body).toContain("NEW.autonomy_level := CASE v_rank");
    expect(body).toContain("ADD COLUMN action_class text NOT NULL DEFAULT 'unclassified'");
    expect(body).toContain("IF NEW.action_class <> 'internal'");
  });

  it("ships a paired rollback and local WF-03 integration check", () => {
    expect(existsSync(ROLLBACK)).toBe(true);
    const rollback = readFileSync(ROLLBACK, "utf8");
    expect(rollback).toContain("WF-03 rollback: runtime objects or columns remain");
    expect(rollback).toContain("WF-03 rollback: audit_chain must remain intact");
    expect(rollback).not.toContain("DROP TABLE IF EXISTS public.audit_chain");
    expect(existsSync("tests/integration/wf03-workflow-runtime.local.sql")).toBe(true);
    expect(readFileSync(".github/workflows/verify.yml", "utf8")).toContain(
      "tests/integration/wf03-workflow-runtime.local.sql",
    );
  });
});
