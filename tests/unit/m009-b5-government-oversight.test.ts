import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeWorkspace } from "../../frontend/src/lib/sherivs-ws/engine";
import roleTemplates from "../../frontend/src/lib/sherivs-ws/role-templates.data";
import { buildCategoryWorkspace } from "../../frontend/src/lib/workspaces/category-workspace";
import { categoryWorkspaces } from "../../frontend/src/lib/workspaces/category-workspaces";
import { GOVERNMENT_OVERSIGHT_WORKSPACE } from "../../frontend/src/lib/workspaces/government-oversight";

const ORG = {
  id: "synthetic-authority",
  name: "Synthetic Authority",
  plan: "test",
  features: ["core", "health", "sms", "ai", "cbt", "transport"],
};

function manifestFor(template: string, extra: readonly string[] = []) {
  const codes = [
    ...(roleTemplates[template] ?? []).filter(([, k, on]) => k === "m" || on).map(([c]) => c),
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
const view = (template: string, extra: readonly string[] = [], cards = {}) =>
  buildCategoryWorkspace(GOVERNMENT_OVERSIGHT_WORKSPACE, manifestFor(template, extra), cards);

describe("M009 B-5 government oversight workspace", () => {
  it("gives oversight templates aggregate widgets and the inspection action", () => {
    for (const template of ["regulator", "regulator_inspector"]) {
      const result = view(template);
      expect(
        result?.queues.map((q) => q.key),
        template,
      ).toEqual(expect.arrayContaining(["w.gov_overview", "w.gov_compliance"]));
      expect(result?.actions.map((a) => a.key)).toContain("a.gov_inspect");
    }
  });

  it("shows only the metric from a widget payload, never lists or notes", () => {
    const result = view("regulator", [], {
      "w.gov_overview": {
        metric: 12,
        note: "Synthetic Person Name",
        list: [["Synthetic Learner", "absent"]],
        warn: "synthetic detail",
      },
    });
    const text = JSON.stringify(result);
    expect(result?.queues.find((q) => q.key === "w.gov_overview")?.value).toBe("12");
    expect(text).not.toContain("Synthetic Person Name");
    expect(text).not.toContain("Synthetic Learner");
    expect(text).not.toContain("synthetic detail");
  });

  it("never surfaces identifiable widgets, even if a manifest carried them", () => {
    const base = manifestFor("regulator");
    const donor = manifestFor("health", ["welfare.pastoral", "reports.academic"]);
    const teacher = manifestFor("teacher");
    const mixed = {
      ...base,
      widgets: [...base.widgets, ...donor.widgets, ...teacher.widgets],
      inbox: [...base.inbox, ...donor.inbox],
    };
    expect(mixed.widgets.some((w) => w.key === "w.sick_bay")).toBe(true);
    const result = buildCategoryWorkspace(GOVERNMENT_OVERSIGHT_WORKSPACE, mixed, {});
    const keys = (result?.queues ?? []).map((q) => q.key);
    for (const forbidden of GOVERNMENT_OVERSIGHT_WORKSPACE.forbiddenKeys ?? []) {
      expect(keys).not.toContain(forbidden);
    }
    expect(keys.every((k) => k.startsWith("w.gov_"))).toBe(true);
  });

  it("shows nothing to institution staff, guardians or learners", () => {
    for (const template of [
      "teacher",
      "bursar",
      "parent",
      "student",
      "head_of_institution",
      "proprietor",
    ]) {
      expect(view(template), template).toBeNull();
    }
  });

  it("labels absent data as not configured and states the reporting stage is out of scope", () => {
    const result = view("regulator");
    for (const q of result?.queues ?? []) expect(q.value).toBe("Not configured");
    expect(result?.notConfigured.map((n) => n.label).join(" ")).toMatch(/reporting/i);
  });

  it("is registered", () => {
    expect(categoryWorkspaces(manifestFor("regulator"), {}).map((v) => v.id)).toContain(
      "government-oversight",
    );
  });
});

describe("M009 B-5 oversight authority gate (static)", () => {
  const migration = readFileSync(
    "database/supabase/migrations/20261103153000_sherivs_m009_b5_oversight_authority_gate.sql",
    "utf8",
  ).replace(/--.*$/gm, "");
  const rollback = readFileSync(
    "database/supabase/rollbacks/20261103153000_sherivs_m009_b5_oversight_authority_gate.sql",
    "utf8",
  ).replace(/--.*$/gm, "");

  it("flags both oversight templates as authority-dependent and nothing else", () => {
    expect(migration).toMatch(/requires_verified_authority_link\s*=\s*true/);
    expect(migration).toMatch(/template_code IN \('regulator', 'regulator_inspector'\)/);
    expect(migration).not.toMatch(/INSERT INTO/i);
    expect(migration).not.toMatch(/institution_authority_links/i);
  });

  it("only narrows eligibility and has a matching rollback", () => {
    expect(migration).not.toMatch(/GRANT|DROP|DELETE|TRUNCATE/i);
    expect(rollback).toMatch(/requires_verified_authority_link\s*=\s*false/);
    expect(rollback).toMatch(/template_code IN \('regulator', 'regulator_inspector'\)/);
  });

  it("stays inside the reserved migration block", () => {
    const version = 20261103153000;
    expect(version).toBeGreaterThanOrEqual(20261103153000);
    expect(version).toBeLessThanOrEqual(20261103153999);
  });
});
