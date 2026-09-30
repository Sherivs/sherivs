/**
 * CoreGrid Scholar — Phase 16 Digital Twin Platform unit tests
 * (twin-state).
 *
 * Validates:
 * - Observation model (AB-AD): observation != truth; provenance
 *   preserved; raw value immutable.
 * - Reconciliation and conflict resolution (AF, AG): conflicts preserved,
 *   resolution explainable.
 * - State model (U, V, W): historical state never overwritten;
 *   state-at-timestamp reconstruction.
 * - Event-sourced state (X): replay is deterministic.
 * - State machine (Z): invalid transitions rejected.
 * - Freshness (AJ), staleness (AK), fidelity (AI).
 * - Synchronization (AL-AR): invalid/conflicting observations are never
 *   projected as authoritative state.
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  recordObservation,
  resolveConflictingObservations,
  getStateAt,
  getStateTransitionHistory,
  reconstructState,
  defaultStateReducer,
  isStateTransitionAllowed,
  isTwinStale,
  calculateFidelity,
  synchronizeObservation,
  type TwinObservation,
  type TwinStateEntry,
  type TwinStateMachine,
} from "@/lib/twin-state";

const TENANT_A = tenantId("tenant-a");
const NOW = "2026-01-01T00:00:00Z";
const EARLIER = "2025-12-31T10:00:00Z";

function obs(overrides: Partial<TwinObservation> = {}): TwinObservation {
  return {
    observationId: "obs-1",
    twinId: "twin-1",
    tenantId: TENANT_A,
    source: "hardware",
    sourceId: "sensor-1",
    observedAt: EARLIER,
    ingestedAt: NOW,
    transformation: null,
    confidence: 0.9,
    quality: "VALID",
    version: 1,
    value: "occupied",
    raw: "occupied",
    ...overrides,
  };
}

function entry(overrides: Partial<TwinStateEntry> = {}): TwinStateEntry {
  return {
    twinId: "twin-1",
    tenantId: TENANT_A,
    stateName: "occupancy",
    value: "occupied",
    source: "hardware",
    timestamp: EARLIER,
    confidence: 0.9,
    validity: "valid",
    freshness: 0.8,
    provenanceRef: "prov-1",
    ...overrides,
  };
}

describe("Observations (AB-AD)", () => {
  it("records an observation with provenance and preserved raw value", () => {
    const result = recordObservation({
      twinId: "twin-1",
      tenantId: TENANT_A,
      source: "hardware",
      sourceId: "sensor-1",
      observedAt: EARLIER,
      ingestedAt: NOW,
      quality: "VALID",
      value: "occupied",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.observation.raw).toBe("occupied");
      expect(result.observation.source).toBe("hardware");
      expect(result.observation.quality).toBe("VALID");
    }
  });

  it("rejects an observation whose observed time is after ingestion", () => {
    const result = recordObservation({
      twinId: "twin-1",
      tenantId: TENANT_A,
      source: "hardware",
      observedAt: "2026-02-01T00:00:00Z",
      ingestedAt: NOW,
      value: "x",
    });
    expect(result.ok).toBe(false);
  });

  it("defaults unqualified observations to UNVERIFIED — never silently VALID", () => {
    const result = recordObservation({
      twinId: "twin-1",
      tenantId: TENANT_A,
      source: "manual_inspection",
      ingestedAt: NOW,
      value: "closed",
    });
    if (!result.ok) throw new Error("fixture failed");
    expect(result.observation.quality).toBe("UNVERIFIED");
  });
});

describe("Conflict resolution (AF, AG)", () => {
  it("preserves the conflict and explains the resolution", () => {
    const sensor = obs({
      observationId: "o1",
      source: "hardware",
      quality: "CONFLICTING",
      value: "occupied",
      observedAt: EARLIER,
      confidence: 0.9,
    });
    const human = obs({
      observationId: "o2",
      source: "human_input",
      quality: "CONFLICTING",
      value: "vacant",
      observedAt: "2025-12-31T11:00:00Z",
      confidence: 1.0,
    });
    const result = resolveConflictingObservations({
      observations: [sensor, human],
      sourceAuthority: { human_input: 2, hardware: 1 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selected.observationId).toBe("o2");
      expect(result.conflicting).toHaveLength(1);
      expect(result.reason).toContain("human_input");
    }
  });

  it("rejects an empty observation set", () => {
    const result = resolveConflictingObservations({ observations: [], sourceAuthority: {} });
    expect(result.ok).toBe(false);
  });
});

describe("State model and history (U, V, W)", () => {
  it("reconstructs state at a historical timestamp without overwriting", () => {
    const entries = [
      entry({ value: "available", timestamp: EARLIER }),
      entry({ value: "occupied", timestamp: "2025-12-31T14:00:00Z" }),
      entry({ value: "maintenance", timestamp: "2025-12-31T16:00:00Z" }),
    ];
    const atNoon = getStateAt(entries, "twin-1", "occupancy", "2025-12-31T12:00:00Z");
    expect(atNoon?.value).toBe("available");
    const at3pm = getStateAt(entries, "twin-1", "occupancy", "2025-12-31T15:00:00Z");
    expect(at3pm?.value).toBe("occupied");
  });

  it("returns null for state that did not exist at the requested time", () => {
    const result = getStateAt(
      [entry({ timestamp: EARLIER })],
      "twin-1",
      "occupancy",
      "2020-01-01T00:00:00Z",
    );
    expect(result).toBeNull();
  });

  it("returns the transition history in chronological order", () => {
    const history = getStateTransitionHistory(
      [
        entry({ timestamp: "2025-12-31T16:00:00Z", value: "maintenance" }),
        entry({ timestamp: EARLIER, value: "available" }),
      ],
      "twin-1",
      "occupancy",
    );
    expect(history[0].value).toBe("available");
    expect(history[1].value).toBe("maintenance");
  });
});

describe("Event-sourced state (X)", () => {
  it("reconstructs current state deterministically from events", () => {
    const events = [
      {
        kind: "state_set" as const,
        stateName: "occupancy",
        value: "occupied",
        at: "2025-12-31T14:00:00Z",
      },
      { kind: "state_set" as const, stateName: "capacity", value: 30, at: "2025-12-31T14:00:01Z" },
      { kind: "state_cleared" as const, stateName: "occupancy", at: "2025-12-31T15:00:00Z" },
    ];
    const state = reconstructState(events, defaultStateReducer);
    expect(state).toEqual({ capacity: 30 });
    // Replay is deterministic:
    expect(reconstructState(events, defaultStateReducer)).toEqual(state);
  });
});

describe("State machine (Z)", () => {
  const machine: TwinStateMachine = {
    twinKind: "classroom",
    states: ["AVAILABLE", "OCCUPIED", "MAINTENANCE"],
    transitions: [
      { from: "AVAILABLE", to: "OCCUPIED" },
      { from: "OCCUPIED", to: "AVAILABLE" },
      { from: "AVAILABLE", to: "MAINTENANCE" },
      { from: "OCCUPIED", to: "MAINTENANCE" },
    ],
  };

  it("accepts AVAILABLE -> OCCUPIED", () => {
    expect(isStateTransitionAllowed(machine, "AVAILABLE", "OCCUPIED")).toBe(true);
  });

  it("rejects MAINTENANCE -> OCCUPIED", () => {
    expect(isStateTransitionAllowed(machine, "MAINTENANCE", "OCCUPIED")).toBe(false);
  });
});

describe("Freshness, staleness, fidelity (AI, AJ, AK)", () => {
  it("marks a twin stale beyond its freshness threshold", () => {
    expect(isTwinStale("2025-01-01T00:00:00Z", NOW, 60_000)).toBe(true);
    expect(isTwinStale("2025-12-31T23:59:50Z", NOW, 60_000)).toBe(false);
    expect(isTwinStale(null, NOW, 60_000)).toBe(true);
  });

  it("computes a bounded, decomposable fidelity", () => {
    const fidelity = calculateFidelity({
      dataFreshness: 1,
      sourceCoverage: 0.8,
      sensorCoverage: 0.6,
      relationshipCompleteness: 1,
      stateCompleteness: 0.9,
      synchronizationQuality: 0.7,
    });
    expect(fidelity).toBeGreaterThan(0);
    expect(fidelity).toBeLessThanOrEqual(1);
  });
});

describe("Synchronization (AL-AR)", () => {
  it("projects valid observations into twin state", () => {
    const result = synchronizeObservation(obs({ quality: "VALID" }), (o) => ({
      occupancy: o.value,
    }));
    expect(result.state).toBe("SYNC_COMPLETE");
    expect(result.projectedState.occupancy).toBe("occupied");
  });

  it("never projects conflicting observations as authoritative state", () => {
    const result = synchronizeObservation(obs({ quality: "CONFLICTING" }), (o) => ({
      occupancy: o.value,
    }));
    expect(result.state).toBe("SYNC_CONFLICT");
    expect(result.projectedState).toEqual({});
  });

  it("fails closed on invalid observations", () => {
    const result = synchronizeObservation(obs({ quality: "INVALID" }), (o) => ({
      occupancy: o.value,
    }));
    expect(result.state).toBe("SYNC_FAILED");
    expect(result.projectedState).toEqual({});
  });
});
