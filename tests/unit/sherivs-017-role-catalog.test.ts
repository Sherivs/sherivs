import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  NG_GUARDRAILS,
  NG_PERMISSIONS,
  NG_ROLE_CATALOG_STATS,
  NG_ROLE_TEMPLATES,
  NG_ROLES,
} from "../../frontend/src/lib/scholar/roles/ng-role-catalog.generated";

const MIG = readFileSync("database/supabase/migrations/20261024000240_sherivs_017_role_permission_catalog.sql", "utf8");
const RB = readFileSync("database/supabase/rollbacks/20261024000240_sherivs_017_role_permission_catalog.sql", "utf8");

describe("SHERIVS-017 Nigerian role catalog", () => {
  it("covers every institution type with 500+ unique roles", () => {
    expect(NG_ROLES.length).toBeGreaterThanOrEqual(500);
    expect(new Set(NG_ROLES.map((r) => r.code)).size).toBe(NG_ROLES.length);
    const types = new Set(NG_ROLES.flatMap((r) => r.institutionTypes));
    for (const t of ["government", "nursery", "primary", "secondary", "boarding", "faith", "polytechnic", "college_of_education", "university"])
      expect(types.has(t)).toBe(true);
    for (const name of ["Vice-Chancellor", "Rector", "Provost", "Registrar", "Bursar", "Level Adviser", "SIWES Coordinator (Institution)", "House Master", "Matron", "School Imam", "Chaplain", "Form Master / Form Mistress", "Executive Chairman, SUBEB", "Payroll Officer", "Internal Auditor"])
      expect(NG_ROLES.some((r) => r.name === name)).toBe(true);
  });
  it("every role resolves to a template with mandatory permissions and guardrails", () => {
    for (const r of NG_ROLES) {
      const t = NG_ROLE_TEMPLATES[r.template];
      expect(t, r.code).toBeDefined();
      expect(t.mandatory.length, r.template).toBeGreaterThan(0);
      expect(t.guardrails).toContain("tenant_isolation");
      for (const p of [...t.mandatory, ...t.optionalOn, ...t.optionalOff]) expect(NG_PERMISSIONS[p], p).toBeDefined();
      for (const g of t.guardrails) expect(NG_GUARDRAILS[g], g).toBeDefined();
      expect(t.mandatory.filter((p) => t.optionalOn.includes(p) || t.optionalOff.includes(p))).toEqual([]);
    }
  });
  it("teaching roles are class-scoped and never carry payroll/approval powers as mandatory", () => {
    for (const k of ["teacher", "form_teacher", "teaching_support"]) {
      expect(NG_ROLE_TEMPLATES[k].scope).toBe("class");
      expect(NG_ROLE_TEMPLATES[k].guardrails).toContain("own_classes_only");
      expect(NG_ROLE_TEMPLATES[k].mandatory.some((p) => p.startsWith("payroll.prepare") || p === "payroll.approve" || p === "expenses.approve")).toBe(false);
    }
    expect(NG_ROLE_TEMPLATES.auditor.guardrails).toContain("auditor_independence");
    expect(NG_ROLE_TEMPLATES.regulator.mandatory).toEqual(["regulator.read_aggregate"]);
  });
  it("stats match the generated catalog", () => {
    expect(NG_ROLE_CATALOG_STATS.roles).toBe(NG_ROLES.length);
    expect(NG_ROLE_CATALOG_STATS.permissions).toBe(Object.keys(NG_PERMISSIONS).length);
  });
});

describe("SHERIVS-017 migration guardrails", () => {
  it("seed in the migration is the generated one", () => {
    const seed = readFileSync("tools/role-catalog/seed.generated.sql", "utf8").trim();
    expect(MIG).toContain(seed);
  });
  it("API roles cannot write the catalog, settings or assignments", () => {
    expect(MIG).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.permission_catalog[\s\S]+FROM PUBLIC, anon, authenticated, service_role;/);
    expect(MIG).toContain("FORCE ROW LEVEL SECURITY");
  });
  it("mandatory permissions, guardrails, protected grants and SoD are enforced in the DB", () => {
    expect(MIG).toContain("mandatory permission % on % cannot be removed");
    expect(MIG).toContain("guardrails on % cannot be removed");
    expect(MIG).toContain("is mandatory for role % and cannot be toggled");
    expect(MIG).toContain("can only be held through a catalog role that carries it");
    expect(MIG).toContain("separation of duties: % conflicts with the existing role %");
    expect(MIG).toContain("no_self_role_grant");
    expect(MIG).toContain("no_self_payroll_approval");
    expect(MIG).toContain("no_self_expense_approval");
    expect(MIG).toContain("approval limit exceeded");
  });
  it("every change is audited into audit_logs", () => {
    expect(MIG).toMatch(/CREATE TRIGGER trg_%1\$s_audit AFTER INSERT OR UPDATE OR DELETE/);
    expect(MIG).toContain("INSERT INTO public.audit_logs (school_id, user_id, action, table_name, record_id, old_value, new_value)");
  });
  it("rollback removes every new function and table", () => {
    for (const fn of ["role_context", "role_create_custom", "role_assign", "role_set_optional", "role_add_custom_grant", "effective_permissions", "has_permission", "staff_payroll_sod_guard", "school_expenses_sod_guard"])
      expect(RB).toContain(`DROP FUNCTION IF EXISTS public.${fn}(`);
    expect(RB).toContain("public.user_role_assignments");
  });
});
