import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const MIGRATION = read(
  "database/supabase/migrations/20261030000100_sherivs_catalog_revoke_client_writes.sql",
);
const ROLLBACK = read(
  "database/supabase/rollbacks/20261030000100_sherivs_catalog_revoke_client_writes.sql",
);
const TABLES = ["websites", "website_versions", "website_audit", "website_block_types"];

describe("website catalog client write privileges", () => {
  it("revokes only client write privileges on the four website catalog tables", () => {
    const executable = MIGRATION.split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    const statements = executable.match(/^\s*REVOKE\b.*;$/gm) ?? [];

    expect(statements).toHaveLength(TABLES.length);
    for (const table of TABLES) {
      expect(executable).toContain(
        `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.${table} FROM anon, authenticated;`,
      );
    }
    expect(executable).not.toMatch(/\bREVOKE\s+ALL\b/i);
    expect(executable).not.toMatch(/\bSELECT\b/i);
  });

  it("rolls back only the observed writes and warns before restoring client access", () => {
    const executable = ROLLBACK.split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(ROLLBACK).toMatch(/^-- WARNING:/m);
    expect(ROLLBACK).toContain(
      "GRANT INSERT, UPDATE, DELETE ON TABLE\n  public.websites, public.website_versions, public.website_audit, public.website_block_types\n  TO authenticated;",
    );
    expect(ROLLBACK).toContain(
      "GRANT INSERT, UPDATE, DELETE ON TABLE public.website_block_types TO anon;",
    );
    expect(executable).not.toMatch(/\bTRUNCATE\b/i);
    expect(executable).not.toMatch(/\bGRANT\s+ALL\b/i);
  });
});
