import { describe, expect, it } from "vitest";
import type {
  WorkspaceManifest,
  WorkspaceManifestItem,
} from "../../frontend/src/components/workspaces/_contract-shim";
import {
  institutionalExecutiveApprovals,
  institutionalExecutiveCards,
  isInstitutionalExecutiveWorkspace,
} from "../../frontend/src/lib/workspaces/institutional-executive";

const widget = (key: string): WorkspaceManifestItem => ({
  key,
  kind: "widget",
  icon: "dashboard",
  to: `/home/s/${key}`,
  size: "1x1",
  label: key,
  scope: ["institution"],
  via: ["assignment"],
});

const manifest: WorkspaceManifest = {
  version: 1,
  org: { id: "synthetic-school", name: "Synthetic School", plan: "test", features: [] },
  families: ["principal"],
  primaryFamily: "principal",
  locale: "en",
  nav: [],
  bottomNav: [],
  widgets: [widget("w.enrolment"), widget("w.expense_approvals")],
  available: [],
  actions: [],
  inbox: [],
  hiddenByPolicy: [],
  scopeOptions: {},
  policies: [],
  canPersonalise: false,
};

describe("institutional executive workspace", () => {
  it("recognizes executive families without relying on titles", () => {
    expect(isInstitutionalExecutiveWorkspace({ families: ["principal"] })).toBe(true);
    expect(isInstitutionalExecutiveWorkspace({ families: ["student"] })).toBe(false);
    expect(isInstitutionalExecutiveWorkspace(null)).toBe(false);
  });

  it("uses only assigned widgets and labels absent sources as not configured", () => {
    const cards = institutionalExecutiveCards(manifest, {
      "w.enrolment": { metric: 0 },
      "w.school_health": { metric: "98%" },
    });

    expect(cards.find((item) => item.key === "enrolment")?.value).toBe("0");
    expect(cards.find((item) => item.key === "attendance")?.value).toBe("Not configured");
    expect(cards.find((item) => item.key === "compliance")?.value).toBe("Not configured");
    expect(cards.find((item) => item.key === "enrolment")?.href).toBe("/home/s/w.enrolment");
  });

  it("shows assigned approval queues and no unassigned action links", () => {
    const approvals = institutionalExecutiveApprovals(manifest, {
      "w.expense_approvals": { metric: 2 },
      "w.leave_requests": { metric: 4 },
    });

    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.value).toBe("2");
    expect(approvals[0]?.href).toBe("/home/s/w.expense_approvals");
  });
});
