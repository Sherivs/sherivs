/**
 * SHERIVS-RLS-IMPLEMENTATION-PREP-001 — plan integrity ratchet.
 *
 * Pins that this mission authored a reviewable plan without placing SQL
 * on the production apply path, and that the staging harness refuses the
 * canonical production project. After GATE3-CORRECTIONS-001, also pins
 * C1 (no pg_catalog.auth.*) and H1 (lexicographic 00010–00090).
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

const EXPECTED_PROPOSED = [
  "20261015000010_sherivs_authz_helpers_active.sql.proposed",
  "20261015000020_sherivs_admin_hr_rpcs.sql.proposed",
  "20261015000030_sherivs_users_identity_freeze.sql.proposed",
  "20261015000040_sherivs_users_sensitive_column_revoke.sql.proposed",
  "20261015000050_sherivs_rls_wave_a_classes_calendar_timetable.sql.proposed",
  "20261015000060_sherivs_rls_wave_b_students_map_plans_attendance.sql.proposed",
  "20261015000070_sherivs_fees_settlement_and_rls_wave_c.sql.proposed",
  "20261015000080_sherivs_rls_grant_hygiene.sql.proposed",
  "20261015000090_sherivs_users_force_rls.sql.proposed",
];

describe("SHERIVS-RLS-IMPLEMENTATION-PREP-001 plan integrity", () => {
  it("does not place forward SQL on the db-apply path", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    expect(files.some((f) => f.includes("sherivs_users_identity_freeze"))).toBe(false);
    expect(files.some((f) => f.includes("sherivs_rls_wave"))).toBe(false);
    expect(files.some((f) => f.endsWith(".sql.proposed"))).toBe(false);
    expect(files.some((f) => f.includes("sherivs_authz_helpers_active"))).toBe(false);
    expect(files.some((f) => f.includes("sherivs_admin_hr_rpcs"))).toBe(false);
  });

  it("keeps proposed SQL outside migrations/ with a non-apply suffix", () => {
    const proposed = readdirSync(PROPOSED_DIR)
      .filter((f) => f.endsWith(".sql.proposed"))
      .sort();
    expect(proposed).toEqual(EXPECTED_PROPOSED);
    const applyOne = readFileSync(APPLY_ONE, "utf8");
    expect(applyOne).toContain('join(ROOT, "database", "supabase", "migrations")');
    expect(applyOne).not.toContain("rls-prep/proposed-sql");
  });

  it("orders proposed SQL lexicographically to match the H1 dependency graph", () => {
    const proposed = readdirSync(PROPOSED_DIR)
      .filter((f) => f.endsWith(".sql.proposed"))
      .sort();
    expect(proposed[0]).toMatch(/00010_.*authz_helpers/);
    expect(proposed[1]).toMatch(/00020_.*admin_hr_rpcs/);
    expect(proposed[2]).toMatch(/00030_.*identity_freeze/);
    expect(proposed[3]).toMatch(/00040_.*sensitive_column/);
    expect(proposed[4]).toMatch(/00050_.*wave_a/);
    expect(proposed[5]).toMatch(/00060_.*wave_b/);
    expect(proposed[6]).toMatch(/00070_.*fees_settlement/);
    expect(proposed[7]).toMatch(/00080_.*grant_hygiene/);
    expect(proposed[8]).toMatch(/00090_.*force_rls/);
  });

  it("does not use invalid pg_catalog.auth.* three-part names (C1)", () => {
    const proposed = readdirSync(PROPOSED_DIR).filter((f) => f.endsWith(".sql.proposed"));
    for (const f of proposed) {
      const body = readFileSync(join(PROPOSED_DIR, f), "utf8");
      expect(body, f).not.toMatch(/pg_catalog\.auth\.(uid|role)\s*\(/);
    }
  });

  it("locks search_path without adding the auth schema (C1)", () => {
    const helpers = readFileSync(
      join(PROPOSED_DIR, "20261015000010_sherivs_authz_helpers_active.sql.proposed"),
      "utf8",
    );
    expect(helpers).toMatch(/SET search_path = pg_catalog, public/);
    expect(helpers).not.toMatch(/search_path = pg_catalog, public, auth/);
    expect(helpers).toMatch(/auth\.uid\(\)/);
  });

  it("pins C2 memberships freeze to trigger depth or service_role, not a GUC", () => {
    const freeze = readFileSync(
      join(PROPOSED_DIR, "20261015000030_sherivs_users_identity_freeze.sql.proposed"),
      "utf8",
    );
    expect(freeze).toMatch(/pg_catalog\.pg_trigger_depth\(\) > 1/);
    expect(freeze).toMatch(/auth\.role\(\) = 'service_role'/);
    expect(freeze).not.toMatch(/set_config|current_setting|sherivs\.allow/);
    expect(freeze).toMatch(/self_activation_frozen/);
  });

  it("re-revokes identity, HR, and settlement columns after table GRANT (C3)", () => {
    const grants = readFileSync(
      join(PROPOSED_DIR, "20261015000080_sherivs_rls_grant_hygiene.sql.proposed"),
      "utf8",
    );
    const revokeRoleAt = grants.lastIndexOf("REVOKE UPDATE (role, school_id)");
    const grantUsersAt = grants.lastIndexOf("GRANT SELECT, UPDATE ON TABLE public.users");
    expect(grantUsersAt).toBeGreaterThan(-1);
    expect(revokeRoleAt).toBeGreaterThan(grantUsersAt);
    expect(grants).toMatch(/REVOKE SELECT, UPDATE \(\s*salary, nin, bank_name/);
    expect(grants).toMatch(/REVOKE UPDATE \(\s*status, paid_amount, paid_at, paystack_reference/);
    expect(grants).toMatch(/users\.is_active/);
  });

  it("separates lesson-plan owner edits from approval (H2)", () => {
    const waveB = readFileSync(
      join(PROPOSED_DIR, "20261015000060_sherivs_rls_wave_b_students_map_plans_attendance.sql.proposed"),
      "utf8",
    );
    expect(waveB).toMatch(/lesson_plans_update_owner_content/);
    expect(waveB).toMatch(/lesson_plans_update_admin_review/);
    expect(waveB).toMatch(/lesson_plan_self_approval_denied/);
    expect(waveB).not.toMatch(/CREATE POLICY lesson_plans_update_owner_or_admin/);
  });

  it("HR SQL RPC does not accept p_role and pins staff targets (H5)", () => {
    const hr = readFileSync(
      join(PROPOSED_DIR, "20261015000020_sherivs_admin_hr_rpcs.sql.proposed"),
      "utf8",
    );
    expect(hr).not.toMatch(/p_role\s+text/);
    expect(hr).toMatch(/not_staff_target/);
    expect(hr).toMatch(/'teacher','admin','principal','bursar','driver','librarian','nurse'/);
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
    expect(plan).toContain("PASS WITH CONDITIONS");
    expect(plan).toContain("Not fully passed");
    expect(plan).toContain("d195ba8");
    expect(plan).toContain("20261008000050_coregrid_organization_memberships.sql");
    expect(plan).toContain("does not declare any finding remediated");
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

  it("ships companion plan files including Gate 3 corrections", () => {
    for (const rel of [
      "docs/security/rls-prep/CHANGE-SETS.md",
      "docs/security/rls-prep/APPLICATION-INVENTORY.md",
      "docs/security/rls-prep/PER-TABLE-RLS-MATRIX.md",
      "docs/security/rls-prep/STAGING-TEST-HARNESS.md",
      "docs/security/rls-prep/VERIFICATION-AND-ROLLBACK.md",
      "docs/security/rls-prep/GATE3-CORRECTIONS.md",
      "docs/security/rls-prep/HR-RPC-CONTRACT.md",
      "docs/security/rls-prep/PAYMENT-INVARIANTS.md",
      "docs/security/rls-prep/RELATED-POLICIES.md",
      "scripts/staging/sherivs-rls-prep/catalog-verify.sql",
    ]) {
      expect(existsSync(join(ROOT, rel)), rel).toBe(true);
    }
  });
});
