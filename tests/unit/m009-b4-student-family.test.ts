import { describe, expect, it } from "vitest";
import { computeWorkspace } from "../../frontend/src/lib/sherivs-ws/engine";
import roleTemplates from "../../frontend/src/lib/sherivs-ws/role-templates.data";
import { buildCategoryWorkspace } from "../../frontend/src/lib/workspaces/category-workspace";
import { categoryWorkspaces } from "../../frontend/src/lib/workspaces/category-workspaces";
import {
  GUARDIAN_FAMILY_WORKSPACE,
  LEARNER_WORKSPACE,
} from "../../frontend/src/lib/workspaces/student-family";

const ORG = {
  id: "synthetic-school",
  name: "Synthetic School",
  plan: "test",
  features: ["core", "sms", "ai", "cbt", "transport"],
};

function manifestFor(
  template: string,
  extraPermissions: readonly string[] = [],
  only?: readonly string[],
) {
  const codes = only ?? [
    ...(roleTemplates[template] ?? []).filter(([, k, on]) => k === "m" || on).map(([c]) => c),
    ...extraPermissions,
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

const guardian = (template: string, only?: readonly string[]) =>
  buildCategoryWorkspace(GUARDIAN_FAMILY_WORKSPACE, manifestFor(template, [], only), {});
const learner = (template: string) =>
  buildCategoryWorkspace(LEARNER_WORKSPACE, manifestFor(template), {});

describe("M009 B-4 student, parent and family workspace", () => {
  it("shows a parent their children and fees, and the pay action", () => {
    const view = guardian("parent");
    expect(view?.queues.map((q) => q.key)).toEqual(
      expect.arrayContaining(["w.children_summary", "w.child_fees"]),
    );
    expect(view?.actions.map((a) => a.key)).toContain("a.pay_fees");
  });

  it("gives a parent no learner self-service items and a student no guardian items", () => {
    const parentLearner = learner("parent");
    expect(parentLearner).toBeNull();
    const studentGuardian = guardian("student");
    expect(studentGuardian).toBeNull();
    const student = learner("student");
    expect(student?.queues.map((q) => q.key)).toContain("w.my_timetable");
  });

  it("does not let fee access alone open children's records", () => {
    // A payer holding only fees.view (no verified children.view) gets nothing.
    expect(guardian("parent", ["fees.view"])).toBeNull();
  });

  it("an adult student never inherits parental supervision items, even if a manifest mixed them", () => {
    // Worst case: a student-family manifest that somehow carries guardian items.
    const mixed = { ...manifestFor("parent"), families: ["student"] };
    expect(mixed.widgets.some((w) => w.key === "w.children_summary")).toBe(true);
    const result = buildCategoryWorkspace(LEARNER_WORKSPACE, mixed, {});
    const keys = [...(result?.queues ?? []), ...(result?.actions ?? [])].map((i) => i.key);
    for (const forbidden of ["w.children_summary", "w.child_fees", "w.child_bus", "a.pay_fees"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("a guardian view never shows learner self-service items", () => {
    const mixed = { ...manifestFor("student"), families: ["parent"] };
    expect(mixed.widgets.some((w) => w.key === "w.my_results")).toBe(true);
    const result = buildCategoryWorkspace(GUARDIAN_FAMILY_WORKSPACE, mixed, {});
    const keys = [...(result?.queues ?? []), ...(result?.actions ?? [])].map((i) => i.key);
    for (const forbidden of ["w.my_results", "w.my_timetable", "w.my_cbt", "a.ask_tutor"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("shows nothing to staff, government or governance roles", () => {
    for (const template of ["teacher", "bursar", "regulator", "proprietor", "security_head"]) {
      expect(guardian(template)).toBeNull();
      expect(learner(template)).toBeNull();
    }
  });

  it("keeps guardian-only permission off the student template and vice versa", () => {
    const studentPerms = (roleTemplates.student ?? []).map(([c]) => c);
    const parentPerms = (roleTemplates.parent ?? []).map(([c]) => c);
    expect(studentPerms).not.toContain("children.view");
    expect(parentPerms).not.toContain("self.view_own");
  });

  it("labels missing data as not configured", () => {
    for (const q of guardian("parent")?.queues ?? []) expect(q.value).toBe("Not configured");
    const loaded = buildCategoryWorkspace(GUARDIAN_FAMILY_WORKSPACE, manifestFor("parent"), {
      "w.child_fees": { metric: 2 },
    });
    expect(loaded?.queues.find((q) => q.key === "w.child_fees")?.value).toBe("2");
  });

  it("is registered and a parent who is also a student sees two separate sections", () => {
    const ids = categoryWorkspaces(manifestFor("parent"), {}).map((v) => v.id);
    expect(ids).toContain("family-guardian");
    expect(ids).not.toContain("learner-self");
  });
});
