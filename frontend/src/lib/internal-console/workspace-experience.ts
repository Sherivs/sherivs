/**
 * Role workspace operating-environment contract.
 *
 * Membership never grants capabilities. Each experience composes authorized
 * console data for a role workspace; the universal shell stays shared.
 */
import { mappingForRole, ROLE_WORKSPACE_MAPPINGS } from "./role-workspace";
import { CONSOLE_PATHS } from "./paths";
import type { InternalWorkspace } from "./workspaces";

export const WORKSPACE_EXPERIENCE_KEYS = [
  "platform_operations",
  "platform_administration",
  "operations",
  "engineering",
  "support",
  "personal",
  "shared",
] as const;
export type WorkspaceExperienceKey = (typeof WORKSPACE_EXPERIENCE_KEYS)[number];

export interface WorkspaceNavLink {
  label: string;
  href: string;
  search?: Record<string, string>;
  capability: string | null;
}

export interface WorkspaceExperienceContract {
  key: WorkspaceExperienceKey;
  title: string;
  purpose: string;
  audience: string;
  membership: string;
  lifecycle: string;
  revocation: string;
  privacy: string;
  requiredCapabilities: readonly string[];
  navigation: readonly WorkspaceNavLink[];
}

export const WORKSPACE_EXPERIENCES: Record<WorkspaceExperienceKey, WorkspaceExperienceContract> = {
  platform_operations: {
    key: "platform_operations",
    title: "Platform Operations",
    purpose: "Platform-wide oversight and coordinated operational decision-making.",
    audience: "Platform owners (super-admin) and personnel granted the matching capabilities.",
    membership: "Role workspace for platform_owner. Membership is not a permission grant.",
    lifecycle:
      "Provisioned when a super-admin staff membership is active. Archived membership is removed on revocation.",
    revocation:
      "Revocation drops role-workspace membership. Personal workspace ownership is preserved.",
    privacy: "Does not expose private personal workspaces or unrestricted school records.",
    requiredCapabilities: ["platform.operations.read"],
    navigation: [
      { label: "Overview", href: CONSOLE_PATHS.home, capability: null },
      {
        label: "Organizations",
        href: CONSOLE_PATHS.organizations,
        capability: "platform.operations.read",
      },
      { label: "Workspaces", href: CONSOLE_PATHS.workspaces, capability: null },
      { label: "Runtime directory", href: CONSOLE_PATHS.runtimes, capability: null },
      {
        label: "Analytics",
        href: CONSOLE_PATHS.activityMetrics,
        capability: "platform.operations.read",
      },
      {
        label: "Incidents",
        href: CONSOLE_PATHS.activityIncidents,
        capability: "platform.operations.read",
      },
      { label: "Audit", href: CONSOLE_PATHS.activityAdmin, capability: "platform.audit.read" },
      { label: "Help", href: CONSOLE_PATHS.help, capability: null },
    ],
  },
  platform_administration: {
    key: "platform_administration",
    title: "Platform Administration",
    purpose: "Internal staff governance and permitted platform configuration.",
    audience: "Staff with the platform_admin role.",
    membership: "Role workspace for platform_admin.",
    lifecycle: "Provisioned when the platform_admin role is assigned. Reconciled on role change.",
    revocation:
      "Role-workspace membership is removed. Super-admin privileges are never granted from this workspace.",
    privacy: "Staff-management permission does not open another person's personal workspace.",
    requiredCapabilities: ["platform.staff.read"],
    navigation: [
      { label: "Team directory", href: CONSOLE_PATHS.team, capability: "platform.staff.read" },
      {
        label: "Invitations",
        href: CONSOLE_PATHS.teamInvitations,
        capability: "platform.staff.read",
      },
      { label: "Role catalogue", href: CONSOLE_PATHS.teamRoles, capability: "platform.staff.read" },
      { label: "Access review", href: CONSOLE_PATHS.teamAccess, capability: "platform.audit.read" },
      { label: "Workspaces", href: CONSOLE_PATHS.workspaces, capability: null },
      {
        label: "Administrative audit",
        href: CONSOLE_PATHS.activityAdmin,
        capability: "platform.audit.read",
      },
      {
        label: "Platform settings",
        href: CONSOLE_PATHS.settings,
        capability: "platform.config.read",
      },
      { label: "Help", href: CONSOLE_PATHS.help, capability: null },
    ],
  },
  operations: {
    key: "operations",
    title: "Operations",
    purpose:
      "Manage organization onboarding and the operational lifecycle of organizations using Sherivs.",
    audience: "Staff with the operations role.",
    membership: "Role workspace for operations.",
    lifecycle: "Provisioned when the operations role is assigned.",
    revocation:
      "Role-workspace membership is removed. Organization assignment history is retained.",
    privacy: "Organization lifecycle permission is not school-tenant data permission.",
    requiredCapabilities: ["platform.tenants.read"],
    navigation: [
      {
        label: "Organization directory",
        href: CONSOLE_PATHS.organizations,
        capability: "platform.tenants.read",
      },
      {
        label: "Onboarding queue",
        href: CONSOLE_PATHS.organizations,
        search: { state: "submitted" },
        capability: "platform.tenants.read",
      },
      {
        label: "Provisioning failures",
        href: CONSOLE_PATHS.organizations,
        search: { state: "provisioning_failed" },
        capability: "platform.tenants.read",
      },
      {
        label: "Ready for activation",
        href: CONSOLE_PATHS.organizations,
        search: { state: "ready_for_activation" },
        capability: "platform.tenants.read",
      },
      { label: "Runtime eligibility", href: CONSOLE_PATHS.runtimes, capability: null },
      {
        label: "Operational metrics",
        href: CONSOLE_PATHS.activityMetrics,
        capability: "platform.tenants.read",
      },
      {
        label: "Incidents",
        href: CONSOLE_PATHS.activityIncidents,
        capability: "platform.tenants.read",
      },
      {
        label: "Billing",
        href: CONSOLE_PATHS.activityBilling,
        capability: "platform.tenants.manage",
      },
      { label: "Help", href: CONSOLE_PATHS.help, capability: null },
    ],
  },
  engineering: {
    key: "engineering",
    title: "Engineering",
    purpose: "Technical visibility into the platform and its operational runtimes.",
    audience: "Staff with the engineering role.",
    membership: "Role workspace for engineering.",
    lifecycle: "Provisioned when the engineering role is assigned.",
    revocation: "Role-workspace membership is removed. Audit history is retained.",
    privacy: "Technical logs and diagnostics stay capability-gated. Secrets are never displayed.",
    requiredCapabilities: ["platform.engineering.read"],
    navigation: [
      { label: "Runtime health", href: CONSOLE_PATHS.runtimes, capability: null },
      { label: "Sherivs Scholar", href: CONSOLE_PATHS.scholar, capability: null },
      {
        label: "Metrics",
        href: CONSOLE_PATHS.activityMetrics,
        capability: "platform.engineering.read",
      },
      { label: "Logs", href: CONSOLE_PATHS.activityLogs, capability: "platform.engineering.read" },
      {
        label: "Incidents",
        href: CONSOLE_PATHS.activityIncidents,
        capability: "platform.engineering.read",
      },
      {
        label: "Security events",
        href: CONSOLE_PATHS.activitySecurity,
        capability: "platform.audit.read",
      },
      { label: "Help", href: CONSOLE_PATHS.help, capability: null },
    ],
  },
  support: {
    key: "support",
    title: "Support",
    purpose:
      "Help organizations resolve onboarding and product-access issues while preserving tenant privacy.",
    audience: "Staff with the support role.",
    membership: "Role workspace for support.",
    lifecycle: "Provisioned when the support role is assigned.",
    revocation: "Role-workspace membership is removed. Assignment history is retained.",
    privacy:
      "Support staff do not receive student, financial, or biometric school records from this workspace.",
    requiredCapabilities: ["platform.tenants.read"],
    navigation: [
      {
        label: "Assigned organizations",
        href: CONSOLE_PATHS.organizations,
        capability: "platform.tenants.read",
      },
      {
        label: "Organization directory",
        href: CONSOLE_PATHS.organizations,
        capability: "platform.tenants.read",
      },
      {
        label: "Tickets",
        href: CONSOLE_PATHS.activityTickets,
        capability: "platform.support.handle",
      },
      { label: "Runtime availability", href: CONSOLE_PATHS.scholar, capability: null },
      { label: "Help", href: CONSOLE_PATHS.help, capability: null },
    ],
  },
  personal: {
    key: "personal",
    title: "Personal workspace",
    purpose: "A private working environment for the individual staff member.",
    audience: "Every internal staff member.",
    membership: "Owned by the staff member. Private by default.",
    lifecycle: "Created on invitation claim. Role changes do not delete it.",
    revocation:
      "Suspension and revocation block protected requests. Ownership and audit history remain.",
    privacy:
      "Administrators may see workspace metadata. They cannot open personal content from staff.manage.",
    requiredCapabilities: [],
    navigation: [
      { label: "My workspaces", href: CONSOLE_PATHS.workspaces, capability: null },
      { label: "Account and preferences", href: CONSOLE_PATHS.account, capability: null },
      { label: "Help", href: CONSOLE_PATHS.help, capability: null },
    ],
  },
  shared: {
    key: "shared",
    title: "Shared workspace",
    purpose: "A custom shared working environment for explicitly authorized members.",
    audience: "Assigned members of a shared workspace.",
    membership: "Explicit membership rows. Not derived from role.",
    lifecycle:
      "Created by authorized staff. May be archived. Role workspaces are not managed through this form.",
    revocation: "Removing a member does not delete their personal workspace.",
    privacy: "Shared content is limited to members. This is not a personal workspace.",
    requiredCapabilities: ["platform.staff.manage"],
    navigation: [
      { label: "Workspace directory", href: CONSOLE_PATHS.workspaces, capability: null },
      { label: "Help", href: CONSOLE_PATHS.help, capability: null },
    ],
  },
};

const ROLE_EXPERIENCE: Record<string, WorkspaceExperienceKey> = {
  platform_owner: "platform_operations",
  platform_admin: "platform_administration",
  operations: "operations",
  engineering: "engineering",
  support: "support",
};

export function experienceKeyForWorkspace(
  workspace: Pick<InternalWorkspace, "id" | "slug" | "type" | "name">,
): WorkspaceExperienceKey {
  if (workspace.type === "personal" || workspace.id === "me" || workspace.slug === "me") {
    return "personal";
  }
  if (workspace.type === "shared") return "shared";
  const mapped =
    ROLE_WORKSPACE_MAPPINGS.find(
      (row) =>
        row.slug === workspace.slug ||
        row.name === workspace.name ||
        workspace.id === `role:${row.roleCode}` ||
        workspace.slug === row.roleCode,
    ) ?? mappingForRole(workspace.slug.replace(/^role-/, "").replace(/-/g, "_"));
  if (mapped && ROLE_EXPERIENCE[mapped.roleCode]) return ROLE_EXPERIENCE[mapped.roleCode];
  if (workspace.type === "role") {
    const fromId = workspace.id.startsWith("role:") ? workspace.id.slice(5) : workspace.slug;
    return ROLE_EXPERIENCE[fromId] ?? "shared";
  }
  return "shared";
}

export function visibleWorkspaceNav(
  contract: WorkspaceExperienceContract,
  viewer: { isSuperAdmin: boolean; capabilities: ReadonlySet<string> },
): WorkspaceNavLink[] {
  return contract.navigation.filter(
    (item) => item.capability === null || viewer.capabilities.has(item.capability),
  );
}
