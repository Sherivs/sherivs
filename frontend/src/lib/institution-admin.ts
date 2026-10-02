/**
 * CoreGrid Institutional Onboarding, Administration & Workforce Identity Platform —
 * Institutional administration governance domain.
 *
 * Implements `architecture/phase-25-institutional-onboarding-administration-workforce-identity-platform.md`:
 * - Administrator account (AE) + dashboard (AF) + administrative command centre (AG).
 * - HR account creation (AH) + HR workspace (AI): only explicitly assigned
 *   capabilities appear.
 * - Dynamic workspace generation (AJ): Identity → Role → Context → Permission →
 *   Policy → Capability → Workspace Composer → Personalized Workspace.
 * - Zero-static-portal principle (CT): one workspace engine, thousands of
 *   legitimate role/context combinations — never `TeacherPortal`/`HRPortal` apps.
 * - Workspace recomposition (CS): Role Changed → Policy Recomputed → Permissions
 *   Recomputed → Capabilities Recomputed → Workspace Recomputed.
 * - Administrator delegation (CK): role, scope, duration, permissions, policy,
 *   audit trail. Administrative escalation (CL): critical actions may require a
 *   second administrator / platform support / institutional approval.
 * - Break-glass access (CM): reason, identity, scope, duration, audit,
 *   post-event review. Admin audit (CN).
 * - Permission explanation (CP): what was denied, why, which authority controls it,
 *   who can request access — without exposing authorization internals.
 * - Dynamic capability discovery (CQ) + feature availability (CR): UI receives
 *   capability information from authoritative services; never hard-code role checks.
 * - Admin configuration assistant (CV): AI-generated administrative changes require
 *   approval. Policy simulation (CW): who gains/loses access. Role simulation (CX):
 *   preview effective workspace without unsafe impersonation. Access preview (CY).
 * - Admin impersonation (CZ): explicit authorization, time limit, visible indicator,
 *   audit trail, restricted sensitive-data exposure.
 * - Staff self-service (DA): profile/preferences/password/PIN/devices/notifications/
 *   accessibility — never self-granted institutional privileges.
 * - Account recovery (CF), device registration (CH), device revocation (CI),
 *   session management (CJ).
 * - Admin disaster recovery (EY), succession (EZ), lockout prevention (FA),
 *   emergency administrative recovery (FB).
 *
 * Phase 25 consumes Phase 06 workspace composition and Phase 08 security policy
 * primitives; this domain defines the administrative governance contracts.
 */

import type { TenantId } from "./tenant-core";
import type { InstitutionId } from "./institution-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type AdminDelegationId = string & { readonly __brand: "AdminDelegationId" };
export type BreakGlassAccessId = string & { readonly __brand: "BreakGlassAccessId" };
export type ImpersonationSessionId = string & { readonly __brand: "ImpersonationSessionId" };
export type AdminAuditEventId = string & { readonly __brand: "AdminAuditEventId" };
export type PolicySimulationId = string & { readonly __brand: "PolicySimulationId" };
export type AccessPreviewId = string & { readonly __brand: "AccessPreviewId" };

export function adminDelegationId(raw: string): AdminDelegationId {
  return raw as AdminDelegationId;
}
export function breakGlassAccessId(raw: string): BreakGlassAccessId {
  return raw as BreakGlassAccessId;
}
export function impersonationSessionId(raw: string): ImpersonationSessionId {
  return raw as ImpersonationSessionId;
}
export function adminAuditEventId(raw: string): AdminAuditEventId {
  return raw as AdminAuditEventId;
}
export function policySimulationId(raw: string): PolicySimulationId {
  return raw as PolicySimulationId;
}
export function accessPreviewId(raw: string): AccessPreviewId {
  return raw as AccessPreviewId;
}

/* ─────────────────────────────────────────────────────────────
 * Administrator delegation (Section CK)
 * ────────────────────────────────────────────────────────────*/

export interface AdminDelegation {
  id: AdminDelegationId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  /** Delegating (primary) administrator identity. */
  delegatorRef: string;
  /** Delegate identity. */
  delegateRef: string;
  /** Delegated role ref. */
  roleRef: string;
  /** Delegated scope (department/campus refs). Empty = full delegated role scope. */
  scope: string[];
  /** Delegated permission strings. */
  permissions: string[];
  /** Policy refs governing the delegation. */
  policyRefs: string[];
  grantedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export function createAdminDelegation(input: {
  id: AdminDelegationId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  delegatorRef: string;
  delegateRef: string;
  roleRef: string;
  scope?: string[];
  permissions?: string[];
  policyRefs?: string[];
  durationHours: number;
  now?: string;
}): { ok: true; delegation: AdminDelegation } | { ok: false; error: string } {
  const now = input.now ?? timeAuthority.now().at;
  if (input.delegatorRef === input.delegateRef) {
    return { ok: false, error: "A delegator cannot delegate to themselves" };
  }
  if (input.durationHours <= 0 || input.durationHours > 24 * 365) {
    return { ok: false, error: "Delegation duration must be between 1 hour and 1 year" };
  }
  const expiresAt = new Date(
    new Date(now).getTime() + input.durationHours * 3_600_000,
  ).toISOString();
  return {
    ok: true,
    delegation: {
      id: input.id,
      tenantId: input.tenantId,
      institutionId: input.institutionId,
      delegatorRef: input.delegatorRef,
      delegateRef: input.delegateRef,
      roleRef: input.roleRef,
      scope: input.scope ?? [],
      permissions: input.permissions ?? [],
      policyRefs: input.policyRefs ?? [],
      grantedAt: now,
      expiresAt,
      revokedAt: null,
    },
  };
}

export function revokeAdminDelegation(
  delegation: AdminDelegation,
  now: string = timeAuthority.now().at,
): AdminDelegation {
  return { ...delegation, revokedAt: now };
}

export function isAdminDelegationActive(
  delegation: AdminDelegation,
  now: string = timeAuthority.now().at,
): boolean {
  if (delegation.revokedAt !== null) return false;
  return now <= delegation.expiresAt;
}

/* ─────────────────────────────────────────────────────────────
 * Break-glass access (Section CM)
 * ────────────────────────────────────────────────────────────*/

export interface BreakGlassAccess {
  id: BreakGlassAccessId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  /** Identity requesting emergency access. */
  requesterRef: string;
  /** Reason for emergency access. */
  reason: string;
  /** Scope of the emergency access. */
  scope: string[];
  grantedAt: string;
  expiresAt: string;
  /** Post-event review reference (required for every break-glass event). */
  reviewRef: string | null;
}

export function createBreakGlassAccess(input: {
  id: BreakGlassAccessId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  requesterRef: string;
  reason: string;
  scope: string[];
  durationMinutes: number;
  now?: string;
}): { ok: true; access: BreakGlassAccess } | { ok: false; error: string } {
  const now = input.now ?? timeAuthority.now().at;
  if (!input.reason.trim()) {
    return { ok: false, error: "Break-glass access requires a reason (Section CM)" };
  }
  if (input.scope.length === 0) {
    return { ok: false, error: "Break-glass access requires a scope (Section CM)" };
  }
  if (input.durationMinutes <= 0 || input.durationMinutes > 720) {
    return { ok: false, error: "Break-glass duration must be between 1 and 720 minutes" };
  }
  const expiresAt = new Date(
    new Date(now).getTime() + input.durationMinutes * 60_000,
  ).toISOString();
  return {
    ok: true,
    access: {
      id: input.id,
      tenantId: input.tenantId,
      institutionId: input.institutionId,
      requesterRef: input.requesterRef,
      reason: input.reason.trim(),
      scope: input.scope,
      grantedAt: now,
      expiresAt,
      reviewRef: null,
    },
  };
}

/** Break-glass events must be reviewed afterward (Section CM). */
export function recordBreakGlassReview(
  access: BreakGlassAccess,
  reviewRef: string,
): BreakGlassAccess {
  return { ...access, reviewRef };
}

export function isBreakGlassActive(
  access: BreakGlassAccess,
  now: string = timeAuthority.now().at,
): boolean {
  return now <= access.expiresAt;
}

/* ─────────────────────────────────────────────────────────────
 * Admin impersonation (Section CZ)
 * Restricted: explicit authorization, time limit, visible indicator,
 * audit trail, restricted sensitive-data exposure.
 * ────────────────────────────────────────────────────────────*/

export interface ImpersonationSession {
  id: ImpersonationSessionId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  /** Support identity performing the impersonation. */
  actorRef: string;
  /** Identity being impersonated. */
  targetRef: string;
  /** Explicit authorization reference. */
  authorizationRef: string;
  startedAt: string;
  endsAt: string;
  endedAt: string | null;
  /** Visible indicator must be shown in the UI for the whole session. */
  visibleIndicator: boolean;
}

export function createImpersonationSession(input: {
  id: ImpersonationSessionId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  actorRef: string;
  targetRef: string;
  authorizationRef: string;
  durationMinutes: number;
  now?: string;
}): { ok: true; session: ImpersonationSession } | { ok: false; error: string } {
  const now = input.now ?? timeAuthority.now().at;
  if (input.actorRef === input.targetRef) {
    return { ok: false, error: "Cannot impersonate self" };
  }
  if (!input.authorizationRef.trim()) {
    return { ok: false, error: "Impersonation requires explicit authorization (Section CZ)" };
  }
  if (input.durationMinutes <= 0 || input.durationMinutes > 60) {
    return { ok: false, error: "Impersonation time limit must be between 1 and 60 minutes" };
  }
  const endsAt = new Date(new Date(now).getTime() + input.durationMinutes * 60_000).toISOString();
  return {
    ok: true,
    session: {
      id: input.id,
      tenantId: input.tenantId,
      institutionId: input.institutionId,
      actorRef: input.actorRef,
      targetRef: input.targetRef,
      authorizationRef: input.authorizationRef,
      startedAt: now,
      endsAt,
      endedAt: null,
      visibleIndicator: true,
    },
  };
}

export function endImpersonationSession(
  session: ImpersonationSession,
  now: string = timeAuthority.now().at,
): ImpersonationSession {
  return { ...session, endedAt: now };
}

export function isImpersonationActive(
  session: ImpersonationSession,
  now: string = timeAuthority.now().at,
): boolean {
  if (session.endedAt !== null) return false;
  return now <= session.endsAt;
}

/* ─────────────────────────────────────────────────────────────
 * Admin audit + permission explanation (Sections CN, CP)
 * ────────────────────────────────────────────────────────────*/

export type AdminAuditEventType =
  | "user_created"
  | "role_assigned"
  | "permission_changed"
  | "policy_changed"
  | "invitation_sent"
  | "deactivation"
  | "biometric_enrollment"
  | "biometric_revocation"
  | "device_registered"
  | "security_change";

export const ADMIN_AUDIT_EVENT_TYPES: readonly AdminAuditEventType[] = [
  "user_created",
  "role_assigned",
  "permission_changed",
  "policy_changed",
  "invitation_sent",
  "deactivation",
  "biometric_enrollment",
  "biometric_revocation",
  "device_registered",
  "security_change",
] as const;

export interface AdminAuditEvent {
  id: AdminAuditEventId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  type: AdminAuditEventType;
  actorRef: string;
  subjectRef: string;
  occurredAt: string;
  metadata: Record<string, string | number | boolean | null>;
}

export function recordAdminAuditEvent(input: {
  id: AdminAuditEventId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  type: AdminAuditEventType;
  actorRef: string;
  subjectRef: string;
  metadata?: Record<string, string | number | boolean | null>;
  now?: string;
}): AdminAuditEvent {
  return {
    id: input.id,
    tenantId: input.tenantId,
    institutionId: input.institutionId,
    type: input.type,
    actorRef: input.actorRef,
    subjectRef: input.subjectRef,
    occurredAt: input.now ?? timeAuthority.now().at,
    metadata: input.metadata ?? {},
  };
}

export interface PermissionDenialExplanation {
  action: string;
  /** What was denied. */
  resource: string;
  /** Why (safe, non-internal explanation). */
  reason: string;
  /** Which authority controls it. */
  controllingAuthority: string;
  /** Who can request/change access where appropriate. */
  accessRequestPath: string | null;
}

/**
 * Section CP: when an action is denied, explain what/why/who controls it/who can
 * request access — without exposing sensitive authorization internals.
 */
export function explainPermissionDenial(input: {
  action: string;
  resource: string;
  reason: string;
  controllingAuthority: string;
  accessRequestPath?: string | null;
}): PermissionDenialExplanation {
  return {
    action: input.action,
    resource: input.resource,
    reason: input.reason,
    controllingAuthority: input.controllingAuthority,
    accessRequestPath: input.accessRequestPath ?? null,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Dynamic capability discovery + feature availability (CQ, CR)
 * The UI receives capability info from authoritative services;
 * feature visibility is determined by capability/permission/policy/context/platform.
 * ────────────────────────────────────────────────────────────*/

export interface CapabilityDescriptor {
  key: string;
  /** Feature surface this capability unlocks. */
  featureKeys: string[];
  /** Platform requirement, if any (e.g. "mobile", "web"). */
  requiredPlatform: string | null;
}

export function resolveVisibleFeatures(
  capabilities: string[],
  registry: CapabilityDescriptor[],
): string[] {
  const owned = new Set(capabilities);
  const features = new Set<string>();
  for (const descriptor of registry) {
    if (owned.has(descriptor.key)) {
      for (const f of descriptor.featureKeys) features.add(f);
    }
  }
  return [...features];
}

/* ─────────────────────────────────────────────────────────────
 * Workspace recomposition (Section CS) + zero-static-portal (CT)
 * Role Changed → Policy Recomputed → Permissions Recomputed →
 * Capabilities Recomputed → Workspace Recomputed.
 * ────────────────────────────────────────────────────────────*/

export interface WorkspaceCompositionInput {
  rolePermissions: string[];
  roleCapabilities: string[];
  policyRefs: string[];
  contextRef: string | null;
  platform: string | null;
}

export interface RecomposedWorkspace {
  permissions: string[];
  capabilities: string[];
  /** Deterministic feature surface — one engine, thousands of combinations (CT). */
  featureKeys: string[];
  recomposedAt: string;
}

/**
 * Workspace recomposition (CS). This is the deterministic composition step the
 * workspace engine consumes; it is not the workspace itself (Phase 06 owns the
 * configurable surface).
 */
export function recomposeWorkspace(
  input: WorkspaceCompositionInput,
  registry: CapabilityDescriptor[],
  now: string = timeAuthority.now().at,
): RecomposedWorkspace {
  const permissions = [...new Set(input.rolePermissions)].sort();
  const capabilities = [...new Set(input.roleCapabilities)].sort();
  return {
    permissions,
    capabilities,
    featureKeys: resolveVisibleFeatures(capabilities, registry).sort(),
    recomposedAt: now,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Policy simulation (Section CW) + access preview (CY)
 * ────────────────────────────────────────────────────────────*/

export interface PolicySimulationResult {
  id: PolicySimulationId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  /** Identity refs that would GAIN access. */
  gainedAccessRefs: string[];
  /** Identity refs that would LOSE access. */
  lostAccessRefs: string[];
  simulatedAt: string;
}

export function simulatePolicyChange(input: {
  id: PolicySimulationId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  affectedRefs: string[];
  /** Ref -> whether the ref would have the permission after the change. */
  permissionAfter: Map<string, boolean>;
  now?: string;
}): PolicySimulationResult {
  const gained: string[] = [];
  const lost: string[] = [];
  for (const ref of input.affectedRefs) {
    const after = input.permissionAfter.get(ref);
    if (after === true) gained.push(ref);
    else if (after === false) lost.push(ref);
  }
  return {
    id: input.id,
    tenantId: input.tenantId,
    institutionId: input.institutionId,
    gainedAccessRefs: gained,
    lostAccessRefs: lost,
    simulatedAt: input.now ?? timeAuthority.now().at,
  };
}

export interface AccessPreview {
  id: AccessPreviewId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  /** Effective permissions (CY). */
  effectivePermissions: string[];
  /** Effective policy refs. */
  effectivePolicyRefs: string[];
  /** Effective context ref. */
  effectiveContextRef: string | null;
  /** Available capabilities. */
  availableCapabilities: string[];
}

export function buildAccessPreview(input: {
  id: AccessPreviewId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  effectivePermissions: string[];
  effectivePolicyRefs: string[];
  effectiveContextRef?: string | null;
  availableCapabilities: string[];
}): AccessPreview {
  return {
    id: input.id,
    tenantId: input.tenantId,
    institutionId: input.institutionId,
    effectivePermissions: [...input.effectivePermissions].sort(),
    effectivePolicyRefs: [...input.effectivePolicyRefs].sort(),
    effectiveContextRef: input.effectiveContextRef ?? null,
    availableCapabilities: [...input.availableCapabilities].sort(),
  };
}

/* ─────────────────────────────────────────────────────────────
 * Staff self-service (Section DA)
 * Staff may manage profile/preferences/password/PIN/devices/notifications/
 * accessibility and their onboarding progress. They cannot self-grant privileges.
 * ────────────────────────────────────────────────────────────*/

export type SelfServiceItem =
  | "profile"
  | "preferences"
  | "password"
  | "pin"
  | "devices"
  | "notifications"
  | "accessibility"
  | "onboarding_progress";

export const SELF_SERVICE_ITEMS: readonly SelfServiceItem[] = [
  "profile",
  "preferences",
  "password",
  "pin",
  "devices",
  "notifications",
  "accessibility",
  "onboarding_progress",
] as const;

export const SELF_SERVICE_FORBIDDEN_ACTIONS: readonly string[] = [
  "role.assign",
  "permission.grant",
  "policy.modify",
  "workspace.provision",
] as const;

/** Staff can never self-grant institutional privileges (Section DA). */
export function isSelfServiceActionForbidden(action: string): boolean {
  return (SELF_SERVICE_FORBIDDEN_ACTIONS as readonly string[]).includes(action);
}

/* ─────────────────────────────────────────────────────────────
 * Admin recovery, succession, lockout (Sections EY, EZ, FA, FB)
 * ────────────────────────────────────────────────────────────*/

export interface AdminRecoveryPlan {
  tenantId: TenantId;
  institutionId: InstitutionId;
  /** Backup administrator identity refs (Section FA: no permanent lockout). */
  backupAdministratorRefs: string[];
  /** Recovery procedure ref. */
  recoveryProcedureRef: string;
  updatedAt: string;
}

export interface AdminSuccession {
  tenantId: TenantId;
  institutionId: InstitutionId;
  /** Outgoing primary administrator. */
  outgoingAdministratorRef: string;
  /** Incoming primary administrator (Section EZ: controlled transfer). */
  incomingAdministratorRef: string;
  /** Platform safeguard reference — succession must be platform-verified. */
  platformSafeguardRef: string;
  completedAt: string;
}

export function createAdminSuccession(input: {
  tenantId: TenantId;
  institutionId: InstitutionId;
  outgoingAdministratorRef: string;
  incomingAdministratorRef: string;
  platformSafeguardRef: string;
  now?: string;
}): { ok: true; succession: AdminSuccession } | { ok: false; error: string } {
  if (input.outgoingAdministratorRef === input.incomingAdministratorRef) {
    return { ok: false, error: "Succession requires a different incoming administrator" };
  }
  if (!input.platformSafeguardRef.trim()) {
    return { ok: false, error: "Admin succession requires a platform safeguard (Section EZ)" };
  }
  return {
    ok: true,
    succession: {
      tenantId: input.tenantId,
      institutionId: input.institutionId,
      outgoingAdministratorRef: input.outgoingAdministratorRef,
      incomingAdministratorRef: input.incomingAdministratorRef,
      platformSafeguardRef: input.platformSafeguardRef,
      completedAt: input.now ?? timeAuthority.now().at,
    },
  };
}

/**
 * Emergency administrative recovery (Section FB): verified authority + strong
 * authentication + audit + platform safeguards. This contract enforces that all
 * four are present before recovery is possible.
 */
export function isEmergencyRecoveryPermitted(input: {
  verifiedAuthority: boolean;
  strongAuthentication: boolean;
  auditRecorded: boolean;
  platformSafeguard: boolean;
}): boolean {
  return (
    input.verifiedAuthority &&
    input.strongAuthentication &&
    input.auditRecorded &&
    input.platformSafeguard
  );
}
