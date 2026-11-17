import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION =
  "database/supabase/migrations/20261117000400_sherivs_wf01_workflow_engine_schema.sql";
const ROLLBACK =
  "database/supabase/rollbacks/20261117000400_sherivs_wf01_workflow_engine_schema.sql";
const TABLES = [
  "wf_definition",
  "wf_version",
  "wf_trigger_binding",
  "wf_event",
  "wf_run",
  "wf_step_run",
  "wf_run_event",
  "wf_approval",
];

const sql = readFileSync(MIGRATION, "utf8");
const body = sql.replace(/--.*$/gm, "");

describe("WF-01 workflow schema migration (static posture)", () => {
  it("creates the eight tenant-keyed tables, each with RLS enabled and forced", () => {
    for (const t of TABLES) {
      expect(body).toMatch(new RegExp(`CREATE TABLE public\\.${t} \\(`));
      expect(body).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`));
      expect(body).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+FORCE ROW LEVEL SECURITY`));
      const create = body.slice(body.indexOf(`CREATE TABLE public.${t} (`));
      expect(create.slice(0, create.indexOf("\n);"))).toMatch(/org_id\s+uuid NOT NULL/);
    }
    expect(body).not.toMatch(/DISABLE ROW LEVEL SECURITY|NO FORCE/);
  });

  it("gives anon nothing and never grants to PUBLIC", () => {
    expect(body).not.toMatch(/GRANT[^;]*TO[^;]*\banon\b/);
    expect(body).not.toMatch(/TO PUBLIC/);
    expect(body).not.toMatch(/GRANT ALL/);
    expect(body).toMatch(/FROM PUBLIC, anon, authenticated, service_role;/);
  });

  it("lets people write only definitions, draft versions and triggers, and delete nothing", () => {
    expect(body).toMatch(
      /GRANT INSERT, UPDATE ON TABLE public\.wf_definition, public\.wf_version, public\.wf_trigger_binding TO authenticated;/,
    );
    expect(body).not.toMatch(/GRANT[^;]*DELETE[^;]*TO authenticated/);
    const policies = [...body.matchAll(/CREATE POLICY (\w+) ON public\.(\w+) FOR (\w+) TO (\w+)/g)];
    expect(policies.length).toBe(14);
    for (const p of policies) expect(p[4]).toBe("authenticated");
    const writes = policies.filter((p) => p[3] !== "SELECT").map((p) => p[2]);
    expect(new Set(writes)).toEqual(new Set(["wf_definition", "wf_version", "wf_trigger_binding"]));
  });

  it("keeps the claim function and the audit writer away from client roles", () => {
    expect(body).toContain("FOR UPDATE SKIP LOCKED");
    expect(body).toMatch(
      /REVOKE ALL ON FUNCTION public\.wf_claim_due_steps\(text, integer, integer\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(body).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.wf_claim_due_steps\(text, integer, integer\) TO service_role;/,
    );
    expect(body).toMatch(
      /REVOKE ALL ON FUNCTION public\.wf_audit_append\(uuid, text, text, text, jsonb, jsonb\) FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(body).not.toMatch(/GRANT[^;]*wf_audit_append/);
  });

  it("pins search_path on every function and appends to audit_chain with the canonical hash", () => {
    const fns = [...body.matchAll(/CREATE FUNCTION public\.(\w+)\([^)]*\)[\s\S]*?AS \$\$/g)];
    expect(fns.length).toBeGreaterThanOrEqual(12);
    for (const f of fns) expect(f[0]).toContain("SET search_path = ''");
    expect(body).toContain("pg_advisory_xact_lock(hashtextextended(p_org::text, 7013))");
    expect(body).toContain("public.audit_chain_canonical_hash(");
  });

  it("uses composite (org_id, id) keys so no row can point into another organization", () => {
    for (const fk of [
      "wf_version_definition_fk FOREIGN KEY (org_id, definition_id)",
      "wf_run_version_fk FOREIGN KEY (org_id, definition_id, version_id)",
      "wf_step_run_run_fk FOREIGN KEY (org_id, run_id)",
      "wf_approval_step_fk FOREIGN KEY (org_id, step_run_id)",
      "wf_run_event_run_fk FOREIGN KEY (org_id, run_id)",
    ]) {
      expect(body).toContain(fk);
    }
  });

  it("ships a rollback, an ADR and the database tests", () => {
    expect(existsSync(ROLLBACK)).toBe(true);
    const rb = readFileSync(ROLLBACK, "utf8");
    for (const t of TABLES) expect(rb).toContain(`DROP TABLE IF EXISTS public.${t}`);
    expect(rb.replace(/--.*$/gm, "")).not.toContain("audit_chain");
    expect(
      existsSync("architecture/adr/ADR-103_WF01_POSTGRES_WORKFLOW_ENGINE_AND_RUNTIME_PORT.md"),
    ).toBe(true);
    expect(readFileSync("tests/integration/wf01-workflow-schema.local.sql", "utf8")).toContain(
      "WF01 ALL PASS",
    );
    expect(readFileSync(".github/workflows/verify.yml", "utf8")).toContain(
      "tests/integration/wf01-workflow-schema.local.sql",
    );
  });
});
