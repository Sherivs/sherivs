import { describe, expect, it } from "vitest";
import { buildWorkspaceManifest, workspaceKindForRole } from "../../mobile/src/workspace/manifest";

describe("Track E mobile workspace manifest (one account, role-based tabs)", () => {
  it("maps every users.role value to a workspace", () => {
    expect(workspaceKindForRole("student")).toBe("learner");
    expect(workspaceKindForRole("parent")).toBe("guardian");
    expect(workspaceKindForRole("teacher")).toBe("teaching");
    expect(workspaceKindForRole("bursar")).toBe("finance");
    for (const r of ["admin", "principal", "hq"]) expect(workspaceKindForRole(r)).toBe("leadership");
    for (const r of ["alumni", "driver", "", null, "SOMETHING"]) expect(workspaceKindForRole(r)).toBe("basic");
  });
  it("students get CBT; parents and bursars do not", () => {
    const ids = (role: string) => buildWorkspaceManifest(role).tabs.map((t) => t.id);
    expect(ids("student")).toEqual(["home", "results", "cbt", "attendance", "fees", "messages"]);
    expect(ids("parent")).not.toContain("cbt");
    expect(ids("bursar")).toEqual(["home", "fees", "messages"]);
  });
  it("hidden + visible tabs always cover all six screens exactly once", () => {
    for (const role of ["student", "parent", "teacher", "bursar", "admin", "driver"]) {
      const m = buildWorkspaceManifest(role);
      const all = [...m.tabs.map((t) => t.id), ...m.hidden].sort();
      expect(all).toEqual(["attendance", "cbt", "fees", "home", "messages", "results"]);
    }
  });
  it("unknown roles fail closed to the least-privileged workspace", () => {
    expect(buildWorkspaceManifest("root").tabs.map((t) => t.id)).toEqual(["home", "messages"]);
  });
});
