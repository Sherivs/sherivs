/**
 * CoreGrid Institutional Onboarding, Administration & Workforce Identity Platform —
 * Workforce role, context and lifecycle domain.
 *
 * Implements `architecture/phase-25-institutional-onboarding-administration-workforce-identity-platform.md`:
 * - Role model (Section P): identity, name, description, purpose, capabilities,
 *   permissions, policies, organizational/location/time/data/workflow scope.
 * - Role examples (Section Q) are examples, not hard-coded roles.
 * - Custom roles (Section R): assembled from authorized capabilities, not arbitrary code.
 * - Role composition (Section S): a user may hold multiple roles.
 * - Role hierarchy (Section T): Base → Derived → Custom with explicit inheritance.
 * - Role conflicts (Section U): conflicting permissions, incompatible duties,
 *   excessive privilege, separation-of-duty violations.
 * - Context model (Section V) + context example (Section W): institution, campus,
 *   department, class, subject, shift, session, project, workspace, time, location.
 * - Permission model (Section AB): granular permissions, least privilege (AC),
 *   just-in-time access (AD) with reason, issuer, duration, scope, audit trail.
 * - Staff lifecycle (Section BD): INVITED → ACTIVATING → ACTIVE → SUSPENDED/ON_LEAVE
 *   → TRANSFERRED → DEACTIVATED → ARCHIVED.
 * - Transfer management (BE), role change (BF) with recalculation + audit.
 * - Organizational structure (BJ), reporting relationships (BK) — reporting never
 *   automatically implies permissions.
 * - Separation of duties (BL): Requester ≠ Approver ≠ Executor; dual control (BM).
 * - Employment status (DJ), temporary staff (DK), expiring access (DL), substitute
 *   teacher (DM), volunteer (DN), contractor (DO), multi-institution staff (DQ-DS).
 *
 * Phase 25 consumes Phase 02 identity/authorization primitives and Phase 06 workspace
 * membership primitives; it never duplicates them (AGENTS.md 65).
 */

/**
 * ECOSYSTEM REFRAME (platform amendment, §0): the domain-flavored vocabulary
 * below (institution, staff, teacher) is legacy R-001 consumption of CoreGrid
 * Phase 25. The authoritative DOMAIN-FREE contracts live in
 * `frontend/src/lib/onboarding/workforce-lifecycle.ts` (organization
 * membership lifecycle, role change, transfer, SoD, offboarding); any org
 * type and any future runtime consume those. This file is superseded for new
 * work and kept only while R-001 UI still references it.
 */

import type { TenantId } from "./tenant-core";
import type { InstitutionId, CampusId, ShiftId } from "./institution-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type WorkforceRoleId = string & { readonly __brand: "WorkforceRoleId" };
export type WorkforceContextId = string & { readonly __brand: "WorkforceContextId" };
export type WorkforceAssignmentId = string & { readonly __brand: "WorkforceAssignmentId" };
export type DepartmentId = string & { readonly __brand: "DepartmentId" };
export type ReportingRelationshipId = string & { readonly __brand: "ReportingRelationshipId" };
export type JustInTimeAccessId = string & { readonly __brand: "JustInTimeAccessId" };

export function workforceRoleId(raw: string): WorkforceRoleId {
  return raw as WorkforceRoleId;
}
export function workforceContextId(raw: string): WorkforceContextId {
  return raw as WorkforceContextId;
}
export function workforceAssignmentId(raw: string): WorkforceAssignmentId {
  return raw as WorkforceAssignmentId;
}
export function departmentId(raw: string): DepartmentId {
  return raw as DepartmentId;
}
export function reportingRelationshipId(raw: string): ReportingRelationshipId {
  return raw as ReportingRelationshipId;
}
export function justInTimeAccessId(raw: string): JustInTimeAccessId {
  return raw as JustInTimeAccessId;
}

/* ─────────────────────────────────────────────────────────────
 * Role model (Section P)
 * ────────────────────────────────────────────────────────────*/

export type RoleKind = "base" | "derived" | "custom";

export const ROLE_KINDS: readonly RoleKind[] = ["base", "derived", "custom"] as const;

export interface WorkforceRole {
  id: WorkforceRoleId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  kind: RoleKind;
  /** Machine-readable stable key, e.g. "teacher", "department_head", "examination_officer". */
  key: string;
  name: string;
  description: string | null;
  purpose: string | null;
  /** Explicit parent role for inheritance (Section T). */
  parentRoleId: WorkforceRoleId | null;
  /** Granular capabilities this role grants (Section R: assembled from authorized capabilities). */
  capabilities: string[];
  /** Granular permission strings, e.g. "student.read", "attendance.record" (Section AB). */
  permissions: string[];
  /** Policy references (Phase 08 security-policy lifecycle). */
  policyRefs: string[];
  /** Organizational scope — e.g. department IDs. Empty = institution-wide. */
  organizationScope: string[];
  /** Location scope — e.g. campus/premises IDs. Empty = institution-wide. */
  locationScope: string[];
  /** Time scope — e.g. shift IDs. Empty = all shifts. */
  timeScope: string[];
  /** Data scope — e.g. class/subject IDs. Empty = institution default. */
  dataScope: string[];
  /** Workflow scope — workflow type keys this role may execute. */
  workflowScope: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkforceRoleInput {
  id: WorkforceRoleId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  kind?: RoleKind;
  key: string;
  name: string;
  description?: string | null;
  purpose?: string | null;
  parentRoleId?: WorkforceRoleId | null;
  capabilities?: string[];
  permissions?: string[];
  policyRefs?: string[];
  organizationScope?: string[];
  locationScope?: string[];
  timeScope?: string[];
  dataScope?: string[];
  workflowScope?: string[];
  now?: string;
}

export type CreateWorkforceRoleResult =
  { ok: true; role: WorkforceRole } | { ok: false; error: string };

export function createWorkforceRole(
  input: CreateWorkforceRoleInput,
  now: string = timeAuthority.now().at,
): CreateWorkforceRoleResult {
  const key = input.key.trim().toLowerCase();
  if (key === "") {
    return { ok: false, error: "Role key is required" };
  }
  if (!input.name.trim()) {
    return { ok: false, error: "Role name is required" };
  }
  if (input.kind === "derived" && !input.parentRoleId) {
    return { ok: false, error: "Derived roles require an explicit parent role (Section T)" };
  }
  if (input.kind === "base" && input.parentRoleId) {
    return { ok: false, error: "Base roles cannot declare a parent (Section T)" };
  }

  const role: WorkforceRole = {
    id: input.id,
    tenantId: input.tenantId,
    institutionId: input.institutionId,
    kind: input.kind ?? "custom",
    key,
    name: input.name.trim(),
    description: input.description ?? null,
    purpose: input.purpose ?? null,
    parentRoleId: input.parentRoleId ?? null,
    capabilities: input.capabilities ?? [],
    permissions: input.permissions ?? [],
    policyRefs: input.policyRefs ?? [],
    organizationScope: input.organizationScope ?? [],
    locationScope: input.locationScope ?? [],
    timeScope: input.timeScope ?? [],
    dataScope: input.dataScope ?? [],
    workflowScope: input.workflowScope ?? [],
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  return { ok: true, role };
}

/* ─────────────────────────────────────────────────────────────
 * Role inheritance (Section T)
 * Resolve the full effective permission/capability set by walking
 * the explicit parent chain. Inheritance must be explicit.
 * ────────────────────────────────────────────────────────────*/

export function resolveRoleInheritance(
  role: WorkforceRole,
  roleById: Map<WorkforceRoleId, WorkforceRole>,
): {
  capabilities: string[];
  permissions: string[];
  policyRefs: string[];
} {
  const capabilities = new Set<string>(role.capabilities);
  const permissions = new Set<string>(role.permissions);
  const policyRefs = new Set<string>(role.policyRefs);

  let current: WorkforceRole | undefined = role;
  const visited = new Set<WorkforceRoleId>();
  while (current && current.parentRoleId && !visited.has(current.id)) {
    visited.add(current.id);
    const parent = roleById.get(current.parentRoleId);
    if (!parent) break;
    for (const c of parent.capabilities) capabilities.add(c);
    for (const p of parent.permissions) permissions.add(p);
    for (const r of parent.policyRefs) policyRefs.add(r);
    current = parent;
  }

  return {
    capabilities: [...capabilities],
    permissions: [...permissions],
    policyRefs: [...policyRefs],
  };
}

/* ─────────────────────────────────────────────────────────────
 * Role conflict detection (Section U)
 * ────────────────────────────────────────────────────────────*/

export type RoleConflictType =
  "conflicting_permissions" | "incompatible_duties" | "excessive_privilege" | "separation_of_duty";

export interface RoleConflict {
  type: RoleConflictType;
  /** Role keys involved. */
  roleKeys: string[];
  detail: string;
}

/**
 * Detect conflicts for a set of concurrently-held roles (Section U).
 * - Conflicting permissions: the same resource+action granted and explicitly
 *   denied across roles (denials are expressed via `!permission`).
 * - Separation of duty: two roles that are declared mutually exclusive.
 * - Excessive privilege: combined permission breadth crosses a configured cap.
 */
export function detectRoleConflicts(
  roles: WorkforceRole[],
  options?: {
    /** Role keys considered mutually exclusive (SoD, Section BL). */
    separationOfDutyPairs?: Array<[string, string]>;
    /** Max distinct permissions before "excessive privilege" is flagged. */
    maxPermissions?: number;
  },
): RoleConflict[] {
  const conflicts: RoleConflict[] = [];

  const denied = new Set<string>();
  const granted = new Set<string>();
  for (const role of roles) {
    for (const perm of role.permissions) {
      if (perm.startsWith("!")) {
        denied.add(perm.slice(1));
      } else {
        granted.add(perm);
      }
    }
  }
  for (const d of denied) {
    if (granted.has(d)) {
      conflicts.push({
        type: "conflicting_permissions",
        roleKeys: roles.map((r) => r.key),
        detail: `Permission '${d}' is both granted and denied`,
      });
    }
  }

  const sodPairs = options?.separationOfDutyPairs ?? [];
  const roleKeys = new Set(roles.map((r) => r.key));
  for (const [a, b] of sodPairs) {
    if (roleKeys.has(a) && roleKeys.has(b)) {
      conflicts.push({
        type: "separation_of_duty",
        roleKeys: [a, b],
        detail: `Roles '${a}' and '${b}' violate separation of duty (Requester ≠ Approver ≠ Executor)`,
      });
    }
  }

  const maxPermissions = options?.maxPermissions ?? 40;
  if (granted.size > maxPermissions) {
    conflicts.push({
      type: "excessive_privilege",
      roleKeys: roles.map((r) => r.key),
      detail: `Combined permission breadth (${granted.size}) exceeds cap (${maxPermissions})`,
    });
  }

  return conflicts;
}

/* ─────────────────────────────────────────────────────────────
 * Context model (Sections V, W)
 * ────────────────────────────────────────────────────────────*/

export interface WorkforceContext {
  id: WorkforceContextId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  campusId: CampusId | null;
  departmentId: DepartmentId | null;
  /** Class references (Phase 04 ClassId values). */
  classRefs: string[];
  /** Subject references (Phase 04 SubjectId values). */
  subjectRefs: string[];
  shiftId: ShiftId | null;
  /** Academic session reference. */
  academicSessionRef: string | null;
  /** Project reference. */
  projectRef: string | null;
  /** Workspace reference (Phase 06 workspace). */
  workspaceRef: string | null;
  /** Geographic scope (location hierarchy refs). */
  locationRefs: string[];
  /** Time window during which this context applies. */
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
}

export interface CreateWorkforceContextInput {
  id: WorkforceContextId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  campusId?: CampusId | null;
  departmentId?: DepartmentId | null;
  classRefs?: string[];
  subjectRefs?: string[];
  shiftId?: ShiftId | null;
  academicSessionRef?: string | null;
  projectRef?: string | null;
  workspaceRef?: string | null;
  locationRefs?: string[];
  effectiveFrom?: string;
  effectiveTo?: string | null;
}

export function createWorkforceContext(
  input: CreateWorkforceContextInput,
  now: string = timeAuthority.now().at,
): WorkforceContext {
  return {
    id: input.id,
    tenantId: input.tenantId,
    institutionId: input.institutionId,
    campusId: input.campusId ?? null,
    departmentId: input.departmentId ?? null,
    classRefs: input.classRefs ?? [],
    subjectRefs: input.subjectRefs ?? [],
    shiftId: input.shiftId ?? null,
    academicSessionRef: input.academicSessionRef ?? null,
    projectRef: input.projectRef ?? null,
    workspaceRef: input.workspaceRef ?? null,
    locationRefs: input.locationRefs ?? [],
    effectiveFrom: input.effectiveFrom ?? now,
    effectiveTo: input.effectiveTo ?? null,
    isActive: true,
  };
}

/** Is the context currently effective for the given instant? */
export function isContextEffective(
  ctx: WorkforceContext,
  at: string = timeAuthority.now().at,
): boolean {
  if (!ctx.isActive) return false;
  if (at < ctx.effectiveFrom) return false;
  if (ctx.effectiveTo !== null && at > ctx.effectiveTo) return false;
  return true;
}

/* ─────────────────────────────────────────────────────────────
 * Workforce assignment (Section S: role composition)
 * A staff member may hold multiple role × context assignments.
 * ────────────────────────────────────────────────────────────*/

export interface WorkforceAssignment {
  id: WorkforceAssignmentId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  /** Phase 02 identity reference. */
  identityRef: string;
  roleId: WorkforceRoleId;
  contextId: WorkforceContextId;
  /** If set, the assignment expires (temporary staff, Sections DK-DO). */
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
}

export function createWorkforceAssignment(input: {
  id: WorkforceAssignmentId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  identityRef: string;
  roleId: WorkforceRoleId;
  contextId: WorkforceContextId;
  expiresAt?: string | null;
  now?: string;
}): { ok: true; assignment: WorkforceAssignment } | { ok: false; error: string } {
  if (input.expiresAt && input.expiresAt <= (input.now ?? timeAuthority.now().at)) {
    return { ok: false, error: "Assignment expiry must be in the future" };
  }
  return {
    ok: true,
    assignment: {
      id: input.id,
      tenantId: input.tenantId,
      institutionId: input.institutionId,
      identityRef: input.identityRef,
      roleId: input.roleId,
      contextId: input.contextId,
      expiresAt: input.expiresAt ?? null,
      isActive: true,
      createdAt: input.now ?? timeAuthority.now().at,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Just-in-time access (Section AD)
 * Temporary privileges with reason, issuer, duration, scope, audit trail.
 * ────────────────────────────────────────────────────────────*/

export interface JustInTimeAccess {
  id: JustInTimeAccessId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  /** Identity receiving the temporary privilege. */
  subjectRef: string;
  /** Identity issuing the privilege. */
  issuerRef: string;
  /** Why the temporary privilege is being granted. */
  reason: string;
  /** Privilege/scope being granted. */
  scope: string[];
  grantedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export function grantJustInTimeAccess(input: {
  id: JustInTimeAccessId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  subjectRef: string;
  issuerRef: string;
  reason: string;
  scope: string[];
  durationMinutes: number;
  now?: string;
}): { ok: true; access: JustInTimeAccess } | { ok: false; error: string } {
  const now = input.now ?? timeAuthority.now().at;
  if (!input.reason.trim()) {
    return { ok: false, error: "Just-in-time access requires a reason (Section AD)" };
  }
  if (input.scope.length === 0) {
    return { ok: false, error: "Just-in-time access requires a scope (Section AD)" };
  }
  if (input.durationMinutes <= 0 || input.durationMinutes > 1440) {
    return { ok: false, error: "Duration must be between 1 and 1440 minutes" };
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
      subjectRef: input.subjectRef,
      issuerRef: input.issuerRef,
      reason: input.reason.trim(),
      scope: input.scope,
      grantedAt: now,
      expiresAt,
      revokedAt: null,
    },
  };
}

export function revokeJustInTimeAccess(
  access: JustInTimeAccess,
  now: string = timeAuthority.now().at,
): JustInTimeAccess {
  return { ...access, revokedAt: now };
}

export function isJustInTimeAccessActive(
  access: JustInTimeAccess,
  now: string = timeAuthority.now().at,
): boolean {
  if (access.revokedAt !== null) return false;
  return now <= access.expiresAt;
}

/* ─────────────────────────────────────────────────────────────
 * Staff lifecycle (Section BD)
 * INVITED → ACTIVATING → ACTIVE → SUSPENDED/ON_LEAVE → TRANSFERRED
 *   → DEACTIVATED → ARCHIVED
 * ────────────────────────────────────────────────────────────*/

export type StaffLifecycleState =
  | "INVITED"
  | "ACTIVATING"
  | "ACTIVE"
  | "SUSPENDED"
  | "ON_LEAVE"
  | "TRANSFERRED"
  | "DEACTIVATED"
  | "ARCHIVED";

export const STAFF_LIFECYCLE_STATES: readonly StaffLifecycleState[] = [
  "INVITED",
  "ACTIVATING",
  "ACTIVE",
  "SUSPENDED",
  "ON_LEAVE",
  "TRANSFERRED",
  "DEACTIVATED",
  "ARCHIVED",
] as const;

const STAFF_LIFECYCLE_TRANSITIONS: Readonly<
  Record<StaffLifecycleState, readonly StaffLifecycleState[]>
> = {
  INVITED: ["ACTIVATING", "DEACTIVATED"],
  ACTIVATING: ["ACTIVE", "SUSPENDED", "DEACTIVATED"],
  ACTIVE: ["SUSPENDED", "ON_LEAVE", "TRANSFERRED", "DEACTIVATED"],
  SUSPENDED: ["ACTIVE", "DEACTIVATED"],
  ON_LEAVE: ["ACTIVE", "SUSPENDED", "DEACTIVATED"],
  TRANSFERRED: ["ACTIVE", "DEACTIVATED"],
  DEACTIVATED: ["ARCHIVED"],
  ARCHIVED: [],
} as const;

export function canTransitionStaffLifecycle(
  from: StaffLifecycleState,
  to: StaffLifecycleState,
): boolean {
  return STAFF_LIFECYCLE_TRANSITIONS[from].includes(to);
}

export interface StaffLifecycleRecord {
  identityRef: string;
  tenantId: TenantId;
  institutionId: InstitutionId;
  state: StaffLifecycleState;
  updatedAt: string;
}

export function transitionStaffLifecycle(
  record: StaffLifecycleRecord,
  to: StaffLifecycleState,
  actorRef: string,
  reason: string,
  now: string = timeAuthority.now().at,
): { ok: true; record: StaffLifecycleRecord } | { ok: false; error: string } {
  if (!canTransitionStaffLifecycle(record.state, to)) {
    return { ok: false, error: `Invalid staff lifecycle transition: ${record.state} -> ${to}` };
  }
  if (to === "DEACTIVATED" && !reason.trim()) {
    return { ok: false, error: "Deactivation requires a reason (Section BH)" };
  }
  // Role change (BF) and transfer (BE) must trigger recalculation — the caller
  // consumes this record to recompose the workspace/permissions. This domain layer
  // returns the changed record; recalculation is orchestrated by the admin layer.
  return { ok: true, record: { ...record, state: to, updatedAt: now } };
}

/* ─────────────────────────────────────────────────────────────
 * Transfer management (Section BE)
 * Staff may move department, campus, role, shift, institution, school group.
 * Permission/workspace recalculation is triggered automatically.
 * ────────────────────────────────────────────────────────────*/

export type TransferKind =
  "department" | "campus" | "role" | "shift" | "institution" | "school_group";

export interface StaffTransfer {
  id: WorkforceAssignmentId;
  tenantId: TenantId;
  identityRef: string;
  kind: TransferKind;
  fromRef: string;
  toRef: string;
  performedBy: string;
  /** Flags whether permission/workspace recalculation was triggered. */
  recalculationRequired: boolean;
  recalculationStatus: "pending" | "completed" | "failed" | null;
  occurredAt: string;
}

export function createStaffTransfer(input: {
  id: WorkforceAssignmentId;
  tenantId: TenantId;
  identityRef: string;
  kind: TransferKind;
  fromRef: string;
  toRef: string;
  performedBy: string;
  now?: string;
}): StaffTransfer {
  return {
    id: input.id,
    tenantId: input.tenantId,
    identityRef: input.identityRef,
    kind: input.kind,
    fromRef: input.fromRef,
    toRef: input.toRef,
    performedBy: input.performedBy,
    recalculationRequired: true,
    recalculationStatus: "pending",
    occurredAt: input.now ?? timeAuthority.now().at,
  };
}

/** Mark a transfer's recalculation as complete (Section BE: automatic recalculation). */
export function completeStaffTransferRecalculation(transfer: StaffTransfer): StaffTransfer {
  return { ...transfer, recalculationStatus: "completed" };
}

/* ─────────────────────────────────────────────────────────────
 * Organizational structure (Section BJ) + reporting (BK)
 * Reporting relationships never automatically imply permissions.
 * ────────────────────────────────────────────────────────────*/

export interface Department {
  id: DepartmentId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  name: string;
  /** Optional parent department (faculties → departments → units). */
  parentDepartmentId: DepartmentId | null;
  headIdentityRef: string | null;
  isActive: boolean;
}

export type ReportingRelationshipType =
  "manager" | "supervisor" | "department_head" | "principal" | "director" | "hr_authority";

export const REPORTING_RELATIONSHIP_TYPES: readonly ReportingRelationshipType[] = [
  "manager",
  "supervisor",
  "department_head",
  "principal",
  "director",
  "hr_authority",
] as const;

export interface ReportingRelationship {
  id: ReportingRelationshipId;
  tenantId: TenantId;
  /** Identity that reports. */
  reporterRef: string;
  /** Identity that is reported to. */
  managerRef: string;
  type: ReportingRelationshipType;
  isActive: boolean;
  createdAt: string;
}

/**
 * Reporting relationships are structural only. They must never automatically
 * imply permissions (Section BK).
 */
export function reportingRelationshipImpliesPermission(): boolean {
  return false;
}

/* ─────────────────────────────────────────────────────────────
 * Employment status (Section DJ)
 * ────────────────────────────────────────────────────────────*/

export type EmploymentStatus =
  | "applicant"
  | "probation"
  | "active"
  | "leave"
  | "suspended"
  | "transferred"
  | "resigned"
  | "terminated"
  | "retired"
  | "archived";

export const EMPLOYMENT_STATUSES: readonly EmploymentStatus[] = [
  "applicant",
  "probation",
  "active",
  "leave",
  "suspended",
  "transferred",
  "resigned",
  "terminated",
  "retired",
  "archived",
] as const;

export interface StaffProfile {
  identityRef: string;
  tenantId: TenantId;
  institutionId: InstitutionId;
  employmentStatus: EmploymentStatus;
  /** Qualifications (display in authorized contexts only). */
  qualificationRefs: string[];
  /** Temporary staff category, if any (Section DK). */
  temporaryCategory:
    "teacher" | "contractor" | "substitute" | "consultant" | "volunteer" | "intern" | null;
  /** Contract expiry for temporary staff (Section DL: expiring access). */
  contractExpiresAt: string | null;
  onboardingRef: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Temporary staff (Section DK) get explicit expiration. A temporary profile with
 * an expired contract must never be considered active for authorization.
 */
export function isStaffProfileActive(
  profile: StaffProfile,
  now: string = timeAuthority.now().at,
): boolean {
  if (profile.employmentStatus !== "active" && profile.employmentStatus !== "probation")
    return false;
  if (profile.contractExpiresAt !== null && profile.contractExpiresAt <= now) return false;
  return true;
}
