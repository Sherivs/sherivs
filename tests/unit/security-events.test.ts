/**
 * CoreGrid Scholar — Phase 08 Security Engine unit tests (security-events).
 *
 * Validates:
 * - Security event contract and immutability (Sections F.3, S.2, AT.7).
 * - Security alert creation and status transitions (Section W).
 * - Security incident lifecycle and closure requirements (Section X).
 * - Security evidence record creation (Section Y).
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import { correlationId, traceId } from "@/lib/runtime-core";
import {
  createSecurityEvent,
  assertSecurityEventImmutable,
  createSecurityAlert,
  transitionSecurityAlert,
  createSecurityIncident,
  transitionSecurityIncident,
  isIncidentTransitionAllowed,
  createSecurityEvidenceRecord,
} from "@/lib/security-events";

const TENANT_A = tenantId("tenant-a");
const NOW = "2026-01-01T00:00:00Z";

function baseEvent() {
  return createSecurityEvent({
    type: "login_failure",
    actorId: "user-1",
    tenantId: TENANT_A,
    resource: "session",
    action: "login",
    source: "security-gateway",
    severity: "MEDIUM",
    evidence: ["3 failed attempts in 60s"],
    correlationId: correlationId("corr-1"),
    traceId: traceId("trace-1"),
    now: NOW,
  });
}

describe("createSecurityEvent (Sections F.3, S.2)", () => {
  it("creates an event with all contract fields and deleted=false", () => {
    const event = baseEvent();
    expect(event.type).toBe("login_failure");
    expect(event.deleted).toBe(false);
    expect(event.tenantId).toBe(TENANT_A);
  });

  it("never allows a deleted event (Section AT.7)", () => {
    const event = baseEvent();
    expect(() => assertSecurityEventImmutable(event)).not.toThrow();
  });
});

describe("createSecurityAlert (Section W)", () => {
  it("rejects an out-of-range confidence value", () => {
    const result = createSecurityAlert({
      event: baseEvent(),
      confidence: 1.5,
      recommendedResponse: "block",
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("creates an open alert from an event", () => {
    const result = createSecurityAlert({
      event: baseEvent(),
      confidence: 0.8,
      recommendedResponse: "block IP",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.alert.status).toBe("open");
      expect(result.alert.severity).toBe("MEDIUM");
    }
  });
});

describe("transitionSecurityAlert", () => {
  it("allows open -> acknowledged", () => {
    const created = createSecurityAlert({
      event: baseEvent(),
      confidence: 0.5,
      recommendedResponse: "review",
      now: NOW,
    });
    if (!created.ok) throw new Error("fixture failed");
    const result = transitionSecurityAlert(created.alert, "acknowledged", NOW);
    expect(result.ok).toBe(true);
  });

  it("rejects resolved -> open (terminal state)", () => {
    const created = createSecurityAlert({
      event: baseEvent(),
      confidence: 0.5,
      recommendedResponse: "review",
      now: NOW,
    });
    if (!created.ok) throw new Error("fixture failed");
    const resolved = { ...created.alert, status: "resolved" as const };
    const result = transitionSecurityAlert(resolved, "open", NOW);
    expect(result.ok).toBe(false);
  });
});

describe("Security incidents (Section X)", () => {
  it("requires an owner to create an incident", () => {
    const result = createSecurityIncident({
      ownerId: "",
      severity: "HIGH",
      evidenceRefs: [],
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("creates an incident in the detected state", () => {
    const result = createSecurityIncident({
      ownerId: "sec-1",
      severity: "HIGH",
      evidenceRefs: ["evt-1"],
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.incident.state).toBe("detected");
      expect(result.incident.timeline).toHaveLength(1);
    }
  });

  it("follows the ordered lifecycle detected -> triaged -> investigating -> contained -> remediating -> recovered -> closed -> reviewed", () => {
    expect(isIncidentTransitionAllowed("detected", "triaged")).toBe(true);
    expect(isIncidentTransitionAllowed("detected", "closed")).toBe(false);
    expect(isIncidentTransitionAllowed("reviewed", "detected")).toBe(false);
  });

  it("requires a resolution before closing", () => {
    const created = createSecurityIncident({
      ownerId: "sec-1",
      severity: "HIGH",
      evidenceRefs: [],
      now: NOW,
    });
    if (!created.ok) throw new Error("fixture failed");
    let incident = created.incident;
    for (const to of [
      "triaged",
      "investigating",
      "contained",
      "remediating",
      "recovered",
    ] as const) {
      const step = transitionSecurityIncident(incident, to, `moved to ${to}`, NOW);
      if (!step.ok) throw new Error(`transition to ${to} failed`);
      incident = step.incident;
    }
    const closeResult = transitionSecurityIncident(incident, "closed", "closing", NOW);
    expect(closeResult.ok).toBe(false);

    const withResolution = { ...incident, resolution: "Remediated and verified" };
    const closeWithResolution = transitionSecurityIncident(
      withResolution,
      "closed",
      "closing",
      NOW,
    );
    expect(closeWithResolution.ok).toBe(true);
  });
});

describe("createSecurityEvidenceRecord (Section Y)", () => {
  it("creates an access-controlled evidence record", () => {
    const record = createSecurityEvidenceRecord("security_event", "evt-1", NOW);
    expect(record.accessControlled).toBe(true);
    expect(record.referenceType).toBe("security_event");
    expect(record.capturedAt).toBe(NOW);
  });
});
