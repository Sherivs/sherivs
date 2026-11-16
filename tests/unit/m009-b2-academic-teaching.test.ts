import { describe, expect, it } from "vitest";
import { computeWorkspace } from "../../frontend/src/lib/sherivs-ws/engine";
import roleTemplates from "../../frontend/src/lib/sherivs-ws/role-templates.data";
import { primarySections } from "../../frontend/src/components/workspaces/workspace-shell";
import { ACADEMIC_TEACHING_WORKSPACE } from "../../frontend/src/lib/workspaces/academic-teaching";
import {
  buildCategoryWorkspace,
  type CategoryWorkspaceView,
} from "../../frontend/src/lib/workspaces/category-workspace";
import { categoryWorkspaces } from "../../frontend/src/lib/workspaces/category-workspaces";

const ORG = {
  id: "synthetic-school",
  name: "Synthetic School",
  plan: "test",
  features: ["core", "sms", "ai", "cbt", "library", "health"],
};

function manifestFor(template: string, extraPermissions: readonly string[] = []) {
  const codes = [
    ...(roleTemplates[template] ?? []).filter(([, kind, on]) => kind === "m" || on).map(([c]) => c),
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

function view(template: string, extra: readonly string[] = []): CategoryWorkspaceView | null {
  return buildCategoryWorkspace(ACADEMIC_TEACHING_WORKSPACE, manifestFor(template, extra), {});
}

const ACADEMIC_TEMPLATES = [
  "teacher",
  "form_teacher",
  "teaching_support",
  "early_years_carer",
  "level_adviser",
  "exams_officer",
  "exams_records",
  "cbt",
  "librarian",
  "counsellor",
] as const;

describe("M009 B-2 academic and teaching workspace", () => {
  it("only reads templates that exist in the role catalog", () => {
    for (const template of ACADEMIC_TEMPLATES) expect(roleTemplates[template]).toBeDefined();
  });

  it("gives a teacher the real daily actions their permissions grant", () => {
    const keys = view("teacher")?.actions.map((a) => a.key) ?? [];
    expect(keys).toContain("a.take_attendance");
    expect(keys).toContain("a.enter_scores");
    expect(keys).toContain("a.submit_note");
  });

  it("gives an exams officer exam actions but no classroom marking actions", () => {
    const keys = view("exams_officer")?.actions.map((a) => a.key) ?? [];
    expect(keys).toContain("a.schedule_exam");
    expect(keys).not.toContain("a.enter_scores");
    expect(keys).not.toContain("a.take_attendance");
  });

  it("shows no academic workspace to roles outside the category", () => {
    for (const template of ["bursar", "parent", "student", "regulator", "security_staff"]) {
      expect(view(template)).toBeNull();
    }
  });

  it("never adds an item the manifest did not permit", () => {
    for (const template of ACADEMIC_TEMPLATES) {
      const manifest = manifestFor(template);
      const result = buildCategoryWorkspace(ACADEMIC_TEACHING_WORKSPACE, manifest, {});
      const permittedWidgets = new Set(manifest.widgets.map((w) => w.key));
      const permittedActions = new Set(manifest.actions.map((a) => a.key));
      for (const queue of result?.queues ?? []) expect(permittedWidgets.has(queue.key)).toBe(true);
      for (const action of result?.actions ?? [])
        expect(permittedActions.has(action.key)).toBe(true);
    }
  });

  it("hides learner-risk data unless the welfare permission itself granted it", () => {
    // reports.academic also unlocks w.at_risk in the catalog; the B-2 view must not use it.
    const withoutWelfare = manifestFor("health", ["reports.academic"]);
    expect(withoutWelfare.widgets.some((w) => w.key === "w.at_risk")).toBe(true);
    const hidden = buildCategoryWorkspace(ACADEMIC_TEACHING_WORKSPACE, withoutWelfare, {});
    expect(hidden?.queues.some((q) => q.key === "w.at_risk") ?? false).toBe(false);

    const withWelfare = manifestFor("health", ["welfare.pastoral"]);
    const shown = buildCategoryWorkspace(ACADEMIC_TEACHING_WORKSPACE, withWelfare, {});
    expect(shown?.queues.some((q) => q.key === "w.at_risk")).toBe(true);
  });

  it("labels missing data as not configured and never invents values", () => {
    const result = view("teacher");
    for (const queue of result?.queues ?? []) expect(queue.value).toBe("Not configured");
    const loaded = buildCategoryWorkspace(ACADEMIC_TEACHING_WORKSPACE, manifestFor("teacher"), {
      "w.attendance_todo": { metric: 3 },
    });
    expect(loaded?.queues.find((q) => q.key === "w.attendance_todo")?.value).toBe("3");
  });

  it("reports loading and failure states honestly", () => {
    const manifest = manifestFor("teacher");
    const loading = buildCategoryWorkspace(ACADEMIC_TEACHING_WORKSPACE, manifest, {}, true, false);
    const failed = buildCategoryWorkspace(ACADEMIC_TEACHING_WORKSPACE, manifest, {}, false, true);
    expect(loading?.queues.every((q) => q.value === "Loading…")).toBe(true);
    expect(failed?.queues.every((q) => q.value === "Unavailable")).toBe(true);
  });

  it("does not advertise institution-specific modules as available", () => {
    const result = view("teacher");
    expect(result?.notConfigured.map((n) => n.label).join(" ")).toMatch(/not configured|Clinical/i);
    expect(result?.queues.some((q) => /clinical|fieldwork|placement/i.test(q.label))).toBe(false);
  });

  it("is registered and reachable through the category registry", () => {
    const views = categoryWorkspaces(manifestFor("teacher"), {});
    expect(views.map((v) => v.id)).toContain("academic-teaching");
    expect(categoryWorkspaces(null, {})).toEqual([]);
  });

  it("documents how many primary sections each in-scope template currently has", () => {
    const counts = Object.fromEntries(
      ACADEMIC_TEMPLATES.map((t) => [t, primarySections(manifestFor(t)).length]),
    );
    // Roles with fewer than 3 permitted primary sections are listed, not padded.
    for (const [template, count] of Object.entries(counts)) {
      expect(count, template).toBeLessThanOrEqual(3);
    }
    expect(counts.teacher).toBe(3);
  });
});
