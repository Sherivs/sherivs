import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS = "database/supabase/migrations";
const SEC02 = join(MIGRATIONS, "20261104034500_sherivs_sec02_privilege_hardening.sql");
const ROLLBACK = "database/supabase/rollbacks/20261104034500_sherivs_sec02_privilege_hardening.sql";

const migrationFiles = () =>
  readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ name: f, sql: readFileSync(join(MIGRATIONS, f), "utf8") }));

describe("SEC-02 privilege hardening", () => {
  const sql = readFileSync(SEC02, "utf8");
  const code = sql.replace(/--[^\n]*/g, "");

  it("is marked not applied and names its rollback and ADR", () => {
    expect(sql).toContain("NOT APPLIED");
    expect(sql).toContain("ADR-069");
    expect(readFileSync(ROLLBACK, "utf8")).toContain("GRANT");
  });

  it("revokes then re-grants only SELECT on each of the three views", () => {
    for (const view of [
      "org_credential_inventory",
      "cg_fee_invoice_balances",
      "cg_fee_receipt_sequence_status",
    ]) {
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON public\\.${view} FROM PUBLIC, anon, authenticated`));
      expect(sql).toMatch(new RegExp(`GRANT SELECT ON public\\.${view} TO authenticated`));
    }
  });

  it("never grants write privileges and never touches tables, policies or row data", () => {
    expect(code).not.toMatch(/GRANT[^;]*\b(INSERT|UPDATE|DELETE|ALL)\b/i);
    expect(code).not.toMatch(/\b(CREATE|DROP|ALTER)\s+(TABLE|POLICY)\b/i);
    expect(code).not.toMatch(/\b(INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+\w)/i);
  });

  it("pins exactly eleven function search paths to pg_catalog", () => {
    const block = /FOREACH[\s\S]*?ARRAY\[([\s\S]*?)\]/.exec(sql)?.[1] ?? "";
    const listed = block.match(/'public\.[a-z0-9_]+\([a-z,]*\)'/g) ?? [];
    expect(listed).toHaveLength(11);
    expect(sql).toContain("SET search_path = pg_catalog");
  });

  it("is wired into CI after the real Postgres is available", () => {
    const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
    expect(workflow).toContain("sec02-privilege-hardening.local.sql");
    expect(workflow).toContain("SEC02 ALL PASS");
  });
});

describe("public views must not keep default write privileges", () => {
  it("every public view created by a migration has its client write privileges revoked", () => {
    const files = migrationFiles();
    const all = files.map((f) => f.sql).join("\n");
    const created = new Set<string>();
    for (const m of all.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+public\.([a-z0-9_]+)/gi)) {
      created.add(m[1]!.toLowerCase());
    }
    expect(created.size).toBeGreaterThan(0);
    const uncovered = [...created].filter((view) => {
      const revoke = new RegExp(
        `REVOKE\\s+ALL\\s+ON\\s+(?:TABLE\\s+)?public\\.${view}\\s+FROM[^;]*\\bauthenticated\\b`,
        "i",
      );
      return !revoke.test(all);
    });
    expect(uncovered).toEqual([]);
  });
});
