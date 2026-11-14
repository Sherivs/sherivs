import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = "database/proposals";
const PROPOSAL = `${DIR}/20261105009000_sherivs_sec03_private_by_default_privileges.sql`;
const ROLLBACK = `${DIR}/20261105009000_sherivs_sec03_private_by_default_privileges.rollback.sql`;
const HARNESS = "tests/integration/sec03-default-privileges.local.sql";
const strip = (s: string) => s.replace(/--[^\n]*/g, "");

describe("SEC-03 private-by-default privileges proposal", () => {
  const sql = readFileSync(PROPOSAL, "utf8");
  const code = strip(sql);

  it("is a proposal outside the migrations directory, so no tool applies it", () => {
    expect(sql).toContain("PROPOSED");
    expect(sql).toContain("ADR-076");
    expect(sql).toContain("LAST");
    expect(
      existsSync(
        "database/supabase/migrations/20261105009000_sherivs_sec03_private_by_default_privileges.sql",
      ),
    ).toBe(false);
    for (const f of readdirSync("database/supabase/migrations"))
      expect(f).not.toMatch(/sec03_private_by_default/);
  });

  it("only revokes anon and authenticated from the postgres role's public-schema defaults", () => {
    const stmts = code.match(/ALTER DEFAULT PRIVILEGES[^;]*;/g) ?? [];
    expect(stmts).toHaveLength(2);
    for (const s of stmts) {
      expect(s).toMatch(/FOR ROLE postgres IN SCHEMA public/);
      expect(s).toMatch(/REVOKE ALL ON (TABLES|SEQUENCES) FROM anon, authenticated;/);
      expect(s).not.toMatch(/service_role|PUBLIC|GRANT/);
    }
    expect(code).not.toMatch(/\b(GRANT|DROP|CREATE|INSERT|UPDATE|DELETE)\b/);
  });

  it("documents what it does not cover", () => {
    expect(sql).toMatch(/NOT COVERED/);
    expect(sql).toMatch(/functions/);
    expect(sql).toMatch(/supabase_admin/);
  });

  it("has a rollback that restores the audited defaults, version-aware for MAINTAIN", () => {
    const rb = strip(readFileSync(ROLLBACK, "utf8"));
    expect(rb).toMatch(/server_version_num/);
    expect(rb).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER/);
    expect(rb).toMatch(/GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO anon, authenticated/);
  });

  it("has a disposable-database harness covering before, after, explicit grants and rollback", () => {
    const h = readFileSync(HARNESS, "utf8");
    expect(h).toContain("SEC03 ALL PASS");
    expect(h.trim().endsWith("ROLLBACK;")).toBe(true);
    for (const label of [
      "before: a new view is writable by authenticated",
      "after: a new table has no rights for anon or authenticated",
      "after: service_role keeps its default rights on new tables",
      "after: objects created before the change keep exactly their old privileges",
      "after: an explicit grant gives exactly the named rights",
      "roll forward again",
    ]) {
      expect(h).toContain(label);
    }
  });
});
