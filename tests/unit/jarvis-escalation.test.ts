/**
 * CoreGrid — Jarvis V1 escalation ladder tests (V5.3 Part 15, fail-closed).
 *
 * Security negatives are mandatory (Constitution section 31): critical severity
 * must force human approval, records without evidence must be denied, and no
 * record may auto-resolve — closing requires a non-null humanRef or it fails
 * closed.
 */
import { describe, expect, it } from "vitest";
import {
  closeEscalationRecord,
  escalateIncident,
  isEscalationOpen,
  type EscalationRecord,
  type JarvisIncident,
} from "../../frontend/src/lib/jarvis/escalation";

function incidentFor(overrides?: Partial<JarvisIncident>): JarvisIncident {
  return {
    incidentRef: "incident-001",
    tenantRef: "tenant-alpha",
    severity: "warning",
    summary: "mission worker stalled on payment reconciliation",
    evidenceRefs: ["evidence-log-001", "evidence-log-002"],
    at: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("escalateIncident — deterministic ladder", () => {
  it("maps info to notify_only without mandatory approval", () => {
    const decision = escalateIncident(incidentFor({ severity: "info" }));
    expect(decision.decision).toBe("escalate");
    if (decision.decision === "escalate") {
      expect(decision.tier).toBe("notify_only");
      expect(decision.record.humanApprovalRequired).toBe(false);
    }
  });

  it("maps warning to request_human_approval", () => {
    const decision = escalateIncident(incidentFor({ severity: "warning" }));
    expect(decision.decision).toBe("escalate");
    if (decision.decision === "escalate") {
      expect(decision.tier).toBe("request_human_approval");
      expect(decision.record.humanApprovalRequired).toBe(true);
    }
  });

  it("maps critical to page_operator with mandatory human approval", () => {
    const decision = escalateIncident(incidentFor({ severity: "critical" }));
    expect(decision.decision).toBe("escalate");
    if (decision.decision === "escalate") {
      expect(decision.tier).toBe("page_operator");
      expect(decision.record.humanApprovalRequired).toBe(true);
    }
  });

  it("carries evidence refs into the record", () => {
    const decision = escalateIncident(incidentFor());
    expect(decision.decision).toBe("escalate");
    if (decision.decision === "escalate") {
      expect(decision.record.evidenceRefs).toEqual(["evidence-log-001", "evidence-log-002"]);
      expect(decision.record.closedByHumanRef).toBeNull();
    }
  });
});

describe("escalateIncident — fail-closed negatives", () => {
  it("denies incidents without evidence refs", () => {
    const decision = escalateIncident(incidentFor({ evidenceRefs: [] }));
    expect(decision).toEqual({
      decision: "deny",
      code: "evidence_required",
      reason: "Escalation records must carry at least one evidence ref",
    });
  });

  it("denies unknown severities", () => {
    const decision = escalateIncident(
      incidentFor({ severity: "sev:1" as JarvisIncident["severity"] }),
    );
    expect(decision.decision).toBe("deny");
    if (decision.decision === "deny") {
      expect(decision.code).toBe("invalid_severity");
    }
  });

  it("denies malformed incidents", () => {
    expect(escalateIncident(incidentFor({ incidentRef: "" })).decision).toBe("deny");
    expect(escalateIncident(incidentFor({ tenantRef: "" })).decision).toBe("deny");
    expect(escalateIncident(incidentFor({ summary: "" })).decision).toBe("deny");
  });
});

describe("closeEscalationRecord — no auto-resolve, fail closed", () => {
  function openCriticalRecord(): EscalationRecord {
    const decision = escalateIncident(incidentFor({ severity: "critical" }));
    if (decision.decision !== "escalate") {
      throw new Error("expected critical incident to escalate");
    }
    return decision.record;
  }

  it("refuses automated close attempts and keeps the critical record open", () => {
    const record = openCriticalRecord();
    const automatedRefs: (string | null)[] = [null, ""];
    for (const humanRef of automatedRefs) {
      const closure = closeEscalationRecord(record, humanRef);
      expect(closure.closed).toBe(false);
      if (!closure.closed) {
        expect(closure.code).toBe("human_required");
      }
      expect(isEscalationOpen(record)).toBe(true);
    }
  });

  it("keeps a critical record open until a human closes it", () => {
    const record = openCriticalRecord();
    expect(isEscalationOpen(record)).toBe(true);
    const closure = closeEscalationRecord(record, "human-oncall-7");
    expect(closure.closed).toBe(true);
    if (closure.closed) {
      expect(closure.record.closedByHumanRef).toBe("human-oncall-7");
    }
    expect(isEscalationOpen(closure.closed ? closure.record : record)).toBe(false);
  });

  it("refuses a second close of an already-closed record", () => {
    const record = openCriticalRecord();
    const first = closeEscalationRecord(record, "human-oncall-7");
    expect(first.closed).toBe(true);
    if (!first.closed) {
      throw new Error("expected first close to succeed");
    }
    const second = closeEscalationRecord(first.record, "human-oncall-9");
    expect(second.closed).toBe(false);
    if (!second.closed) {
      expect(second.code).toBe("already_closed");
    }
  });
});
