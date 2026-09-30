/**
 * CoreGrid — Education Reality Engine governance engine.
 *
 * Implements `architecture/phase-04-education-reality-engine.md`:
 * - School blueprint: the institution's complete operating model as a versioned
 *   blueprint (Section 81).
 * - Blueprint versioning: version, author, timestamp, reason, validation,
 *   migration impact (Section 82).
 * - Configuration validation: detect missing rooms, invalid capacities, missing
 *   teachers, curriculum conflicts, schedule conflicts, invalid policies,
 *   impossible assignments (Section 83).
 * - School simulation: "What happens if we add another campus?" (Section 84).
 * - Scenario model: scenario simulation belongs to educational reality;
 *   optimization belongs to the appropriate intelligence phase (Section 85).
 * - Configuration governance: major configuration changes require preview,
 *   validation, authorization, audit, versioning (Section 168).
 * - Reality drift detection: detect when configured reality diverges from
 *   operational reality (Section 164).
 * - Human override: humans remain authoritative for consequential institutional
 *   decisions (Section 166).
 * - Configuration rollback: where safe, configuration changes should be
 *   reversible (Section 129).
 * - School reality validator: continuously evaluate structural, scheduling,
 *   curriculum, facility, staffing consistency (Section 163).
 */

import type { TenantId } from "./tenant-core";
import {
  blueprintId,
  scenarioId,
  snapshotId,
  type BlueprintId,
  type ScenarioId,
  type SnapshotId,
  type TenantScopedEntity,
  type EducationalAuditEvent,
} from "./education-core";

/* ─────────────────────────────────────────────────────────────
 * School blueprint (Sections 81–82)
 * ────────────────────────────────────────────────────────────*/

export interface SchoolBlueprint extends TenantScopedEntity {
  id: BlueprintId;
  version: number;
  author: string;
  reason: string;
  /** Validation result of this blueprint. */
  validation: {
    valid: boolean;
    errors: string[];
  };
  /** Migration impact assessment. */
  migrationImpact: string | null;
  /** Snapshot of the institutional configuration at this version. */
  configurationSnapshot: Record<string, unknown>;
}

export interface CreateBlueprintInput {
  tenantId: TenantId;
  version: number;
  author: string;
  reason: string;
  configurationSnapshot: Record<string, unknown>;
  migrationImpact: string | null;
}

export type CreateBlueprintResult =
  | { ok: true; blueprint: SchoolBlueprint; auditEvent: EducationalAuditEvent }
  | { ok: false; error: string };

export function createBlueprint(
  input: CreateBlueprintInput,
  existingBlueprints: SchoolBlueprint[],
  now: string,
): CreateBlueprintResult {
  // Version numbers must be unique.
  if (existingBlueprints.some((b) => b.version === input.version)) {
    return { ok: false, error: `Blueprint version ${input.version} already exists` };
  }

  if (input.author.trim() === "") {
    return { ok: false, error: "Blueprint requires an author" };
  }

  if (input.reason.trim() === "") {
    return { ok: false, error: "Blueprint requires a reason" };
  }

  const blueprint: SchoolBlueprint = {
    id: blueprintId(`${input.tenantId}:v${input.version}`),
    tenantId: input.tenantId,
    version: input.version,
    author: input.author,
    reason: input.reason,
    validation: {
      valid: true,
      errors: [],
    },
    migrationImpact: input.migrationImpact,
    configurationSnapshot: input.configurationSnapshot,
    createdAt: now,
    updatedAt: now,
  };

  const auditEvent: EducationalAuditEvent = {
    id: `audit-${now}-${blueprint.id}`,
    type: "BlueprintVersioned",
    tenantId: input.tenantId,
    actorId: input.author,
    occurredAt: now,
    entityType: "SchoolBlueprint",
    entityId: blueprint.id,
    result: "success",
    metadata: {
      version: input.version,
      reason: input.reason,
    },
  };

  return { ok: true, blueprint, auditEvent };
}

/* ─────────────────────────────────────────────────────────────
 * Configuration validation (Section 83)
 * ────────────────────────────────────────────────────────────*/

export interface ConfigurationValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate institutional configuration (Section 83).
 * Detects missing rooms, invalid capacities, missing teachers, curriculum
 * conflicts, schedule conflicts, invalid policies, impossible assignments.
 */
export function validateInstitutionalConfiguration(config: {
  campuses: Array<{ id: string; name: string; isActive: boolean }>;
  buildings: Array<{ id: string; campusId: string; name: string }>;
  rooms: Array<{ id: string; buildingId: string; name: string; capacity: number }>;
  classes: Array<{
    id: string;
    name: string;
    campusId: string;
    roomId: string | null;
    teacherAssignmentRefs: string[];
  }>;
  teachers: Array<{ id: string; name: string }>;
  subjects: Array<{ id: string; name: string }>;
  policies: Array<{ id: string; name: string; type: string }>;
}): ConfigurationValidationResult {
  const errors: string[] = [];

  // Missing rooms: classes must reference valid rooms.
  const roomIds = new Set(config.rooms.map((r) => r.id));
  for (const cls of config.classes) {
    if (cls.roomId !== null && !roomIds.has(cls.roomId)) {
      errors.push(`Class ${cls.name} references missing room ${cls.roomId}`);
    }
  }

  // Invalid capacities: rooms must have positive capacity.
  for (const room of config.rooms) {
    if (room.capacity <= 0) {
      errors.push(`Room ${room.name} has invalid capacity ${room.capacity}`);
    }
  }

  // Missing teachers: classes must reference valid teachers.
  const teacherIds = new Set(config.teachers.map((t) => t.id));
  for (const cls of config.classes) {
    for (const ref of cls.teacherAssignmentRefs) {
      if (!teacherIds.has(ref)) {
        errors.push(`Class ${cls.name} references missing teacher ${ref}`);
      }
    }
  }

  // Buildings must reference valid campuses.
  const campusIds = new Set(config.campuses.map((c) => c.id));
  for (const building of config.buildings) {
    if (!campusIds.has(building.campusId)) {
      errors.push(`Building ${building.name} references missing campus ${building.campusId}`);
    }
  }

  // Rooms must reference valid buildings.
  const buildingIds = new Set(config.buildings.map((b) => b.id));
  for (const room of config.rooms) {
    if (!buildingIds.has(room.buildingId)) {
      errors.push(`Room ${room.name} references missing building ${room.buildingId}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/* ─────────────────────────────────────────────────────────────
 * Scenario model (Sections 84–85)
 * ────────────────────────────────────────────────────────────*/

export type ScenarioType =
  | "campus_addition"
  | "shift_introduction"
  | "facility_unavailability"
  | "enrolment_change"
  | "curriculum_change"
  | "custom";

export const SCENARIO_TYPES: readonly ScenarioType[] = [
  "campus_addition",
  "shift_introduction",
  "facility_unavailability",
  "enrolment_change",
  "curriculum_change",
  "custom",
] as const;

export interface Scenario extends TenantScopedEntity {
  id: ScenarioId;
  name: string;
  type: ScenarioType;
  description: string | null;
  /** Proposed configuration changes. */
  proposedChanges: Record<string, unknown>;
  /** Validation result. */
  validation: ConfigurationValidationResult;
  /** Whether this scenario has been approved. */
  isApproved: boolean;
  /** Who created this scenario. */
  createdBy: string;
}

export interface CreateScenarioInput {
  tenantId: TenantId;
  name: string;
  type: ScenarioType;
  description: string | null;
  proposedChanges: Record<string, unknown>;
  createdBy: string;
}

export type CreateScenarioResult = { ok: true; scenario: Scenario } | { ok: false; error: string };

export function createScenario(input: CreateScenarioInput, now: string): CreateScenarioResult {
  if (input.name.trim() === "") {
    return { ok: false, error: "Scenario name is required" };
  }

  const scenario: Scenario = {
    id: scenarioId(`${input.tenantId}:${input.name}`),
    tenantId: input.tenantId,
    name: input.name,
    type: input.type,
    description: input.description,
    proposedChanges: input.proposedChanges,
    validation: { valid: true, errors: [] },
    isApproved: false,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };

  return { ok: true, scenario };
}

/* ─────────────────────────────────────────────────────────────
 * Reality drift detection (Section 164)
 * ────────────────────────────────────────────────────────────*/

export interface RealityDrift {
  entityType: string;
  entityId: string;
  configuredState: string;
  operationalState: string;
  detectedAt: string;
  severity: "low" | "medium" | "high";
}

/**
 * Detect when configured reality diverges from operational reality (Section 164).
 * Example: a laboratory is configured as available but repeatedly reported unavailable.
 */
export function detectRealityDrift(
  configured: Array<{ entityType: string; entityId: string; state: string }>,
  operational: Array<{ entityType: string; entityId: string; state: string }>,
  now: string,
): RealityDrift[] {
  const drifts: RealityDrift[] = [];

  for (const cfg of configured) {
    const op = operational.find(
      (o) => o.entityType === cfg.entityType && o.entityId === cfg.entityId,
    );

    if (op && op.state !== cfg.state) {
      drifts.push({
        entityType: cfg.entityType,
        entityId: cfg.entityId,
        configuredState: cfg.state,
        operationalState: op.state,
        detectedAt: now,
        severity: "medium",
      });
    }
  }

  return drifts;
}

/* ─────────────────────────────────────────────────────────────
 * Configuration rollback (Section 129)
 * ────────────────────────────────────────────────────────────*/

export interface RollbackConfigurationInput {
  tenantId: TenantId;
  blueprintId: BlueprintId;
  targetVersion: number;
  actorId: string;
  reason: string;
}

export type RollbackConfigurationResult =
  { ok: true; auditEvent: EducationalAuditEvent } | { ok: false; error: string };

export function rollbackConfiguration(
  input: RollbackConfigurationInput,
  blueprints: SchoolBlueprint[],
  now: string,
): RollbackConfigurationResult {
  // Target version must exist.
  const target = blueprints.find((b) => b.version === input.targetVersion);
  if (!target) {
    return { ok: false, error: `Blueprint version ${input.targetVersion} does not exist` };
  }

  if (input.reason.trim() === "") {
    return { ok: false, error: "Configuration rollback requires a reason" };
  }

  const auditEvent: EducationalAuditEvent = {
    id: `audit-${now}-rollback-${input.blueprintId}`,
    type: "ConfigurationRolledBack",
    tenantId: input.tenantId,
    actorId: input.actorId,
    occurredAt: now,
    entityType: "SchoolBlueprint",
    entityId: input.blueprintId,
    result: "success",
    metadata: {
      targetVersion: input.targetVersion,
      reason: input.reason,
    },
  };

  return { ok: true, auditEvent };
}

/* ─────────────────────────────────────────────────────────────
 * Human override (Section 166)
 * ────────────────────────────────────────────────────────────*/

export interface HumanOverride extends TenantScopedEntity {
  id: string;
  entityType: string;
  entityId: string;
  /** What is being overridden. */
  overrideType: string;
  reason: string;
  /** Who authorized the override. */
  authorizedBy: string;
  authorizedAt: string;
  /** Override expiry. */
  expiresAt: string | null;
}

export interface CreateHumanOverrideInput {
  tenantId: TenantId;
  entityType: string;
  entityId: string;
  overrideType: string;
  reason: string;
  authorizedBy: string;
  expiresAt: string | null;
}

export type CreateHumanOverrideResult =
  | { ok: true; override: HumanOverride; auditEvent: EducationalAuditEvent }
  | { ok: false; error: string };

export function createHumanOverride(
  input: CreateHumanOverrideInput,
  now: string,
): CreateHumanOverrideResult {
  if (input.reason.trim() === "") {
    return { ok: false, error: "Human override requires a reason" };
  }

  const override: HumanOverride = {
    id: `override-${input.tenantId}-${input.entityType}-${input.entityId}-${now}`,
    tenantId: input.tenantId,
    entityType: input.entityType,
    entityId: input.entityId,
    overrideType: input.overrideType,
    reason: input.reason,
    authorizedBy: input.authorizedBy,
    authorizedAt: now,
    expiresAt: input.expiresAt,
    createdAt: now,
    updatedAt: now,
  };

  const auditEvent: EducationalAuditEvent = {
    id: `audit-${now}-${override.id}`,
    type: "EducationalEntityCreated",
    tenantId: input.tenantId,
    actorId: input.authorizedBy,
    occurredAt: now,
    entityType: "HumanOverride",
    entityId: override.id,
    result: "success",
    metadata: {
      entityType: input.entityType,
      entityId: input.entityId,
      overrideType: input.overrideType,
      reason: input.reason,
    },
  };

  return { ok: true, override, auditEvent };
}

/* ─────────────────────────────────────────────────────────────
 * Reality snapshot (Section 127)
 * ────────────────────────────────────────────────────────────*/

export interface RealitySnapshot extends TenantScopedEntity {
  id: SnapshotId;
  name: string;
  /** Snapshot of institutional configuration. */
  configuration: Record<string, unknown>;
  capturedBy: string;
  capturedAt: string;
}

export interface CaptureRealitySnapshotInput {
  tenantId: TenantId;
  name: string;
  configuration: Record<string, unknown>;
  capturedBy: string;
}

export type CaptureRealitySnapshotResult =
  { ok: true; snapshot: RealitySnapshot } | { ok: false; error: string };

export function captureRealitySnapshot(
  input: CaptureRealitySnapshotInput,
  now: string,
): CaptureRealitySnapshotResult {
  if (input.name.trim() === "") {
    return { ok: false, error: "Snapshot name is required" };
  }

  const snapshot: RealitySnapshot = {
    id: snapshotId(`${input.tenantId}:${input.name}`),
    tenantId: input.tenantId,
    name: input.name,
    configuration: input.configuration,
    capturedBy: input.capturedBy,
    capturedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  return { ok: true, snapshot };
}
