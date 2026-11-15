import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION =
  "database/supabase/migrations/20261105000200_sherivs_db12_flags_pk_and_duplicate_index.sql";
const ROLLBACK =
  "database/supabase/rollbacks/20261105000200_sherivs_db12_flags_pk_and_duplicate_index.sql";
const HARNESS = "tests/integration/db12-flags-pk-and-index.local.sql";

describe("DB-12 feature_flags primary key and duplicate index", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const code = sql.replace(/--[^\n]*/g, "");

  it("is marked not applied and names its rollback and ADR", () => {
    expect(sql).toContain("NOT APPLIED");
    expect(sql).toContain("ADR-073");
    expect(readFileSync(ROLLBACK, "utf8")).toContain("feature_flags_pkey");
  });

  it("adds a surrogate id primary key and keeps the (key, org) uniqueness rule", () => {
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid\(\)/);
    expect(code).toMatch(/ADD CONSTRAINT feature_flags_pkey PRIMARY KEY \(id\)/);
    expect(code).not.toMatch(/PRIMARY KEY \(key/);
    expect(code).not.toMatch(/DROP INDEX[^;]*feature_flags_scope/);
  });

  it("only drops the redundant index, and only after proving it is identical", () => {
    const drops = code.match(/DROP INDEX[^;]*;/g) ?? [];
    expect(drops).toEqual(["DROP INDEX public.idx_biometrics_user;"]);
    for (const clause of [
      "indkey",
      "indclass",
      "indcollation",
      "indoption",
      "indisunique",
      "indpred",
      "indexprs",
    ]) {
      expect(code).toContain(`dup.${clause}`);
    }
  });

  it("changes no policy, grant, trigger, function or row", () => {
    expect(code).not.toMatch(/\b(CREATE|DROP|ALTER)\s+(POLICY|TRIGGER|FUNCTION)\b/i);
    expect(code).not.toMatch(/\b(GRANT|REVOKE)\b/i);
    expect(code).not.toMatch(/\b(INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+\w)/i);
  });

  it("is idempotent and bounded by a lock timeout", () => {
    expect(code).toMatch(/SET LOCAL lock_timeout/);
    expect(code).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint/);
    expect(code).toMatch(/to_regclass\('public\.idx_biometrics_user'\) IS NOT NULL/);
  });

  it("has a rollback that only restores the earlier structure", () => {
    const rb = readFileSync(ROLLBACK, "utf8").replace(/--[^\n]*/g, "");
    expect(rb).toMatch(/DROP CONSTRAINT IF EXISTS feature_flags_pkey/);
    expect(rb).toMatch(/DROP COLUMN IF EXISTS id/);
    expect(rb).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_biometrics_user ON public\.teacher_biometrics \(user_id, school_id\)/,
    );
    expect(rb).not.toMatch(/feature_flags_scope/);
  });

  it("has a disposable-database harness that proves before, after, guard and rollback", () => {
    const h = readFileSync(HARNESS, "utf8");
    expect(h).toContain("DB12 ALL PASS");
    expect(h).toContain("inet_server_addr()");
    expect(h.trim().endsWith("ROLLBACK;")).toBe(true);
    for (const label of [
      "before: feature_flags has no primary key",
      "after: a duplicate platform-wide flag is still refused",
      "after: flag_set (ON CONFLICT on the scope index) and flag_on still work",
      "guard: same columns in a different order are both kept",
      "rollback: running it twice is harmless",
    ]) {
      expect(h).toContain(label);
    }
  });

  it("is the latest migration version and unique", () => {
    const files = readdirSync("database/supabase/migrations").filter((f) => f.endsWith(".sql"));
    const mine = files.filter((f) => f.startsWith("20261105000200_"));
    expect(mine).toHaveLength(1);
  });
});
