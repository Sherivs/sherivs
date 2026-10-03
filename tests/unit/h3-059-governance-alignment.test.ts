/**
 * CoreGrid — H3-059 governance-alignment contract tests (mission G-059).
 * Zod validation of phase-39 alignment substrate contracts: expectations,
 * evidence-based conformance, drift records with actor attribution,
 * advisory-only escalations, and the human-governance relaxation posture
 * (AGENTS §7, §44). Pure offline: no network, no database, no secrets.
 */
import { describe, expect, it } from "vitest";
import {
  GOVERNANCE_ALIGNMENT_BOUNDARY,
  HUMAN_GOVERNANCE_POSTURE,
  MAX_EVIDENCE_PER_RECORD,
  MAX_EXPECTATIONS_PER_SET,
  SEVERITY_ORDER,
  STATEMENT_MAX_LENGTH,
  alignmentDriftRecordSchema,
  alignmentExpectationSchema,
  conformanceResultSchema,
  decideEscalation,
  decideRelaxation,
  escalationPolicySchema,
  escalationRecordSchema,
  parseAlignmentExpectations,
  severityAtLeast,
  summarizeConformance,
  type AlignmentExpectation,
  type ConformanceResult,
} from "../../frontend/src/lib/governance-alignment/contracts";

const DECLARED_AT = "2026-10-03T00:00:00.000Z";
const EVALUATED_AT = "2026-10-03T01:00:00.000Z";

const PROVENANCE = {
  declaredBy: "role:contract-architect",
  authority: "AGENTS.md §42 / H3 wave mission G-059",
  declaredAt: DECLARED_AT,
};

function expectation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    expectationId: "no_self_issued_permissions",
    kind: "boundary_respect",
    statement:
      "an autonomous agent never grants itself a permission it did not hold at declaration time",
    severity: "critical",
    measurableVia: "permission-diff check between declared scope and exercised scope",
    version: 1,
    status: "active",
    provenance: PROVENANCE,
    ...overrides,
  };
}

function evidence(ref: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    evidenceRef: ref,
    evidenceKind: "record_reference",
    capturedAt: EVALUATED_AT,
    capturedBy: "role:alignment-evaluator",
    ...overrides,
  };
}

function result(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    expectationId: "no_self_issued_permissions",
    expectationVersion: 1,
    subject: { subjectRef: "agent:worker-7", subjectKind: "autonomous_agent" },
    evaluatedAt: EVALUATED_AT,
    outcome: "conformant",
    evidence: [evidence("obs_001")],
    ...overrides,
  };
}

function drift(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    driftId: "drift_scope_expansion",
    expectationId: "no_self_issued_permissions",
    expectationVersion: 1,
    actor: { subjectRef: "agent:worker-7", subjectKind: "autonomous_agent" },
    severity: "warning",
    firstObservedAt: "2026-10-03T01:00:00.000Z",
    lastObservedAt: "2026-10-03T02:00:00.000Z",
    resultRefs: ["res_001"],
    evidence: [evidence("obs_001")],
    ...overrides,
  };
}

function policy(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    policyId: "drift_escalation_default",
    minEscalationSeverity: "notice",
    oversightRole: "role:human-oversight",
    maxOpenEscalations: 100,
    advisoryOnly: true,
    ...overrides,
  };
}

const APPROVAL = {
  approvedBy: "human:platform-steward",
  authority: "governance review board",
  decidedAt: EVALUATED_AT,
};

function typedExpectation(overrides: Record<string, unknown> = {}): AlignmentExpectation {
  const parsed = alignmentExpectationSchema.safeParse(expectation(overrides));
  if (!parsed.success) throw new Error("fixture must parse");
  return parsed.data;
}

function typedResult(overrides: Record<string, unknown> = {}): ConformanceResult {
  const parsed = conformanceResultSchema.safeParse(result(overrides));
  if (!parsed.success) throw new Error("fixture must parse");
  return parsed.data;
}

describe("alignment expectation schema", () => {
  it("accepts a complete, measurable, provenance-backed expectation", () => {
    const parsed = alignmentExpectationSchema.safeParse(expectation());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.kind).toBe("boundary_respect");
      expect(parsed.data.severity).toBe("critical");
    }
  });

  it("rejects unmeasurable declarations — measurableVia is mandatory", () => {
    const missing = expectation();
    delete missing.measurableVia;
    expect(alignmentExpectationSchema.safeParse(missing).success).toBe(false);

    expect(
      alignmentExpectationSchema.safeParse(expectation({ measurableVia: "   " })).success,
    ).toBe(false);
  });

  it("rejects anonymous declarations — provenance is mandatory (AGENTS §12)", () => {
    const anonymous = expectation();
    delete anonymous.provenance;
    expect(alignmentExpectationSchema.safeParse(anonymous).success).toBe(false);
  });

  it("rejects silent retirements — a retired expectation must name its reason", () => {
    expect(
      alignmentExpectationSchema.safeParse(expectation({ status: "retired" })).success,
    ).toBe(false);
    expect(
      alignmentExpectationSchema.safeParse(
        expectation({ status: "retired", retiredReason: "superseded by version 2" }),
      ).success,
    ).toBe(true);
  });

  it("rejects malformed identifiers and overlong statements (bounded inputs)", () => {
    expect(alignmentExpectationSchema.safeParse(expectation({ expectationId: "NoGood" })).success).toBe(false);
    expect(alignmentExpectationSchema.safeParse(expectation({ expectationId: "" })).success).toBe(false);
    expect(
      alignmentExpectationSchema.safeParse(
        expectation({ statement: "x".repeat(STATEMENT_MAX_LENGTH + 1) }),
      ).success,
    ).toBe(false);
  });

  it("rejects unknown keys (strict shape) so permissive semantics cannot leak in", () => {
    const extra = expectation({ defaultSatisfied: true });
    expect(alignmentExpectationSchema.safeParse(extra).success).toBe(false);
  });
});

describe("expectation set parsing (fail-closed, no partial sets)", () => {
  it("parses a valid set of expectations", () => {
    const parsed = parseAlignmentExpectations([
      expectation(),
      expectation({ expectationId: "policy_conformance_declared", kind: "policy_conformance", severity: "notice" }),
    ]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.expectations).toHaveLength(2);
  });

  it("rejects malformed inputs with structured issues", () => {
    for (const bad of [null, undefined, 42, "expectations", {}, [[]]]) {
      const parsed = parseAlignmentExpectations(bad);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.reason).toBe("invalid_shape");
        expect(parsed.issues.length).toBeGreaterThan(0);
        expect(typeof parsed.issues[0].path).toBe("string");
        expect(typeof parsed.issues[0].message).toBe("string");
      }
    }
  });

  it("rejects duplicate expectation ids — one id, one declaration", () => {
    const parsed = parseAlignmentExpectations([
      expectation(),
      expectation({ version: 2 }),
    ]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe("cross_record_invariant");
      expect(parsed.issues[0].message).toContain("duplicate");
    }
  });

  it("rejects sets above the bounded expectation count", () => {
    const many = Array.from({ length: MAX_EXPECTATIONS_PER_SET + 1 }, (_, i) =>
      expectation({ expectationId: `expectation_${i}` }),
    );
    const parsed = parseAlignmentExpectations(many);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
  });
});

describe("conformance results (evidence-based; canonical truth, AGENTS §9)", () => {
  it("accepts a conformant result backed by evidence", () => {
    expect(conformanceResultSchema.safeParse(result()).success).toBe(true);
  });

  it("rejects an evidence-free result — nothing is assumed satisfied", () => {
    const bare = result();
    delete bare.evidence;
    expect(conformanceResultSchema.safeParse(bare).success).toBe(false);
    expect(conformanceResultSchema.safeParse(result({ evidence: [] })).success).toBe(false);
  });

  it("rejects evidence sets above the bounded maximum", () => {
    const many = Array.from({ length: MAX_EVIDENCE_PER_RECORD + 1 }, (_, i) =>
      evidence(`obs_${i}`),
    );
    expect(conformanceResultSchema.safeParse(result({ evidence: many })).success).toBe(false);
  });

  it("requires a named gap for nonconformant outcomes — gaps are never silent", () => {
    expect(conformanceResultSchema.safeParse(result({ outcome: "nonconformant" })).success).toBe(false);
    expect(
      conformanceResultSchema.safeParse(
        result({ outcome: "nonconformant", gap: "exercised scope exceeded declared scope by one grant" }),
      ).success,
    ).toBe(true);
  });

  it("requires a reason for unmeasurable outcomes — unmeasurable is a defect, not a pass", () => {
    expect(conformanceResultSchema.safeParse(result({ outcome: "unmeasurable" })).success).toBe(false);
    expect(
      conformanceResultSchema.safeParse(
        result({ outcome: "unmeasurable", unmeasurableReason: "evidence_insufficient" }),
      ).success,
    ).toBe(true);
    expect(
      conformanceResultSchema.safeParse(
        result({ outcome: "unmeasurable", unmeasurableReason: "something_else" }),
      ).success,
    ).toBe(false);
  });

  it("rejects unmeasurableReason on measured outcomes", () => {
    expect(
      conformanceResultSchema.safeParse(
        result({ outcome: "conformant", unmeasurableReason: "evidence_insufficient" }),
      ).success,
    ).toBe(false);
  });

  it("summarizes conformance fail-closed: unmeasurable counts as a defect", () => {
    const summary = summarizeConformance([
      typedResult(),
      typedResult({
        expectationId: "policy_conformance_declared",
        outcome: "nonconformant",
        gap: "declared policy not matched by observed behaviour",
      }),
      typedResult({
        expectationId: "invariant_hold_declared",
        outcome: "unmeasurable",
        unmeasurableReason: "expectation_not_measurable",
      }),
    ]);
    expect(summary.total).toBe(3);
    expect(summary.conformant).toBe(1);
    expect(summary.nonconformant).toBe(1);
    expect(summary.unmeasurable).toBe(1);
    expect(summary.ok).toBe(false);
    expect(summary.gapExpectationIds).toEqual(["policy_conformance_declared"]);
    expect(summary.unmeasurableExpectationIds).toEqual(["invariant_hold_declared"]);
    expect(summary.detail).toContain("unmeasurable is never treated as satisfied");
  });

  it("reports ok only for fully evidenced, fully conformant results", () => {
    const summary = summarizeConformance([typedResult()]);
    expect(summary.ok).toBe(true);
    expect(summary.detail).toBeNull();
  });

  it("never reports ok for an empty result set — absence of measurement is not conformance", () => {
    const summary = summarizeConformance([]);
    expect(summary.total).toBe(0);
    expect(summary.ok).toBe(false);
    expect(summary.detail).not.toBeNull();
  });
});

describe("drift records (attributed, evidence-backed)", () => {
  it("accepts a complete drift record with actor attribution", () => {
    expect(alignmentDriftRecordSchema.safeParse(drift()).success).toBe(true);
  });

  it("rejects unattributed drift — actor attribution is mandatory", () => {
    const anonymous = drift();
    delete anonymous.actor;
    expect(alignmentDriftRecordSchema.safeParse(anonymous).success).toBe(false);
  });

  it("rejects drift without evidence or result references", () => {
    const noRefs = drift();
    delete noRefs.resultRefs;
    expect(alignmentDriftRecordSchema.safeParse(noRefs).success).toBe(false);
    expect(alignmentDriftRecordSchema.safeParse(drift({ evidence: [] })).success).toBe(false);
  });

  it("rejects a lastObservedAt that precedes firstObservedAt", () => {
    expect(
      alignmentDriftRecordSchema.safeParse(
        drift({ firstObservedAt: "2026-10-03T02:00:00.000Z", lastObservedAt: "2026-10-03T01:00:00.000Z" }),
      ).success,
    ).toBe(false);
  });

  it("orders severities so the escalation threshold is well-defined", () => {
    expect(SEVERITY_ORDER.info).toBeLessThan(SEVERITY_ORDER.notice);
    expect(SEVERITY_ORDER.notice).toBeLessThan(SEVERITY_ORDER.warning);
    expect(SEVERITY_ORDER.warning).toBeLessThan(SEVERITY_ORDER.critical);
    expect(severityAtLeast("critical", "notice")).toBe(true);
    expect(severityAtLeast("info", "notice")).toBe(false);
  });
});

describe("escalation (advisory-only by construction)", () => {
  it("binds policies to the advisory-only literal — a policy can never claim enforcement", () => {
    expect(escalationPolicySchema.safeParse(policy()).success).toBe(true);
    expect(escalationPolicySchema.safeParse(policy({ advisoryOnly: false })).success).toBe(false);
    const missing = policy();
    delete missing.advisoryOnly;
    expect(escalationPolicySchema.safeParse(missing).success).toBe(false);
  });

  it("binds escalation records to authorizes:false — the surface cannot express an authorization", () => {
    const record = {
      escalationId: "esc_001",
      driftId: "drift_scope_expansion",
      expectationId: "no_self_issued_permissions",
      routedTo: "role:human-oversight",
      routedAt: EVALUATED_AT,
      status: "open",
      authorizes: false,
    };
    expect(escalationRecordSchema.safeParse(record).success).toBe(true);
    expect(escalationRecordSchema.safeParse({ ...record, authorizes: true }).success).toBe(false);
    const missing: Partial<typeof record> = { ...record };
    delete missing.authorizes;
    expect(escalationRecordSchema.safeParse(missing).success).toBe(false);
  });

  it("requires a human closure record to close an escalation — no machine closure", () => {
    const base = {
      escalationId: "esc_001",
      driftId: "drift_scope_expansion",
      expectationId: "no_self_issued_permissions",
      routedTo: "role:human-oversight",
      routedAt: EVALUATED_AT,
      authorizes: false,
    };
    expect(
      escalationRecordSchema.safeParse({ ...base, status: "closed_by_human" }).success,
    ).toBe(false);
    expect(
      escalationRecordSchema.safeParse({
        ...base,
        status: "closed_by_human",
        closedByHuman: { humanRef: "human:platform-steward", decidedAt: EVALUATED_AT, note: "confirmed and routed upstream" },
      }).success,
    ).toBe(true);
    expect(
      escalationRecordSchema.safeParse({ ...base, status: "open", closedByHuman: { humanRef: "human:platform-steward", decidedAt: EVALUATED_AT, note: "premature" } }).success,
    ).toBe(false);
  });

  it("escalates drift at or above the policy threshold", () => {
    const typedPolicy = escalationPolicySchema.parse(policy());
    const typedDrift = alignmentDriftRecordSchema.parse(drift({ severity: "warning" }));
    const decision = decideEscalation(typedPolicy, typedDrift);
    expect(decision.decision).toBe("escalate");
    if (decision.decision === "escalate") {
      expect(decision.routedTo).toBe("role:human-oversight");
      expect(decision.detail).toContain("authorizes nothing");
    }
  });

  it("always escalates critical drift — no policy can exempt the most severe class", () => {
    const criticalDrift = alignmentDriftRecordSchema.parse(drift({ severity: "critical" }));
    const permissivePolicy = escalationPolicySchema.parse(policy({ minEscalationSeverity: "critical" }));
    const decision = decideEscalation(permissivePolicy, criticalDrift);
    expect(decision.decision).toBe("escalate");
  });

  it("monitors below-threshold drift without absorbing it silently", () => {
    const typedPolicy = escalationPolicySchema.parse(policy({ minEscalationSeverity: "warning" }));
    const infoDrift = alignmentDriftRecordSchema.parse(drift({ severity: "info" }));
    const decision = decideEscalation(typedPolicy, infoDrift);
    expect(decision.decision).toBe("monitor");
    if (decision.decision === "monitor") {
      expect(decision.detail).toContain("never absorbed silently");
    }
  });

  it("exposes the advisory boundary as a citable constant", () => {
    expect(GOVERNANCE_ALIGNMENT_BOUNDARY).toContain("never enforces, grants, denies, or authorizes");
    expect(GOVERNANCE_ALIGNMENT_BOUNDARY).toContain("enforcement authority remains with the phases that own it");
  });
});

describe("human governance posture (AGENTS §7, §8, §44)", () => {
  it("refuses to relax a constitutional-boundary expectation unconditionally — no approval unlocks it", () => {
    const constitutional = typedExpectation({ kind: "constitutional_boundary" });
    const decision = decideRelaxation(constitutional, APPROVAL);
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toBe("constitutional_boundary_immutable");
      expect(decision.detail).toContain("may not independently redefine architecture or remove security boundaries");
    }
  });

  it("refuses even a fabricated approval on a security boundary expectation", () => {
    const constitutional = typedExpectation({ kind: "constitutional_boundary" });
    const forged = {
      approvedBy: "agent:self",
      authority: "self-granted",
      decidedAt: EVALUATED_AT,
    };
    const decision = decideRelaxation(constitutional, forged);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("constitutional_boundary_immutable");
  });

  it("requires a valid human approval record for non-constitutional changes — malformed approvals fail closed", () => {
    const ordinary = typedExpectation({ kind: "policy_conformance", severity: "notice" });

    for (const bad of [undefined, null, {}, { approvedBy: "agent:self" }, { ...APPROVAL, approvedBy: "" }, { ...APPROVAL, decidedAt: "not-a-timestamp" }]) {
      const decision = decideRelaxation(ordinary, bad);
      expect(decision.ok).toBe(false);
      if (!decision.ok) expect(decision.reason).toBe("human_approval_invalid");
    }

    const approved = decideRelaxation(ordinary, APPROVAL);
    expect(approved.ok).toBe(true);
    if (approved.ok) expect(approved.expectationId).toBe("no_self_issued_permissions");
  });

  it("publishes the human-governance posture as a citable constant", () => {
    expect(HUMAN_GOVERNANCE_POSTURE).toContain("may not independently redefine architecture or remove security boundaries");
    expect(HUMAN_GOVERNANCE_POSTURE).toContain("human approval");
  });
});

describe("module hygiene", () => {
  it("carries bounded ceilings that are positive integers", () => {
    expect(STATEMENT_MAX_LENGTH).toBeGreaterThan(0);
    expect(MAX_EXPECTATIONS_PER_SET).toBeGreaterThan(0);
    expect(MAX_EVIDENCE_PER_RECORD).toBeGreaterThan(0);
    expect(Number.isInteger(STATEMENT_MAX_LENGTH)).toBe(true);
    expect(Number.isInteger(MAX_EXPECTATIONS_PER_SET)).toBe(true);
    expect(Number.isInteger(MAX_EVIDENCE_PER_RECORD)).toBe(true);
  });

  it("exposes every contract schema for downstream phase-39 consumers", () => {
    for (const schema of [
      alignmentExpectationSchema,
      conformanceResultSchema,
      alignmentDriftRecordSchema,
      escalationPolicySchema,
      escalationRecordSchema,
    ]) {
      expect(typeof schema.safeParse).toBe("function");
    }
  });
});
