/**
 * SHERIVS-RLS-IMPLEMENTATION-PREP-001 — plan integrity ratchet.
 *
 * Pins that this mission authored a reviewable plan without placing SQL
 * on the production apply path, and that the staging harness refuses the
 * canonical production project.
 *
 * READ-ONLY: no database access, no network, no secrets.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRODUCTION_SUPABASE_REF,
  assertNotProductionTarget,
} from "../../scripts/staging/sherivs-rls-prep/assert-not-production.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATIONS_DIR = join(ROOT, "database", "supabase", "migrations");
const PROPOSED_DIR = join(ROOT, "docs/security/rls-prep/proposed-sql");
const PLAN = join(ROOT, "docs/security/SHERIVS-RLS-IMPLEMENTATION-PREP-001.md");
const APPLY_ONE = join(ROOT, "scripts/db-apply-one.mjs");

describe("SHERIVS-RLS-IMPLEMENTATION-PREP-001 plan integrity", () => {
  it("does not place forward SQL on the db-apply path", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    expect(files.some((f) => f.includes("sherivs_users_identity_freeze"))).toBe(false);
    expect(files.some((f) => f.includes("sherivs_rls_wave"))).toBe(false);
    expect(files.some((f) => f.endsWith(".sql.proposed"))).toBe(false);
  });

  it("keeps proposed SQL outside migrations/ with a non-apply suffix", () => {
    const proposed = readdirSync(PROPOSED_DIR).filter((f) => f.endsWith(".sql.proposed"));
    expect(proposed.length).toBeGreaterThanOrEqual(6);
    const applyOne = readFileSync(APPLY_ONE, "utf8");
    expect(applyOne).toContain('join(ROOT, "database", "supabase", "migrations")');
    expect(applyOne).not.toContain("rls-prep/proposed-sql");
  });

  it("documents GATE 6 as not entered and production as unmodified", () => {
    const plan = readFileSync(PLAN, "utf8");
    for (const heading of [
      "## 1. Baseline reconciliation",
      "## 2. Application read/write inventory",
      "## 3. Implementation change-set plan",
      "## 4. Per-table RLS implementation plan",
      "## 5. HR and payment compatibility plan",
      "## 6. Staging test harness plan",
      "## 7. Migration order and dependencies",
      "## 8. Verification and rollback plan",
      "## 9. Remaining product decisions",
      "## 10. Release gates",
      "## 11. Explicit confirmation",
    ]) {
      expect(plan).toContain(heading);
    }
    expect(plan).toContain("GATE 6");
    expect(plan).toContain("NOT ENTERED");
    expect(plan).toContain("remain **OPEN**");
    expect(plan).toContain("d195ba8");
    expect(plan).toContain("20261008000050_coregrid_organization_memberships.sql");
  });

  it("refuses the canonical production Supabase project and Sherivs hosts", () => {
    expect(PRODUCTION_SUPABASE_REF).toBe("nwrflbpbhyiqdptmlccm");
    expect(assertNotProductionTarget(`postgresql://x@db.${PRODUCTION_SUPABASE_REF}.supabase.co/postgres`)).toEqual({
      ok: false,
      reason: "canonical_production_supabase_ref",
    });
    expect(assertNotProductionTarget("https://app.sherivs.com")).toEqual({
      ok: false,
      reason: "production_host:app.sherivs.com",
    });
    expect(assertNotProductionTarget("https://staging-sherivs-rls.example.supabase.co")).toEqual({
      ok: true,
    });
    expect(assertNotProductionTarget("")).toEqual({ ok: false, reason: "empty_target" });
  });

  it("ships companion plan files", () => {
    for (const rel of [
      "docs/security/rls-prep/CHANGE-SETS.md",
      "docs/security/rls-prep/APPLICATION-INVENTORY.md",
      "docs/security/rls-prep/PER-TABLE-RLS-MATRIX.md",
      "docs/security/rls-prep/STAGING-TEST-HARNESS.md",
      "docs/security/rls-prep/VERIFICATION-AND-ROLLBACK.md",
      "scripts/staging/sherivs-rls-prep/catalog-verify.sql",
    ]) {
      expect(existsSync(join(ROOT, rel))).toBe(true);
    }
  });
});
