import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const migration = readFileSync(
  join(ROOT, "database/supabase/migrations/20261029002000_sherivs_m006_checker_and_schema.sql"),
  "utf8",
);
const rollback = readFileSync(
  join(ROOT, "database/supabase/rollbacks/20261029002000_sherivs_m006_checker_and_schema.sql"),
  "utf8",
);

describe("M006 result checker and schema privileges", () => {
  it("revokes schema CREATE and returns a uniform checker error instead of raising", () => {
    expect(migration).toContain(
      "REVOKE CREATE ON SCHEMA public FROM anon, authenticated, PUBLIC",
    );
    expect(migration).toContain(
      "RETURN jsonb_build_object('ok', false, 'error', 'invalid serial or PIN');",
    );
    expect(migration).not.toMatch(/RAISE EXCEPTION 'student not found/);
    expect(migration).not.toMatch(/GRANT CREATE/i);
    expect(migration).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
    expect(migration).not.toMatch(/GRANT EXECUTE ON FUNCTION public.check_result/i);
  });

  it("rollback restores the raising checker and does not re-grant CREATE", () => {
    expect(rollback).toContain("RAISE EXCEPTION 'student not found for this card'");
    expect(rollback).not.toMatch(/^\s*GRANT CREATE/im);
    expect(rollback).toContain("Does NOT re-grant CREATE");
  });
});
