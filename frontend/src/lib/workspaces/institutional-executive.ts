import { formatWidgetMetric } from "@/lib/shell/metrics";
import type { CardData } from "@/lib/sherivs-ws/live";
import type { WorkspaceManifest } from "@/components/workspaces/_contract-shim";

const EXECUTIVE_FAMILIES = new Set(["proprietor", "principal", "hod"]);

const INDICATORS = [
  { key: "enrolment", label: "Enrolment", widget: "w.enrolment", source: "Active public.students" },
  {
    key: "attendance",
    label: "Attendance",
    widget: "w.school_health",
    source: "Today’s public.attendance register",
  },
  {
    key: "academic",
    label: "Academic",
    widget: "w.results_pipeline",
    source: "Authorized academic results",
  },
  {
    key: "workforce",
    label: "Workforce",
    widget: "w.staff_attendance",
    source: "Authorized staff attendance",
  },
  {
    key: "finance",
    label: "Finance",
    widget: "w.fee_collection",
    source: "public.fees paid and billed totals",
  },
  {
    key: "risks",
    label: "Risks",
    widget: "w.at_risk",
    source: "Recent attendance indicators",
  },
  { key: "compliance", label: "Compliance deadlines", widget: null, source: "Not configured" },
  {
    key: "corrective-actions",
    label: "Corrective actions",
    widget: null,
    source: "Not configured",
  },
] as const;

const APPROVALS = [
  { key: "expenses", label: "Expenses", widget: "w.expense_approvals" },
  { key: "leave", label: "Staff leave", widget: "w.leave_requests" },
  { key: "lesson-notes", label: "Lesson notes", widget: "w.lesson_note_approvals" },
] as const;

export interface ExecutiveWorkspaceCard {
  key: string;
  label: string;
  value: string;
  source: string;
  href: string | null;
}

export function isInstitutionalExecutiveWorkspace(
  manifest: Pick<WorkspaceManifest, "families"> | null,
): boolean {
  return Boolean(manifest?.families.some((family) => EXECUTIVE_FAMILIES.has(family)));
}

function liveCard(
  manifest: WorkspaceManifest,
  cards: Readonly<Record<string, CardData>>,
  key: string,
  label: string,
  widget: string | null,
  source: string,
  loading: boolean,
  failed: boolean,
): ExecutiveWorkspaceCard {
  const permitted = widget ? manifest.widgets.find((item) => item.key === widget) : undefined;
  const data = permitted && widget ? cards[widget] : undefined;
  const value = loading
    ? "Loading…"
    : failed
      ? "Unavailable"
      : !widget || !permitted || !data || data.unavailable || data.metric == null
        ? "Not configured"
        : formatWidgetMetric(data).text;
  return {
    key,
    label,
    value,
    source: value === "Not configured" ? "Not configured" : source,
    href: permitted?.to ?? null,
  };
}

export function institutionalExecutiveCards(
  manifest: WorkspaceManifest,
  cards: Readonly<Record<string, CardData>>,
  loading = false,
  failed = false,
): ExecutiveWorkspaceCard[] {
  return INDICATORS.map((indicator) =>
    liveCard(
      manifest,
      cards,
      indicator.key,
      indicator.label,
      indicator.widget,
      indicator.source,
      loading,
      failed,
    ),
  );
}

export function institutionalExecutiveApprovals(
  manifest: WorkspaceManifest,
  cards: Readonly<Record<string, CardData>>,
  loading = false,
  failed = false,
): ExecutiveWorkspaceCard[] {
  return APPROVALS.map(({ key, label, widget }) =>
    liveCard(
      manifest,
      cards,
      `approval-${key}`,
      label,
      widget,
      "Pending records in the authorized tenant scope",
      loading,
      failed,
    ),
  ).filter((item) => item.href !== null);
}
