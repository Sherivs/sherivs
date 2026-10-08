/**
 * Sherivs multi-membership identity store — structural migration pins.
 *
 * Pins the authored migration 20261008000050_coregrid_organization_memberships.sql
 * (+ its genuine inverse rollback):
 *
 *  1. ADDITIVE only — no rename, no drop of the legacy identity store;
 *     `users.school_id` remains the ACTIVE-CONTEXT binding.
 *  2. Table shape: one row per (user, organization), declared tenant roles
 *     only (no super_admin — that is internal workforce, not a tenant role),
 *     single-primary partial unique index.
 *  3. Trigger-enforced consistency: every write to public.users mirrors into
 *     the membership set; a school MOVE demotes the previous primary but
 *     keeps the prior affiliation as history.
 *  4. RLS ENABLED + FORCED with the exact four-policy posture; member reads
 *     own rows, organization admin manages only the active organization,
 *     internal workforce manages all; anon has NO privileges.
 *  5. Multi-membership-aware helpers keep legacy signatures and semantics
 *     (ONE active organization) with legacy fallback.
 *  6. The rollback is the genuine inverse: substrate removed, legacy helper
 *     bodies restored, identity-store data untouched.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATION_PATH =
  "database/supabase/migrations/20261008000050_coregrid_organization_memberships.sql";
const ROLLBACK_PATH =
  "database/supabase/rollbacks/20261008000050_coregrid_organization_memberships.sql";

const MIGRATION = readFileSync(join(ROOT, MIGRATION_PATH), "utf8");
const ROLLBACK = readFileSync(join(ROOT, ROLLBACK_PATH), "utf8");

describe("organization_memberships migration — structure", () => {
  it("is additive: never renames or drops the legacy identity store", () => {
    expect(MIGRATION).not.toMatch(/ALTER TABLE public\.users\s+RENAME/i);
    expect(MIGRATION).not.toMatch(/DROP TABLE/i);
    expect(MIGRATION).not.toMatch(/DROP COLUMN/i);
    // The active-context binding survives untouched as a column.
    expect(MIGRATION).toMatch(/users\.school_id REMAINS the ACTIVE-CONTEXT binding/i);
  });

  it("declares the SET semantics: unique (user, organization) membership", () => {
    expect(MIGRATION).toMatch(
      /CONSTRAINT organization_memberships_user_school_unique UNIQUE \(user_id, school_id\)/,
    );
  });

  it("mirrors the declared tenant role vocabulary and excludes super_admin", () => {
    const roleCheck = MIGRATION.match(/CHECK \(role IN \(([^)]*)\)\)/)?.[1] ?? "";
    // Mirrors the live users_role_check vocabulary exactly, so the dual-write
    // trigger can never fail on a role the identity store legally holds.
    for (const role of ["admin","principal","teacher","parent","student","bursar","hq","alumni","driver"]) {
      expect(roleCheck).toContain(`'${role}'`);
    }
    expect(roleCheck).not.toContain("super_admin");
  });

  it("caps the primary membership at one per user (active-context default)", () => {
    expect(MIGRATION).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS organization_memberships_single_primary\s+ON public\.organization_memberships \(user_id\)\s+WHERE is_primary = true/,
    );
  });

  it("dual-writes from the identity store and preserves prior affiliations on a school move", () => {
    expect(MIGRATION).toMatch(
      /CREATE TRIGGER organization_memberships_sync\s+AFTER INSERT OR UPDATE OF school_id, role, is_active ON public\.users/,
    );
    // A move demotes the previous primary — it does NOT delete it.
    expect(MIGRATION).toMatch(/SET is_primary = false/);
    expect(MIGRATION).not.toMatch(/DELETE FROM public\.organization_memberships/);
    expect(MIGRATION).toMatch(/prior affiliations are history/i);
  });

  it("backfills idempotently (ON CONFLICT DO NOTHING)", () => {
    expect(MIGRATION).toMatch(/ON CONFLICT \(user_id, school_id\) DO NOTHING/);
  });
});

describe("organization_memberships migration — security posture", () => {
  it("enables AND forces row level security", () => {
    expect(MIGRATION).toMatch(/ALTER TABLE public\.organization_memberships ENABLE ROW LEVEL SECURITY/);
    expect(MIGRATION).toMatch(/ALTER TABLE public\.organization_memberships FORCE ROW LEVEL SECURITY/);
  });

  it("ships exactly the four policy commands, member-scoped", () => {
    expect(MIGRATION).toMatch(/CREATE POLICY organization_memberships_select[\s\S]*?FOR SELECT\s+USING \(\s*auth\.uid\(\) = user_id/);
    expect(MIGRATION).toMatch(/CREATE POLICY organization_memberships_insert[\s\S]*?FOR INSERT\s+WITH CHECK/);
    expect(MIGRATION).toMatch(/CREATE POLICY organization_memberships_update[\s\S]*?FOR UPDATE\s+USING/);
    expect(MIGRATION).toMatch(/CREATE POLICY organization_memberships_delete[\s\S]*?FOR DELETE\s+USING/);
    // A client can never grant itself a membership it cannot administer.
    expect(MIGRATION).toMatch(/WITH CHECK \(\s*public\.is_super_admin\(\)\s+OR \(public\.is_school_admin\(\) AND school_id = public\.get_my_school_id\(\)\)\s*\)/);
  });

  it("is privilege-fail-closed: anon nothing, authenticated policy-gated DML, service full", () => {
    expect(MIGRATION).toMatch(/REVOKE ALL ON TABLE public\.organization_memberships FROM anon/);
    expect(MIGRATION).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.organization_memberships TO authenticated/,
    );
    expect(MIGRATION).toMatch(/GRANT ALL ON TABLE public\.organization_memberships TO service_role/);
  });

  it("keeps helper signatures and semantics: ONE active organization, legacy fallback", () => {
    expect(MIGRATION).toMatch(/CREATE OR REPLACE FUNCTION public\.get_my_school_id\(\)\s+RETURNS uuid/);
    expect(MIGRATION).toMatch(/CREATE OR REPLACE FUNCTION public\.get_my_role\(\)\s+RETURNS text/);
    expect(MIGRATION).toMatch(/CREATE OR REPLACE FUNCTION public\.get_my_memberships\(\)/);
    // Fallback to the legacy identity store when the substrate is empty.
    expect(MIGRATION).toMatch(/SELECT u\.school_id FROM public\.users u WHERE u\.id = auth\.uid\(\)/);
    // Membership-set helper is not world-executable.
    expect(MIGRATION).toMatch(/REVOKE EXECUTE ON FUNCTION public\.get_my_memberships\(\) FROM PUBLIC, anon/);
  });
});

describe("organization_memberships rollback — genuine inverse", () => {
  it("restores the legacy single-membership helper bodies verbatim", () => {
    expect(ROLLBACK).toMatch(
      /SELECT school_id FROM public\.users WHERE id = auth\.uid\(\)/,
    );
    expect(ROLLBACK).toMatch(
      /SELECT role FROM public\.users WHERE id = auth\.uid\(\)/,
    );
    expect(ROLLBACK).toMatch(/DROP FUNCTION IF EXISTS public\.get_my_memberships\(\)/);
  });

  it("removes the policies, the RLS posture, the trigger and the substrate", () => {
    for (const policy of ["select", "insert", "update", "delete"]) {
      expect(ROLLBACK).toMatch(
        new RegExp(`DROP POLICY IF EXISTS organization_memberships_${policy} ON public\\.organization_memberships`),
      );
    }
    expect(ROLLBACK).toMatch(/ALTER TABLE public\.organization_memberships NO FORCE ROW LEVEL SECURITY/);
    expect(ROLLBACK).toMatch(/DROP TRIGGER IF EXISTS organization_memberships_sync ON public\.users/);
    expect(ROLLBACK).toMatch(/DROP FUNCTION IF EXISTS public\.sync_organization_membership_on_user_write\(\)/);
    expect(ROLLBACK).toMatch(/DROP TABLE IF EXISTS public\.organization_memberships/);
  });

  it("touches no identity-store data", () => {
    expect(ROLLBACK).not.toMatch(/DELETE FROM public\.users/i);
    expect(ROLLBACK).not.toMatch(/UPDATE public\.users/i);
    expect(ROLLBACK).not.toMatch(/DROP TABLE public\.users/i);
  });
});
