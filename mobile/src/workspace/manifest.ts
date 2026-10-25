/**
 * Sherivs Mobile — workspace manifest (Track E).
 *
 * One account, one sign-in; the tabs a person sees are derived from the role on their
 * `users` row (RLS still decides what data each tab can read — the manifest only decides
 * what is worth showing). Mirrors the web "workspace manifest" idea: a pure, testable
 * role -> workspace mapping with no network access.
 */
export type SchoolTab = "home" | "results" | "attendance" | "fees" | "messages" | "cbt";

export interface TabSpec {
  readonly id: SchoolTab;
  readonly title: string;
  readonly icon: string; // single glyph: no icon font dependency
}

export const TAB_SPECS: Readonly<Record<SchoolTab, TabSpec>> = {
  home: { id: "home", title: "Home", icon: "⌂" },
  results: { id: "results", title: "Results", icon: "★" },
  attendance: { id: "attendance", title: "Attendance", icon: "✓" },
  fees: { id: "fees", title: "Fees", icon: "₦" },
  messages: { id: "messages", title: "Messages", icon: "✉" },
  cbt: { id: "cbt", title: "CBT", icon: "✎" },
};

export type WorkspaceKind = "learner" | "guardian" | "teaching" | "finance" | "leadership" | "basic";

const ROLE_TABS: Readonly<Record<WorkspaceKind, readonly SchoolTab[]>> = {
  learner: ["home", "results", "cbt", "attendance", "fees", "messages"],
  guardian: ["home", "results", "attendance", "fees", "messages"],
  teaching: ["home", "attendance", "results", "cbt", "messages"],
  finance: ["home", "fees", "messages"],
  leadership: ["home", "results", "attendance", "fees", "messages"],
  basic: ["home", "messages"],
};

export function workspaceKindForRole(role: string | null | undefined): WorkspaceKind {
  switch ((role ?? "").trim().toLowerCase()) {
    case "student":
      return "learner";
    case "parent":
      return "guardian";
    case "teacher":
      return "teaching";
    case "bursar":
      return "finance";
    case "admin":
    case "principal":
    case "hq":
    case "super_admin":
      return "leadership";
    default:
      return "basic"; // alumni, driver, unknown: least privilege
  }
}

export interface WorkspaceManifest {
  readonly kind: WorkspaceKind;
  readonly tabs: readonly TabSpec[];
  readonly hidden: readonly SchoolTab[];
}

export function buildWorkspaceManifest(role: string | null | undefined): WorkspaceManifest {
  const kind = workspaceKindForRole(role);
  const visible = ROLE_TABS[kind];
  const all = Object.keys(TAB_SPECS) as SchoolTab[];
  return { kind, tabs: visible.map((id) => TAB_SPECS[id]), hidden: all.filter((id) => !visible.includes(id)) };
}
