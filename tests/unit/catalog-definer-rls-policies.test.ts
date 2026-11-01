/**
 * V1 companion to FORCE RLS on the six catalogs.
 * The policy migration may name only non-bypass function owners, and the
 * SQL-editor bundle must carry the approved FORCE statements unchanged.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const POLICY = read(
  "database/supabase/migrations/20261029001100_sherivs_catalog_definer_rls_policies.sql",
);
const POLICY_ROLLBACK = read(
  "database/supabase/rollbacks/20261029001100_sherivs_catalog_definer_rls_policies.sql",
);
const REVOKE = read(
  "database/supabase/migrations/20261030000100_sherivs_catalog_revoke_client_writes.sql",
);
const FORCE = read(
  "database/supabase/migrations/20261029001000_sherivs_force_rls_catalog_tables.sql",
);
const FORCE_ROLLBACK = read(
  "database/supabase/rollbacks/20261029001000_sherivs_force_rls_catalog_tables.sql",
);
const APPLY = read("ops/2026-10-29-apply-force-rls-catalog-tables/apply.sql");
const PREFLIGHT = read("ops/2026-10-29-apply-force-rls-catalog-tables/preflight.sql");
const VERIFY = read("ops/2026-10-29-apply-force-rls-catalog-tables/verify.sql");
const ROLLBACK = read("ops/2026-10-29-apply-force-rls-catalog-tables/rollback.sql");

function statements(sql: string): string[] {
  return sql.split("\n").filter((line) => {
    const trimmed = line.trim();
    return trimmed !== "BEGIN;" && trimmed !== "COMMIT;";
  });
}

const DEFINER_POLICIES = [
  "website_block_types_definer_select",
  "websites_definer_select",
  "websites_definer_insert",
  "websites_definer_update",
  "website_versions_definer_select",
  "website_versions_definer_insert",
  "website_audit_definer_insert",
  "exam_bodies_definer_select",
  "connector_manifests_definer_select",
];

describe("catalog definer RLS policies", () => {
  it("does not grant, disable RLS, or drop the client policies", () => {
    expect(POLICY).not.toMatch(/^\s*GRANT /m);
    expect(POLICY).not.toMatch(/^\s*ALTER ROLE /m);
    expect(POLICY).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
    expect(POLICY).not.toMatch(/NO FORCE ROW LEVEL SECURITY/i);
    for (const name of [
      "website_block_types_read",
      "websites_read",
      "website_versions_read",
      "website_audit_read",
      "exam_bodies_read",
      "connector_manifests_read",
    ]) {
      expect(POLICY).not.toContain(`DROP POLICY IF EXISTS ${name}`);
      expect(POLICY_ROLLBACK).not.toContain(name);
    }
  });

  it("names only the nine definer policies and gates writes with scholar_can", () => {
    for (const name of DEFINER_POLICIES) {
      expect(POLICY).toContain(name);
      expect(POLICY_ROLLBACK).toContain(`DROP POLICY IF EXISTS ${name}`);
    }
    expect(POLICY).toContain("public.scholar_can({{org}}, 'website.manage')");
    expect(POLICY).toContain("pg_temp.catalog_org_column()");
    expect(POLICY).not.toMatch(/\bschool_id\b/);
    const code = POLICY.split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(code).not.toMatch(/TO anon\b|TO authenticated\b|TO public\b/i);
    expect(POLICY).toContain("AND NOT own.rolsuper");
    expect(POLICY).toContain("AND NOT own.rolbypassrls");
  });

  it("keeps the approved FORCE statements verbatim inside the SQL-editor bundle", () => {
    for (const line of FORCE.split("\n")) {
      if (line.startsWith("ALTER TABLE")) expect(APPLY).toContain(line);
    }
    for (const line of statements(POLICY)) {
      if (line.trim().length > 0) expect(APPLY).toContain(line);
    }
    for (const line of statements(REVOKE)) {
      if (line.trim().length > 0) expect(APPLY).toContain(line);
    }
    expect(APPLY).toContain("20261029001000");
    expect(APPLY).toContain("20261029001100");
    expect(APPLY).toContain("20261030000100");
    expect(APPLY).not.toMatch(/^\s*GRANT /m);
  });

  it("rolls back both FORCE and the definer policies, and keeps preflight and verify read-only", () => {
    for (const line of FORCE_ROLLBACK.split("\n")) {
      if (line.startsWith("ALTER TABLE")) expect(ROLLBACK).toContain(line);
    }
    for (const name of DEFINER_POLICIES) {
      expect(ROLLBACK).toContain(`DROP POLICY IF EXISTS ${name}`);
    }
    expect(PREFLIGHT).toContain("SET default_transaction_read_only = on");
    expect(VERIFY).toContain("SET default_transaction_read_only = on");
    for (const sql of [PREFLIGHT, VERIFY]) {
      const executable = sql
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
      expect(executable).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|ALTER|DROP|GRANT|TRUNCATE)\b/im);
    }
  });
});
