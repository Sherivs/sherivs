/**
 * CoreGrid — H3-096 Twin Governance assertion suite (mission J-096,
 * Squad J — Governance & documentation).
 *
 * PURPOSE: prove, over the EXISTING twin contracts/modules (read-only),
 * the Constitution §10 boundary statement: "A Digital Twin is not a
 * permission bypass — having information inside a Twin does not mean
 * everyone can access it."
 *
 * Modules exercised (imported READ-ONLY, never modified):
 * - frontend/src/lib/twin-civilization/contracts.ts (phase 46 federation
 *   substrate: the typed no-grant boundary)
 * - frontend/src/lib/twin-governance.ts (phase 16 security CL-CQ,
 *   subscriptions, simulation, overrides, export)
 * - frontend/src/lib/twin-graph.ts (phase 16 relationships, CQ
 *   cross-tenant governance)
 * - frontend/src/lib/twin-core.ts (phase 16 identity, authorized merge,
 *   AI-assisted-not-autonomous identity resolution)
 * - frontend/src/lib/twin-state.ts (phase 16 observations: observation
 *   is not truth — the canonical-truth boundary §9)
 *
 * Governing laws asserted:
 * - §10: twin data presence never yields an access grant; cross-tenant
 *   twin access requires explicit governance; twin relationships cannot
 *   smuggle authority; simulation is never production authority.
 * - §9: predictions/observations are Intelligence, never silently
 *   promoted to canonical Reality.
 * - §16: decisions use the authorization vocabulary (DENY / ESCALATE /
 *   REQUIRE_APPROVAL) and fail closed.
 * - §12: every governance artifact carries provenance/attribution.
 *
 * Pure offline: no network, no database, no secrets, no git.
 * Finding evidence, not fixes: gaps are reported to
 * progress/h3-wave/H3-096.report.md — the twin modules are never
 * patched by this suite.
 */
import { describe, expect, it } from "vitest";
import { tenantId, type TenantId } from "../../frontend/src/lib/tenant-core";
import {
  authorizeTwinAccess,
  createManualOverride,
  createSubscription,
  isEventVisibleToSubscription,
  isOverrideExpired,
  isSimulationResultIsolated,
  reconcileAfterOverride,
  recordActual,
  recordPrediction,
  runExport,
  runIsolatedSimulation,
  type TwinEvent,
} from "../../frontend/src/lib/twin-governance";
import { addRelationship, type TwinRelationship } from "../../frontend/src/lib/twin-graph";
import { mergeTwins, resolveIdentity, type MatchingSignals } from "../../frontend/src/lib/twin-core";
import { recordObservation, synchronizeObservation } from "../../frontend/src/lib/twin-state";
import {
  FEDERATION_TRANSITIONS,
  TWIN_PRESENCE_GRANTS,
  evaluateTwinDataAccessRequest,
  federationGate,
  parseFederationAgreement,
  parseSharedStateEnvelope,
  type FederationAgreement,
  type FederationGateResult,
} from "../../frontend/src/lib/twin-civilization/contracts";

const TENANT_A: TenantId = tenantId("tenant_a");
const TENANT_B: TenantId = tenantId("tenant_b");
const NOW = "2026-10-03T00:00:00.000Z";
const LATER = "2027-10-03T00:00:00.000Z";
const DIGEST = "a".repeat(64);
const DECLARED_PATH = "state.metrics.load";

type Fixture = Record<string, unknown>;

const PROVENANCE: Fixture = {
  actorId: "agent:federation-worker-1",
  actorKind: "agent",
  tenantId: "tenant_a",
  policyRef: "policy:twin-governance-v1",
  traceId: "trace:h3-096",
  recordedAt: NOW,
};

function twinRef(t: TenantId, overrides: Fixture = {}): Fixture {
  return {
    twinId: `twin:${t}-1`,
    twinKind: "entity",
    ownerRef: "owner:org-1",
    homeTenantId: t,
    currentStateDigest: DIGEST,
    historyRef: "history:twin-1",
    capabilities: ["capability:mirror-state"],
    policyRefs: ["policy:twin-governance-v1"],
    recordedAt: NOW,
    ...overrides,
  };
}

function agreementFixture(overrides: Fixture = {}): Fixture {
  return {
    agreementId: "fed:agreement-1",
    initiator: twinRef(TENANT_A),
    counterparty: twinRef(TENANT_B, { twinId: "twin:tenant_b-1" }),
    state: "PROPOSED",
    accessGrant: "none",
    sharedFieldPaths: [DECLARED_PATH],
    classification: "internal",
    effectiveFrom: NOW,
    expiresAt: LATER,
    provenance: PROVENANCE,
    ...overrides,
  };
}

function envelopeFixture(overrides: Fixture = {}): Fixture {
  return {
    envelopeId: "env:1",
    agreementId: "fed:agreement-1",
    fieldPath: DECLARED_PATH,
    classification: "internal",
    redacted: false,
    payloadDigest: DIGEST,
    sourceTenantId: "tenant_a",
    destinationTenantId: "tenant_b",
    authority: "mirror",
    provenance: PROVENANCE,
    exchangedAt: NOW,
    ...overrides,
  };
}

function parseAgreement(overrides: Fixture = {}): FederationAgreement {
  const result = parseFederationAgreement(agreementFixture(overrides));
  if (!result.ok) {
    throw new Error(`fixture must parse: ${result.issues.map((i) => i.message).join("; ")}`);
  }
  return result.value;
}

function expectRefusal(result: FederationGateResult): string {
  if (result.decision === "ALLOW") {
    throw new Error("expected a fail-closed decision, got ALLOW");
  }
  return result.reason;
}

function evt(overrides: Partial<TwinEvent> = {}): TwinEvent {
  return {
    eventId: "evt-1",
    sequence: 1,
    type: "twin.created",
    twinId: "twin-1",
    tenantId: TENANT_A,
    timestamp: NOW,
    source: "h3-096",
    correlationId: null,
    payload: {},
    ...overrides,
  };
}

/* ─────────────────────────────────────────────────────────────
 * 1. Twin presence is never an access grant (§10, phase 46 boundary)
 * ────────────────────────────────────────────────────────────*/
describe("§10 boundary: twin data presence is not an authorization decision", () => {
  it("refuses every twin-data access attempt regardless of claimed tenancy or action", () => {
    for (const claimedTenantId of [undefined, "tenant_a", "tenant_b"]) {
      for (const requestedAction of ["read", "write", "admin", "delete", "grant"]) {
        const verdict = evaluateTwinDataAccessRequest({
          twinId: "twin:tenant_a-1",
          requestedAction,
          claimedTenantId,
        });
        expect(verdict.granted).toBe(false);
        expect(verdict.reason).toBe("TWIN_PRESENCE_IS_NOT_A_GRANT");
      }
    }
  });

  it("refuses even when the claimant is the twin's own home tenant", () => {
    const verdict = evaluateTwinDataAccessRequest({
      twinId: "twin:tenant_a-1",
      requestedAction: "read",
      claimedTenantId: "tenant_a",
    });
    expect(verdict.granted).toBe(false);
    expect(verdict.reason).toBe("TWIN_PRESENCE_IS_NOT_A_GRANT");
    expect(verdict.detail).toContain("authorization engine");
  });

  it("exposes an empty set of grants derivable from twin presence alone", () => {
    expect(TWIN_PRESENCE_GRANTS).toHaveLength(0);
  });

  it("cannot express a federation agreement that grants access", () => {
    const forged = parseFederationAgreement(
      agreementFixture({ accessGrant: "read:all" }),
    );
    expect(forged.ok).toBe(false);
  });

  it("cannot express a shared-state envelope that is an authority to act", () => {
    const forged = parseSharedStateEnvelope(envelopeFixture({ authority: "grant" }));
    expect(forged.ok).toBe(false);
  });

  it("keeps every parseable envelope a mirror, never an authority", () => {
    const parsed = parseSharedStateEnvelope(envelopeFixture());
    if (!parsed.ok) throw new Error("valid envelope fixture must parse");
    expect(parsed.value.authority).toBe("mirror");
  });

  it("fails closed on unredacted restricted shared state", () => {
    const result = parseSharedStateEnvelope(envelopeFixture({ classification: "restricted" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("redaction_violation");
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Twin access control (CL-CQ): cross-tenant access is governed
 * ────────────────────────────────────────────────────────────*/
describe("§10 boundary: twin access crosses tenants only under explicit governance", () => {
  it("denies cross-tenant access without an explicit grant (CP)", () => {
    const decision = authorizeTwinAccess({
      actorTenantId: TENANT_A,
      resourceTenantId: TENANT_B,
      resourceTwinId: "twin-b-1",
      operation: "read",
      crossTenantGranted: false,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("denied");
  });

  it("permits cross-tenant access only through the explicit grant path (CQ)", () => {
    const granted = authorizeTwinAccess({
      actorTenantId: TENANT_A,
      resourceTenantId: TENANT_B,
      resourceTwinId: "twin-b-1",
      operation: "read",
      crossTenantGranted: true,
    });
    expect(granted.allowed).toBe(true);
    expect(granted.reason).toContain("Explicit cross-tenant grant");
  });

  it("denies by default for every governed operation, not only reads", () => {
    for (const operation of ["read", "write", "control", "delete", "export"]) {
      const decision = authorizeTwinAccess({
        actorTenantId: TENANT_A,
        resourceTenantId: TENANT_B,
        resourceTwinId: "twin-b-1",
        operation,
        crossTenantGranted: false,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.operation).toBe(operation);
    }
  });

  it("records an explainable reason on every decision (§29 observability)", () => {
    const denied = authorizeTwinAccess({
      actorTenantId: TENANT_A,
      resourceTenantId: TENANT_B,
      resourceTwinId: "twin-b-1",
      operation: "read",
      crossTenantGranted: false,
    });
    expect(denied.reason.trim().length).toBeGreaterThan(0);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Subscriptions cannot widen scope (CP): tenant, twin, topic
 * ────────────────────────────────────────────────────────────*/
describe("§10 boundary: event subscriptions never leak across tenants", () => {
  it("never delivers another tenant's twin events, whatever topics are subscribed", () => {
    const sub = createSubscription("consumer-a", TENANT_A, [
      "twin_changes",
      "state_changes",
      "relationship_changes",
      "observation_updates",
      "lifecycle_changes",
    ]);
    expect(isEventVisibleToSubscription(sub, evt({ tenantId: TENANT_B }))).toBe(false);
  });

  it("honors the twin-id filter as a scope boundary", () => {
    const sub = createSubscription("consumer-a", TENANT_A, ["twin_changes"], "twin-1");
    expect(isEventVisibleToSubscription(sub, evt({ twinId: "twin-1" }))).toBe(true);
    expect(isEventVisibleToSubscription(sub, evt({ twinId: "twin-2" }))).toBe(false);
  });

  it("delivers nothing outside the subscribed topics", () => {
    const sub = createSubscription("consumer-a", TENANT_A, ["twin_changes"]);
    expect(isEventVisibleToSubscription(sub, evt({ type: "twin.state_changed" }))).toBe(false);
    expect(isEventVisibleToSubscription(sub, evt({ type: "twin.created" }))).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. Simulation is never production authority (FA.29, BX-BY)
 * ────────────────────────────────────────────────────────────*/
describe("§10 boundary: simulated twin state can never pose as production truth", () => {
  it("forces every simulated result into the simulation namespace", () => {
    const result = runIsolatedSimulation(
      {
        simulationId: "sim-1",
        tenantId: TENANT_A,
        twinId: "twin-1",
        startingState: { occupancy: 30 },
        assumptions: ["steady state"],
        inputs: { visitors: 10 },
        simulationVersion: "1.0",
        model: "what-if-v1",
        timestamp: NOW,
      },
      (state, inputs) => ({ ...state, occupancy: 999, from: inputs }),
    );
    expect(result.namespace).toBe("simulation");
    expect(isSimulationResultIsolated(result)).toBe(true);
    expect(result.resultingState.occupancy).toBe(999);
  });

  it("keeps the isolation label even when the model returns production-shaped data", () => {
    const result = runIsolatedSimulation(
      {
        simulationId: "sim-2",
        tenantId: TENANT_A,
        twinId: "twin-1",
        startingState: {},
        assumptions: [],
        inputs: {},
        simulationVersion: "1.0",
        model: "overconfident-model",
        timestamp: NOW,
      },
      () => ({ production: true, authoritative: true }),
    );
    expect(isSimulationResultIsolated(result)).toBe(true);
    expect(result.namespace).toBe("simulation");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. Manual overrides are governed records, not silent rewrites (EO-ER)
 * ────────────────────────────────────────────────────────────*/
describe("§10 boundary: overriding a twin is governed, attributed and expiring", () => {
  it("refuses anonymous overrides (EP)", () => {
    const result = createManualOverride({
      twinId: "twin-1",
      tenantId: TENANT_A,
      actor: "  ",
      reason: "sensor misread",
      timestamp: NOW,
      previousValue: 1,
      newValue: 2,
    });
    expect(result.ok).toBe(false);
  });

  it("refuses unexplained overrides (EP)", () => {
    const result = createManualOverride({
      twinId: "twin-1",
      tenantId: TENANT_A,
      actor: "human:operator-1",
      reason: "",
      timestamp: NOW,
      previousValue: 1,
      newValue: 2,
    });
    expect(result.ok).toBe(false);
  });

  it("preserves previous value, actor, reason and evidence as provenance (§12)", () => {
    const result = createManualOverride({
      twinId: "twin-1",
      tenantId: TENANT_A,
      actor: "human:operator-1",
      reason: "sensor misread",
      timestamp: NOW,
      previousValue: 1,
      newValue: 2,
      evidence: "work-order-42",
    });
    if (!result.ok) throw new Error("valid override fixture must succeed");
    expect(result.override.actor).toBe("human:operator-1");
    expect(result.override.previousValue).toBe(1);
    expect(result.override.newValue).toBe(2);
    expect(result.override.evidence).toBe("work-order-42");
  });

  it("expires temporary overrides and they stop holding after expiry (EQ)", () => {
    const result = createManualOverride({
      twinId: "twin-1",
      tenantId: TENANT_A,
      actor: "human:operator-1",
      reason: "temporary correction",
      timestamp: NOW,
      previousValue: 1,
      newValue: 2,
      expiresAt: LATER,
    });
    if (!result.ok) throw new Error("valid override fixture must succeed");
    const AFTER = "2027-10-03T00:00:00.001Z";
    expect(isOverrideExpired(result.override, NOW)).toBe(false);
    expect(isOverrideExpired(result.override, LATER)).toBe(false);
    expect(isOverrideExpired(result.override, AFTER)).toBe(true);
    expect(reconcileAfterOverride(result.override, { authoritative: false, timestamp: AFTER }, AFTER)).toBe("expire");
  });

  it("rejects an override whose expiry precedes its timestamp (EQ)", () => {
    const result = createManualOverride({
      twinId: "twin-1",
      tenantId: TENANT_A,
      actor: "human:operator-1",
      reason: "backwards window",
      timestamp: LATER,
      previousValue: 1,
      newValue: 2,
      expiresAt: NOW,
    });
    expect(result.ok).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 6. Twin relationships cannot smuggle authority across tenants (CQ, P)
 * ────────────────────────────────────────────────────────────*/
describe("§10 boundary: twin graph relationships require governance across tenants", () => {
  it("rejects a cross-tenant relationship without explicit governance", () => {
    const result = addRelationship([], {
      sourceTwinId: "twin-a-1",
      targetTwinId: "twin-b-1",
      type: "connected_to",
      tenantId: TENANT_A,
      createdAt: NOW,
      metadata: { targetTenant: "tenant_b" },
    });
    expect(result.ok).toBe(false);
  });

  it("records the counterparty tenant only under explicit authorization", () => {
    const result = addRelationship([], {
      sourceTwinId: "twin-a-1",
      targetTwinId: "twin-b-1",
      type: "connected_to",
      tenantId: TENANT_A,
      createdAt: NOW,
      crossTenantAuthorized: true,
      metadata: { targetTenant: "tenant_b" },
    });
    if (!result.ok) throw new Error("authorized cross-tenant relationship must succeed");
    const relationship: TwinRelationship = result.relationship;
    expect(relationship.targetTenantId).toBe("tenant_b");
    expect(relationship.sourceTenantId).toBe("tenant_a");
  });

  it("rejects prohibited containment cycles that could alias authority", () => {
    const first = addRelationship([], {
      sourceTwinId: "twin-a-1",
      targetTwinId: "twin-a-2",
      type: "contains",
      tenantId: TENANT_A,
      createdAt: NOW,
    });
    if (!first.ok) throw new Error("first contains link must succeed");
    const cycle = addRelationship([first.relationship], {
      sourceTwinId: "twin-a-2",
      targetTwinId: "twin-a-1",
      type: "contains",
      tenantId: TENANT_A,
      createdAt: NOW,
    });
    expect(cycle.ok).toBe(false);
  });

  it("rejects self-relationships that could launder identity", () => {
    const result = addRelationship([], {
      sourceTwinId: "twin-a-1",
      targetTwinId: "twin-a-1",
      type: "connected_to",
      tenantId: TENANT_A,
      createdAt: NOW,
    });
    expect(result.ok).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 7. Twin merging and identity resolution are governed (AZ, BD, BE)
 * ────────────────────────────────────────────────────────────*/
describe("§10 boundary: twin identity changes require a human-authorized decision", () => {
  it("refuses a merge without an authorizing identity (AZ)", () => {
    const result = mergeTwins({
      primaryTwinId: "twin-1",
      duplicateTwinIds: ["twin-2"],
      authorizedBy: "",
      reason: "duplicate records",
      resolvedConflicts: 0,
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a merge without a recorded reason (AZ)", () => {
    const result = mergeTwins({
      primaryTwinId: "twin-1",
      duplicateTwinIds: ["twin-2"],
      authorizedBy: "human:steward-1",
      reason: " ",
      resolvedConflicts: 0,
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("marks partial identity signals uncertain so AI cannot silently merge (BE)", () => {
    const signals: MatchingSignals = {
      sharedIdentifiers: 1,
      totalIdentifiers: 3,
      nameSimilarity: 0.97,
      locationMatch: true,
      metadataMatch: true,
      timestampProximity: true,
    };
    expect(resolveIdentity(signals)).toBe("uncertain");
  });

  it("never merges on name similarity alone (BE)", () => {
    const signals: MatchingSignals = {
      sharedIdentifiers: 0,
      totalIdentifiers: 0,
      nameSimilarity: 0.97,
      locationMatch: false,
      metadataMatch: false,
      timestampProximity: true,
    };
    expect(resolveIdentity(signals)).toBe("uncertain");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 8. Federation gate speaks the §16 vocabulary and fails closed
 * ────────────────────────────────────────────────────────────*/
describe("§10 boundary: the federation gate never converts twin data into access", () => {
  it("denies unknown actions outright", () => {
    const reason = expectRefusal(
      federationGate({
        action: "grant_access",
        agreement: parseAgreement({ state: "ACTIVE", approvalRef: "auth:1" }),
        now: NOW,
      }),
    );
    expect(reason).toContain("unknown federation action");
  });

  it("denies state exchange outside an ACTIVE agreement", () => {
    const reason = expectRefusal(
      federationGate({
        action: "exchange_state",
        agreement: parseAgreement(),
        fieldPath: DECLARED_PATH,
        now: NOW,
      }),
    );
    expect(reason).toContain("not ACTIVE");
  });

  it("denies state exchange under an expired agreement", () => {
    const reason = expectRefusal(
      federationGate({
        action: "exchange_state",
        agreement: parseAgreement({ state: "ACTIVE", approvalRef: "auth:1" }),
        fieldPath: DECLARED_PATH,
        now: LATER,
      }),
    );
    expect(reason).toContain("expired");
  });

  it("denies state exchange for undeclared field paths (no prefix inference)", () => {
    const reason = expectRefusal(
      federationGate({
        action: "exchange_state",
        agreement: parseAgreement({ state: "ACTIVE", approvalRef: "auth:1" }),
        fieldPath: "state.metrics.load.detail",
        now: NOW,
      }),
    );
    expect(reason).toContain("outside the agreement's shared scope");
  });

  it("escalates scope widening regardless of who asks", () => {
    const agreement = parseAgreement({ state: "ACTIVE", approvalRef: "auth:1" });
    const reason = expectRefusal(
      federationGate({ action: "widen_shared_scope", agreement, approvalRef: "auth:1", now: NOW }),
    );
    expect(reason).toContain("never an automatic decision");
  });

  it("keeps revocation terminal — a severed federation never resurrects", () => {
    expect(FEDERATION_TRANSITIONS.REVOKED).toHaveLength(0);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 9. Observations are not truth; exports are redaction-gated (§9, ED)
 * ────────────────────────────────────────────────────────────*/
describe("§9 canonical truth: twin intelligence never overwrites reality", () => {
  it("projects no state from an INVALID observation (18)", () => {
    const recorded = recordObservation({
      twinId: "twin-1",
      tenantId: TENANT_A,
      source: "hardware",
      ingestedAt: NOW,
      value: { occupancy: 999 },
      quality: "INVALID",
    });
    if (!recorded.ok) throw new Error("valid observation fixture must succeed");
    const sync = synchronizeObservation(recorded.observation, (o) => ({
      occupancy: o.value,
    }));
    expect(sync.state).toBe("SYNC_FAILED");
    expect(sync.projectedState).toEqual({});
  });

  it("distinguishes PREDICTED from ACTUAL until reality reports back (CC, CD)", () => {
    const prediction = recordPrediction({
      twinId: "twin-1",
      tenantId: TENANT_A,
      predictedValue: 42,
      predictionTime: NOW,
      horizonMs: 3_600_000,
      confidence: 0.8,
      source: "model-v1",
      modelReference: "forecast@1.0",
    });
    expect(prediction.actualValue).toBeNull();
    expect(prediction.actualAt).toBeNull();
    const reconciled = recordActual(prediction, 40, LATER);
    expect(reconciled.actualValue).toBe(40);
    expect(reconciled.predictedValue).toBe(42);
    expect(reconciled.error).toBe(-2);
  });

  it("never exports sensitive twin fields unredacted through the governed path (ED)", () => {
    const result = runExport(
      [{ twinId: "twin-1", individual_location: "room-12", occupancy: 30 }],
      { redactSensitive: true, includeProvenance: true, version: 1 },
      ["individual_location"],
    );
    expect(result.records[0].individual_location).toBe("[REDACTED]");
    expect(result.redactedCount).toBe(1);
    expect(result.records[0].provenance).toBe("export-twin");
  });
});
