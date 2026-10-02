/**
 * CoreGrid — command centre operational projection tests (V1CAP-089 / J-048 /
 * MISSION-R-110). Covers the projection contract's loop-closure laws:
 *  1. projection correctness (alerts → declared incident grouping, severity
 *     and lifecycle discipline)
 *  2. append-only decision records (history is never rewritten)
 *  3. observation closure (E-018: loop re-entry sees closed loops as closed)
 *  4. tenant scoping (cross-tenant never projects; scope-less is a defect)
 *  5. delta-by-cursor (what changed since the operator's observation frontier)
 *  6. read-only guarantee (the centre never mutates the substrates)
 */
import { describe, expect, it } from "vitest";
import {
  appendIncidentDecision,
  CommandCentreAppendError,
  projectCommandCentre,
  type IncidentDecisionRecord,
} from "../../frontend/src/lib/command-centre";
import { createCommandAlert, type CommandAlert } from "../../frontend/src/lib/command-alerts";
import { createIncident, type Incident } from "../../frontend/src/lib/command-incidents";
import { tenantId as ref } from "../../frontend/src/lib/tenant-core";

/* ────────────────────────────────────────────────────────────
 * Fixtures — declared records built through the owning domains
 * ────────────────────────────────────────────────────────────*/

const TENANT = ref("tenant:ops-a");
const OTHER_TENANT = ref("tenant:ops-b");

function alert(overrides: Partial<CommandAlert> & { alertId: string }): CommandAlert {
  const created = createCommandAlert({
    alertId: overrides.alertId,
    tenantId: TENANT,
    source: "security",
    sourceAlertId: `src-${overrides.alertId}`,
    severity: "HIGH",
    summary: `alert ${overrides.alertId}`,
    impactedScope: ["identity:subject-1"],
    createdAt: "2026-10-01T08:00:00Z",
  });
  if (!created.ok) throw new Error(`fixture alert ${overrides.alertId} rejected`);
  return { ...created.alert, ...overrides };
}

function incident(overrides: Partial<Incident> & { incidentId: string }): Incident {
  const created = createIncident({
    incidentId: overrides.incidentId,
    tenantId: TENANT,
    kind: "security_incident",
    severity: "CRITICAL",
    scope: ["identity:subject-1"],
    detectedAt: "2026-10-01T08:10:00Z",
  });
  if (!created.ok) throw new Error(`fixture incident ${overrides.incidentId} rejected`);
  return { ...created.incident, ...overrides };
}

function decision(overrides: Partial<IncidentDecisionRecord> & { decisionId: string }): IncidentDecisionRecord {
  return {
    tenantId: TENANT,
    incidentId: "incident-1",
    decidedBy: "user:operator-1",
    rationale: "Observed and closed with the declared evidence.",
    evidenceRefs: ["evidence:loop-1"],
    decidedAt: "2026-10-01T09:00:00Z",
    ...overrides,
  };
}

/** A fully closed loop: resolved incident + grouped alert + appended decision. */
function closedLoopSubstrate(): {
  alerts: readonly CommandAlert[];
  incidents: readonly Incident[];
  decisions: readonly IncidentDecisionRecord[];
} {
  const open = alert({ alertId: "a1", correlationGroup: "inc-1" });
  const resolved = incident({
    incidentId: "inc-1",
    state: "RESOLVED",
    resolvedAt: "2026-10-01T09:30:00Z",
    evidence: [{ evidenceId: "e1", source: "security", reference: "evidence:sec-1" }],
  });
  const ledger = appendIncidentDecision([], decision({ decisionId: "d1", incidentId: "inc-1" }));
  return { alerts: [open], incidents: [resolved], decisions: ledger };
}

/* ────────────────────────────────────────────────────────────
 * 1. Projection correctness (alerts → incidents, discipline)
 * ────────────────────────────────────────────────────────────*/

describe("open-alert projection", () => {
  it("projects only open alerts with declared severity, subjects and observation instants", () => {
    const resolvedAlert = alert({ alertId: "a-res", status: "RESOLVED" });
    const suppressed = alert({ alertId: "a-sup", status: "SUPPRESSED" });
    const open = alert({ alertId: "a-open", acknowledgedAt: "2026-10-01T08:30:00Z" });
    const projection = projectCommandCentre({
      tenantId: TENANT,
      alerts: [resolvedAlert, suppressed, open],
      incidents: [],
    });
    expect(projection.openAlerts.map((a) => a.alertId)).toEqual(["a-open"]);
    expect(projection.openAlerts[0]?.firstObservedAt).toBe("2026-10-01T08:00:00Z");
    expect(projection.openAlerts[0]?.lastObservedAt).toBe("2026-10-01T08:30:00Z");
    expect(projection.openAlerts[0]?.subjectRefs).toEqual(["identity:subject-1"]);
  });

  it("orders severity-descending then oldest-first (severity discipline)", () => {
    const low = alert({ alertId: "a-low", severity: "LOW", createdAt: "2026-10-01T07:00:00Z" });
    const criticalOld = alert({
      alertId: "a-crit",
      severity: "CRITICAL",
      createdAt: "2026-10-01T06:00:00Z",
    });
    const high = alert({ alertId: "a-high", severity: "HIGH", createdAt: "2026-10-01T05:00:00Z" });
    const projection = projectCommandCentre({
      tenantId: TENANT,
      alerts: [low, criticalOld, high],
      incidents: [],
    });
    expect(projection.openAlerts.map((a) => a.alertId)).toEqual(["a-crit", "a-high", "a-low"]);
  });
});

describe("incident grouping (declared correlation only)", () => {
  it("groups alerts under incidents via the declared correlation link", () => {
    const a1 = alert({ alertId: "a1", correlationGroup: "inc-1", severity: "CRITICAL" });
    const a2 = alert({ alertId: "a2", correlationGroup: "inc-1", severity: "MEDIUM" });
    const a3 = alert({ alertId: "a3" });
    const inc1 = incident({ incidentId: "inc-1" });
    const projection = projectCommandCentre({
      tenantId: TENANT,
      alerts: [a1, a2, a3],
      incidents: [inc1],
    });
    expect(projection.incidents).toHaveLength(1);
    const projected = projection.incidents[0];
    expect(projected?.alertIds).toEqual(["a1", "a2"]);
    expect(projected?.highestAlertSeverity).toBe("CRITICAL");
    expect(projected?.open).toBe(true);
    expect(projected?.closed).toBe(false);
    expect(projected?.lifecycleState).toBe("DETECTED");
  });

  it("surfaces an alert correlated to an unknown incident as a defect, never silently dropped", () => {
    const orphan = alert({ alertId: "a-orphan", correlationGroup: "inc-unknown" });
    const projection = projectCommandCentre({
      tenantId: TENANT,
      alerts: [orphan],
      incidents: [],
    });
    expect(projection.incidents).toEqual([]);
    expect(projection.defects.map((defect) => defect.reason)).toContain(
      "unknown_incident_reference",
    );
  });

  it("derives lifecycle openness from the incident state machine's own closed states", () => {
    const resolved = incident({ incidentId: "inc-1", state: "RESOLVED", resolvedAt: "2026-10-01T09:00:00Z" });
    const closed = incident({ incidentId: "inc-2", state: "CLOSED", resolvedAt: "2026-10-01T09:00:00Z" });
    const mitigated = incident({ incidentId: "inc-3", state: "MITIGATED" });
    const projection = projectCommandCentre({
      tenantId: TENANT,
      alerts: [],
      incidents: [resolved, closed, mitigated],
    });
    const byId = new Map(projection.incidents.map((entry) => [entry.incidentId, entry]));
    expect(byId.get("inc-1")?.closed).toBe(true);
    expect(byId.get("inc-2")?.closed).toBe(true);
    expect(byId.get("inc-3")?.open).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────
 * 2. Append-only decision records
 * ────────────────────────────────────────────────────────────*/

describe("append-only decision records", () => {
  it("appends without modifying the input ledger or any existing record", () => {
    const first = decision({ decisionId: "d1" });
    const ledger = Object.freeze([Object.freeze(first)]);
    const second = decision({ decisionId: "d2", decidedAt: "2026-10-01T10:00:00Z" });
    const appended = appendIncidentDecision(ledger, second);
    expect(appended).toHaveLength(2);
    expect(appended[0]).toEqual(first);
    expect(appended[1]).toEqual(second);
    expect(ledger).toHaveLength(1);
  });

  it("fails closed on rewriting history under an existing decision id", () => {
    const ledger = appendIncidentDecision([], decision({ decisionId: "d1" }));
    expect(() =>
      appendIncidentDecision(ledger, decision({ decisionId: "d1", rationale: "changed my mind" })),
    ).toThrow(CommandCentreAppendError);
  });

  it("fails closed on blank decided-by, blank rationale, or a non-ISO audit instant", () => {
    expect(() =>
      appendIncidentDecision([], decision({ decisionId: "d1", decidedBy: "  " })),
    ).toThrow(CommandCentreAppendError);
    expect(() =>
      appendIncidentDecision([], decision({ decisionId: "d1", rationale: "" })),
    ).toThrow(CommandCentreAppendError);
    expect(() =>
      appendIncidentDecision([], decision({ decisionId: "d1", decidedAt: "not-a-time" })),
    ).toThrow(CommandCentreAppendError);
  });

  it("projects the ledger in append order with provenance (decided-by, rationale, evidence)", () => {
    const ledger = appendIncidentDecision(
      appendIncidentDecision([], decision({ decisionId: "d1" })),
      decision({ decisionId: "d2", decidedAt: "2026-10-01T10:00:00Z" }),
    );
    const projection = projectCommandCentre({ tenantId: TENANT, alerts: [], incidents: [incident({ incidentId: "incident-1" })], decisions: ledger });
    expect(projection.decisions.map((entry) => entry.decisionId)).toEqual(["d1", "d2"]);
    expect(projection.decisions[0]?.decidedBy).toBe("user:operator-1");
    expect(projection.decisions[0]?.evidenceRefs).toEqual(["evidence:loop-1"]);
  });
});

/* ────────────────────────────────────────────────────────────
 * 3. Observation closure (E-018)
 * ────────────────────────────────────────────────────────────*/

describe("observation closure — the loop closes for humans", () => {
  it("closes only when outcome + observation + evidence all hold", () => {
    const substrate = closedLoopSubstrate();
    const projection = projectCommandCentre({ ...substrate, tenantId: TENANT });
    const closure = projection.closures[0];
    expect(closure?.outcomeRecorded).toBe(true);
    expect(closure?.observationRecorded).toBe(true);
    expect(closure?.evidenceBearing).toBe(true);
    expect(closure?.closed).toBe(true);
    expect(closure?.closedAt).toBe("2026-10-01T09:30:00Z");
    expect(closure?.evidenceRefs).toContain("evidence:sec-1");
    expect(closure?.evidenceRefs).toContain("evidence:loop-1");
  });

  it("keeps the loop open when the outcome is recorded but no observation re-entered", () => {
    const resolved = incident({
      incidentId: "inc-1",
      state: "RESOLVED",
      resolvedAt: "2026-10-01T09:30:00Z",
      evidence: [{ evidenceId: "e1", source: "security", reference: "evidence:sec-1" }],
    });
    const projection = projectCommandCentre({
      tenantId: TENANT,
      alerts: [],
      incidents: [resolved],
    });
    const closure = projection.closures[0];
    expect(closure?.outcomeRecorded).toBe(true);
    expect(closure?.observationRecorded).toBe(false);
    expect(closure?.closed).toBe(false);
    expect(closure?.closedAt).toBeNull();
  });

  it("keeps the loop open when the closure is not evidence-bearing (E-018)", () => {
    const resolved = incident({
      incidentId: "inc-1",
      state: "RESOLVED",
      resolvedAt: "2026-10-01T09:30:00Z",
    });
    const ledger = appendIncidentDecision(
      [],
      decision({
        decisionId: "d1",
        incidentId: "inc-1",
        evidenceRefs: [],
      }),
    );
    const projection = projectCommandCentre({
      tenantId: TENANT,
      alerts: [],
      incidents: [resolved],
      decisions: ledger,
    });
    const closure = projection.closures[0];
    expect(closure?.outcomeRecorded).toBe(true);
    expect(closure?.observationRecorded).toBe(true);
    expect(closure?.evidenceBearing).toBe(false);
    expect(closure?.closed).toBe(false);
  });

  it("E-018: loop re-entry sees closed loops as closed (deterministic re-projection)", () => {
    const substrate = { ...closedLoopSubstrate(), tenantId: TENANT };
    const first = projectCommandCentre(substrate);
    const second = projectCommandCentre(substrate);
    expect(second.closures).toEqual(first.closures);
    expect(first.closures[0]?.closed).toBe(true);
    expect(second.closures[0]?.closed).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────
 * 4. Tenant scoping
 * ────────────────────────────────────────────────────────────*/

describe("tenant scoping (total — Constitution §13)", () => {
  it("never projects a cross-tenant record and leaks none of its references", () => {
    const foreignAlert = alert({ alertId: "a-foreign", tenantId: OTHER_TENANT, correlationGroup: "inc-1" });
    const foreignIncident = incident({ incidentId: "inc-foreign", tenantId: OTHER_TENANT });
    const foreignDecision = decision({ decisionId: "d-foreign", tenantId: OTHER_TENANT });
    const projection = projectCommandCentre({
      tenantId: TENANT,
      alerts: [foreignAlert],
      incidents: [foreignIncident],
      decisions: [foreignDecision],
    });
    expect(projection.openAlerts).toEqual([]);
    expect(projection.incidents).toEqual([]);
    expect(projection.decisions).toEqual([]);
    expect(JSON.stringify(projection)).not.toContain("a-foreign");
    expect(JSON.stringify(projection)).not.toContain("inc-foreign");
    expect(JSON.stringify(projection)).not.toContain("d-foreign");
    expect(projection.excludedForeignTenantCount).toBe(3);
  });

  it("treats a scope-less record as a defect (a projection without tenant scope is a defect)", () => {
    const anonymous = alert({ alertId: "a-anon", tenantId: "" as CommandAlert["tenantId"] });
    const projection = projectCommandCentre({
      tenantId: TENANT,
      alerts: [anonymous],
      incidents: [],
    });
    expect(projection.openAlerts).toEqual([]);
    expect(projection.defects).toEqual([
      expect.objectContaining({ reason: "missing_tenant_scope", ref: "a-anon" }),
    ]);
  });

  it("fails closed on an observation cursor scoped to another tenant", () => {
    expect(() =>
      projectCommandCentre({
        tenantId: TENANT,
        alerts: [],
        incidents: [],
        cursor: { tenantId: OTHER_TENANT, sinceAt: "2026-10-01T00:00:00Z" },
      }),
    ).toThrow(CommandCentreAppendError);
  });
});

/* ────────────────────────────────────────────────────────────
 * 5. Delta by observation cursor
 * ────────────────────────────────────────────────────────────*/

describe("delta projections (what changed since the operator's cursor)", () => {
  const cursor = { tenantId: TENANT, sinceAt: "2026-10-01T08:00:00Z" };

  it("reports new, updated and closed records since the declared frontier", () => {
    const before = alert({ alertId: "a-old", createdAt: "2026-10-01T07:00:00Z", correlationGroup: "inc-1" });
    const beforeResolved = incident({
      incidentId: "inc-1",
      detectedAt: "2026-10-01T07:30:00Z",
      state: "RESOLVED",
      resolvedAt: "2026-10-01T08:45:00Z",
    });
    const after = alert({ alertId: "a-new", createdAt: "2026-10-01T08:30:00Z" });
    const afterIncident = incident({ incidentId: "inc-2", detectedAt: "2026-10-01T08:40:00Z" });
    const ledger = appendIncidentDecision(
      [],
      decision({ decisionId: "d-new", incidentId: "inc-2", decidedAt: "2026-10-01T09:10:00Z" }),
    );
    const projection = projectCommandCentre({
      tenantId: TENANT,
      alerts: [before, after],
      incidents: [beforeResolved, afterIncident],
      decisions: ledger,
      cursor,
    });
    expect(projection.delta.newAlertIds).toEqual(["a-new"]);
    expect(projection.delta.newIncidentIds).toEqual(["inc-2"]);
    expect(projection.delta.incidentsClosedSince).toEqual(["inc-1"]);
    expect(projection.delta.newDecisionIds).toEqual(["d-new"]);
  });

  it("classifies a re-observed (acknowledged) alert as updated, not new", () => {
    const acknowledged = alert({
      alertId: "a-1",
      createdAt: "2026-10-01T07:00:00Z",
      acknowledgedAt: "2026-10-01T08:20:00Z",
    });
    const projection = projectCommandCentre({
      tenantId: TENANT,
      alerts: [acknowledged],
      incidents: [],
      cursor,
    });
    expect(projection.delta.newAlertIds).toEqual([]);
    expect(projection.delta.updatedAlertIds).toEqual(["a-1"]);
  });

  it("records nothing as changed when nothing changed since the cursor", () => {
    const substrate = { ...closedLoopSubstrate(), tenantId: TENANT };
    const fresh = projectCommandCentre({ ...substrate, cursor: null });
    const then = projectCommandCentre({ ...substrate, cursor: { tenantId: TENANT, sinceAt: "2026-10-01T23:59:59Z" } });
    expect(fresh.delta.cursor).toBeNull();
    expect(then.delta.newAlertIds).toEqual([]);
    expect(then.delta.updatedAlertIds).toEqual([]);
    expect(then.delta.newIncidentIds).toEqual([]);
    expect(then.delta.incidentsClosedSince).toEqual([]);
    expect(then.delta.newDecisionIds).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────
 * 6. Read-only guarantee + surfaced quota evidence
 * ────────────────────────────────────────────────────────────*/

describe("read-only guarantee (the centre never mutates canonical truth)", () => {
  it("projects without mutating deep-frozen substrate records", () => {
    const substrate = closedLoopSubstrate();
    const frozenAlerts = Object.freeze(substrate.alerts.map((entry) => Object.freeze({ ...entry })));
    const frozenIncidents = Object.freeze(substrate.incidents.map((entry) => Object.freeze({ ...entry })));
    const frozenDecisions = Object.freeze(substrate.decisions.map((entry) => Object.freeze({ ...entry })));
    const projection = projectCommandCentre({
      tenantId: TENANT,
      alerts: frozenAlerts,
      incidents: frozenIncidents,
      decisions: frozenDecisions,
      cursor: { tenantId: TENANT, sinceAt: "2026-10-01T08:00:00Z" },
    });
    expect(projection.openAlerts).toHaveLength(1);
    expect(projection.incidents).toHaveLength(1);
    expect(projection.decisions).toHaveLength(1);
    expect(Object.isFrozen(projection.openAlerts)).toBe(true);
    expect(Object.isFrozen(projection.incidents)).toBe(true);
    expect(Object.isFrozen(projection.closures)).toBe(true);
    expect(Object.isFrozen(projection.decisions)).toBe(true);
    expect(Object.isFrozen(projection.defects)).toBe(true);
  });

  it("surfaces quota evidence through the metering contract's own evaluation, never a local recompute", async () => {
    const { rollUpCosts } = await import("../../frontend/src/lib/metering/cost-attribution");
    const rollUp = rollUpCosts([
      {
        tenantRef: TENANT,
        missionRef: "mission-1",
        actorRef: "worker-1",
        agentRef: null,
        model: "model-x",
        provider: "provider-x",
        purpose: "summarization",
        at: "2026-10-01T08:00:00Z",
        tokensIn: 100,
        tokensOut: 50,
        durationMs: 1000,
        estimatedCostUsd: 0.5,
      },
    ]);
    const projection = projectCommandCentre({
      tenantId: TENANT,
      alerts: [],
      incidents: [],
      quotaEvidence: { rollUp, quota: { tenantRef: TENANT, maxCostUsd: 1 } },
    });
    expect(projection.quotaEvidence?.decision).toBe("within");
    expect(projection.quotaEvidence).not.toBeNull();
  });
});
