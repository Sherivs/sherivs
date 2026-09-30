/**
 * CoreGrid — Scheduling & Timetable Intelligence Availability Engine
 * (Phase 12, Sections L, M).
 *
 * Implements `architecture/phase-12-scheduling-intelligence.md`:
 * - Availability Engine (L): availability represents when an entity can
 *   participate — teachers, rooms, learners, equipment, campuses. It must
 *   distinguish preferred, allowed, unavailable, and mandatory.
 * - Availability sources (M): institutional policy, personal configuration,
 *   assigned workload, room bookings, maintenance, holidays, leave,
 *   external calendar integration, academic requirements. External
 *   availability is not automatically authoritative.
 *
 * Boundaries: this module interprets availability; enforcement during
 * validation is the Independent Validator's responsibility.
 */

import type { TenantId } from "./tenant-core";
import type { TimeInterval } from "./scheduling-core";
import { intervalsOverlap } from "./scheduling-core";

/* ─────────────────────────────────────────────────────────────
 * Availability model (L)
 * ────────────────────────────────────────────────────────────*/

export type AvailabilityState = "preferred" | "allowed" | "unavailable" | "mandatory";

export const AVAILABILITY_STATES: readonly AvailabilityState[] = [
  "preferred",
  "allowed",
  "unavailable",
  "mandatory",
] as const;

export interface AvailabilityWindow {
  entityId: string;
  tenantId: TenantId;
  entityType: "instructor" | "room" | "learner" | "equipment" | "campus";
  state: AvailabilityState;
  interval: TimeInterval;
  /** Provenance of this availability (M): policy, configuration, workload, booking, maintenance, holiday, leave, external, academic. */
  source: string;
}

export interface CreateAvailabilityWindowInput {
  entityId: string;
  tenantId: TenantId;
  entityType: AvailabilityWindow["entityType"];
  state: AvailabilityState;
  interval: TimeInterval;
  source: string;
}

export type CreateAvailabilityWindowResult =
  { ok: true; window: AvailabilityWindow } | { ok: false; error: string };

export function createAvailabilityWindow(
  input: CreateAvailabilityWindowInput,
): CreateAvailabilityWindowResult {
  if (input.entityId.trim() === "") {
    return { ok: false, error: "Availability requires an entity (L)" };
  }
  if (input.source.trim() === "") {
    return { ok: false, error: "Availability requires a source (M)" };
  }
  return {
    ok: true,
    window: {
      entityId: input.entityId,
      tenantId: input.tenantId,
      entityType: input.entityType,
      state: input.state,
      interval: input.interval,
      source: input.source,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Availability resolution
 * ────────────────────────────────────────────────────────────*/

export type AvailabilityVerdict =
  | { verdict: "available"; state: AvailabilityState; reason: string }
  | { verdict: "unavailable"; reason: string };

/**
 * Resolve an entity's availability for an interval (L). The strongest
 * covering window wins: mandatory > unavailable > preferred > allowed.
 * A mandatory window makes the entity available; an unavailable window
 * blocks the interval regardless of allowed/preferred windows.
 */
export function resolveAvailability(
  windows: AvailabilityWindow[],
  entityId: string,
  tenantId: TenantId,
  interval: TimeInterval,
): AvailabilityVerdict {
  const covering = windows.filter(
    (w) =>
      w.entityId === entityId && w.tenantId === tenantId && intervalsOverlap(w.interval, interval),
  );
  if (covering.length === 0) {
    return { verdict: "unavailable", reason: "No availability window covers the interval (L)" };
  }
  const strength: Record<AvailabilityState, number> = {
    mandatory: 3,
    unavailable: 2,
    preferred: 1,
    allowed: 0,
  };
  const strongest = covering.reduce((acc, w) =>
    strength[w.state] > strength[acc.state] ? w : acc,
  );
  if (strongest.state === "unavailable") {
    return {
      verdict: "unavailable",
      reason: `Entity is unavailable (source: ${strongest.source}) (L)`,
    };
  }
  return {
    verdict: "available",
    state: strongest.state,
    reason: `Available as ${strongest.state} (source: ${strongest.source})`,
  };
}

/**
 * External availability is not automatically authoritative (M): windows
 * originating from external sources are accepted only when the caller has
 * explicitly verified them.
 */
export function isExternalAvailabilityAuthoritative(
  window: AvailabilityWindow,
  verifiedExternally: boolean,
): boolean {
  if (window.source === "external") {
    return verifiedExternally;
  }
  return true;
}
