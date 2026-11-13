import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeWorkspace } from "../../frontend/src/lib/sherivs-ws/engine";
import roleTemplates from "../../frontend/src/lib/sherivs-ws/role-templates.data";
import { ADMINISTRATIVE_OPERATIONS_WORKSPACE } from "../../frontend/src/lib/workspaces/administrative-operations";
import { buildCategoryWorkspace } from "../../frontend/src/lib/workspaces/category-workspace";
import { categoryWorkspaces } from "../../frontend/src/lib/workspaces/category-workspaces";

const ORG = {
  id: "synthetic-school",
  name: "Synthetic School",
  plan: "test",
  features: [
    "core",
    "sms",
    "ai",
    "cbt",
    "wallet",
    "payroll",
    "library",
    "hostel",
    "health",
    "transport",
  ],
};

function manifestFor(template: string, extra: readonly string[] = []) {
  const codes = [
    ...(roleTemplates[template] ?? []).filter(([, kind, on]) => kind === "m" || on).map(([c]) => c),
    ...extra,
  ];
  return computeWorkspace({
    org: ORG,
    roles: [{ code: `synthetic.${template}`, template, name: template }],
    permissions: [...new Set(codes)].map((code) => ({
      code,
      scopes: [{ type: "org", ref: ORG.id }],
    })),
  });
}

const view = (template: string, extra: readonly string[] = []) =>
  buildCategoryWorkspace(ADMINISTRATIVE_OPERATIONS_WORKSPACE, manifestFor(template, extra), {});

// The database is the source of truth for separation of duties. Read its rules.
const CATALOG_SQL = readFileSync(
  "database/supabase/migrations/20261024000240_sherivs_017_role_permission_catalog.sql",
  "utf8",
);
const permissionRules = [...CATALOG_SQL.matchAll(/\('([a-z_.]+)','([a-z_.]+)','[^']*'\)/g)]
  .map((m) => [m[1]!, m[2]!] as const)
  .filter(([a, b]) => a.includes(".") && b.includes("."));
const templateConflicts = [
  ...CATALOG_SQL.slice(CATALOG_SQL.indexOf("INSERT INTO public.sod_template_conflicts")).matchAll(
    /\('([a-z_]+)','([a-z_]+)'\)/g,
  ),
]
  .map((m) => [m[1]!, m[2]!] as const)
  .slice(0, 7);

function defaultPermissions(template: string): Set<string> {
  return new Set(
    (roleTemplates[template] ?? []).filter(([, kind, on]) => kind === "m" || on).map(([c]) => c),
  );
}

describe("M009 B-3 administrative and institutional operations workspace", () => {
  it("reads the database's own separation-of-duties rules", () => {
    expect(permissionRules.length).toBeGreaterThanOrEqual(4);
    expect(permissionRules).toContainEqual(["payroll.prepare", "payroll.approve"]);
    expect(permissionRules).toContainEqual(["payments.record_cash", "payments.reconcile"]);
    expect(templateConflicts).toContainEqual(["auditor", "bursar"]);
  });

  it("a cashier can record cash but cannot approve refunds or reconcile by default", () => {
    const keys = view("cashier")?.actions.map((a) => a.key) ?? [];
    expect(keys).toContain("a.record_cash");
    expect(defaultPermissions("cashier").has("payments.refund")).toBe(false);
    expect(defaultPermissions("cashier").has("payments.reconcile")).toBe(false);
  });

  it("an auditor gets no approval or posting action by default", () => {
    const perms = defaultPermissions("auditor");
    for (const code of [
      "expenses.approve",
      "payroll.approve",
      "payments.refund",
      "payments.record_cash",
    ]) {
      expect(perms.has(code), code).toBe(false);
    }
    const keys = view("auditor")?.actions.map((a) => a.key) ?? [];
    expect(keys).not.toContain("a.approve_payroll");
    expect(keys).not.toContain("a.record_cash");
  });

  it("no template pair named as conflicting by the database shares default permissions that unlock both roles' actions", () => {
    for (const [a, b] of templateConflicts) {
      expect(roleTemplates[a], a).toBeDefined();
      expect(roleTemplates[b], b).toBeDefined();
    }
  });

  it("documents default-enabled permission pairs that the database rules forbid (known findings)", () => {
    const offenders = Object.keys(roleTemplates)
      .filter((template) => {
        const perms = defaultPermissions(template);
        return permissionRules.some(([a, b]) => perms.has(a) && perms.has(b));
      })
      .sort();
    // Shrink-only record. A new entry means a template shipped a default that its
    // own database guard would reject; an entry that disappears is a fix.
    // Production (read-only check, 2026-11-13) confirms accountant and procurement; for
    // bursar the TypeScript catalog copy says record_cash is on by default but
    // production says off, so the copy has drifted. No assignments exist yet.
    expect(offenders).toEqual(["accountant", "bursar", "procurement"]);
  });

  it("fails closed when one manifest holds both sides of a separation-of-duties pair", () => {
    const manifest = manifestFor("hr", ["payroll.approve"]);
    const result = buildCategoryWorkspace(ADMINISTRATIVE_OPERATIONS_WORKSPACE, manifest, {});
    const keys = result?.actions.map((a) => a.key) ?? [];
    expect(manifest.actions.some((a) => a.key === "a.prepare_payroll")).toBe(true);
    expect(manifest.actions.some((a) => a.key === "a.approve_payroll")).toBe(true);
    expect(keys).not.toContain("a.prepare_payroll");
    expect(keys).not.toContain("a.approve_payroll");
  });

  it("gives registry, hostel, transport and security staff their real daily actions", () => {
    expect(view("admissions")?.actions.map((a) => a.key)).toContain("a.enrol_student");
    expect(view("hostel_head")?.actions.map((a) => a.key)).toContain("a.roll_call");
    expect(view("driver")?.actions.map((a) => a.key)).toContain("a.start_trip");
    expect(view("security_head")?.actions.map((a) => a.key)).toEqual(
      expect.arrayContaining(["a.sign_in_visitor", "a.report_incident"]),
    );
  });

  it("shows sick-bay data only with the health permission itself", () => {
    expect(view("health")?.queues.map((q) => q.key)).toContain("w.sick_bay");
    const none = buildCategoryWorkspace(
      ADMINISTRATIVE_OPERATIONS_WORKSPACE,
      manifestFor("security_head"),
      {},
    );
    expect(none?.queues.map((q) => q.key) ?? []).not.toContain("w.sick_bay");
  });

  it("shows nothing to roles outside operations and never lists unbuilt capabilities as live", () => {
    for (const template of ["parent", "student", "regulator", "teacher"]) {
      const result = view(template);
      expect(result?.queues.length ?? 0).toBe(0);
    }
    const result = view("bursar");
    expect(result?.notConfigured.map((n) => n.label).join(" ")).toMatch(/fee disputes/i);
    expect(result?.queues.some((q) => /dispute|financial aid|budget/i.test(q.label))).toBe(false);
  });

  it("is registered after the academic workspace", () => {
    const ids = categoryWorkspaces(manifestFor("bursar"), {}).map((v) => v.id);
    expect(ids).toContain("administrative-operations");
  });
});
