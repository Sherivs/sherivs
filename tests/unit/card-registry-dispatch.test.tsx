/**
 * M3 (ADR-106): `/home/s/<key>` dispatches through the card registry. Live keys render their real
 * screen (each screen module is replaced by a marker here, so the test proves routing, not the
 * screen's own behaviour), planned keys render PlannedCapabilityState, unknown keys render a
 * not-found state.
 */
import type React from "react";
import { prerender } from "react-dom/static";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const marker = (name: string) => () => <div data-screen={name} />;

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: { children?: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
// WF-07/08/12 and AIN-05: the workflow screens are registry cards with default-export screens.
vi.mock("@/components/app-shell/approval-inbox-screen", () => ({
  default: marker("ApprovalInboxScreen"),
}));
vi.mock("@/components/app-shell/run-history-screen", () => ({
  default: marker("RunHistoryScreen"),
}));
vi.mock("@/components/app-shell/agent-console-screen", () => ({
  default: marker("AgentConsoleScreen"),
}));
vi.mock("@/components/app-shell/limits-screen", () => ({ default: marker("LimitsScreen") }));
vi.mock("@/components/app-shell/role-management-screen", () => ({
  RoleManagementScreen: marker("RoleManagementScreen"),
}));
vi.mock("@/components/app-shell/org-workforce-screens", () => ({
  OrgAgentsScreen: marker("OrgAgentsScreen"),
  RolePacketScreen: marker("RolePacketScreen"),
  WorkspacePolicyScreen: marker("WorkspacePolicyScreen"),
}));
vi.mock("@/components/app-shell/institution-interview-screen", () => ({
  InstitutionInterviewScreen: marker("InstitutionInterviewScreen"),
}));
vi.mock("@/components/app-shell/communication-inbox", () => ({
  CommunicationInboxScreen: marker("CommunicationInboxScreen"),
}));
vi.mock("@/components/app-shell/student-mobility-screen", () => ({
  StudentMobilityScreen: marker("StudentMobilityScreen"),
}));
vi.mock("@/components/app-shell/asc-export-screen", () => ({
  AscExportScreen: marker("AscExportScreen"),
}));
vi.mock("@/components/app-shell/custom-role-builder-screen", () => ({
  CustomRoleBuilderScreen: marker("CustomRoleBuilderScreen"),
}));
vi.mock("@/components/app-shell/access-review-screen", () => ({
  AccessReviewScreen: marker("AccessReviewScreen"),
}));
vi.mock("@/components/app-shell/delegation-screen", () => ({
  DelegationScreen: marker("DelegationScreen"),
}));
vi.mock("@/components/app-shell/teaching/today-classes-screen", () => ({
  TodayClassesScreen: marker("TodayClassesScreen"),
}));
vi.mock("@/components/app-shell/teaching/attendance-screen", () => ({
  AttendanceScreen: marker("AttendanceScreen"),
}));
vi.mock("@/components/app-shell/teaching/gradebook-screen", () => ({
  GradebookScreen: marker("GradebookScreen"),
}));
vi.mock("@/components/app-shell/teaching/lesson-notes-screen", () => ({
  LessonNotesScreen: marker("LessonNotesScreen"),
}));
vi.mock("@/components/app-shell/privacy-register-screen", () => ({
  PrivacyRegisterScreen: marker("PrivacyRegisterScreen"),
}));
vi.mock("@/components/app-shell/cashier-desk-screen", () => ({
  CashierDeskScreen: marker("CashierDeskScreen"),
}));

const shell = {
  nav: [] as { key: string; label: string; icon: string }[],
  manifest: null as null | { widgets: unknown[]; actions: unknown[]; locale: string },
  cards: {} as Record<string, unknown>,
  scopeFocus: null as null | { dim: string; ref: string },
  roleTitle: "Head of organization",
  orgName: "Test Org",
};
vi.mock("@/components/app-shell/shell-context", () => ({ useAppShell: () => shell }));

const { AppSectionScreen } = await import("../../frontend/src/components/app-shell/section-screen");
const { CARD_REGISTRY, resolveCard, PLANNED_CATALOGUE_KEYS } =
  await import("../../frontend/src/lib/shell/card-registry");

async function renderAll(node: React.ReactNode): Promise<string> {
  const { prelude } = await prerender(<>{node}</>);
  const reader = prelude.getReader();
  const decoder = new TextDecoder();
  let html = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  return html + decoder.decode();
}

const LIVE_SCREENS: Record<string, string> = {
  roles: "RoleManagementScreen",
  agents: "OrgAgentsScreen",
  "role-packets": "RolePacketScreen",
  "workspace-policies": "WorkspacePolicyScreen",
  school_setup: "InstitutionInterviewScreen",
  communications: "CommunicationInboxScreen",
  students: "StudentMobilityScreen",
  "nav.students": "StudentMobilityScreen",
  "nav.reports": "AscExportScreen",
  "role-builder": "CustomRoleBuilderScreen",
  "access-reviews": "AccessReviewScreen",
  delegations: "DelegationScreen",
  // M7 (ADR-149) teaching screens.
  "w.today_classes": "TodayClassesScreen",
  "nav.my_classes": "TodayClassesScreen",
  "nav.attendance": "AttendanceScreen",
  "a.take_attendance": "AttendanceScreen",
  "w.attendance_todo": "AttendanceScreen",
  "nav.gradebook": "GradebookScreen",
  "a.enter_scores": "GradebookScreen",
  "w.grading_queue": "GradebookScreen",
  "nav.lesson_notes": "LessonNotesScreen",
  "a.submit_note": "LessonNotesScreen",
  "w.lesson_note_status": "LessonNotesScreen",
  "w.lesson_note_approvals": "LessonNotesScreen",
  privacy: "PrivacyRegisterScreen",
  "privacy-register": "PrivacyRegisterScreen",
  "r001.org_admin.ndpa": "PrivacyRegisterScreen",
  "a.record_cash": "CashierDeskScreen",
  approvals: "ApprovalInboxScreen",
  "workflow-runs": "RunHistoryScreen",
  "agent-console": "AgentConsoleScreen",
  "workflow-limits": "LimitsScreen",
};

beforeEach(() => {
  shell.nav = [];
  shell.manifest = null;
  shell.cards = {};
  shell.scopeFocus = null;
});

describe("card registry dispatch", () => {
  it("keeps every key that had a real screen on that same screen", async () => {
    const live = Object.values(CARD_REGISTRY)
      .filter((entry) => entry.status === "live")
      .map((entry) => entry.key)
      .sort();
    expect(live).toEqual(Object.keys(LIVE_SCREENS).sort());
    for (const [key, screen] of Object.entries(LIVE_SCREENS)) {
      expect(resolveCard(key).kind).toBe("live");
      const html = await renderAll(<AppSectionScreen sectionKey={key} />);
      expect(html, key).toContain(`data-screen="${screen}"`);
      expect(html).not.toContain("planned-capability-state");
    }
  });

  it("renders the planned state for every planned catalogue key", () => {
    for (const key of PLANNED_CATALOGUE_KEYS) {
      expect(resolveCard(key).kind, key).toBe("planned");
      const html = renderToStaticMarkup(<AppSectionScreen sectionKey={key} />);
      expect(html, key).toContain('data-testid="planned-capability-state"');
      expect(html).not.toContain("data-screen=");
      expect(html).not.toContain("<input");
      expect(html).not.toContain("<button");
    }
  });

  it("uses the catalogue label and the card kind in the planned sentence", () => {
    // M7 made a.take_attendance live; a.new_cbt is still a planned action.
    const html = renderToStaticMarkup(<AppSectionScreen sectionKey="a.new_cbt" />);
    expect(html).toContain("<h1");
    expect(html).toContain("New CBT test");
    expect(html).toContain("New CBT test will let you do this task from here.");
    expect(html).toContain("Planned, not built yet");
  });

  it("shows a figure only when the server returned one for the card", () => {
    expect(renderToStaticMarkup(<AppSectionScreen sectionKey="w.defaulters" />)).not.toContain(
      "planned-capability-figure",
    );
    shell.cards = { "w.defaulters": { metric: 12, note: "Learners with a balance" } };
    const html = renderToStaticMarkup(<AppSectionScreen sectionKey="w.defaulters" />);
    expect(html).toContain("planned-capability-figure");
    expect(html).toContain("12");
    shell.cards = { "w.defaulters": { unavailable: true } };
    expect(renderToStaticMarkup(<AppSectionScreen sectionKey="w.defaulters" />)).not.toContain(
      "planned-capability-figure",
    );
  });

  it("keeps the scope focus on the way back home", () => {
    shell.scopeFocus = { dim: "campus", ref: "North" };
    const html = renderToStaticMarkup(<AppSectionScreen sectionKey="nav.fees" />);
    expect(html).toContain('href="/home?scope=campus%3ANorth"');
  });

  it("renders not-found for an unknown key, never the planned state", () => {
    expect(resolveCard("w.does_not_exist").kind).toBe("unknown");
    const html = renderToStaticMarkup(<AppSectionScreen sectionKey="w.does_not_exist" />);
    expect(html).toContain('data-testid="card-not-found"');
    expect(html).toContain("Section not found");
    expect(html).not.toContain("planned-capability-state");
  });

  it("does not treat inherited object properties as registered keys", () => {
    expect(resolveCard("constructor").kind).toBe("unknown");
    expect(resolveCard("__proto__").kind).toBe("unknown");
  });

  it("treats a live entry without a screen as planned", () => {
    const registry = {
      "w.x": { ...CARD_REGISTRY["nav.fees"]!, key: "w.x", status: "live" as const, screen: null },
    };
    expect(resolveCard("w.x", registry).kind).toBe("planned");
  });
});
