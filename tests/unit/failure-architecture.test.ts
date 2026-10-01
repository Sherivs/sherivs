/**
 * CoreGrid — failure & incident architecture contract tests (V1CAP-075,
 * MISSION-R-102 T1). Taxonomy completeness, containment correctness (no
 * fail-open, no silent containment, no auto-retry of critical modes),
 * append-only incident log, and escalation triggering.
 */
import { describe, expect, it } from "vitest";
import {
  CONTAINMENT_POSTURES,
  DEFAULT_ESCALATION_POLICY,
  FAILURE_MODES,
  FAILURE_TAXONOMY_ENTRIES,
  LOOP_STAGES,
  IncidentLog,
  auditTaxonomy,
  evaluateEscalation,
  failureModeSpec,
  isFailureMode,
  isLoopStage,
  recordAndEvaluate,
  type FailureMode,
  type LoopStage,
  type RecordIncidentInput,
} from "../../frontend/src/lib/reliability/failure-architecture";

const T0 = "2026-10-01T09:00:00.000Z";

function incidentInput(overrides: Partial<RecordIncidentInput> = {}): RecordIncidentInput {
  return {
    id: "inc-0001",
    stage: "action",
    mode: "unauthorized",
    detection: {
      signal: "authorization_denial",
      evidenceRef: "structured-log:line-42",
      observedAt: T0,
    },
    tenantId: "tenant-a",
    ...overrides,
  };
}

describe("failure-mode taxonomy completeness", () => {
  it("enumerates the eleven governed loop stages", () => {
    expect(LOOP_STAGES).toEqual([
      "observation",
      "context",
      "intelligence",
      "decision",
      "mission",
      "delegation",
      "worker_execution",
      "action",
      "evidence",
      "verification",
      "memory",
    ]);
  });

  it("enumerates exactly the six failure modes", () => {
    expect(FAILURE_MODES).toEqual(["absent", "stale", "wrong", "duplicate", "unauthorized", "degraded"]);
  });

  it("covers every stage × mode pair with no gaps (11 × 6 = 66)", () => {
    expect(FAILURE_TAXONOMY_ENTRIES).toHaveLength(LOOP_STAGES.length * FAILURE_MODES.length);
    for (const stage of LOOP_STAGES) {
      for (const mode of FAILURE_MODES) {
        const spec = failureModeSpec(stage, mode);
        expect(spec.stage).toBe(stage);
        expect(spec.mode).toBe(mode);
      }
    }
  });

  it("gives every entry a detect signal and a non-empty description", () => {
    for (const spec of FAILURE_TAXONOMY_ENTRIES) {
      expect(spec.detect.signal.length).toBeGreaterThan(0);
      expect(spec.detect.description.trim().length).toBeGreaterThan(0);
      expect(spec.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("passes its own integrity audit", () => {
    const audit = auditTaxonomy();
    expect(audit.ok).toBe(true);
    expect(audit.problems).toEqual([]);
    expect(audit.failOpenEntries).toBe(0);
    expect(audit.silentContainments).toBe(0);
    expect(audit.criticalWithAutoRetry).toBe(0);
    expect(audit.entries).toBe(66);
  });

  it("rejects unknown stage/mode lookups instead of inventing a spec", () => {
    expect(() =>
      failureModeSpec("not-a-stage" as LoopStage, "absent"),
    ).toThrow(TypeError);
    expect(() =>
      failureModeSpec("action", "not-a-mode" as FailureMode),
    ).toThrow(TypeError);
    expect(isLoopStage("action")).toBe(true);
    expect(isLoopStage("boss-stage")).toBe(false);
    expect(isFailureMode("unauthorized")).toBe(true);
    expect(isFailureMode("fail_open")).toBe(false);
  });
});

describe("containment correctness (no fail-open paths)", () => {
  it("uses only fail_closed / fail_degraded postures — fail_open is unrepresentable", () => {
    expect(CONTAINMENT_POSTURES).toEqual(["fail_closed", "fail_degraded"]);
    const postures = new Set(FAILURE_TAXONOMY_ENTRIES.map((spec) => spec.contain.posture));
    for (const posture of postures) {
      expect(CONTAINMENT_POSTURES).toContain(posture);
    }
    expect(postures.has("fail_open" as never)).toBe(false);
  });

  it("never leaves a containment silent: every response is non-empty", () => {
    for (const spec of FAILURE_TAXONOMY_ENTRIES) {
      expect(spec.contain.response.trim().length).toBeGreaterThan(0);
    }
  });

  it("every unauthorized mode is fail_closed and critical everywhere", () => {
    for (const stage of LOOP_STAGES) {
      const spec = failureModeSpec(stage, "unauthorized");
      expect(spec.contain.posture).toBe("fail_closed");
      expect(spec.severity).toBe("critical");
      expect(spec.autoRetry).toBe(false);
    }
  });

  it("every critical mode forbids automatic retry", () => {
    for (const spec of FAILURE_TAXONOMY_ENTRIES) {
      if (spec.severity === "critical") {
        expect(spec.autoRetry).toBe(false);
      }
    }
  });

  it("canonical-truth-corrupting modes (wrong evidence/verification/memory, duplicate action) are critical and fail closed", () => {
    for (const [stage, mode] of [
      ["evidence", "wrong"],
      ["verification", "wrong"],
      ["memory", "wrong"],
      ["action", "duplicate"],
      ["decision", "absent"],
      ["verification", "absent"],
    ] as const) {
      const spec = failureModeSpec(stage, mode);
      expect(spec.severity).toBe("critical");
      expect(spec.contain.posture).toBe("fail_closed");
    }
  });

  it("action duplicate containment enforces exactly-once under retry (J-030)", () => {
    const spec = failureModeSpec("action", "duplicate");
    expect(spec.detect.signal).toBe("idempotency_replay_detected");
    expect(spec.contain.posture).toBe("fail_closed");
  });
});

describe("incident log append-only", () => {
  it("records an incident with the full evidence shape", () => {
    const log = new IncidentLog();
    const view = log.record(incidentInput());
    expect(view.id).toBe("inc-0001");
    expect(view.seq).toBe(1);
    expect(view.stage).toBe("action");
    expect(view.mode).toBe("unauthorized");
    expect(view.severity).toBe("critical");
    expect(view.detection.evidenceRef).toBe("structured-log:line-42");
    expect(view.containment.posture).toBe("fail_closed");
    expect(view.containment.tenantId).toBe("tenant-a");
    expect(view.resolvedAt).toBeNull();
  });

  it("freezes every stored entry and never hands out the mutable internals", () => {
    const log = new IncidentLog();
    log.record(incidentInput());
    const entries = log.entries();
    expect(Object.isFrozen(entries[0])).toBe(true);
    expect(Object.isFrozen((entries[0] as { incident: object }).incident)).toBe(true);
    // The returned array is a copy: mutating it cannot touch the log…
    const copy = [...entries];
    copy.pop();
    expect(log.length).toBe(1);
    // …and the stored entry itself resists mutation.
    expect(() => {
      (entries[0] as unknown as { kind: string }).kind = "resolution";
    }).toThrow();
    expect(log.views()[0].id).toBe("inc-0001");
  });

  it("rejects duplicate incident ids (append-only, no rewrite)", () => {
    const log = new IncidentLog();
    log.record(incidentInput({ id: "inc-1" }));
    expect(() => log.record(incidentInput({ id: "inc-1" }))).toThrow(/append-only/);
    expect(log.length).toBe(1);
  });

  it("fails closed on incidents without detection evidence", () => {
    const log = new IncidentLog();
    expect(() =>
      log.record(
        incidentInput({ detection: { signal: "authorization_denial", evidenceRef: "  ", observedAt: T0 } }),
      ),
    ).toThrow(/evidence/);
    expect(() =>
      log.record(incidentInput({ detection: { signal: "authorization_denial", evidenceRef: "x", observedAt: "nope" } })),
    ).toThrow(/ISO/);
    expect(() => log.record(incidentInput({ id: "   " }))).toThrow(/id/);
    expect(log.length).toBe(0);
  });

  it("resolves by APPENDING a resolution entry, never by rewriting the original", () => {
    const log = new IncidentLog();
    log.record(incidentInput({ id: "inc-1" }));
    const before = log.entries();
    log.resolve({ incidentId: "inc-1", resolvedAt: T0, resolvedBy: "operator-7", note: "contained and verified" });
    const after = log.entries();

    expect(after.length).toBe(before.length + 1);
    // Original incident entry untouched.
    expect(after[0]).toEqual(before[0]);
    expect(after[1].kind).toBe("resolution");
    const resolution = (after[1] as { resolution: { incidentId: string; resolvedAt: string; resolvedBy: string } })
      .resolution;
    expect(resolution.incidentId).toBe("inc-1");
    expect(resolution.resolvedAt).toBe(T0);
    expect(resolution.resolvedBy).toBe("operator-7");
    expect(log.view("inc-1")?.resolvedAt).toBe(T0);
    expect(log.openIncidents()).toHaveLength(0);
  });

  it("refuses double resolution and resolution of unknown incidents", () => {
    const log = new IncidentLog();
    log.record(incidentInput({ id: "inc-1" }));
    log.resolve({ incidentId: "inc-1", resolvedAt: T0, resolvedBy: "operator-7" });
    expect(() => log.resolve({ incidentId: "inc-1", resolvedAt: T0, resolvedBy: "operator-7" })).toThrow(
      /append-only/,
    );
    expect(() => log.resolve({ incidentId: "ghost", resolvedAt: T0, resolvedBy: "operator-7" })).toThrow(
      /unknown incident/,
    );
  });

  it("derives severity and containment from the taxonomy, not from the caller", () => {
    const log = new IncidentLog();
    const view = log.record(incidentInput({ stage: "memory", mode: "duplicate" }));
    const spec = failureModeSpec("memory", "duplicate");
    expect(view.severity).toBe(spec.severity);
    expect(view.containment.posture).toBe(spec.contain.posture);
    expect(view.containment.response).toBe(spec.contain.response);
  });

  it("tracks per-(stage, mode) occurrence counts in append order", () => {
    const log = new IncidentLog();
    log.record(incidentInput({ id: "a", stage: "worker_execution", mode: "absent" }));
    log.record(incidentInput({ id: "b", stage: "worker_execution", mode: "absent" }));
    log.record(incidentInput({ id: "c", stage: "action", mode: "absent" }));
    expect(log.countFor("worker_execution", "absent")).toBe(2);
    expect(log.countFor("action", "absent")).toBe(1);
    expect(log.countFor("memory", "wrong")).toBe(0);
    expect(log.forStageMode("worker_execution", "absent").map((v) => v.id)).toEqual(["a", "b"]);
  });
});

describe("escalation rule", () => {
  it("escalates every critical incident immediately", () => {
    const log = new IncidentLog();
    const view = log.record(incidentInput({ stage: "decision", mode: "wrong" }));
    const decision = evaluateEscalation(view, log, Date.parse(view.detectedAt));
    expect(decision.escalate).toBe(true);
    expect(decision.route).toBe("human_operator_via_notification_escalation");
    expect(decision.autoRetry).toBe("prohibited");
    expect(decision.reasons[0]).toMatch(/immediate escalation set/);
  });

  it("never auto-retries critical incidents", () => {
    const log = new IncidentLog();
    const critical = log.record(incidentInput({ stage: "evidence", mode: "absent" }));
    expect(evaluateEscalation(critical, log, Date.parse(critical.detectedAt)).autoRetry).toBe("prohibited");
    const minor = log.record(
      incidentInput({
        id: "inc-0002",
        stage: "evidence",
        mode: "degraded",
        detection: { signal: "structured_log_error", evidenceRef: "log-1", observedAt: T0 },
      }),
    );
    expect(evaluateEscalation(minor, log, Date.parse(minor.detectedAt)).autoRetry).toBe("permitted");
  });

  it("escalates repeated non-critical incidents of the same stage+mode at the threshold", () => {
    const log = new IncidentLog();
    const input = () =>
      incidentInput({
        stage: "observation",
        mode: "stale",
        detection: { signal: "staleness_probe", evidenceRef: "log-stale", observedAt: T0 },
      });
    const first = log.record({ ...input(), id: "s-1" });
    const second = log.record({ ...input(), id: "s-2" });
    expect(evaluateEscalation(first, log, Date.parse(first.detectedAt)).escalate).toBe(false);
    // Second occurrence: 2 < threshold 3 → no escalation yet.
    expect(evaluateEscalation(second, log, Date.parse(second.detectedAt)).escalate).toBe(false);
    const third = log.record({ ...input(), id: "s-3" });
    const decision = evaluateEscalation(third, log, Date.parse(third.detectedAt));
    expect(decision.escalate).toBe(true);
    expect(decision.reasons[0]).toMatch(/3 incidents of \(observation, stale\)/);
  });

  it("does not count repeats outside the window", () => {
    const log = new IncidentLog();
    const old = log.record(
      incidentInput({
        id: "old-1",
        stage: "observation",
        mode: "stale",
        detection: { signal: "staleness_probe", evidenceRef: "log-old", observedAt: "2026-09-01T09:00:00.000Z" },
      }),
    );
    const fresh = log.record(
      incidentInput({
        id: "fresh-1",
        stage: "observation",
        mode: "stale",
        detection: { signal: "staleness_probe", evidenceRef: "log-fresh", observedAt: T0 },
      }),
    );
    expect(evaluateEscalation(fresh, log, Date.parse(fresh.detectedAt)).escalate).toBe(false);
    expect(evaluateEscalation(old, log, Date.parse(old.detectedAt)).escalate).toBe(false);
  });

  it("does not count repeats across different stage+mode pairs", () => {
    const log = new IncidentLog();
    // All minor "degraded" modes: none critical, so only repeats can escalate.
    log.record(
      incidentInput({ id: "r1", stage: "observation", mode: "degraded", detection: { signal: "health_probe_degraded", evidenceRef: "log-1", observedAt: T0 } }),
    );
    log.record(
      incidentInput({ id: "r2", stage: "evidence", mode: "degraded", detection: { signal: "structured_log_error", evidenceRef: "log-2", observedAt: T0 } }),
    );
    const third = log.record(
      incidentInput({ id: "r3", stage: "verification", mode: "degraded", detection: { signal: "health_probe_degraded", evidenceRef: "log-3", observedAt: T0 } }),
    );
    expect(third.severity).not.toBe("critical");
    expect(evaluateEscalation(third, log, Date.parse(third.detectedAt)).escalate).toBe(false);
  });

  it("escalates non-critical modes in the immediate set when configured", () => {
    const log = new IncidentLog();
    const view = log.record(incidentInput({ stage: "observation", mode: "stale" }));
    const decision = evaluateEscalation(view, log, Date.parse(view.detectedAt), {
      ...DEFAULT_ESCALATION_POLICY,
      immediateSeverities: ["critical", "major"],
    });
    expect(decision.escalate).toBe(true);
    expect(decision.route).toBe("human_operator_via_notification_escalation");
  });

  it("records the escalation flag on the incident via recordAndEvaluate", () => {
    const log = new IncidentLog();
    // Critical: escalates on first occurrence, flag set at append time.
    const criticalResult = recordAndEvaluate(log, incidentInput({ id: "crit-1", stage: "mission", mode: "duplicate" }));
    expect(criticalResult.decision.escalate).toBe(true);
    expect(criticalResult.view.escalated).toBe(true);
    expect(criticalResult.decision.autoRetry).toBe("prohibited");

    // Non-critical below threshold: no escalation, no flag.
    const staleInput = () =>
      incidentInput({
        stage: "observation",
        mode: "stale",
        detection: { signal: "staleness_probe", evidenceRef: "log-stale", observedAt: T0 },
      });
    const first = recordAndEvaluate(log, { ...staleInput(), id: "s-1" });
    expect(first.decision.escalate).toBe(false);
    expect(first.view.escalated).toBe(false);

    // Third repeat: escalation decision flips, and the flag was set on append.
    recordAndEvaluate(log, { ...staleInput(), id: "s-2" });
    const third = recordAndEvaluate(log, { ...staleInput(), id: "s-3" });
    expect(third.decision.escalate).toBe(true);
    expect(third.view.escalated).toBe(true);
  });
});