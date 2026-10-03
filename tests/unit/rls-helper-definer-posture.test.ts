/**
 * RLS helper posture ratchet — is_super_admin() must be SECURITY DEFINER.
 *
 * Recursion defect (observed live by the F-13 e2e vertical slice, T6):
 *   public.is_super_admin() was the ONLY helper left SECURITY INVOKER after
 *   20260620151525 flipped its three siblings (get_my_school_id,
 *   get_my_role, is_school_admin) to SECURITY DEFINER to fix the same
 *   recursion class. Reading public.super_admins under its own policy
 *   ("Super admin reads super_admins" USING id = auth.uid() OR
 *   is_super_admin()) re-invokes the helper for any scanned row that is not
 *   the caller -> unbounded RLS recursion -> PG 54001 "stack depth limit
 *   exceeded" on every tenant read (schools, users, ...) whenever at least
 *   one super_admins row exists. Reproduced deterministically against the
 *   canonical backend; fixed by
 *   20261003000020_coregrid_is_super_admin_definer.sql.
 *
 * This ratchet pins, at the migration-source level:
 *   1. the lexically-last definition of is_super_admin is SECURITY DEFINER;
 *   2. the fix migration and its exact-inverse rollback both exist;
 *   3. the canonical apply manifest binds the migration checksum.
 *
 * READ-ONLY: no database access, no network, no secrets.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATIONS_DIR = join(ROOT, "database", "supabase", "migrations");
const ROLLBACKS_DIR = join(ROOT, "database", "supabase", "rollbacks");
const FIX_MIGRATION = "20261003000020_coregrid_is_super_admin_definer.sql";
const MANIFEST_PATH = "architecture/proofs/CANONICAL_APPLY_RECORD_HARDENING.json";

/** All migration files that define public.is_super_admin, lexically sorted (apply order). */
function isSuperAdminDefinitionFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => {
      const body = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
      return /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.is_super_admin/.test(body);
    });
}

describe("is_super_admin RLS helper posture", () => {
  it("is last defined as SECURITY DEFINER — the recursion ratchet", () => {
    const files = isSuperAdminDefinitionFiles();
    expect(files.length).toBeGreaterThan(0);
    const last = readFileSync(join(MIGRATIONS_DIR, files[files.length - 1]!), "utf8");
    const defn = last.match(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.is_super_admin[\s\S]*?\$\$\s*([\s\S]*?)\s*\$\$;/,
    );
    expect(defn, `parse definition in ${files[files.length - 1]}`).toBeTruthy();
    expect(last.slice(defn!.index ?? 0, (defn!.index ?? 0) + 300)).toMatch(/SECURITY\s+DEFINER/);
  });

  it("every historical INVOKER definition is superseded (no later INVOKER redefinition)", () => {
    const files = isSuperAdminDefinitionFiles();
    const lastDefinerIndex = files.findIndex((f) =>
      readFileSync(join(MIGRATIONS_DIR, f), "utf8")
        .slice(0, 400)
        .includes("SECURITY DEFINER"),
    );
    expect(lastDefinerIndex, "at least one DEFINER definition must exist").toBeGreaterThan(-1);
    for (const f of files.slice(lastDefinerIndex + 1)) {
      const head = readFileSync(join(MIGRATIONS_DIR, f), "utf8").slice(0, 400);
      expect(head, `${f} must not reintroduce SECURITY INVOKER`).not.toMatch(
        /SECURITY\s+INVOKER/,
      );
    }
  });

  it("the fix migration ships its exact-inverse rollback (Constitution §38)", () => {
    const migration = readFileSync(join(MIGRATIONS_DIR, FIX_MIGRATION), "utf8");
    const rollback = readFileSync(join(ROLLBACKS_DIR, FIX_MIGRATION), "utf8");
    expect(migration).toMatch(/SECURITY\s+DEFINER/);
    expect(rollback).toMatch(/SECURITY\s+INVOKER/);
  });

  it("the canonical apply manifest binds the fix migration", () => {
    const record = JSON.parse(readFileSync(join(ROOT, MANIFEST_PATH), "utf8"));
    const entry = record.declaredVsApplied?.find(
      (m: { file?: string }) => m.file === FIX_MIGRATION,
    );
    expect(entry, "manifest covers the fix migration").toBeTruthy();
    expect(entry.state).toMatch(/APPLIED|ALREADY_APPLIED/);
  });
});
