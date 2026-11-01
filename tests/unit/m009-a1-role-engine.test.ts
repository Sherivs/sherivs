import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "database/supabase/migrations/20261101000010_sherivs_m009_a1_role_responsibility_engine.sql",
  "utf8",
);
const rollback = readFileSync(
  "database/supabase/rollbacks/20261101000010_sherivs_m009_a1_role_responsibility_engine.sql",
  "utf8",
);
const matrix = readFileSync("docs/workspaces/permission-matrix.md", "utf8");
const harness = readFileSync("tests/integration/m009-a1-role-engine.local.sql", "utf8");

describe("M009-A1 role engine migration", () => {
  it("creates the tenant-scoped responsibility, delegation, org-unit, and audit records", () => {
    for (const table of [
      "workspace_org_units",
      "workspace_responsibility_catalog",
      "workspace_role_responsibilities",
      "workspace_responsibility_permissions",
      "role_assignment_responsibility_grants",
      "role_assignment_delegations",
      "role_assignment_audit_events",
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
      expect(migration).toContain(`'${table}'`);
    }
    expect(migration).toContain("ALTER TABLE public.%I FORCE ROW LEVEL SECURITY");
  });

  it("keeps effective permissions scoped and effective-dated", () => {
    expect(migration).toContain("a.started_at <= p_at");
    expect(migration).toContain("a.valid_until > p_at");
    expect(migration).toContain("g.valid_until > p_at");
    expect(migration).toContain("d.valid_until > p_at");
    expect(migration).toContain("workspace_role_sod_validate_schedule");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("assignment scope exceeds the role template scope");
    expect(migration).toContain("u.is_active IS TRUE");
    expect(migration).toContain("source_user.is_active IS TRUE");
    expect(migration).toContain("unit_type = 'subject'");
    expect(migration).toContain("WHEN 'lga' THEN false");
    expect(migration).toContain("WHEN 'authority' THEN false");
    expect(migration).toContain(
      "role_assignment_scope_sets s WHERE s.assignment_id = e.assignment_id",
    );
  });

  it("enforces fixed SoD controls and an immutable, attributed audit", () => {
    const auditTable = migration.match(
      /CREATE TABLE IF NOT EXISTS public\.role_assignment_audit_events \([\s\S]*?\n\);/,
    )?.[0];
    expect(auditTable).toBeDefined();
    expect(auditTable).not.toContain("REFERENCES");
    expect(migration).toContain("expenses.create");
    expect(migration).toContain("expenses.approve");
    expect(migration).toContain("grades.enter");
    expect(migration).toContain("results.publish");
    expect(migration).toContain("auditor_independence");
    expect(migration).toContain("role assignment audit events are append-only");
    expect(migration).toContain("actor_user_id, target_user_id, assignment_id");
    expect(rollback).toContain("Immutable role_assignment_audit_events are deliberately retained");
    expect(rollback).not.toMatch(/DROP TABLE(?: IF EXISTS)? public\.role_assignment_audit_events/);
  });

  it("keeps rollback compatible with persisted scopes and active identity checks", () => {
    expect(rollback).toContain("'org','institution','group','campus','shift','class','subject'");
    expect(rollback).toContain("m.is_active AND u.is_active IS TRUE");
    expect(rollback).toContain("ura.started_at <= now()");
    expect(rollback).toContain("ura.valid_until > now()");
    expect(rollback).toContain("p_scope_type IS NULL");
    expect(rollback).toContain("'type', p_scope_type, 'ref', p_scope_ref");
  });

  it("documents a catalog-derived matrix and includes disposable isolation/expiry/SoD probes", () => {
    for (const table of [
      "role_template_permissions",
      "workspace_role_responsibilities",
      "workspace_responsibility_permissions",
      "permission_catalog",
      "role_templates",
      "org_role_custom_grants",
    ]) {
      expect(matrix).toContain(table);
    }
    expect(harness).toContain("loopback disposable DB");
    expect(harness).toContain("user sees only their own assignments");
    expect(harness).toContain("expired add-on grant loses permission");
    expect(harness).toContain("same user cannot also receive finance approval");
    expect(harness).toContain("deactivated user loses effective permissions");
    expect(harness).toContain("deactivated source member loses delegated permissions");
    expect(harness).toContain("ROLLBACK;");
  });

  it("keeps the permission matrix documentation generated from the catalog query", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "m009-role-matrix-"));
    try {
      mkdirSync(join(temporaryRoot, "docs/workspaces"), { recursive: true });
      execFileSync(
        process.execPath,
        [resolve("scripts/generate-workspace-permission-matrix.mjs")],
        { cwd: temporaryRoot },
      );
      expect(matrix).toBe(
        readFileSync(join(temporaryRoot, "docs/workspaces/permission-matrix.md"), "utf8"),
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("requires SHERIVS-017 before changing the role engine schema", () => {
    expect(migration.indexOf("M009-A1 requires SHERIVS-017")).toBeLessThan(
      migration.indexOf("BEGIN;"),
    );
    expect(migration).toContain("public.role_create_custom(uuid,text,text,text)");
    expect(migration).not.toContain("IF t <> 'role_assignment_audit_events'");
  });
});
