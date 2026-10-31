/**
 * Catalog tables that shipped with RLS enabled but not forced.
 * The forward migration only sets FORCE. It does not edit historical SQL,
 * drop policies, or grant new access.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATION = readFileSync(
  join(ROOT, "database/supabase/migrations/20261029001000_sherivs_force_rls_catalog_tables.sql"),
  "utf8",
);
const ROLLBACK = readFileSync(
  join(ROOT, "database/supabase/rollbacks/20261029001000_sherivs_force_rls_catalog_tables.sql"),
  "utf8",
);
const WEBSITE = readFileSync(
  join(ROOT, "database/supabase/migrations/20261025100240_sherivs_100_website_engine.sql"),
  "utf8",
);
const EXAM = readFileSync(
  join(ROOT, "database/supabase/migrations/20261025100040_sherivs_a04_exam_body_windows.sql"),
  "utf8",
);
const HUB = readFileSync(
  join(ROOT, "database/supabase/migrations/20261025100180_sherivs_090_integration_hub.sql"),
  "utf8",
);

const TABLES = [
  "websites",
  "website_versions",
  "website_block_types",
  "website_audit",
  "exam_bodies",
  "connector_manifests",
] as const;

describe("catalog FORCE ROW LEVEL SECURITY", () => {
  it("forces exactly the six catalogs and does not weaken RLS", () => {
    for (const table of TABLES) {
      expect(MIGRATION).toContain(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY;`);
      expect(ROLLBACK).toContain(`ALTER TABLE public.${table} NO FORCE ROW LEVEL SECURITY;`);
    }
    expect(MIGRATION).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
    expect(MIGRATION).not.toMatch(/NO FORCE ROW LEVEL SECURITY/i);
    expect(MIGRATION).not.toMatch(/DROP POLICY/i);
    expect(MIGRATION).not.toMatch(/GRANT /i);
    expect(MIGRATION).not.toMatch(/CREATE POLICY/i);
  });

  it("leaves the historical enable-RLS migrations without FORCE on these tables", () => {
    expect(WEBSITE).toContain("ALTER TABLE public.websites ENABLE ROW LEVEL SECURITY;");
    expect(WEBSITE).not.toContain("ALTER TABLE public.websites FORCE ROW LEVEL SECURITY;");
    expect(EXAM).toContain("ALTER TABLE public.exam_bodies ENABLE ROW LEVEL SECURITY;");
    expect(EXAM).not.toContain("ALTER TABLE public.exam_bodies FORCE ROW LEVEL SECURITY;");
    expect(HUB).toContain("ALTER TABLE public.connector_manifests ENABLE ROW LEVEL SECURITY;");
    expect(HUB).not.toContain("ALTER TABLE public.connector_manifests FORCE ROW LEVEL SECURITY;");
  });
});
