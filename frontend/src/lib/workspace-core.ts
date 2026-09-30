/**
 * CoreGrid — Phase 06 Workspace Engine core domain model (platform interaction
 * layer; domain runtimes consume it).
 *
 * Implements `architecture/phase-06-workspace-engine.md`:
 * - A workspace is the configurable interaction layer; it is not the database,
 *   a domain engine, an AI agent, or the communication system (Section B3).
 * - Every workspace requires a stable identity (Section I).
 * - Workspace lifecycle: creation validates identity, tenant, type, authorization,
 *   naming, parent, required configuration (Section K).
 * - Every tenant-scoped workspace record must contain or derive tenant context (Section DB).
 * - Sensitive changes must produce audit records (Section CP).
 * - Phase 06 is the surface for capabilities; it does not own domain truth (Sections GU, ID).
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Branded workspace IDs
 * ────────────────────────────────────────────────────────────*/

export type WorkspaceId = string & { readonly __brand: "WorkspaceId" };
export type WorkspaceTypeId = string & { readonly __brand: "WorkspaceTypeId" };
export type WorkspaceMembershipId = string & { readonly __brand: "WorkspaceMembershipId" };
export type WorkspaceRoleId = string & { readonly __brand: "WorkspaceRoleId" };
export type WorkspaceInvitationId = string & { readonly __brand: "WorkspaceInvitationId" };
export type NavigationItemId = string & { readonly __brand: "NavigationItemId" };
export type ModuleId = string & { readonly __brand: "ModuleId" };
export type PageId = string & { readonly __brand: "PageId" };
export type DashboardId = string & { readonly __brand: "DashboardId" };
export type CardId = string & { readonly __brand: "CardId" };
export type WidgetTypeId = string & { readonly __brand: "WidgetTypeId" };
export type WidgetInstanceId = string & { readonly __brand: "WidgetInstanceId" };
export type LayoutId = string & { readonly __brand: "LayoutId" };
export type ViewId = string & { readonly __brand: "ViewId" };
export type FilterId = string & { readonly __brand: "FilterId" };
export type TemplateId = string & { readonly __brand: "TemplateId" };
export type WorkspaceSnapshotId = string & { readonly __brand: "WorkspaceSnapshotId" };
export type WorkspaceConfigVersionId = string & { readonly __brand: "WorkspaceConfigVersionId" };
export type WorkspacePreferenceId = string & { readonly __brand: "WorkspacePreferenceId" };
export type WorkspaceSessionId = string & { readonly __brand: "WorkspaceSessionId" };

export function workspaceId(raw: string): WorkspaceId {
  return raw as WorkspaceId;
}
export function workspaceTypeId(raw: string): WorkspaceTypeId {
  return raw as WorkspaceTypeId;
}
export function workspaceMembershipId(raw: string): WorkspaceMembershipId {
  return raw as WorkspaceMembershipId;
}
export function workspaceRoleId(raw: string): WorkspaceRoleId {
  return raw as WorkspaceRoleId;
}
export function workspaceInvitationId(raw: string): WorkspaceInvitationId {
  return raw as WorkspaceInvitationId;
}
export function navigationItemId(raw: string): NavigationItemId {
  return raw as NavigationItemId;
}
export function moduleId(raw: string): ModuleId {
  return raw as ModuleId;
}
export function pageId(raw: string): PageId {
  return raw as PageId;
}
export function dashboardId(raw: string): DashboardId {
  return raw as DashboardId;
}
export function cardId(raw: string): CardId {
  return raw as CardId;
}
export function widgetTypeId(raw: string): WidgetTypeId {
  return raw as WidgetTypeId;
}
export function widgetInstanceId(raw: string): WidgetInstanceId {
  return raw as WidgetInstanceId;
}
export function layoutId(raw: string): LayoutId {
  return raw as LayoutId;
}
export function viewId(raw: string): ViewId {
  return raw as ViewId;
}
export function filterId(raw: string): FilterId {
  return raw as FilterId;
}
export function templateId(raw: string): TemplateId {
  return raw as TemplateId;
}
export function workspaceSnapshotId(raw: string): WorkspaceSnapshotId {
  return raw as WorkspaceSnapshotId;
}
export function workspaceConfigVersionId(raw: string): WorkspaceConfigVersionId {
  return raw as WorkspaceConfigVersionId;
}
export function workspacePreferenceId(raw: string): WorkspacePreferenceId {
  return raw as WorkspacePreferenceId;
}
export function workspaceSessionId(raw: string): WorkspaceSessionId {
  return raw as WorkspaceSessionId;
}

/* ─────────────────────────────────────────────────────────────
 * Tenant-scoped workspace entity base (Section DB)
 * ────────────────────────────────────────────────────────────*/

/**
 * Every tenant-scoped workspace record must contain or derive tenant context
 * safely (Section DB). Cross-tenant access is exceptional (Section GU).
 */
export interface WorkspaceTenantScopedEntity {
  tenantId: TenantId;
  workspaceId: WorkspaceId;
  createdAt: string;
  updatedAt: string;
}

/** Invariant: workspace entity carries a determinable tenant boundary. */
export function hasWorkspaceTenantBoundary(
  entity: Pick<WorkspaceTenantScopedEntity, "tenantId">,
): boolean {
  return entity.tenantId.length > 0;
}

/** Invariant: a workspace entity must belong to the active tenant context. */
export function isWorkspaceEntityInTenant(
  entity: Pick<WorkspaceTenantScopedEntity, "tenantId">,
  context: Pick<{ tenantId: TenantId | null }, "tenantId">,
): boolean {
  return context.tenantId === null || entity.tenantId === context.tenantId;
}

/* ─────────────────────────────────────────────────────────────
 * Workspace types (Sections G, GY)
 * ────────────────────────────────────────────────────────────*/

/**
 * CoreGrid supports multiple workspace classes (Section G).
 * These are workspace types, not separate architectural engines (Section G).
 */
export type WorkspaceType =
  "institution" | "campus" | "department" | "role" | "team" | "personal" | "system" | "custom";

export const WORKSPACE_TYPES: readonly WorkspaceType[] = [
  "institution",
  "campus",
  "department",
  "role",
  "team",
  "personal",
  "system",
  "custom",
] as const;

export interface WorkspaceTypeDefinition extends WorkspaceTenantScopedEntity {
  id: WorkspaceTypeId;
  type: WorkspaceType;
  /** Human-readable name. */
  name: string;
  /** Description of the workspace class. */
  description: string | null;
  /** Default modules provisioned for this type (Section GY). */
  defaultModuleIds: ModuleId[];
  /** Whether this type may be used to provision default workspaces. */
  provisionable: boolean;
}

/* ─────────────────────────────────────────────────────────────
 * Workspace lifecycle (Sections J–O)
 * ────────────────────────────────────────────────────────────*/

export type WorkspaceLifecycleState = "draft" | "active" | "suspended" | "archived" | "deleted";

export const WORKSPACE_LIFECYCLE_STATES: readonly WorkspaceLifecycleState[] = [
  "draft",
  "active",
  "suspended",
  "archived",
  "deleted",
] as const;

export interface WorkspaceLifecycleTransition {
  from: WorkspaceLifecycleState;
  to: WorkspaceLifecycleState;
  allowed: boolean;
  /** Reason required for suspension, archival, or deletion. */
  requiresReason: boolean;
}

export const WORKSPACE_LIFECYCLE_TRANSITIONS: readonly WorkspaceLifecycleTransition[] = [
  { from: "draft", to: "active", allowed: true, requiresReason: false },
  { from: "draft", to: "archived", allowed: true, requiresReason: true },
  { from: "draft", to: "deleted", allowed: true, requiresReason: true },
  { from: "active", to: "suspended", allowed: true, requiresReason: true },
  { from: "active", to: "archived", allowed: true, requiresReason: true },
  { from: "active", to: "active", allowed: true, requiresReason: false },
  { from: "suspended", to: "active", allowed: true, requiresReason: false },
  { from: "suspended", to: "archived", allowed: true, requiresReason: true },
  { from: "suspended", to: "deleted", allowed: true, requiresReason: true },
  { from: "archived", to: "deleted", allowed: true, requiresReason: true },
  { from: "archived", to: "active", allowed: true, requiresReason: true },
];

export function isWorkspaceLifecycleTransitionAllowed(
  from: WorkspaceLifecycleState,
  to: WorkspaceLifecycleState,
): { allowed: boolean; requiresReason: boolean } {
  const transition = WORKSPACE_LIFECYCLE_TRANSITIONS.find((t) => t.from === from && t.to === to);
  if (!transition) {
    return { allowed: false, requiresReason: false };
  }
  return { allowed: transition.allowed, requiresReason: transition.requiresReason };
}

/* ─────────────────────────────────────────────────────────────
 * Workspace entity (Sections F, I, H)
 * ────────────────────────────────────────────────────────────*/

/**
 * A workspace is a configurable interaction environment containing authorized
 * capabilities, navigation, views, tools, data representations, and user-specific
 * state (Section F).
 */
export interface Workspace extends WorkspaceTenantScopedEntity {
  id: WorkspaceId;
  /** Stable identity attributes (Section I). */
  name: string;
  /** Short stable code. */
  code: string;
  /** Workspace class. */
  type: WorkspaceType;
  /** Optional parent workspace (Section H). */
  parentWorkspaceId: WorkspaceId | null;
  /** Workspace lifecycle state (Section J). */
  lifecycleState: WorkspaceLifecycleState;
  /** Enabled module IDs (Section AA). */
  moduleIds: ModuleId[];
  /** Default page ID used as the landing surface. */
  defaultPageId: PageId | null;
  /** Whether the workspace is globally discoverable to authorized users (Section GX). */
  isDiscoverable: boolean;
  /** Region context (Section HX). */
  region: string | null;
  /** Timezone context (Section HY). */
  timezone: string | null;
  /** Locale (Section EF). */
  locale: string | null;
  /** Suspension reason. */
  suspensionReason: string | null;
  /** Archive reason. */
  archiveReason: string | null;
  /** Configuration version (Section CD). */
  configVersion: number;
}

export interface CreateWorkspaceInput {
  tenantId: TenantId;
  name: string;
  code: string;
  type: WorkspaceType;
  parentWorkspaceId?: WorkspaceId | null;
  moduleIds?: ModuleId[];
  defaultPageId?: PageId | null;
  isDiscoverable?: boolean;
  region?: string | null;
  timezone?: string | null;
  locale?: string | null;
  creatorId: string;
  now: string;
}

export type CreateWorkspaceResult =
  | { ok: true; workspace: Workspace; auditEvent: WorkspaceAuditEvent }
  | { ok: false; error: string };

/**
 * Workspace creation must validate requesting identity, tenant, workspace type,
 * authorization (external), naming constraints, parent workspace, and required
 * configuration (Section K). Tenant context is mandatory (Section DB).
 */
export function createWorkspace(
  input: CreateWorkspaceInput,
  existingWorkspaces: Array<{ tenantId: TenantId; code: string }>,
  now: string,
): CreateWorkspaceResult {
  if (input.name.trim() === "") {
    return { ok: false, error: "Workspace name is required" };
  }

  if (input.code.trim() === "") {
    return { ok: false, error: "Workspace code is required" };
  }

  if (!/^[A-Z0-9_]{2,32}$/.test(input.code)) {
    return {
      ok: false,
      error: "Workspace code must be 2–32 uppercase letters, digits, or underscores",
    };
  }

  // Tenant-scoped uniqueness (Section I): stable identity within tenant.
  if (existingWorkspaces.some((w) => w.tenantId === input.tenantId && w.code === input.code)) {
    return {
      ok: false,
      error: `Workspace code ${input.code} already exists within this tenant`,
    };
  }

  const id = workspaceId(`${input.tenantId}:${input.code.toLowerCase()}`);

  const workspace: Workspace = {
    id,
    tenantId: input.tenantId,
    workspaceId: id,
    name: input.name,
    code: input.code,
    type: input.type,
    parentWorkspaceId: input.parentWorkspaceId ?? null,
    lifecycleState: "draft",
    moduleIds: input.moduleIds ?? [],
    defaultPageId: input.defaultPageId ?? null,
    isDiscoverable: input.isDiscoverable ?? false,
    region: input.region ?? null,
    timezone: input.timezone ?? null,
    locale: input.locale ?? null,
    suspensionReason: null,
    archiveReason: null,
    configVersion: 1,
    createdAt: now,
    updatedAt: now,
  };

  const auditEvent: WorkspaceAuditEvent = {
    id: `audit-${now}-${id}`,
    type: "WorkspaceCreated",
    tenantId: input.tenantId,
    workspaceId: id,
    actorId: input.creatorId,
    occurredAt: now,
    result: "success",
    metadata: {
      name: input.name,
      code: input.code,
      type: input.type,
      parentWorkspaceId: input.parentWorkspaceId ?? null,
    },
  };

  return { ok: true, workspace, auditEvent };
}

/* ─────────────────────────────────────────────────────────────
 * Workspace lifecycle operations (Sections L–O)
 * ────────────────────────────────────────────────────────────*/

export interface ChangeWorkspaceLifecycleInput {
  tenantId: TenantId;
  workspaceId: WorkspaceId;
  to: WorkspaceLifecycleState;
  reason: string | null;
  actorId: string;
  now: string;
}

export type ChangeWorkspaceLifecycleResult =
  | { ok: true; workspace: Workspace; auditEvent: WorkspaceAuditEvent }
  | { ok: false; error: string };

export function changeWorkspaceLifecycle(
  input: ChangeWorkspaceLifecycleInput,
  workspace: Workspace,
): ChangeWorkspaceLifecycleResult {
  // Cross-tenant guard: caller tenant must own the workspace (Section DB).
  if (workspace.tenantId !== input.tenantId) {
    return { ok: false, error: "Workspace belongs to a different tenant" };
  }

  const transition = isWorkspaceLifecycleTransitionAllowed(workspace.lifecycleState, input.to);

  if (!transition.allowed) {
    return {
      ok: false,
      error: `Workspace lifecycle transition ${workspace.lifecycleState} → ${input.to} is not allowed`,
    };
  }

  if (transition.requiresReason && (input.reason === null || input.reason.trim() === "")) {
    return {
      ok: false,
      error: `Transition to ${input.to} requires a reason`,
    };
  }

  const updated: Workspace = {
    ...workspace,
    lifecycleState: input.to,
    suspensionReason: input.to === "suspended" ? input.reason : workspace.suspensionReason,
    archiveReason: input.to === "archived" ? input.reason : workspace.archiveReason,
    updatedAt: input.now,
  };

  const auditEventType: WorkspaceAuditEventType =
    input.to === "active"
      ? "WorkspaceActivated"
      : input.to === "suspended"
        ? "WorkspaceSuspended"
        : input.to === "archived"
          ? "WorkspaceArchived"
          : input.to === "deleted"
            ? "WorkspaceDeleted"
            : "WorkspaceCreated";

  const auditEvent: WorkspaceAuditEvent = {
    id: `audit-${input.now}-${workspace.id}-${input.to}`,
    type: auditEventType,
    tenantId: input.tenantId,
    workspaceId: workspace.id,
    actorId: input.actorId,
    occurredAt: input.now,
    result: "success",
    metadata: {
      from: workspace.lifecycleState,
      to: input.to,
      reason: input.reason,
    },
  };

  return { ok: true, workspace: updated, auditEvent };
}

/* ─────────────────────────────────────────────────────────────
 * Workspace activation validation (Section L)
 * ────────────────────────────────────────────────────────────*/

export type ActivationValidationResult = { ok: true } | { ok: false; errors: string[] };

/**
 * Activation should verify required configuration, permissions, dependencies,
 * required modules, navigation, and default views (Section L).
 */
export function validateWorkspaceForActivation(
  workspace: Workspace,
  enabledModuleIds: ModuleId[],
  hasNavigation: boolean,
  hasDefaultPage: boolean,
): ActivationValidationResult {
  const errors: string[] = [];

  if (workspace.lifecycleState !== "draft") {
    errors.push("Only draft workspaces may be activated");
  }

  // Required modules: every declared module must be enabled (Section L).
  const missingModules = workspace.moduleIds.filter((m) => !enabledModuleIds.includes(m));
  if (missingModules.length > 0) {
    errors.push(`Workspace declares modules that are not enabled: ${missingModules.join(", ")}`);
  }

  if (!hasNavigation) {
    errors.push("Workspace must have navigation before activation");
  }

  if (!hasDefaultPage) {
    errors.push("Workspace must have a default page before activation");
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/* ─────────────────────────────────────────────────────────────
 * Workspace audit event (Section CP)
 * ────────────────────────────────────────────────────────────*/

export type WorkspaceAuditEventType =
  | "WorkspaceCreated"
  | "WorkspaceActivated"
  | "WorkspaceSuspended"
  | "WorkspaceArchived"
  | "WorkspaceDeleted"
  | "WorkspaceMemberAdded"
  | "WorkspaceMemberRemoved"
  | "WorkspaceRoleChanged"
  | "WorkspaceInvitationSent"
  | "WorkspaceInvitationAccepted"
  | "WorkspaceInvitationRevoked"
  | "WorkspaceNavigationChanged"
  | "WorkspaceModuleChanged"
  | "WorkspaceDashboardChanged"
  | "WorkspaceViewCreated"
  | "WorkspaceViewShared"
  | "WorkspaceTemplateApplied"
  | "WorkspaceConfigurationChanged"
  | "WorkspaceConfigVersioned"
  | "WorkspaceSnapshotCreated"
  | "WorkspaceSnapshotRestored"
  | "WorkspaceSensitiveAccess";

export interface WorkspaceAuditEvent {
  id: string;
  type: WorkspaceAuditEventType;
  tenantId: TenantId;
  workspaceId: WorkspaceId;
  actorId: string | null;
  occurredAt: string;
  result: "success" | "failure" | "partial";
  metadata: Record<string, unknown>;
}

/* ─────────────────────────────────────────────────────────────
 * Workspace context (Sections BX–BZ)
 * ────────────────────────────────────────────────────────────*/

export interface WorkspaceContext {
  tenantId: TenantId;
  workspaceId: WorkspaceId;
  workspaceName: string;
  workspaceType: WorkspaceType;
  actorId: string | null;
  /** List of workspaces the actor may switch to (Section BY). */
  accessibleWorkspaceIds: WorkspaceId[];
  /** Current page / view state (Section CA). */
  activePageId: PageId | null;
  /** Whether this context is a cross-tenant switch (Section BZ). */
  isCrossTenantSwitch: boolean;
}

export type WorkspaceContextSwitchResult =
  { ok: true; context: WorkspaceContext } | { ok: false; error: string };

/**
 * Switching workspace must invalidate or recompute workspace-scoped state (Section BZ).
 * Cross-tenant context switches are prohibited unless explicitly authorized (Section DD).
 */
export function switchWorkspaceContext(
  from: WorkspaceContext,
  toWorkspace: Pick<Workspace, "id" | "tenantId" | "name" | "type">,
  actorId: string | null,
  authorizedWorkspaceIds: WorkspaceId[],
): WorkspaceContextSwitchResult {
  if (!authorizedWorkspaceIds.includes(toWorkspace.id)) {
    return { ok: false, error: "Actor is not authorized to access this workspace" };
  }

  const isCrossTenant = from.tenantId !== toWorkspace.tenantId;
  if (isCrossTenant && !from.isCrossTenantSwitch) {
    return {
      ok: false,
      error: "Cross-tenant workspace switch is not authorized",
    };
  }

  return {
    ok: true,
    context: {
      tenantId: toWorkspace.tenantId,
      workspaceId: toWorkspace.id,
      workspaceName: toWorkspace.name,
      workspaceType: toWorkspace.type,
      actorId,
      accessibleWorkspaceIds: authorizedWorkspaceIds,
      activePageId: null,
      isCrossTenantSwitch: isCrossTenant,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Workspace search / discovery (Sections GX, HH)
 * ────────────────────────────────────────────────────────────*/

export interface WorkspaceSearchQuery {
  tenantId: TenantId;
  query: string;
  types?: WorkspaceType[];
  lifecycleStates?: WorkspaceLifecycleState[];
}

export interface WorkspaceSearchResult {
  workspaceId: WorkspaceId;
  name: string;
  code: string;
  type: WorkspaceType;
  lifecycleState: WorkspaceLifecycleState;
  isDiscoverable: boolean;
}

/**
 * Search supports workspace name, type, institution, role, status while respecting
 * authorization (Section HH). Workspace search must never bypass tenant boundaries (Section GT).
 */
export function searchWorkspaces(
  query: WorkspaceSearchQuery,
  candidates: Workspace[],
): WorkspaceSearchResult[] {
  const q = query.query.trim().toLowerCase();

  return candidates
    .filter((w) => w.tenantId === query.tenantId)
    .filter((w) => (query.types ? query.types.includes(w.type) : true))
    .filter((w) =>
      query.lifecycleStates ? query.lifecycleStates.includes(w.lifecycleState) : true,
    )
    .filter((w) => {
      if (q === "") return true;
      return (
        w.name.toLowerCase().includes(q) ||
        w.code.toLowerCase().includes(q) ||
        w.type.toLowerCase().includes(q)
      );
    })
    .map((w) => ({
      workspaceId: w.id,
      name: w.name,
      code: w.code,
      type: w.type,
      lifecycleState: w.lifecycleState,
      isDiscoverable: w.isDiscoverable,
    }));
}

/* ─────────────────────────────────────────────────────────────
 * Workspace provisioning (Sections GY, GZ, HA)
 * ────────────────────────────────────────────────────────────*/

export interface ProvisionDefaultWorkspaceInput {
  tenantId: TenantId;
  workspaceType: WorkspaceType;
  role: string;
  actorId: string;
  now: string;
}

export type ProvisionDefaultWorkspaceResult =
  { ok: true; workspace: Workspace; created: boolean } | { ok: false; error: string };

/**
 * CoreGrid may provision default workspaces based on institution type, user role,
 * tenant configuration, and enabled capabilities (Section GY).
 * Provisioning must be idempotent (Section HA).
 */
export function provisionDefaultWorkspace(
  input: ProvisionDefaultWorkspaceInput,
  existingWorkspaces: Workspace[],
): ProvisionDefaultWorkspaceResult {
  const codeBase = input.workspaceType === "role" ? input.role : input.workspaceType;
  const code = `${input.workspaceType.toUpperCase()}_${codeBase.toUpperCase()}`.slice(0, 32);

  // Idempotency: if a matching default workspace already exists, return it (Section HA).
  const existing = existingWorkspaces.find((w) => w.tenantId === input.tenantId && w.code === code);

  if (existing) {
    return { ok: true, workspace: existing, created: false };
  }

  const result = createWorkspace(
    {
      tenantId: input.tenantId,
      name: `${input.workspaceType[0].toUpperCase()}${input.workspaceType.slice(1)} Workspace`,
      code,
      type: input.workspaceType,
      isDiscoverable: true,
      creatorId: input.actorId,
      now: input.now,
    },
    existingWorkspaces.map((w) => ({ tenantId: w.tenantId, code: w.code })),
    input.now,
  );

  if (!result.ok) {
    return { ok: false, error: (result as { ok: false; error: string }).error };
  }

  return { ok: true, workspace: result.workspace as Workspace, created: true };
}

/* ─────────────────────────────────────────────────────────────
 * Workspace health (Sections HK, HL)
 * ────────────────────────────────────────────────────────────*/

export interface WorkspaceDependencyStatus {
  capabilityName: string;
  available: boolean;
  /** Whether the dependency is enabled for this workspace. */
  enabled: boolean;
}

export interface WorkspaceHealth {
  workspaceId: WorkspaceId;
  configurationValid: boolean;
  configErrors: string[];
  dependencyStatuses: WorkspaceDependencyStatus[];
  /** Aggregated status. Must not pretend domain systems are healthy merely because the workspace renders (Section HK). */
  overallStatus: "healthy" | "degraded" | "unhealthy";
}

export function evaluateWorkspaceHealth(
  workspaceId: WorkspaceId,
  configurationValid: boolean,
  configErrors: string[],
  dependencyStatuses: WorkspaceDependencyStatus[],
): WorkspaceHealth {
  const unavailableDeps = dependencyStatuses.filter((d) => d.available === false);

  let overallStatus: WorkspaceHealth["overallStatus"];
  if (!configurationValid || unavailableDeps.some((d) => d.enabled)) {
    overallStatus = "unhealthy";
  } else if (unavailableDeps.length > 0) {
    overallStatus = "degraded";
  } else {
    overallStatus = "healthy";
  }

  return {
    workspaceId,
    configurationValid,
    configErrors,
    dependencyStatuses,
    overallStatus,
  };
}
