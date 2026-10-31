import type { ConsoleHealthState, ConsoleSeverity } from "./status";
import type { ConsolePresentationRole } from "./roles";
import type { InternalWorkspace } from "./workspaces";
import type { ConsoleRuntimeContract } from "./runtime-contract";
import type { RecentResource } from "./recent";
import type {
  OrganizationAssignmentRecord,
  OrganizationDirectoryRow,
  OrganizationMetricsSnapshot,
} from "./organization-lifecycle";

export interface ConsoleHealthCard {
  key: string;
  name: string;
  status: ConsoleHealthState;
  detail: string;
  lastCheck: string | null;
  href: string;
  source: string;
}

export interface ConsoleMetric {
  key: string;
  name: string;
  value: string | null;
  unit: string;
  window: string;
  source: string;
  updatedAt: string | null;
  available: boolean;
  definition: string;
}

export interface ConsoleAttentionItem {
  id: string;
  severity: ConsoleSeverity;
  title: string;
  description: string;
  detectedAt: string;
  resource: string;
  owner: string | null;
  nextAction: string;
  href: string;
}

export interface ConsoleActivityItem {
  id: string;
  description: string;
  actor: string | null;
  target: string | null;
  at: string;
  outcome: string;
  action: string;
}

export interface ConsoleStaffRow {
  id: string;
  email: string;
  fullName: string;
  department: string | null;
  status: string;
  invitedAt: string | null;
  activatedAt: string | null;
  inviteExpiresAt: string | null;
  roles: string[];
}

export interface ConsoleOverview {
  viewer: {
    id: string;
    name: string;
    email: string;
    isSuperAdmin: boolean;
    roles: string[];
    presentationRole: ConsolePresentationRole;
    presentationLabel: string;
    capabilities: string[];
  };
  context: {
    organization: string;
    workspace: string;
    environment: string;
    environmentSource: string;
    host: string | null;
    version: string | null;
  };
  health: {
    overall: ConsoleHealthState;
    cards: ConsoleHealthCard[];
    caveat: string;
  };
  metrics: ConsoleMetric[];
  attention: ConsoleAttentionItem[];
  activity: ConsoleActivityItem[];
  workspaces: InternalWorkspace[];
  workspaceStore: "database" | "derived-fallback";
  runtimes: ConsoleRuntimeContract[];
  recent: RecentResource[];
  staff: ConsoleStaffRow[];
  staffAvailable: boolean;
  pendingInvitations: number | null;
  expiredInvitations: number | null;
  activeStaff: number | null;
  usageDefinition: string;
  organizations: OrganizationDirectoryRow[];
  organizationStore: "database" | "unavailable" | "fixture";
  organizationMetrics: OrganizationMetricsSnapshot;
  assignments: OrganizationAssignmentRecord[];
  scholarTenants: number | null;
  registeredUsers: number | null;
  activeUsers30d: number | null;
}

export type ConsoleStaffPresentationStatus =
  "invited" | "active" | "suspended" | "revoked" | "expired";

export const STAFF_STATUS_LABELS: Record<ConsoleStaffPresentationStatus, string> = {
  invited: "Invited",
  active: "Active",
  suspended: "Suspended",
  revoked: "Revoked",
  expired: "Expired",
};

export function presentationStaffStatus(
  row: Pick<ConsoleStaffRow, "status" | "inviteExpiresAt">,
  nowIso: string,
): ConsoleStaffPresentationStatus {
  if (row.status === "invited" && row.inviteExpiresAt !== null && row.inviteExpiresAt < nowIso) {
    return "expired";
  }
  if (
    row.status === "active" ||
    row.status === "suspended" ||
    row.status === "revoked" ||
    row.status === "invited"
  ) {
    return row.status;
  }
  return "invited";
}
