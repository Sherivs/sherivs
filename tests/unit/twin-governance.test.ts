/**
 * CoreGrid Scholar — Phase 16 Digital Twin Platform unit tests
 * (twin-governance).
 *
 * Validates:
 * - Events (BQ-BR): sequence ordering, duplicate tolerance.
 * - Subscriptions (BM, BN): tenant-scoped visibility.
 * - Simulation (BU-BZ): isolation, namespacing, never mutating
 *   production.
 * - Prediction (CA-CD): PREDICTED vs ACTUAL distinguished, error
 *   computed.
 * - Health (CE-CK): explainable composite score, ordered drift steps.
 * - Security (CL-CQ): tenant isolation, cross-tenant governance.
 * - Trust (EL-EN): explainable trust levels and reality score.
 * - Manual override (EO-ER): audited, expiring, reconciled.
 * - Retention/archival/GC (EE-EH): production history never collected
 *   accidentally.
 * - Import/export (EC-ED): dry run, redaction, provenance.
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  emitTwinEvent,
  isEventSequenceInOrder,
  isDuplicateEvent,
  createSubscription,
  isEventVisibleToSubscription,
  runIsolatedSimulation,
  isSimulationResultIsolated,
  recordPrediction,
  recordActual,
  calculateTwinHealthScore,
  isTwinHealthy,
  isDriftStepAllowed,
  authorizeTwinAccess,
  assessTwinTrust,
  calculateRealityScore,
  createManualOverride,
  isOverrideExpired,
  reconcileAfterOverride,
  shouldCollectTwin,
  canArchiveTwin,
  runImport,
  runExport,
  type TwinEvent,
} from "@/lib/twin-governance";

const TENANT_A = tenantId("tenant-a");
const TENANT_B = tenantId("tenant-b");
const NOW = "2026-01-01T00:00:00Z";
const LATER = "2026-06-01T00:00:00Z";

function evt(overrides: Partial<TwinEvent> = {}): TwinEvent {
  return {
    eventId: "evt-1",
    sequence: 1,
    type: "twin.created",
    twinId: "twin-1",
    tenantId: TENANT_A,
    timestamp: NOW,
    source: "test",
    correlationId: null,
    payload: {},
    ...overrides,
  };
}

describe("Events (BQ, BR, BS)", () => {
  it("emits an event with ordering metadata", () => {
    const event = emitTwinEvent({
      sequence: 3,
      type: "twin.state_changed",
      twinId: "twin-1",
      tenantId: TENANT_A,
      timestamp: NOW,
      source: "sync",
      correlationId: "corr-1",
    });
    expect(event.sequence).toBe(3);
    expect(event.correlationId).toBe("corr-1");
  });

  it("rejects out-of-order event sequences", () => {
    expect(
      isEventSequenceInOrder([
        evt({ sequence: 1 }),
        evt({ eventId: "e2", sequence: 2 }),
        evt({ eventId: "e3", sequence: 3 }),
      ]),
    ).toBe(true);
    expect(
      isEventSequenceInOrder([evt({ sequence: 2 }), evt({ eventId: "e2", sequence: 1 })]),
    ).toBe(false);
  });

  it("detects duplicate event delivery", () => {
    const seen = new Set<string>(["evt-1"]);
    expect(isDuplicateEvent(seen, evt())).toBe(true);
    expect(isDuplicateEvent(seen, evt({ eventId: "evt-2" }))).toBe(false);
  });
});

describe("Subscriptions (BM, BN)", () => {
  it("delivers only events within the subscription tenant (CP)", () => {
    const sub = createSubscription("consumer-1", TENANT_A, ["state_changes"]);
    expect(isEventVisibleToSubscription(sub, evt({ type: "twin.state_changed" }))).toBe(true);
    expect(
      isEventVisibleToSubscription(sub, evt({ type: "twin.state_changed", tenantId: TENANT_B })),
    ).toBe(false);
  });

  it("honors the twin filter and topic selection", () => {
    const sub = createSubscription("consumer-1", TENANT_A, ["state_changes"], "twin-1");
    expect(
      isEventVisibleToSubscription(sub, evt({ type: "twin.state_changed", twinId: "twin-1" })),
    ).toBe(true);
    expect(
      isEventVisibleToSubscription(sub, evt({ type: "twin.state_changed", twinId: "twin-2" })),
    ).toBe(false);
    expect(isEventVisibleToSubscription(sub, evt({ type: "twin.relationship_added" }))).toBe(false);
  });
});

describe("Simulation (BU-BZ)", () => {
  it("runs an isolated simulation that never touches production", () => {
    const result = runIsolatedSimulation(
      {
        simulationId: "sim-1",
        tenantId: TENANT_A,
        twinId: "twin-1",
        startingState: { occupancy: 20, capacity: 30 },
        assumptions: ["occupancy increases"],
        inputs: { delta: 10 },
        simulationVersion: "1.0",
        model: "what-if-v1",
        timestamp: NOW,
      },
      (state, inputs) => ({
        ...state,
        occupancy: (state.occupancy as number) + (inputs.delta as number),
      }),
    );
    expect(isSimulationResultIsolated(result)).toBe(true);
    expect(result.resultingState.occupancy).toBe(30);
  });
});

describe("Prediction (CA-CD)", () => {
  it("records a prediction and computes error against the actual", () => {
    const prediction = recordPrediction({
      twinId: "twin-1",
      tenantId: TENANT_A,
      predictedValue: 34,
      predictionTime: NOW,
      horizonMs: 3600_000,
      confidence: 0.8,
      source: "analytics-model",
      modelReference: "model-v2",
    });
    expect(prediction.actualValue).toBeNull();
    const withActual = recordActual(prediction, 36, LATER);
    expect(withActual.actualValue).toBe(36);
    expect(withActual.error).toBe(2);
  });

  it("keeps PREDICTED and ACTUAL distinguishable before comparison", () => {
    const prediction = recordPrediction({
      twinId: "twin-1",
      tenantId: TENANT_A,
      predictedValue: "occupied",
      predictionTime: NOW,
      horizonMs: 60_000,
      confidence: null,
      source: "rule",
      modelReference: "v1",
    });
    expect(prediction.predictedValue).toBe("occupied");
    expect(prediction.error).toBeNull();
  });
});

describe("Health and drift (CE-CK)", () => {
  it("computes an explainable health score and health threshold", () => {
    const healthy = calculateTwinHealthScore({
      freshness: 0.9,
      completeness: 0.9,
      synchronization: 0.9,
      consistency: 0.9,
      provenance: 0.9,
      sourceAvailability: 0.9,
      relationshipIntegrity: 0.9,
    });
    expect(healthy).toBeGreaterThanOrEqual(0.7);
    expect(isTwinHealthy(healthy)).toBe(true);
    const unhealthy = calculateTwinHealthScore({
      freshness: 0.2,
      completeness: 0.2,
      synchronization: 0.2,
      consistency: 0.2,
      provenance: 0.2,
      sourceAvailability: 0.2,
      relationshipIntegrity: 0.2,
    });
    expect(isTwinHealthy(unhealthy)).toBe(false);
  });

  it("requires ordered drift resolution steps", () => {
    expect(isDriftStepAllowed(null, "DETECT")).toBe(true);
    expect(isDriftStepAllowed("DETECT", "CLASSIFY")).toBe(true);
    expect(isDriftStepAllowed("CLASSIFY", "INVESTIGATE")).toBe(true);
    expect(isDriftStepAllowed("INVESTIGATE", "RECONCILE")).toBe(true);
    expect(isDriftStepAllowed("RECONCILE", "VERIFY")).toBe(true);
    expect(isDriftStepAllowed("DETECT", "VERIFY")).toBe(false);
  });
});

describe("Security and tenant isolation (CL-CQ)", () => {
  it("grants same-tenant access and denies cross-tenant without a grant", () => {
    const sameTenant = authorizeTwinAccess({
      actorTenantId: TENANT_A,
      resourceTenantId: TENANT_A,
      resourceTwinId: "twin-1",
      operation: "read",
      crossTenantGranted: false,
    });
    expect(sameTenant.allowed).toBe(true);
    const crossTenant = authorizeTwinAccess({
      actorTenantId: TENANT_A,
      resourceTenantId: TENANT_B,
      resourceTwinId: "twin-x",
      operation: "read",
      crossTenantGranted: false,
    });
    expect(crossTenant.allowed).toBe(false);
    const granted = authorizeTwinAccess({
      actorTenantId: TENANT_A,
      resourceTenantId: TENANT_B,
      resourceTwinId: "twin-x",
      operation: "read",
      crossTenantGranted: true,
    });
    expect(granted.allowed).toBe(true);
  });
});

describe("Trust and reality score (EL-EN)", () => {
  it("assesses explainable twin trust levels", () => {
    const strong = assessTwinTrust("twin-1", {
      sourceReliability: 0.95,
      freshness: 0.95,
      consistency: 0.95,
      observationCoverage: 0.95,
      calibration: 0.95,
      provenance: 0.95,
    });
    expect(strong.level).toBe("VERIFIED");
    const weak = assessTwinTrust("twin-2", {
      sourceReliability: 0.2,
      freshness: 0.2,
      consistency: 0.2,
      observationCoverage: 0.2,
      calibration: 0.2,
      provenance: 0.2,
    });
    expect(weak.level).toBe("UNVERIFIED");
    expect(weak.factors).toBeDefined();
  });

  it("computes a decomposable reality score", () => {
    const score = calculateRealityScore({ fidelity: 0.9, health: 0.8, trust: 0.7 });
    expect(score).toBeCloseTo(0.8, 3);
  });
});

describe("Manual override (EO-ER)", () => {
  it("records an audited override with actor, reason, evidence", () => {
    const result = createManualOverride({
      twinId: "twin-1",
      tenantId: TENANT_A,
      actor: "admin-1",
      reason: "manual count confirmed 34",
      timestamp: NOW,
      previousValue: 30,
      newValue: 34,
      evidence: "walkthrough log #12",
      expiresAt: LATER,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.override.previousValue).toBe(30);
      expect(result.override.newValue).toBe(34);
      expect(result.override.evidence).toBe("walkthrough log #12");
    }
  });

  it("rejects an override without actor or reason", () => {
    const noActor = createManualOverride({
      twinId: "twin-1",
      tenantId: TENANT_A,
      actor: "",
      reason: "x",
      timestamp: NOW,
      previousValue: 1,
      newValue: 2,
    });
    expect(noActor.ok).toBe(false);
    const noReason = createManualOverride({
      twinId: "twin-1",
      tenantId: TENANT_A,
      actor: "a",
      reason: "",
      timestamp: NOW,
      previousValue: 1,
      newValue: 2,
    });
    expect(noReason.ok).toBe(false);
  });

  it("expires temporary overrides and reconciles later source data (EQ, ER)", () => {
    const result = createManualOverride({
      twinId: "twin-1",
      tenantId: TENANT_A,
      actor: "admin-1",
      reason: "temporary correction",
      timestamp: NOW,
      previousValue: 10,
      newValue: 12,
      evidence: "field inspection",
      expiresAt: "2026-02-01T00:00:00Z",
    });
    if (!result.ok) throw new Error("fixture failed");
    expect(isOverrideExpired(result.override, "2026-03-01T00:00:00Z")).toBe(true);
    expect(
      reconcileAfterOverride(
        result.override,
        { authoritative: true, timestamp: LATER },
        "2026-03-01T00:00:00Z",
      ),
    ).toBe("expire");
  });

  it("challenges unexpired overrides when authoritative data arrives", () => {
    const result = createManualOverride({
      twinId: "twin-1",
      tenantId: TENANT_A,
      actor: "admin-1",
      reason: "correction",
      timestamp: NOW,
      previousValue: 10,
      newValue: 12,
      evidence: "inspection",
      expiresAt: LATER,
    });
    if (!result.ok) throw new Error("fixture failed");
    expect(
      reconcileAfterOverride(result.override, { authoritative: true, timestamp: LATER }, NOW),
    ).toBe("challenge");
  });
});

describe("Retention, archival, garbage collection (EE-EH)", () => {
  it("never collects production twins — only ephemeral ones per policy", () => {
    const policy = {
      twinKind: "sensor",
      retentionMs: null,
      archiveAfterMs: null,
      collectEphemeralAfterMs: 3600_000,
    };
    const productionTwin = {
      creationSource: "device_discovery",
      lifecycleState: "ACTIVE",
      createdAt: "2025-01-01T00:00:00Z",
    };
    expect(shouldCollectTwin(productionTwin, policy, NOW)).toBe(false);
    const ephemeralTwin = {
      creationSource: "derived",
      lifecycleState: "ACTIVE",
      createdAt: "2025-01-01T00:00:00Z",
    };
    expect(shouldCollectTwin(ephemeralTwin, policy, NOW)).toBe(true);
  });

  it("archives only twins in non-terminal states", () => {
    expect(canArchiveTwin({ lifecycleState: "ACTIVE" })).toBe(true);
    expect(canArchiveTwin({ lifecycleState: "SUSPENDED" })).toBe(true);
    expect(canArchiveTwin({ lifecycleState: "RETIRED" })).toBe(false);
  });
});

describe("Import and export (EC, ED)", () => {
  it("runs an import dry run without committing", () => {
    const result = runImport({
      dryRun: true,
      records: [{ id: "1" }, { id: "2" }, { id: "3" }],
      validate: (r) =>
        (r as { id: string }).id !== "2"
          ? { ok: true as const }
          : { ok: false as const, error: "duplicate" },
    });
    expect(result.accepted).toBe(2);
    expect(result.rejected).toBe(1);
    expect(result.rejectedReasons).toContain("duplicate");
  });

  it("redacts sensitive fields on export while preserving provenance", () => {
    const result = runExport(
      [{ twinId: "twin-1", occupancy: 34, ownerId: "user-9" }],
      { redactSensitive: true, includeProvenance: true, version: 2 },
      ["occupancy", "ownerId"],
    );
    expect(result.redactedCount).toBe(2);
    expect(result.records[0].occupancy).toBe("[REDACTED]");
    expect(result.records[0].ownerId).toBe("[REDACTED]");
    expect(result.records[0].provenance).toBe("export-twin");
    expect(result.records[0].exportVersion).toBe(2);
  });
});
