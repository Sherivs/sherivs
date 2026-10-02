/**
 * CoreGrid Tenant Lifecycle Engine (G3).
 *
 * Implements `architecture/phase-03-multi-tenancy.md`:
 * - Controls tenant state transitions (H2).
 * - Every transition is attributable and auditable.
 * - Suspension preserves data, audit history, and recoverability (K2).
 * - Termination is deliberate and multi-step (K5).
 * - Migration is reversible until a defined commit point (Invariant 12).
 */

import type {
  CoreGridTenant,
  TenantEvent,
  TenantEventType,
  TenantId,
  TenantStatus,
} from "./tenant-core";
import { canTransitionTenant } from "./tenant-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Lifecycle transition request
 * ────────────────────────────────────────────────────────────*/

export interface TenantLifecycleTransitionRequest {
  tenant: CoreGridTenant;
  from: TenantStatus;
  to: TenantStatus;
  /** Who is performing the transition (attributable). */
  actorId: string | null;
  /** Why the transition is happening. */
  reason: string;
  /** Optional policy reference. */
  policyRef: string | null;
}

export type TenantLifecycleTransitionResult =
  { ok: true; tenant: CoreGridTenant; event: TenantEvent } | { ok: false; error: string };

/* ─────────────────────────────────────────────────────────────
 * Lifecycle engine
 * ────────────────────────────────────────────────────────────*/

export function transitionTenantLifecycle(
  req: TenantLifecycleTransitionRequest,
  now: string = timeAuthority.now().at,
): TenantLifecycleTransitionResult {
  // 1. Validate the transition is allowed by the state machine.
  if (!canTransitionTenant(req.from, req.to)) {
    return {
      ok: false,
      error: `Invalid tenant lifecycle transition: ${req.from} -> ${req.to}`,
    };
  }

  // 2. Validate the tenant's current state matches the request.
  if (req.tenant.status !== req.from) {
    return {
      ok: false,
      error: `Tenant status is '${req.tenant.status}', expected '${req.from}'`,
    };
  }

  // 3. Termination requires a reason (deliberate multi-step process).
  if (req.to === "TERMINATING" && !req.reason.trim()) {
    return {
      ok: false,
      error: "Tenant termination requires a reason",
    };
  }

  // 4. Apply the transition.
  const updated: CoreGridTenant = {
    ...req.tenant,
    status: req.to,
    updatedAt: now,
  };

  const event: TenantEvent = {
    id: crypto.randomUUID(),
    type: tenantEventType(req.to),
    tenantId: req.tenant.id,
    actorId: req.actorId,
    occurredAt: now,
    result: "success",
    metadata: {
      from: req.from,
      to: req.to,
      reason: req.reason,
      policyRef: req.policyRef,
    },
  };

  return { ok: true, tenant: updated, event };
}

function tenantEventType(to: TenantStatus): TenantEventType {
  switch (to) {
    case "PROVISIONING":
      return "TenantCreated";
    case "ACTIVE":
      return "TenantActivated";
    case "SUSPENDED":
      return "TenantSuspended";
    case "MIGRATING":
      return "TenantMigrated";
    case "ARCHIVED":
      return "TenantArchived";
    case "TERMINATING":
    case "TERMINATED":
      return "TenantTerminated";
    default:
      return "TenantCreated";
  }
}

/* ─────────────────────────────────────────────────────────────
 * Convenience helpers
 * ────────────────────────────────────────────────────────────*/

export function isTenantActive(tenant: Pick<CoreGridTenant, "status">): boolean {
  return tenant.status === "ACTIVE";
}

export function isTenantSuspended(tenant: Pick<CoreGridTenant, "status">): boolean {
  return tenant.status === "SUSPENDED";
}

export function isTenantTerminated(tenant: Pick<CoreGridTenant, "status">): boolean {
  return tenant.status === "TERMINATED" || tenant.status === "TERMINATING";
}

export function isTenantMigrating(tenant: Pick<CoreGridTenant, "status">): boolean {
  return tenant.status === "MIGRATING";
}

/* ─────────────────────────────────────────────────────────────
 * Tenant provisioning pipeline (K1)
 * ────────────────────────────────────────────────────────────*/

export type ProvisioningStage =
  | "request"
  | "validation"
  | "approval"
  | "registration"
  | "infrastructure"
  | "configuration"
  | "security_initialization"
  | "validation_final"
  | "activation";

export const PROVISIONING_PIPELINE: readonly ProvisioningStage[] = [
  "request",
  "validation",
  "approval",
  "registration",
  "infrastructure",
  "configuration",
  "security_initialization",
  "validation_final",
  "activation",
] as const;

export interface ProvisioningState {
  tenantId: TenantId;
  stage: ProvisioningStage;
  completedStages: ProvisioningStage[];
  startedAt: string;
  updatedAt: string;
}

export function advanceProvisioning(
  state: ProvisioningState,
  now: string = timeAuthority.now().at,
): ProvisioningState {
  const currentIndex = PROVISIONING_PIPELINE.indexOf(state.stage);
  const nextStage = PROVISIONING_PIPELINE[currentIndex + 1];

  if (!nextStage) {
    return state; // already at activation
  }

  return {
    ...state,
    stage: nextStage,
    completedStages: [...state.completedStages, state.stage],
    updatedAt: now,
  };
}

export function isProvisioningComplete(state: ProvisioningState): boolean {
  return state.stage === "activation";
}

/* ─────────────────────────────────────────────────────────────
 * Tenant migration pipeline (K3)
 * ────────────────────────────────────────────────────────────*/

export type MigrationStage =
  "PLANNED" | "VALIDATING" | "SNAPSHOTTING" | "COPYING" | "VERIFYING" | "SWITCHING" | "COMPLETED";

export const MIGRATION_PIPELINE: readonly MigrationStage[] = [
  "PLANNED",
  "VALIDATING",
  "SNAPSHOTTING",
  "COPYING",
  "VERIFYING",
  "SWITCHING",
  "COMPLETED",
] as const;

export interface MigrationState {
  migrationId: string;
  tenantId: TenantId;
  source: string;
  destination: string;
  stage: MigrationStage;
  /** Rollback criteria must be defined before execution (K4). */
  rollbackCriteria: string[];
  startedAt: string;
  updatedAt: string;
}

export function advanceMigration(
  state: MigrationState,
  now: string = timeAuthority.now().at,
): MigrationState {
  const currentIndex = MIGRATION_PIPELINE.indexOf(state.stage);
  const nextStage = MIGRATION_PIPELINE[currentIndex + 1];

  if (!nextStage) {
    return state; // already completed
  }

  return {
    ...state,
    stage: nextStage,
    updatedAt: now,
  };
}

export function isMigrationComplete(state: MigrationState): boolean {
  return state.stage === "COMPLETED";
}

/** Invariant 12: Migration is reversible until a defined commit point. */
export function isMigrationReversible(state: MigrationState): boolean {
  return state.stage !== "COMPLETED";
}
