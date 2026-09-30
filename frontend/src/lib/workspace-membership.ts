/**
 * CoreGrid — Phase 06 Workspace Engine membership and roles (platform layer).
 *
 * Implements `architecture/phase-06-workspace-engine.md`:
 * - A workspace may have many members (Section P).
 * - Membership states (Section Q).
 * - Workspace roles: owner, administrator, manager, editor, contributor, viewer,
 *   guest (Section R). These roles do not replace the global authorization architecture (Section R).
 * - Invitations: identity, destination, workspace, intended role, expiration, status,
 *   inviter, acceptance timestamp (Section T).
 * - Access must consider authorization, membership, data classification, least privilege (Section U).
 * - Sensitive mutations must produce audit records (Section CP).
 * - Cannot grant privileges the actor does not possess (Section DW).
 */

import type { TenantId } from "./tenant-core";
import {
  workspaceId,
  workspaceMembershipId,
  workspaceRoleId,
  workspaceInvitationId,
  type WorkspaceId,
  type WorkspaceMembershipId,
  type WorkspaceRoleId,
  type WorkspaceInvitationId,
  type WorkspaceAuditEvent,
  type WorkspaceTenantScopedEntity,
} from "./workspace-core";

/* ─────────────────────────────────────────────────────────────
 * Workspace roles (Section R)
 * ────────────────────────────────────────────────────────────*/

export type WorkspaceRole =
  "owner" | "administrator" | "manager" | "editor" | "contributor" | "viewer" | "guest";

export const WORKSPACE_ROLES: readonly WorkspaceRole[] = [
  "owner",
  "administrator",
  "manager",
  "editor",
  "contributor",
  "viewer",
  "guest",
] as const;

/**
 * Role hierarchy for workspace-level capability evaluation.
 * These are coarse-grained roles (Section DO); they do not replace
 * the global RBAC/ABAC/ReBAC/PBAC authorization architecture (Section R).
 */
export const WORKSPACE_ROLE_RANK: Record<WorkspaceRole, number> = {
  owner: 7,
  administrator: 6,
  manager: 5,
  editor: 4,
  contributor: 3,
  viewer: 2,
  guest: 1,
};

export interface WorkspaceRoleDefinition extends WorkspaceTenantScopedEntity {
  id: WorkspaceRoleId;
  role: WorkspaceRole;
  /** Display name. */
  name: string;
  /** Description of the role's coarse-grained capabilities. */
  description: string | null;
  /** Whether this role may manage workspace membership. */
  canManageMembership: boolean;
  /** Whether this role may change workspace configuration. */
  canManageConfiguration: boolean;
  /** Whether this role may publish shared views (Section BE). */
  canPublishSharedViews: boolean;
  /** Whether this role may provision/activate/suspend the workspace. */
  canManageLifecycle: boolean;
}

export const DEFAULT_WORKSPACE_ROLE_DEFINITIONS: readonly Omit<
  WorkspaceRoleDefinition,
  "id" | "workspaceId" | "tenantId" | "createdAt" | "updatedAt"
>[] = [
  {
    role: "owner",
    name: "Owner",
    description: "Full workspace control",
    canManageMembership: true,
    canManageConfiguration: true,
    canPublishSharedViews: true,
    canManageLifecycle: true,
  },
  {
    role: "administrator",
    name: "Administrator",
    description: "Manages workspace configuration and membership",
    canManageMembership: true,
    canManageConfiguration: true,
    canPublishSharedViews: true,
    canManageLifecycle: true,
  },
  {
    role: "manager",
    name: "Manager",
    description: "Manages members and shared views within workspace",
    canManageMembership: true,
    canManageConfiguration: false,
    canPublishSharedViews: true,
    canManageLifecycle: false,
  },
  {
    role: "editor",
    name: "Editor",
    description: "Edits workspace content",
    canManageMembership: false,
    canManageConfiguration: false,
    canPublishSharedViews: true,
    canManageLifecycle: false,
  },
  {
    role: "contributor",
    name: "Contributor",
    description: "Contributes content",
    canManageMembership: false,
    canManageConfiguration: false,
    canPublishSharedViews: false,
    canManageLifecycle: false,
  },
  {
    role: "viewer",
    name: "Viewer",
    description: "Read-only access",
    canManageMembership: false,
    canManageConfiguration: false,
    canPublishSharedViews: false,
    canManageLifecycle: false,
  },
  {
    role: "guest",
    name: "Guest",
    description: "Limited read access",
    canManageMembership: false,
    canManageConfiguration: false,
    canPublishSharedViews: false,
    canManageLifecycle: false,
  },
];

/* ─────────────────────────────────────────────────────────────
 * Membership states (Section Q)
 * ────────────────────────────────────────────────────────────*/

export type MembershipState = "invited" | "active" | "suspended" | "removed";

export const MEMBERSHIP_STATES: readonly MembershipState[] = [
  "invited",
  "active",
  "suspended",
  "removed",
] as const;

export interface WorkspaceMembership extends WorkspaceTenantScopedEntity {
  id: WorkspaceMembershipId;
  /** Phase 02 identity reference. Phase 06 does not create its own user system (Section E2). */
  identityId: string;
  /** Workspace role. */
  role: WorkspaceRole;
  /** Membership state. */
  state: MembershipState;
  /** Whether the member's access is currently active. */
  isActive: boolean;
  /** Optional membership-specific data classification. */
  dataClassification: "PUBLIC" | "TENANT_INTERNAL" | "CONFIDENTIAL" | "SENSITIVE" | "RESTRICTED";
}

export interface AddWorkspaceMemberInput {
  tenantId: TenantId;
  workspaceId: WorkspaceId;
  identityId: string;
  role: WorkspaceRole;
  actorId: string;
  now: string;
}

export type AddWorkspaceMemberResult =
  | { ok: true; membership: WorkspaceMembership; auditEvent: WorkspaceAuditEvent }
  | { ok: false; error: string };

/**
 * Add a member to a workspace. Roles do not grant privileges the actor
 * does not possess (Section DW); caller authorization is enforced externally.
 */
export function addWorkspaceMember(
  input: AddWorkspaceMemberInput,
  existingMembers: WorkspaceMembership[],
  workspaceRoleDefinitions: Map<WorkspaceRole, WorkspaceRoleDefinition>,
): AddWorkspaceMemberResult {
  // Duplicate active membership is not allowed (Section P).
  if (existingMembers.some((m) => m.identityId === input.identityId && m.state !== "removed")) {
    return { ok: false, error: "Identity is already a member of this workspace" };
  }

  // Role must be a known role (Section R).
  if (!workspaceRoleDefinitions.has(input.role)) {
    return { ok: false, error: `Unknown workspace role: ${input.role}` };
  }

  const id = workspaceMembershipId(`${input.workspaceId}:${input.identityId}`);
  const membership: WorkspaceMembership = {
    id,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    identityId: input.identityId,
    role: input.role,
    state: "active",
    isActive: true,
    dataClassification: "TENANT_INTERNAL",
    createdAt: input.now,
    updatedAt: input.now,
  };

  const auditEvent: WorkspaceAuditEvent = {
    id: `audit-${input.now}-${id}`,
    type: "WorkspaceMemberAdded",
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    occurredAt: input.now,
    result: "success",
    metadata: { identityId: input.identityId, role: input.role },
  };

  return { ok: true, membership, auditEvent };
}

/* ─────────────────────────────────────────────────────────────
 * Role change (Section R, CP)
 * ────────────────────────────────────────────────────────────*/

export interface ChangeWorkspaceMemberRoleInput {
  tenantId: TenantId;
  workspaceId: WorkspaceId;
  membershipId: WorkspaceMembershipId;
  newRole: WorkspaceRole;
  actorId: string;
  now: string;
}

export type ChangeWorkspaceMemberRoleResult =
  | { ok: true; membership: WorkspaceMembership; auditEvent: WorkspaceAuditEvent }
  | { ok: false; error: string };

export function changeWorkspaceMemberRole(
  input: ChangeWorkspaceMemberRoleInput,
  membership: WorkspaceMembership,
  roleCanAssign: (targetRole: WorkspaceRole) => boolean,
): ChangeWorkspaceMemberRoleResult {
  // Tenant-scope guard (Section DB).
  if (membership.tenantId !== input.tenantId || membership.workspaceId !== input.workspaceId) {
    return { ok: false, error: "Membership does not belong to this workspace/tenant" };
  }

  // Cannot assign a role the actor does not possess (Section DW).
  if (!roleCanAssign(input.newRole)) {
    return { ok: false, error: "Actor cannot assign this role" };
  }

  // The owner role cannot be revoked/demoted through this path; ownership transfers
  // are handled explicitly by higher authority (Section R, CP).
  if (membership.role === "owner" && input.newRole !== "owner") {
    return { ok: false, error: "Owner role change requires an explicit ownership transfer" };
  }

  const updated: WorkspaceMembership = {
    ...membership,
    role: input.newRole,
    updatedAt: input.now,
  };

  const auditEvent: WorkspaceAuditEvent = {
    id: `audit-${input.now}-${membership.id}-role`,
    type: "WorkspaceRoleChanged",
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    occurredAt: input.now,
    result: "success",
    metadata: { membershipId: membership.id, fromRole: membership.role, toRole: input.newRole },
  };

  return { ok: true, membership: updated, auditEvent };
}

/* ─────────────────────────────────────────────────────────────
 * Membership removal / suspension
 * ────────────────────────────────────────────────────────────*/

export type RemoveWorkspaceMemberResult =
  | { ok: true; membership: WorkspaceMembership; auditEvent: WorkspaceAuditEvent }
  | { ok: false; error: string };

export function removeWorkspaceMember(
  tenantId: TenantId,
  workspaceId: WorkspaceId,
  membership: WorkspaceMembership,
  actorId: string,
  now: string,
): RemoveWorkspaceMemberResult {
  if (membership.tenantId !== tenantId || membership.workspaceId !== workspaceId) {
    return { ok: false, error: "Membership does not belong to this workspace/tenant" };
  }

  if (membership.role === "owner") {
    return { ok: false, error: "Owner cannot be removed; transfer ownership first" };
  }

  const updated: WorkspaceMembership = {
    ...membership,
    state: "removed",
    isActive: false,
    updatedAt: now,
  };

  const auditEvent: WorkspaceAuditEvent = {
    id: `audit-${now}-${membership.id}-removed`,
    type: "WorkspaceMemberRemoved",
    tenantId,
    workspaceId,
    actorId,
    occurredAt: now,
    result: "success",
    metadata: { membershipId: membership.id, identityId: membership.identityId },
  };

  return { ok: true, membership: updated, auditEvent };
}

/* ─────────────────────────────────────────────────────────────
 * Workspace invitations (Section T)
 * ────────────────────────────────────────────────────────────*/

export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";

export const INVITATION_STATUSES: readonly InvitationStatus[] = [
  "pending",
  "accepted",
  "expired",
  "revoked",
] as const;

export interface WorkspaceInvitation extends WorkspaceTenantScopedEntity {
  id: WorkspaceInvitationId;
  /** Inviting identity. */
  inviterId: string;
  /** Invited identity. */
  inviteeId: string;
  /** Intended role (Section T). */
  intendedRole: WorkspaceRole;
  /** Expiration timestamp (Section T). */
  expiresAt: string;
  /** Status (Section T). */
  status: InvitationStatus;
  /** Acceptance timestamp (Section T). */
  acceptedAt: string | null;
}

export interface SendWorkspaceInvitationInput {
  tenantId: TenantId;
  workspaceId: WorkspaceId;
  inviterId: string;
  inviteeId: string;
  intendedRole: WorkspaceRole;
  expiresAt: string;
  now: string;
}

export type SendWorkspaceInvitationResult =
  | { ok: true; invitation: WorkspaceInvitation; auditEvent: WorkspaceAuditEvent }
  | { ok: false; error: string };

export function sendWorkspaceInvitation(
  input: SendWorkspaceInvitationInput,
  existingInvitations: WorkspaceInvitation[],
  existingMembers: WorkspaceMembership[],
): SendWorkspaceInvitationResult {
  // Invitations must be resistant to enumeration and must be expirable (Section T).
  if (input.expiresAt <= input.now) {
    return { ok: false, error: "Invitation expiration must be in the future" };
  }

  if (existingMembers.some((m) => m.identityId === input.inviteeId && m.state !== "removed")) {
    return { ok: false, error: "Invitee is already a member of this workspace" };
  }

  // A pending invitation must not be duplicated (idempotency).
  if (
    existingInvitations.some(
      (i) =>
        i.inviteeId === input.inviteeId &&
        i.workspaceId === input.workspaceId &&
        i.status === "pending",
    )
  ) {
    return { ok: false, error: "A pending invitation already exists for this invitee" };
  }

  const id = workspaceInvitationId(`${input.workspaceId}:${input.inviteeId}:${input.now}`);
  const invitation: WorkspaceInvitation = {
    id,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    inviterId: input.inviterId,
    inviteeId: input.inviteeId,
    intendedRole: input.intendedRole,
    expiresAt: input.expiresAt,
    status: "pending",
    acceptedAt: null,
    createdAt: input.now,
    updatedAt: input.now,
  };

  const auditEvent: WorkspaceAuditEvent = {
    id: `audit-${input.now}-${id}`,
    type: "WorkspaceInvitationSent",
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    actorId: input.inviterId,
    occurredAt: input.now,
    result: "success",
    metadata: {
      inviteeId: input.inviteeId,
      intendedRole: input.intendedRole,
      expiresAt: input.expiresAt,
    },
  };

  return { ok: true, invitation, auditEvent };
}

export interface AcceptWorkspaceInvitationInput {
  tenantId: TenantId;
  workspaceId: WorkspaceId;
  invitationId: WorkspaceInvitationId;
  acceptingIdentityId: string;
  now: string;
}

export type AcceptWorkspaceInvitationResult =
  | {
      ok: true;
      invitation: WorkspaceInvitation;
      membership: WorkspaceMembership;
      auditEvent: WorkspaceAuditEvent;
    }
  | { ok: false; error: string };

export function acceptWorkspaceInvitation(
  input: AcceptWorkspaceInvitationInput,
  invitation: WorkspaceInvitation,
  existingMembers: WorkspaceMembership[],
): AcceptWorkspaceInvitationResult {
  if (invitation.tenantId !== input.tenantId || invitation.workspaceId !== input.workspaceId) {
    return { ok: false, error: "Invitation does not belong to this workspace/tenant" };
  }

  // Only the invitee may accept (Section T).
  if (invitation.inviteeId !== input.acceptingIdentityId) {
    return { ok: false, error: "Only the invitee may accept this invitation" };
  }

  if (invitation.status !== "pending") {
    return { ok: false, error: `Invitation is not pending (status: ${invitation.status})` };
  }

  if (invitation.expiresAt < input.now) {
    return {
      ok: false,
      error: "Invitation has expired",
      // We return ok:false; caller may update status to "expired".
    };
  }

  const accepted: WorkspaceInvitation = {
    ...invitation,
    status: "accepted",
    acceptedAt: input.now,
    updatedAt: input.now,
  };

  const membershipResult = addWorkspaceMember(
    {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      identityId: input.acceptingIdentityId,
      role: invitation.intendedRole,
      actorId: input.acceptingIdentityId,
      now: input.now,
    },
    existingMembers,
    DEFAULT_WORKSPACE_ROLE_DEFINITIONS_MAP(),
  );

  if (!membershipResult.ok) {
    return { ok: false, error: membershipResult.error };
  }

  const auditEvent: WorkspaceAuditEvent = {
    id: `audit-${input.now}-${invitation.id}`,
    type: "WorkspaceInvitationAccepted",
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    actorId: input.acceptingIdentityId,
    occurredAt: input.now,
    result: "success",
    metadata: { invitationId: invitation.id, role: invitation.intendedRole },
  };

  return { ok: true, invitation: accepted, membership: membershipResult.membership, auditEvent };
}

export function revokeWorkspaceInvitation(
  tenantId: TenantId,
  workspaceId: WorkspaceId,
  invitation: WorkspaceInvitation,
  actorId: string,
  now: string,
):
  | { ok: true; invitation: WorkspaceInvitation; auditEvent: WorkspaceAuditEvent }
  | { ok: false; error: string } {
  if (invitation.tenantId !== tenantId || invitation.workspaceId !== workspaceId) {
    return { ok: false, error: "Invitation does not belong to this workspace/tenant" };
  }

  if (invitation.status !== "pending") {
    return { ok: false, error: "Only pending invitations may be revoked" };
  }

  const updated: WorkspaceInvitation = {
    ...invitation,
    status: "revoked",
    updatedAt: now,
  };

  const auditEvent: WorkspaceAuditEvent = {
    id: `audit-${now}-${invitation.id}`,
    type: "WorkspaceInvitationRevoked",
    tenantId,
    workspaceId,
    actorId,
    occurredAt: now,
    result: "success",
    metadata: { invitationId: invitation.id, inviteeId: invitation.inviteeId },
  };

  return { ok: true, invitation: updated, auditEvent };
}

export function isInvitationExpired(invitation: WorkspaceInvitation, now: string): boolean {
  return invitation.expiresAt < now;
}

/* ─────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────*/

function DEFAULT_WORKSPACE_ROLE_DEFINITIONS_MAP(): Map<WorkspaceRole, WorkspaceRoleDefinition> {
  const map = new Map<WorkspaceRole, WorkspaceRoleDefinition>();
  for (const def of DEFAULT_WORKSPACE_ROLE_DEFINITIONS) {
    map.set(def.role, {
      ...def,
      id: workspaceRoleId(`role:${def.role}`),
      tenantId: "" as TenantId,
      workspaceId: workspaceId("*"),
      createdAt: "",
      updatedAt: "",
    });
  }
  return map;
}

/* ─────────────────────────────────────────────────────────────
 * Access evaluation (Sections U, DO, DP, DQ, DR)
 * ────────────────────────────────────────────────────────────*/

export interface WorkspaceAccessRequest {
  tenantId: TenantId;
  workspaceId: WorkspaceId;
  identityId: string;
  /** Required capability for this action. */
  requiredCapability:
    | "read"
    | "write"
    | "manage_membership"
    | "manage_configuration"
    | "manage_lifecycle"
    | "publish_views";
}

export type WorkspaceAccessDecision = { decision: "ALLOW" } | { decision: "DENY"; reason: string };

/**
 * Evaluate coarse-grained workspace access based on membership role and capability.
 * This is workspace-level coarse authorization (Section DO).
 * The authoritative security/authorization architecture evaluates full RBAC/ABAC/ReBAC/PBAC.
 * Phase 06 must not invent its own complete authorization model (Sections E7, GU).
 */
export function evaluateWorkspaceAccess(
  request: WorkspaceAccessRequest,
  membership: WorkspaceMembership | null,
): WorkspaceAccessDecision {
  if (!membership) {
    return { decision: "DENY", reason: "Identity is not a member of this workspace" };
  }

  if (membership.tenantId !== request.tenantId || membership.workspaceId !== request.workspaceId) {
    return { decision: "DENY", reason: "Membership does not apply to this workspace" };
  }

  if (!membership.isActive || membership.state !== "active") {
    return { decision: "DENY", reason: "Membership is not active" };
  }

  const rank = WORKSPACE_ROLE_RANK[membership.role];

  switch (request.requiredCapability) {
    case "read":
      // All active roles can read (guest = minimal).
      return { decision: "ALLOW" };
    case "write":
      return rank >= WORKSPACE_ROLE_RANK.editor
        ? { decision: "ALLOW" }
        : { decision: "DENY", reason: "Role cannot write to this workspace" };
    case "publish_views":
      return rank >= WORKSPACE_ROLE_RANK.editor
        ? { decision: "ALLOW" }
        : { decision: "DENY", reason: "Role cannot publish shared views" };
    case "manage_membership":
      return rank >= WORKSPACE_ROLE_RANK.manager
        ? { decision: "ALLOW" }
        : { decision: "DENY", reason: "Role cannot manage membership" };
    case "manage_configuration":
      return rank >= WORKSPACE_ROLE_RANK.administrator
        ? { decision: "ALLOW" }
        : { decision: "DENY", reason: "Role cannot manage configuration" };
    case "manage_lifecycle":
      return rank >= WORKSPACE_ROLE_RANK.administrator
        ? { decision: "ALLOW" }
        : { decision: "DENY", reason: "Role cannot manage lifecycle" };
  }
}
