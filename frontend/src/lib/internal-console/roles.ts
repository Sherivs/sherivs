/**
 * Internal Console presentation roles and navigation.
 *
 * Database authority remains `platform_roles` / `platform_staff_roles`
 * (SHERIVS-008). This module maps those codes onto the V1 operator
 * prototypes for UI only. Capabilities still come from the database.
 */
import {
  PLATFORM_ROLE_LABELS,
  capabilitiesForRoles,
  type PlatformRoleCode,
} from "@/lib/platform-staff/catalogue";
import { CONSOLE_PATHS } from "./paths";

export const CONSOLE_PRESENTATION_ROLES = [
  "platform_owner",
  "platform_administrator",
  "operations_administrator",
  "engineer",
  "support_specialist",
  "standard_team_member",
] as const;
export type ConsolePresentationRole = (typeof CONSOLE_PRESENTATION_ROLES)[number];

export const CONSOLE_PRESENTATION_LABELS: Record<ConsolePresentationRole, string> = {
  platform_owner: "Platform Owner",
  platform_administrator: "Platform Administrator",
  operations_administrator: "Operations Administrator",
  engineer: "Engineer",
  support_specialist: "Support Specialist",
  standard_team_member: "Standard Team Member",
};

export function presentationRoleFor(input: {
  isSuperAdmin: boolean;
  roles: readonly string[];
}): ConsolePresentationRole {
  if (input.isSuperAdmin) return "platform_owner";
  if (input.roles.includes("platform_admin")) return "platform_administrator";
  if (input.roles.includes("operations")) return "operations_administrator";
  if (input.roles.includes("engineering")) return "engineer";
  if (input.roles.includes("support")) return "support_specialist";
  return "standard_team_member";
}

export function presentationRoleLabel(input: {
  isSuperAdmin: boolean;
  roles: readonly string[];
}): string {
  const presentation = presentationRoleFor(input);
  if (presentation !== "standard_team_member") return CONSOLE_PRESENTATION_LABELS[presentation];
  const first = input.roles.find((role): role is PlatformRoleCode => role in PLATFORM_ROLE_LABELS);
  return first ? PLATFORM_ROLE_LABELS[first] : CONSOLE_PRESENTATION_LABELS.standard_team_member;
}

export type ConsoleNavItem = {
  key: string;
  label: string;
  href: string;
  /** null = every console operator. */
  capability: string | null;
  /** When set, the item is visible if the viewer holds any listed capability. */
  anyOf?: readonly string[];
  children?: readonly ConsoleNavItem[];
  /** False when the item is a grouping shell for visible children. */
  navigable?: boolean;
};

export const CONSOLE_NAV: readonly ConsoleNavItem[] = [
  {
    key: "home",
    label: "Overview",
    href: CONSOLE_PATHS.home,
    capability: null,
  },
  {
    key: "organizations",
    label: "Organizations",
    href: CONSOLE_PATHS.organizations,
    capability: "platform.tenants.read",
    children: [
      {
        key: "organization-directory",
        label: "Directory",
        href: CONSOLE_PATHS.organizations,
        capability: "platform.tenants.read",
      },
      {
        key: "organization-onboard",
        label: "Onboard organization",
        href: CONSOLE_PATHS.organizationNew,
        capability: "platform.tenants.manage",
      },
      {
        key: "billing",
        label: "Billing",
        href: CONSOLE_PATHS.activityBilling,
        capability: "platform.tenants.manage",
        anyOf: ["platform.tenants.manage", "platform.finance.read"],
      },
    ],
  },
  {
    key: "team",
    label: "Team & Access",
    href: CONSOLE_PATHS.team,
    capability: "platform.staff.read",
    children: [
      {
        key: "team-directory",
        label: "Staff Directory",
        href: CONSOLE_PATHS.team,
        capability: "platform.staff.read",
      },
      {
        key: "team-invitations",
        label: "Invitations",
        href: CONSOLE_PATHS.teamInvitations,
        capability: "platform.staff.read",
      },
      {
        key: "team-roles",
        label: "Role Catalogue",
        href: CONSOLE_PATHS.teamRoles,
        capability: "platform.staff.read",
      },
      {
        key: "team-suspended",
        label: "Suspended and Revoked",
        href: CONSOLE_PATHS.teamSuspended,
        capability: "platform.staff.read",
      },
      {
        key: "team-access",
        label: "Access Review",
        href: CONSOLE_PATHS.teamAccess,
        capability: "platform.audit.read",
      },
    ],
  },
  {
    key: "workspaces",
    label: "Workspaces",
    href: CONSOLE_PATHS.workspaces,
    capability: null,
    children: [
      {
        key: "my-workspace",
        label: "My Workspace",
        href: CONSOLE_PATHS.myWorkspace,
        capability: null,
      },
      {
        key: "workspace-directory",
        label: "Workspace Directory",
        href: CONSOLE_PATHS.workspaces,
        capability: null,
      },
    ],
  },
  {
    key: "runtimes",
    label: "Runtime Management",
    href: CONSOLE_PATHS.runtimes,
    capability: null,
    children: [
      {
        key: "runtime-directory",
        label: "Runtime Directory",
        href: CONSOLE_PATHS.runtimes,
        capability: null,
      },
      { key: "scholar", label: "Sherivs Scholar", href: CONSOLE_PATHS.scholar, capability: null },
    ],
  },
  {
    key: "activity",
    label: "Intelligence & Assurance",
    href: CONSOLE_PATHS.activity,
    capability: "platform.audit.read",
    children: [
      {
        key: "activity-overview",
        label: "Activity Overview",
        href: CONSOLE_PATHS.activity,
        capability: "platform.audit.read",
      },
      {
        key: "activity-admin",
        label: "Administrative Events",
        href: CONSOLE_PATHS.activityAdmin,
        capability: "platform.audit.read",
      },
      {
        key: "activity-security",
        label: "Security Events",
        href: CONSOLE_PATHS.activitySecurity,
        capability: "platform.audit.read",
      },
      {
        key: "metrics",
        label: "Metrics",
        href: CONSOLE_PATHS.activityMetrics,
        capability: "platform.tenants.read",
        anyOf: [
          "platform.tenants.read",
          "platform.operations.read",
          "platform.engineering.read",
        ],
      },
      {
        key: "logs",
        label: "Logs",
        href: CONSOLE_PATHS.activityLogs,
        capability: "platform.engineering.read",
        anyOf: ["platform.engineering.read", "platform.audit.read"],
      },
      {
        key: "incidents",
        label: "Incidents",
        href: CONSOLE_PATHS.activityIncidents,
        capability: "platform.engineering.read",
        anyOf: [
          "platform.engineering.read",
          "platform.operations.read",
          "platform.tenants.read",
          "platform.audit.read",
        ],
      },
      {
        key: "tickets",
        label: "Tickets",
        href: CONSOLE_PATHS.activityTickets,
        capability: "platform.support.handle",
        anyOf: ["platform.support.handle", "platform.tenants.read"],
      },
    ],
  },
];

export const CONSOLE_ACCOUNT_NAV: readonly ConsoleNavItem[] = [
  { key: "account", label: "Account & Preferences", href: CONSOLE_PATHS.account, capability: null },
];

export const CONSOLE_PLATFORM_NAV: readonly ConsoleNavItem[] = [
  {
    key: "settings",
    label: "Platform Settings",
    href: CONSOLE_PATHS.settings,
    capability: "platform.config.read",
  },
  { key: "help", label: "Help & Support", href: CONSOLE_PATHS.help, capability: null },
];

export function navVisible(
  item: ConsoleNavItem,
  viewer: { isSuperAdmin: boolean; capabilities: ReadonlySet<string> },
): boolean {
  if (viewer.isSuperAdmin) return true;
  if (item.anyOf?.length) {
    return item.anyOf.some((capability) => viewer.capabilities.has(capability));
  }
  return item.capability === null || viewer.capabilities.has(item.capability);
}

export function filterNav(
  items: readonly ConsoleNavItem[],
  viewer: { isSuperAdmin: boolean; capabilities: ReadonlySet<string> },
): ConsoleNavItem[] {
  return items.flatMap((item) => {
    const children = item.children ? filterNav(item.children, viewer) : undefined;
    const visible = navVisible(item, viewer);
    if (!visible && !children?.length) return [];
    return [{ ...item, children, navigable: visible }];
  });
}

export type ConsoleQuickAction = {
  key: string;
  label: string;
  href: string;
  capability: string | null;
  /** When true, only super admins (Platform Owner) see the action. */
  ownerOnly?: boolean;
  external?: boolean;
};

export const CONSOLE_QUICK_ACTIONS: readonly ConsoleQuickAction[] = [
  {
    key: "onboard",
    label: "Onboard organization",
    href: CONSOLE_PATHS.organizationNew,
    capability: "platform.tenants.manage",
  },
  {
    key: "invite",
    label: "Invite staff",
    href: CONSOLE_PATHS.teamInvitations,
    capability: "platform.staff.manage",
  },
  {
    key: "access",
    label: "Review Access",
    href: CONSOLE_PATHS.teamAccess,
    capability: "platform.audit.read",
  },
  {
    key: "create-workspace",
    label: "Create Workspace",
    href: CONSOLE_PATHS.workspaces,
    capability: "platform.staff.manage",
  },
  {
    key: "workspace",
    label: "Open My Workspace",
    href: CONSOLE_PATHS.myWorkspace,
    capability: null,
  },
  {
    key: "scholar",
    label: "Open Sherivs Scholar",
    href: CONSOLE_PATHS.scholar,
    capability: null,
  },
  {
    key: "events",
    label: "Review Critical Events",
    href: CONSOLE_PATHS.activitySecurity,
    capability: "platform.audit.read",
  },
  {
    key: "settings",
    label: "Open Platform Settings",
    href: CONSOLE_PATHS.settings,
    capability: "platform.config.read",
    ownerOnly: true,
  },
  {
    key: "status",
    label: "Review Operational Status",
    href: CONSOLE_PATHS.activityMetrics,
    capability: "platform.operations.read",
  },
  {
    key: "activity",
    label: "View Relevant Activity",
    href: CONSOLE_PATHS.activity,
    capability: "platform.audit.read",
  },
];

export function quickActionsFor(viewer: {
  isSuperAdmin: boolean;
  capabilities: ReadonlySet<string>;
}): ConsoleQuickAction[] {
  return CONSOLE_QUICK_ACTIONS.filter((action) => {
    if (action.ownerOnly && !viewer.isSuperAdmin) return false;
    if (viewer.isSuperAdmin) return true;
    return action.capability === null || viewer.capabilities.has(action.capability);
  });
}

export function viewerCapabilities(roles: readonly string[], isSuperAdmin: boolean): Set<string> {
  const caps = capabilitiesForRoles(roles);
  if (isSuperAdmin) {
    for (const extra of [
      "platform.staff.read",
      "platform.staff.manage",
      "platform.tenants.read",
      "platform.config.read",
      "platform.audit.read",
      "platform.engineering.read",
      "platform.operations.read",
      "platform.security.read",
      "platform.support.handle",
    ])
      caps.add(extra);
  }
  return caps;
}
