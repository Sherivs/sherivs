/**
 * CoreGrid — Education Reality Engine facilities engine.
 *
 * Implements `architecture/phase-04-education-reality-engine.md`:
 * - Facilities: classrooms, laboratories, workshops, libraries, offices, halls,
 *   dormitories, clinics, cafeterias, kitchens, farms, sports fields, prayer
 *   facilities, community centres (Section 59).
 * - Facility assignment: a facility may serve multiple programmes, classes,
 *   institutions when authorized (Section 92).
 * - Facility availability: a facility marked unavailable cannot be scheduled
 *   without an explicit override (Section 170).
 * - Equipment and maintenance (Sections 64, 76).
 * - Shared facilities (Section 92).
 * - Phase 04 defines educational use of facilities; Phase 16 represents
 *   physical digital twins (Section 189).
 */

import type { TenantId } from "./tenant-core";
import {
  facilityId,
  type FacilityId,
  type CampusId,
  type TenantScopedEntity,
  type EducationalAuditEvent,
} from "./education-core";

/* ─────────────────────────────────────────────────────────────
 * Facility availability (Section 74)
 * ────────────────────────────────────────────────────────────*/

export type FacilityAvailabilityState = "available" | "unavailable" | "restricted" | "maintenance";

export const FACILITY_AVAILABILITY_STATES: readonly FacilityAvailabilityState[] = [
  "available",
  "unavailable",
  "restricted",
  "maintenance",
] as const;

export interface FacilityAvailability extends TenantScopedEntity {
  id: string;
  facilityId: FacilityId;
  state: FacilityAvailabilityState;
  /** Reason for unavailability. */
  reason: string | null;
  /** Effective period. */
  effectiveFrom: string;
  effectiveUntil: string | null;
  /** Whether an explicit override is required to schedule. */
  requiresOverride: boolean;
}

/* ─────────────────────────────────────────────────────────────
 * Facility assignment (Section 92)
 * ────────────────────────────────────────────────────────────*/

export interface FacilityAssignment extends TenantScopedEntity {
  id: string;
  facilityId: FacilityId;
  /** Assigned entity type (programme, class, institution). */
  assignedToType: "programme" | "class" | "institution";
  assignedToId: string;
  /** Whether this assignment is authorized. */
  authorized: boolean;
  validFrom: string;
  validUntil: string | null;
}

/* ─────────────────────────────────────────────────────────────
 * Equipment (Section 64)
 * ────────────────────────────────────────────────────────────*/

export interface Equipment extends TenantScopedEntity {
  id: string;
  name: string;
  type: string;
  facilityId: FacilityId | null;
  /** Maintenance state (Section 76). */
  maintenanceState: "operational" | "needs_maintenance" | "out_of_service";
  /** Whether this equipment is currently available. */
  isAvailable: boolean;
}

/* ─────────────────────────────────────────────────────────────
 * Facility operations
 * ────────────────────────────────────────────────────────────*/

export interface CreateFacilityInput {
  tenantId: TenantId;
  campusId: CampusId;
  name: string;
  type: string;
  capacity: number | null;
  capabilities: string[];
  equipmentRefs: string[];
}

export type CreateFacilityResult =
  | {
      ok: true;
      facility: {
        id: FacilityId;
        tenantId: TenantId;
        campusId: CampusId;
        name: string;
        type: string;
        capacity: number | null;
        capabilities: string[];
        state: "operational" | "degraded" | "maintenance" | "unavailable";
        availabilityRestrictions: string[];
        equipmentRefs: string[];
        maintenanceState: string | null;
        createdAt: string;
        updatedAt: string;
      };
    }
  | { ok: false; error: string };

export function createFacility(
  input: CreateFacilityInput,
  existingFacilities: Array<{ name: string }>,
  now: string,
): CreateFacilityResult {
  if (input.name.trim() === "") {
    return { ok: false, error: "Facility name is required" };
  }

  if (existingFacilities.some((f) => f.name === input.name)) {
    return { ok: false, error: `Facility ${input.name} already exists` };
  }

  const facility = {
    id: facilityId(`${input.tenantId}:${input.name}`),
    tenantId: input.tenantId,
    campusId: input.campusId,
    name: input.name,
    type: input.type,
    capacity: input.capacity,
    capabilities: input.capabilities,
    state: "operational" as const,
    availabilityRestrictions: [] as string[],
    equipmentRefs: input.equipmentRefs,
    maintenanceState: null,
    createdAt: now,
    updatedAt: now,
  };

  return { ok: true, facility };
}

/* ─────────────────────────────────────────────────────────────
 * Facility availability operations (Section 170)
 * ────────────────────────────────────────────────────────────*/

export interface SetFacilityAvailabilityInput {
  tenantId: TenantId;
  facilityId: FacilityId;
  state: FacilityAvailabilityState;
  reason: string | null;
  effectiveFrom: string;
  effectiveUntil: string | null;
  requiresOverride: boolean;
  actorId: string;
}

export type SetFacilityAvailabilityResult =
  | { ok: true; availability: FacilityAvailability; auditEvent: EducationalAuditEvent }
  | { ok: false; error: string };

export function setFacilityAvailability(
  input: SetFacilityAvailabilityInput,
  now: string,
): SetFacilityAvailabilityResult {
  // Marking a facility unavailable requires a reason.
  if (input.state === "unavailable" && (input.reason === null || input.reason.trim() === "")) {
    return { ok: false, error: "Marking a facility unavailable requires a reason" };
  }

  const availability: FacilityAvailability = {
    id: `avail-${input.tenantId}-${input.facilityId}-${now}`,
    tenantId: input.tenantId,
    facilityId: input.facilityId,
    state: input.state,
    reason: input.reason,
    effectiveFrom: input.effectiveFrom,
    effectiveUntil: input.effectiveUntil,
    requiresOverride: input.requiresOverride,
    createdAt: now,
    updatedAt: now,
  };

  const auditEvent: EducationalAuditEvent = {
    id: `audit-${now}-${availability.id}`,
    type: "EducationalEntityUpdated",
    tenantId: input.tenantId,
    actorId: input.actorId,
    occurredAt: now,
    entityType: "FacilityAvailability",
    entityId: availability.id,
    result: "success",
    metadata: {
      facilityId: input.facilityId,
      state: input.state,
      reason: input.reason,
    },
  };

  return { ok: true, availability, auditEvent };
}

/* ─────────────────────────────────────────────────────────────
 * Facility scheduling guard (Section 170)
 * ────────────────────────────────────────────────────────────*/

/**
 * A facility marked unavailable cannot be scheduled without an explicit override (Section 170).
 */
export function canScheduleFacility(
  availability: FacilityAvailability,
  hasOverride: boolean,
): { ok: boolean; error?: string } {
  if (availability.state === "unavailable" && !hasOverride) {
    return {
      ok: false,
      error: `Facility ${availability.facilityId} is unavailable and requires an explicit override`,
    };
  }

  if (availability.state === "maintenance" && !hasOverride) {
    return {
      ok: false,
      error: `Facility ${availability.facilityId} is under maintenance and requires an explicit override`,
    };
  }

  return { ok: true };
}

/* ─────────────────────────────────────────────────────────────
 * Shared facility authorization (Section 92)
 * ────────────────────────────────────────────────────────────*/

export interface AuthorizeFacilityAssignmentInput {
  tenantId: TenantId;
  facilityId: FacilityId;
  assignedToType: "programme" | "class" | "institution";
  assignedToId: string;
  actorId: string;
}

export type AuthorizeFacilityAssignmentResult =
  | { ok: true; assignment: FacilityAssignment; auditEvent: EducationalAuditEvent }
  | { ok: false; error: string };

export function authorizeFacilityAssignment(
  input: AuthorizeFacilityAssignmentInput,
  now: string,
): AuthorizeFacilityAssignmentResult {
  const assignment: FacilityAssignment = {
    id: `assign-${input.tenantId}-${input.facilityId}-${input.assignedToId}`,
    tenantId: input.tenantId,
    facilityId: input.facilityId,
    assignedToType: input.assignedToType,
    assignedToId: input.assignedToId,
    authorized: true,
    validFrom: now,
    validUntil: null,
    createdAt: now,
    updatedAt: now,
  };

  const auditEvent: EducationalAuditEvent = {
    id: `audit-${now}-${assignment.id}`,
    type: "EducationalEntityCreated",
    tenantId: input.tenantId,
    actorId: input.actorId,
    occurredAt: now,
    entityType: "FacilityAssignment",
    entityId: assignment.id,
    result: "success",
    metadata: {
      facilityId: input.facilityId,
      assignedToType: input.assignedToType,
      assignedToId: input.assignedToId,
    },
  };

  return { ok: true, assignment, auditEvent };
}
