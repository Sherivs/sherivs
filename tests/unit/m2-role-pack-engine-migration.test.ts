import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Pins the safety statements of the M2 Roles Pack Engine migration (ADR-105). The behaviour is
 * proven by tests/sql/m2-role-pack-engine.sql; this test fails fast if a statement is removed.
 */
const NAME = "20261117001100_sherivs_m2_role_pack_engine.sql";
const migration = readFileSync(`database/supabase/migrations/${NAME}`, "utf8");
const rollback = readFileSync(`database/supabase/rollbacks/${NAME}`, "utf8");
const code = migration.replace(/--.*$/gm, "");

const TABLES = [
  "role_pack_items",
  "role_pack_migrations",
  "tenant_role_pack_installations",
  "tenant_role_overrides",
  "org_custom_roles",
] as const;

const GUARD_TRIGGERS: ReadonlyArray<[string, string, string]> = [
  ["role_pack_items_guard_trg", "role_pack_items", "role_pack_items_guard"],
  ["role_pack_items_truncate_guard_trg", "role_pack_items", "role_pack_items_guard"],
  ["role_pack_migrations_guard_trg", "role_pack_migrations", "role_pack_migrations_guard"],
  [
    "tenant_role_pack_installations_guard_trg",
    "tenant_role_pack_installations",
    "tenant_role_pack_installations_guard",
  ],
  ["tenant_role_overrides_guard_trg", "tenant_role_overrides", "tenant_role_overrides_guard"],
  ["org_custom_roles_guard_trg", "org_custom_roles", "org_custom_roles_guard"],
];

describe("M2 role pack engine migration (ADR-105)", () => {
  it("is marked NOT APPLIED on its first line and names its rollback", () => {
    expect(migration.split("\n")[0]).toBe(
      "-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.",
    );
    expect(migration).toContain(`-- Rollback: database/supabase/rollbacks/${NAME}`);
    expect(code).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im);
  });

  it.each(TABLES)("%s has ENABLE and FORCE row level security", (table) => {
    expect(code).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
    expect(code).toContain(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY;`);
    expect(code).toMatch(
      new RegExp(`CREATE POLICY \\w+ ON public\\.${table} FOR SELECT TO authenticated`),
    );
  });

  it("grants nothing to anon and only SELECT to authenticated", () => {
    expect(code).not.toMatch(/GRANT[^;]*\bTO\b[^;]*\banon\b/i);
    expect(code).not.toMatch(/GRANT\s+(INSERT|UPDATE|DELETE|ALL)[^;]*TO\s+authenticated/i);
    expect(code).toMatch(
      /REVOKE ALL ON TABLE public\.role_pack_items[^;]*FROM PUBLIC, anon, authenticated;/,
    );
    expect(code).toMatch(
      /REVOKE ALL ON FUNCTION[^;]*role_pack_install\(uuid, text, text\)[^;]*FROM PUBLIC, anon, authenticated;/,
    );
    expect(code).toContain(
      "GRANT EXECUTE ON FUNCTION public.role_pack_install(uuid, text, text) TO service_role;",
    );
  });

  it.each(GUARD_TRIGGERS)("guard trigger %s on %s runs %s", (trigger, table, fn) => {
    expect(code).toMatch(
      new RegExp(
        `CREATE TRIGGER ${trigger}\\s+BEFORE [A-Z ]+ ON public\\.${table}\\s+FOR EACH (ROW|STATEMENT) EXECUTE FUNCTION public\\.${fn}\\(\\);`,
      ),
    );
    expect(rollback).toContain(`DROP FUNCTION IF EXISTS public.${fn}();`);
  });

  it("audits every tenant table with scholar_audit", () => {
    for (const table of [
      "tenant_role_pack_installations",
      "tenant_role_overrides",
      "org_custom_roles",
    ]) {
      expect(code).toMatch(
        new RegExp(
          `CREATE TRIGGER trg_${table}_audit\\s+AFTER INSERT OR UPDATE OR DELETE ON public\\.${table}\\s+FOR EACH ROW EXECUTE FUNCTION public\\.scholar_audit\\(\\);`,
        ),
      );
    }
  });

  it("every function pins an empty search_path and the provisioning entry points are definers", () => {
    const fns = [
      ...code.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\([^]*?\$(function)?\$/g),
    ];
    expect(fns.length).toBeGreaterThanOrEqual(17);
    for (const m of fns) expect(m[0], m[1]).toContain("SET search_path = ''");
    for (const fn of [
      "role_pack_install",
      "role_pack_upgrade_preview",
      "role_pack_upgrade_apply",
    ]) {
      expect(code).toMatch(
        new RegExp(
          `FUNCTION public\\.${fn}\\([^)]*\\)\\s+RETURNS jsonb LANGUAGE plpgsql[^$]*SECURITY DEFINER`,
        ),
      );
    }
  });

  it("keeps four-eyes and the never-narrowable rules in the database", () => {
    expect(code).toContain("CHECK (approved_by IS NULL OR approved_by <> created_by)");
    expect(code).toContain(
      "CHECK (status NOT IN ('active', 'retired') OR approved_by IS NOT NULL)",
    );
    expect(code).toContain("guardrails and separation of duties cannot be overridden");
    expect(code).toContain("protected permission % cannot be added by an override");
    expect(code).toContain("protected permission % cannot be put in a custom role");
    expect(code).toContain("CHECK (kind IN ('tenant_role', 'platform_role', 'institution_pack'))");
  });

  it("rollback restores the ENGINE-01 kind check and fails closed on institution packs", () => {
    expect(rollback).toContain("CHECK (kind IN ('tenant_role', 'platform_role'))");
    expect(rollback).toContain("v_max_rank := CASE NEW.kind WHEN 'tenant_role' THEN 2 ELSE 3 END;");
    expect(rollback).toContain("sherivs.rollback_purge_institution_packs");
    for (const table of TABLES) expect(rollback).toContain(`DROP TABLE IF EXISTS public.${table};`);
  });
});
