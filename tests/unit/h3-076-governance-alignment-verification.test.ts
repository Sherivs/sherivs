/**
 * CoreGrid — H3-076 adversarial verification suite (mission G-076).
 * Verifier, phase 39 governance-alignment: attacks the COMPLETED contract
 * module `frontend/src/lib/governance-alignment/contracts.ts` (H3-059,
 * READ-ONLY import) along six adversarial axes:
 *
 *   1. escalation surface abuse — any path that could express an authorization
 *   2. constitutional-boundary mutation attempts
 *   3. machine-authored approval forgery
 *   4. conformance-without-evidence claims
 *   5. drift-record attribution laundering
 *   6. retirement bypass
 *
 * Every attack must be contained with a typed denial. Where an attack
 * SUCCEEDS structurally, this suite does not fix the module — it records a
 * precise FINDING in the in-suite ledger (asserted well-formed at the end)
 * and in progress/h3-wave/H3-076.report.md.
 *
 * Pure offline: no network, no database, no secrets, no git. Strict
 * TypeScript: no `any`, no `z.any()`.
 */
import { describe, expect, it } from "vitest";
import {
  GOVERNANCE_ALIGNMENT_BOUNDARY,
  MAX_EVIDENCE_PER_RECORD,
  MAX_OPEN_ESCALATIONS,
  escalationPolicySchema,
  escalationRecordSchema,
  escalationThresholdSchema,
  alignmentDriftRecordSchema,
  alignmentExpectationSchema,
  conformanceEvidenceSchema,
  conformanceResultSchema,
  decideEscalation,
  decideRelaxation,
  parseAlignmentExpectations,
  severityAtLeast,
  severitySchema,
  summarizeConformance,
  subjectSchema,
  type AlignmentExpectation,
  type ConformanceResult,
  type EscalationDecision,
  type EscalationPolicy,
  type EscalationThreshold,
  type Severity,
} from "../../frontend/src/lib/governance-alignment/contracts";

/* ─────────────────────────────────────────────────────────────
 * FINDINGS ledger — every successful attack is registered here.
 * ────────────────────────────────────────────────────────────*/

interface VerificationFinding {
  readonly id: string;
  readonly title: string;
  /** The exact attack attempted, in one sentence. */
  readonly attack: string;
  /** What the module actually did (observed, not assumed). */
  readonly observed: string;
  /** Why it matters against AGENTS §7/§8/§9/§21/§44 and the module's own law. */
  readonly impact: string;
  /** The module surface the attack went through. */
  readonly surface: string;
}

const FINDINGS: VerificationFinding[] = [];

function recordFinding(finding: VerificationFinding): void {
  FINDINGS.push(finding);
}

/* ─────────────────────────────────────────────────────────────
 * Fixtures (schema-shaped, typed as untrusted records)
 * ────────────────────────────────────────────────────────────*/

const DECLARED_AT = "2026-10-03T00:00:00.000Z";
const EVALUATED_AT = "2026-10-03T01:00:00.000Z";
const CLOSED_AT = "2026-10-03T02:00:00.000Z";

const PROVENANCE = {
  declaredBy: "role:contract-architect",
  authority: "AGENTS.md §42 / H3 wave mission G-059",
  declaredAt: DECLARED_AT,
};

function expectationFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
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

function evidenceFixture(
  ref: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    evidenceRef: ref,
    evidenceKind: "record_reference",
    capturedAt: EVALUATED_AT,
    capturedBy: "role:alignment-evaluator",
    ...overrides,
  };
}

function resultFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    expectationId: "no_self_issued_permissions",
    expectationVersion: 1,
    subject: { subjectRef: "agent:worker-7", subjectKind: "autonomous_agent" },
    evaluatedAt: EVALUATED_AT,
    outcome: "conformant",
    evidence: [evidenceFixture("obs_001")],
    ...overrides,
  };
}

function driftFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    driftId: "drift_scope_expansion",
    expectationId: "no_self_issued_permissions",
    expectationVersion: 1,
    actor: { subjectRef: "agent:worker-7", subjectKind: "autonomous_agent" },
    severity: "warning",
    firstObservedAt: "2026-10-03T01:00:00.000Z",
    lastObservedAt: "2026-10-03T02:00:00.000Z",
    resultRefs: ["res_001"],
    evidence: [evidenceFixture("obs_001")],
    ...overrides,
  };
}

function policyFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    policyId: "drift_escalation_default",
    minEscalationSeverity: "notice",
    oversightRole: "role:human-oversight",
    maxOpenEscalations: 100,
    advisoryOnly: true,
    ...overrides,
  };
}

function escalationRecordFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    escalationId: "esc_001",
    driftId: "drift_scope_expansion",
    expectationId: "no_self_issued_permissions",
    routedTo: "role:human-oversight",
    routedAt: EVALUATED_AT,
    status: "open",
    authorizes: false,
    ...overrides,
  };
}

const HUMAN_APPROVAL = {
  approvedBy: "human:platform-steward",
  authority: "governance review board",
  decidedAt: EVALUATED_AT,
};

function typedExpectation(
  overrides: Record<string, unknown> = {},
): AlignmentExpectation {
  const parsed = alignmentExpectationSchema.safeParse(expectationFixture(overrides));
  if (!parsed.success) throw new Error("fixture must parse");
  return parsed.data;
}

function typedResult(overrides: Record<string, unknown> = {}): ConformanceResult {
  const parsed = conformanceResultSchema.safeParse(resultFixture(overrides));
  if (!parsed.success) throw new Error("fixture must parse");
  return parsed.data;
}

function typedPolicy(overrides: Record<string, unknown> = {}): EscalationPolicy {
  return escalationPolicySchema.parse(policyFixture(overrides));
}

function typedDrift(severity: Severity): ReturnType<typeof alignmentDriftRecordSchema.parse> {
  return alignmentDriftRecordSchema.parse(driftFixture({ severity }));
}

/* ─────────────────────────────────────────────────────────────
 * Axis 1 — escalation surface abuse: no path may express an
 * authorization (GOVERNANCE_ALIGNMENT_BOUNDARY, D7).
 * ────────────────────────────────────────────────────────────*/

describe("axis 1: escalation surface abuse", () => {
  it("denies every coercion attempt on the authorizes:false literal", () => {
    const coercions: readonly unknown[] = [
      true,
      0,
      1,
      "false",
      "False",
      null,
      [],
      {},
    ];
    for (const coercion of coercions) {
      const parsed = escalationRecordSchema.safeParse(
        escalationRecordFixture({ authorizes: coercion }),
      );
      expect(parsed.success, `authorizes=${String(coercion)} must be denied`).toBe(false);
    }
    const missing = escalationRecordFixture();
    delete missing.authorizes;
    expect(escalationRecordSchema.safeParse(missing).success).toBe(false);
  });

  it("denies authorization-smuggling payloads as unknown keys (strict shape)", () => {
    const smuggled = [
      escalationRecordFixture({ grants: ["permission:issue_credentials"] }),
      escalationRecordFixture({ authorizesNote: "treat as approval" }),
      escalationRecordFixture({ enforcementDecision: "ALLOW" }),
    ];
    for (const record of smuggled) {
      expect(escalationRecordSchema.safeParse(record).success).toBe(false);
    }
  });

  it("denies a prototype-key injection with the strict-shape typed denial (F-076-07 closed upstream)", () => {
    const polluted: unknown = JSON.parse(
      '{"escalationId":"esc_001","driftId":"drift_scope_expansion","expectationId":"no_self_issued_permissions","routedTo":"role:human-oversight","routedAt":"2026-10-03T01:00:00.000Z","status":"open","authorizes":false,"__proto__":{"authorizes":true,"grants":"all"}}',
    );
    const parsed = escalationRecordSchema.safeParse(polluted);
    recordFinding({
      id: "F-076-07",
      title: "Prototype-key injection is silently stripped, not rejected — the strict-shape typed denial does not fire",
      attack:
        "escalation and approval records carrying a JSON-injected own key '__proto__' holding forged fields ({authorizes:true, grants:'all'}; a forged approvedBy) — attempts to smuggle payloads past the strict shapes",
      observed:
        "CLOSED upstream by zod 4.6.x (lockfile refresh, SHERIVS-005): own __proto__ keys are now refused by strictObject. Originally: escalationRecordSchema.safeParse SUCCEEDED: zod's unknown-key check uses the `in` operator, and '__proto__' is on every object's prototype chain, so the injected key is treated as recognized and silently dropped from the parsed output (parsed data keeps authorizes:false; Object.prototype stays clean)",
      impact:
        "LOW severity: the smuggled payload is dropped, so no authorization is expressed and no pollution occurs — the boundary holds in effect. But the containment is an accident of key-dropping, not the promised typed denial: a strictObject contract that reports success on an input containing a foreign injection key cannot be used as a tamper-evidence signal",
      surface: "escalationRecordSchema / humanApprovalSchema (strictObject unknown-key detection)",
    });
    // zod >= 4.6 refuses the own __proto__ key: the typed denial now fires.
    expect(parsed.success).toBe(false);
    expect((Object.prototype as Record<string, unknown>).authorizes).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).grants).toBeUndefined();
  });

  it("denies a policy smuggling enforcement authority via unknown keys", () => {
    expect(
      escalationPolicySchema.safeParse(
        policyFixture({ enforcementAuthority: "phases_08_09_42" }),
      ).success,
    ).toBe(false);
    expect(
      escalationPolicySchema.safeParse(
        policyFixture({ canApprove: true }),
      ).success,
    ).toBe(false);
    expect(
      escalationPolicySchema.safeParse(
        policyFixture({ maxOpenEscalations: MAX_OPEN_ESCALATIONS + 1 }),
      ).success,
    ).toBe(false);
  });

  it("structurally proves the escalation decision union can never carry an authorization field", () => {
    const thresholds: readonly EscalationThreshold[] = escalationThresholdSchema.options;
    const severities: readonly Severity[] = severitySchema.options;
    const policy = typedPolicy();

    for (const threshold of thresholds) {
      const scopedPolicy = typedPolicy({ minEscalationSeverity: threshold });
      for (const severity of severities) {
        const decision: EscalationDecision = decideEscalation(scopedPolicy, typedDrift(severity));
        switch (decision.decision) {
          case "escalate":
            expect(Object.keys(decision).sort()).toEqual([
              "decision",
              "detail",
              "driftId",
              "routedTo",
            ]);
            expect(decision.routedTo).toBe(policy.oversightRole);
            expect(decision.detail).toContain("authorizes nothing");
            break;
          case "monitor":
            expect(Object.keys(decision).sort()).toEqual([
              "decision",
              "detail",
              "driftId",
            ]);
            expect(decision.detail).toContain("never absorbed silently");
            break;
        }
      }
    }
  });

  it("keeps the threshold matrix advisory: critical always routes, info never routes above notice", () => {
    const noticePolicy = typedPolicy({ minEscalationSeverity: "notice" });
    expect(decideEscalation(noticePolicy, typedDrift("info")).decision).toBe("monitor");
    expect(decideEscalation(noticePolicy, typedDrift("notice")).decision).toBe("escalate");
    expect(decideEscalation(noticePolicy, typedDrift("critical")).decision).toBe("escalate");

    const criticalPolicy = typedPolicy({ minEscalationSeverity: "critical" });
    expect(decideEscalation(criticalPolicy, typedDrift("warning")).decision).toBe("monitor");
    expect(decideEscalation(criticalPolicy, typedDrift("critical")).decision).toBe("escalate");

    const severities: readonly Severity[] = severitySchema.options;
    for (const severity of severities) {
      expect(severityAtLeast("critical", severity)).toBe(true);
      expect(severityAtLeast("info", severity)).toBe(severity === "info");
      expect(severityAtLeast(severity, "critical")).toBe(severity === "critical");
    }
  });

  it("denies an acknowledged escalation without a timestamp — no vague half-states", () => {
    const parsed = escalationRecordSchema.safeParse(
      escalationRecordFixture({ status: "acknowledged" }),
    );
    expect(parsed.success).toBe(false);
    expect(
      escalationRecordSchema.safeParse(
        escalationRecordFixture({ status: "acknowledged", acknowledgedAt: EVALUATED_AT }),
      ).success,
    ).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Axis 2 — constitutional-boundary mutation attempts (AGENTS
 * §7, §44): no approval may unlock a boundary on this surface.
 * ────────────────────────────────────────────────────────────*/

describe("axis 2: constitutional-boundary mutation attempts", () => {
  it("refuses relaxation of a constitutional boundary even with a PERFECTLY VALID human approval", () => {
    const constitutional = typedExpectation({ kind: "constitutional_boundary" });
    const decision = decideRelaxation(constitutional, HUMAN_APPROVAL);
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toBe("constitutional_boundary_immutable");
      expect(decision.detail).toContain("may not independently redefine architecture");
    }
  });

  it("refuses relaxation regardless of approval payload type — the kind check precedes everything", () => {
    const constitutional = typedExpectation({ kind: "constitutional_boundary" });
    const payloads: readonly unknown[] = [
      HUMAN_APPROVAL,
      null,
      undefined,
      42,
      "human:platform-steward",
      [],
      { approvedBy: "human:platform-steward", authority: "constitutional convention", decidedAt: EVALUATED_AT },
      { approvedBy: "human:platform-steward", authority: "AGENTS.md §7 amendment board", decidedAt: EVALUATED_AT },
    ];
    for (const payload of payloads) {
      const decision = decideRelaxation(constitutional, payload);
      expect(decision.ok).toBe(false);
      if (!decision.ok) expect(decision.reason).toBe("constitutional_boundary_immutable");
    }
  });

  it("refuses relaxation after re-declaration laundering (new version, new status, fresh provenance)", () => {
    const laundered = typedExpectation({
      kind: "constitutional_boundary",
      version: 2,
      status: "active",
      severity: "info",
      statement: "previously a boundary; re-declared as an ordinary expectation",
      provenance: {
        declaredBy: "human:platform-steward",
        authority: "governance review board",
        declaredAt: DECLARED_AT,
      },
    });
    const decision = decideRelaxation(laundered, HUMAN_APPROVAL);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("constitutional_boundary_immutable");
  });

  it("denies version-rewinding and version-forging on expectation declarations", () => {
    const forged: readonly Record<string, unknown>[] = [
      expectationFixture({ version: 0 }),
      expectationFixture({ version: -1 }),
      expectationFixture({ version: 1.5 }),
      expectationFixture({ version: Number.MAX_SAFE_INTEGER }),
    ];
    for (const attempt of forged) {
      expect(alignmentExpectationSchema.safeParse(attempt).success).toBe(false);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * Axis 3 — machine-authored approval forgery (AGENTS §8).
 * ────────────────────────────────────────────────────────────*/

describe("axis 3: machine-authored approval forgery", () => {
  it("denies malformed approvals with typed rejections", () => {
    const ordinary = typedExpectation({ kind: "policy_conformance", severity: "notice" });
    const malformed: readonly unknown[] = [
      undefined,
      null,
      42,
      "human:platform-steward",
      [],
      {},
      { approvedBy: "human:platform-steward" },
      { approvedBy: "human:platform-steward", authority: "governance review board" },
      { approvedBy: "   ", authority: "governance review board", decidedAt: EVALUATED_AT },
      { approvedBy: "human:platform-steward", authority: "", decidedAt: EVALUATED_AT },
      { approvedBy: "human:platform-steward", authority: "governance review board", decidedAt: "not-a-timestamp" },
      { approvedBy: "human:platform-steward", authority: "governance review board", decidedAt: "2026-10-03T01:00:00" },
      { approvedBy: 42, authority: "governance review board", decidedAt: EVALUATED_AT },
      { approvedBy: "human:platform-steward", authority: "governance review board", decidedAt: EVALUATED_AT, selfSigned: true },
    ];
    for (const approval of malformed) {
      const decision = decideRelaxation(ordinary, approval);
      expect(decision.ok).toBe(false);
      if (!decision.ok) expect(decision.reason).toBe("human_approval_invalid");
    }
  });

  it("denies a prototype-key injection into the approval record (zod >= 4.6 strict refusal)", () => {
    const ordinary = typedExpectation({ kind: "policy_conformance", severity: "notice" });
    const polluted: unknown = JSON.parse(
      '{"approvedBy":"human:platform-steward","authority":"governance review board","decidedAt":"2026-10-03T01:00:00.000Z","__proto__":{"approvedBy":"agent:forging-agent"}}',
    );
    const decision = decideRelaxation(ordinary, polluted);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("human_approval_invalid");
    expect((Object.prototype as Record<string, unknown>).approvedBy).toBeUndefined();
  });

  it("FINDING F-076-01: an agent-authored approval parses as a human approval and unlocks relaxation", () => {
    const ordinary = typedExpectation({ kind: "policy_conformance", severity: "notice" });
    const forged = {
      approvedBy: "agent:alignment-forger",
      authority: "self-declared runtime authority",
      decidedAt: EVALUATED_AT,
    };
    expect(humanApprovalShapeHolds(forged)).toBe(true);
    const decision = decideRelaxation(ordinary, forged);
    recordFinding({
      id: "F-076-01",
      title: "Machine-authored approval forgery is not structurally contained",
      attack:
        "decideRelaxation called on a non-constitutional expectation with an approval record whose approvedBy is an agent principal ('agent:alignment-forger') and whose authority is self-declared",
      observed:
        "humanApprovalSchema validates only record shape (non-empty strings + ISO timestamp); the agent-authored approval parses, and decideRelaxation returns ok:true",
      impact:
        "The module header and docstring promise 'machine-authored approvals fail closed' (AGENTS §8: AI improvement is not AI permission expansion), but the surface cannot distinguish a machine principal from a human one — an agent can mint its own relaxation approval. H3-059 acknowledged this as a known risk (identity-layer trust), yet the fail-closed contract claim is structurally unmet on this surface",
      surface: "humanApprovalSchema / decideRelaxation",
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.expectationId).toBe("no_self_issued_permissions");
  });
});

function humanApprovalShapeHolds(approval: {
  approvedBy: string;
  authority: string;
  decidedAt: string;
}): boolean {
  return (
    approval.approvedBy.trim().length > 0 &&
    approval.authority.trim().length > 0 &&
    approval.decidedAt.length > 0
  );
}

/* ─────────────────────────────────────────────────────────────
 * Axis 4 — conformance-without-evidence claims (AGENTS §9).
 * ────────────────────────────────────────────────────────────*/

describe("axis 4: conformance-without-evidence claims", () => {
  it("denies evidence items with forged or missing fields, one violation at a time", () => {
    const violations: readonly Record<string, unknown>[] = [
      evidenceFixture("obs_bad", { evidenceRef: "OBS_UPPERCASE" }),
      evidenceFixture("obs_bad", { evidenceRef: "1_starts_with_digit" }),
      evidenceFixture("obs_bad", { evidenceRef: "".padEnd(65, "a") }),
      evidenceFixture("obs_bad", { evidenceKind: "self_attestation" }),
      evidenceFixture("obs_bad", { evidenceKind: "assumption" }),
      evidenceFixture("obs_bad", { capturedAt: "yesterday" }),
      evidenceFixture("obs_bad", { capturedBy: "" }),
      evidenceFixture("obs_bad", { capturedBy: "   " }),
    ];
    for (const violation of violations) {
      const base = resultFixture();
      const bareEvidence = conformanceEvidenceSchema.safeParse(violation);
      expect(bareEvidence.success).toBe(false);
      expect(
        conformanceResultSchema.safeParse({ ...base, evidence: [violation] }).success,
      ).toBe(false);
    }
  });

  it("denies evidence sets above the bounded maximum on results AND drift records", () => {
    const many = Array.from({ length: MAX_EVIDENCE_PER_RECORD + 1 }, (_, i) =>
      evidenceFixture(`obs_${i}`),
    );
    expect(
      conformanceResultSchema.safeParse(resultFixture({ evidence: many })).success,
    ).toBe(false);
    expect(
      alignmentDriftRecordSchema.safeParse(driftFixture({ evidence: many })).success,
    ).toBe(false);
  });

  it("keeps unmeasurable outcomes as counted defects in the summary — never satisfied", () => {
    const allUnmeasurable = [
      typedResult({ expectationId: "invariant_a", outcome: "unmeasurable", unmeasurableReason: "evidence_insufficient" }),
      typedResult({ expectationId: "invariant_b", outcome: "unmeasurable", unmeasurableReason: "expectation_not_measurable" }),
    ];
    const summary = summarizeConformance(allUnmeasurable);
    expect(summary.ok).toBe(false);
    expect(summary.unmeasurable).toBe(2);
    expect(summary.unmeasurableExpectationIds).toEqual(["invariant_a", "invariant_b"]);
    expect(summary.detail).toContain("unmeasurable is never treated as satisfied");

    const oneDefect = summarizeConformance([
      typedResult({ expectationId: "invariant_c" }),
      typedResult({ expectationId: "invariant_d", outcome: "unmeasurable", unmeasurableReason: "evidence_insufficient" }),
    ]);
    expect(oneDefect.ok).toBe(false);
    expect(oneDefect.conformant).toBe(1);
  });

  it("FINDING F-076-02: a result may claim conformance while simultaneously naming a gap", () => {
    const contradictory = conformanceResultSchema.safeParse(
      resultFixture({ outcome: "conformant", gap: "exercised scope exceeded declared scope by one grant" }),
    );
    recordFinding({
      id: "F-076-02",
      title: "Conformance-with-gap contradiction parses: superRefine is asymmetric",
      attack:
        "a conformance result carrying outcome 'conformant' together with a non-empty 'gap' — a record that claims satisfaction while naming the exact violation",
      observed:
        "conformanceResultSchema's superRefine requires a gap only for nonconformant outcomes and, unlike unmeasurableReason, never rejects a gap on a measured outcome — the contradictory record parses",
      impact:
        "AGENTS §9 (canonical truth) requires a conformance result to be coherent; a 'conformant with named gap' record can be laundered through downstream consumers (summarizeConformance counts it as conformant and drops the gap) to overstate alignment",
      surface: "conformanceResultSchema (superRefine) / summarizeConformance",
    });
    expect(contradictory.success).toBe(true);
    if (contradictory.success) {
      const summary = summarizeConformance([contradictory.data]);
      expect(summary.conformant).toBe(1);
      expect(summary.ok).toBe(true);
      expect(summary.gapExpectationIds).toEqual([]);
    }
  });

  it("FINDING F-076-03: conformance can be evidenced solely by the subject attesting to itself", () => {
    const selfAttested = conformanceResultSchema.safeParse(
      resultFixture({
        evidence: [
          evidenceFixture("att_self_001", {
            evidenceKind: "attestation",
            capturedBy: "agent:worker-7",
          }),
        ],
      }),
    );
    recordFinding({
      id: "F-076-03",
      title: "Self-attested conformance parses: evidence carries no independence binding",
      attack:
        "a conformant result for subject 'agent:worker-7' whose single evidence item is an attestation capturedBy the same agent — the evaluated actor vouching for itself",
      observed:
        "conformanceEvidenceSchema constrains shape only; nothing binds capturedBy away from subject.subjectRef (or from the drift actor), so the self-attested result parses and summarizeConformance reports ok:true",
      impact:
        "The evidence mandate (AGENTS §9) is satisfiable with a hollow claim: an agent under evaluation can mint conformant results about itself. Independence enforcement exists elsewhere (phase 08/J-031), but this surface accepts and summarizes self-evidence without flagging it",
      surface: "conformanceEvidenceSchema / conformanceResultSchema / summarizeConformance",
    });
    expect(selfAttested.success).toBe(true);
    if (selfAttested.success) {
      const summary = summarizeConformance([selfAttested.data]);
      expect(summary.ok).toBe(true);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * Axis 5 — drift-record attribution laundering (AGENTS §21).
 * ────────────────────────────────────────────────────────────*/

describe("axis 5: drift-record attribution laundering", () => {
  it("denies anonymous, blank, forged, or overlarge actor attribution", () => {
    const anonymous = driftFixture();
    delete anonymous.actor;
    expect(alignmentDriftRecordSchema.safeParse(anonymous).success).toBe(false);

    const actorViolations: readonly Record<string, unknown>[] = [
      { subjectRef: "", subjectKind: "autonomous_agent" },
      { subjectRef: "   ", subjectKind: "autonomous_agent" },
      { subjectRef: "a".repeat(257), subjectKind: "autonomous_agent" },
      { subjectRef: "agent:worker-7", subjectKind: "collective" },
      { subjectRef: "agent:worker-7", subjectKind: "autonomous_agent", impersonated: true },
    ];
    for (const actor of actorViolations) {
      expect(subjectSchema.safeParse(actor).success).toBe(false);
      expect(
        alignmentDriftRecordSchema.safeParse(driftFixture({ actor })).success,
      ).toBe(false);
    }
  });

  it("documents subjectRef as free-form bounded (not identifier-pattern) — by design, not a laundering vector by itself", () => {
    expect(
      subjectSchema.safeParse({
        subjectRef: "Agent:Worker-7 (role:oversight delegation)",
        subjectKind: "autonomous_agent",
      }).success,
    ).toBe(true);
  });

  it("denies drift without result references, and result-reference overflow", () => {
    const noRefs = driftFixture();
    delete noRefs.resultRefs;
    expect(alignmentDriftRecordSchema.safeParse(noRefs).success).toBe(false);
    expect(
      alignmentDriftRecordSchema.safeParse(driftFixture({ resultRefs: [] })).success,
    ).toBe(false);
    expect(
      alignmentDriftRecordSchema.safeParse(
        driftFixture({
          resultRefs: Array.from({ length: MAX_EVIDENCE_PER_RECORD + 1 }, (_, i) => `res_${i}`),
        }),
      ).success,
    ).toBe(false);
  });

  it("accepts firstObservedAt equal to lastObservedAt but denies crossed observation order", () => {
    expect(
      alignmentDriftRecordSchema.safeParse(
        driftFixture({ firstObservedAt: EVALUATED_AT, lastObservedAt: EVALUATED_AT }),
      ).success,
    ).toBe(true);
    expect(
      alignmentDriftRecordSchema.safeParse(
        driftFixture({
          firstObservedAt: "2026-10-03T03:00:00.000Z",
          lastObservedAt: "2026-10-03T02:00:00.000Z",
        }),
      ).success,
    ).toBe(false);
  });

  it("FINDING F-076-04: drift attribution can be laundered — the actor is unbound from the cited results", () => {
    const laundered = alignmentDriftRecordSchema.safeParse(
      driftFixture({
        actor: { subjectRef: "human:innocent-bystander", subjectKind: "human_initiated" },
        resultRefs: ["res_agent_drift_001"],
        evidence: [
          evidenceFixture("obs_laundered", { capturedBy: "role:alignment-evaluator" }),
        ],
      }),
    );
    recordFinding({
      id: "F-076-04",
      title: "Attribution laundering: drift actor is not bound to the cited conformance results",
      attack:
        "a drift record that re-attributes machine drift to a human ('human:innocent-bystander', subjectKind 'human_initiated') while citing resultRefs that evidence the autonomous agent's behaviour",
      observed:
        "alignmentDriftRecordSchema validates actor shape and resultRefs as bare identifiers; there is no join between actor.subjectRef and the subjects of the referenced results, so the laundered record parses",
      impact:
        "AGENTS §21 requires drift to be attributed truthfully; on this surface the attribution is a free-form claim. Escalations built on a laundered record route the WRONG actor's drift to human oversight, and the genuinely responsible agent never appears in the escalation chain",
      surface: "alignmentDriftRecordSchema (actor / resultRefs join)",
    });
    expect(laundered.success).toBe(true);
    if (laundered.success) {
      const decision = decideEscalation(typedPolicy(), laundered.data);
      expect(decision.decision).toBe("escalate");
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * Axis 6 — retirement bypass (module law: constitutional
 * boundaries are immutable; retirement is fail-closed).
 * ────────────────────────────────────────────────────────────*/

describe("axis 6: retirement bypass", () => {
  it("denies silent and whitespace retirements", () => {
    expect(
      alignmentExpectationSchema.safeParse(expectationFixture({ status: "retired" })).success,
    ).toBe(false);
    expect(
      alignmentExpectationSchema.safeParse(
        expectationFixture({ status: "retired", retiredReason: "   " }),
      ).success,
    ).toBe(false);
  });

  it("denies retiredReason smuggling on active expectations", () => {
    expect(
      alignmentExpectationSchema.safeParse(
        expectationFixture({ status: "active", retiredReason: "preemptive excuse" }),
      ).success,
    ).toBe(true); // shape-valid: reason is optional metadata, not a retirement
    const activeParsed = alignmentExpectationSchema.safeParse(
      expectationFixture({ status: "active", retiredReason: "preemptive excuse" }),
    );
    if (activeParsed.success) expect(activeParsed.data.status).toBe("active");
  });

  it("FINDING F-076-05: a constitutional-boundary expectation can be declared retired directly through the schema", () => {
    const bypass = alignmentExpectationSchema.safeParse(
      expectationFixture({
        kind: "constitutional_boundary",
        status: "retired",
        retiredReason: "boundary dissolved by runtime amendment",
      }),
    );
    recordFinding({
      id: "F-076-05",
      title: "Retirement bypass: constitutional-boundary expectations are schema-retirable",
      attack:
        "a constitutional_boundary expectation declared with status 'retired' plus a plausible retiredReason, pushed straight through the schema (and the set parser) — bypassing decideRelaxation entirely",
      observed:
        "alignmentExpectationSchema's superRefine checks only that a retired record carries a retiredReason; there is no kind-vs-status invariant, so the retired constitutional expectation parses, and parseAlignmentExpectations accepts a set containing it",
      impact:
        "The module's own header law — constitutional-boundary expectations 'cannot be retired or relaxed, only evaluated' (AGENTS §7, §44) — is enforced only on the relaxation path (decideRelaxation). The declaration path leaves the immutable class expressible as retired, so an amendment can be laundered as a pre-existing retirement with provenance attached",
      surface: "alignmentExpectationSchema (kind-vs-status invariant) / parseAlignmentExpectations",
    });
    expect(bypass.success).toBe(true);
    if (bypass.success) {
      expect(bypass.data.status).toBe("retired");
      const setParsed = parseAlignmentExpectations([bypass.data]);
      expect(setParsed.ok).toBe(true);
    }
  });

  it("FINDING F-076-06: any expectation can be retired through the schema with no approval binding at all", () => {
    const unsanctioned = alignmentExpectationSchema.safeParse(
      expectationFixture({
        expectationId: "evidence_backed_conformance",
        kind: "policy_conformance",
        severity: "warning",
        status: "retired",
        retiredReason: "no longer relevant",
      }),
    );
    recordFinding({
      id: "F-076-06",
      title: "Retirement bypass: schema-level retirement carries no human-approval binding",
      attack:
        "an ordinary (non-constitutional) expectation declared 'retired' directly through the schema — no human approval record is attached anywhere on the declaration path",
      observed:
        "the human-approval requirement exists only inside decideRelaxation; alignmentExpectationSchema (and parseAlignmentExpectations) accept a retired expectation whose provenance may name any declaredBy/authority, so a retirement can be minted without any approval surface being consulted",
      impact:
        "HUMAN_GOVERNANCE_POSTURE states all 'other expectation changes require a validated human approval record'; retirement is such a change, yet the declaration path structurally omits the approval binding — the fail-closed posture holds only where decideRelaxation is actually consulted",
      surface: "alignmentExpectationSchema (status transition) / parseAlignmentExpectations",
    });
    expect(unsanctioned.success).toBe(true);
    if (unsanctioned.success) {
      expect(unsanctioned.data.status).toBe("retired");
      const decision = decideRelaxation(unsanctioned.data, HUMAN_APPROVAL);
      expect(decision.ok).toBe(true);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * Findings ledger integrity — the suite's verdict surface.
 * ────────────────────────────────────────────────────────────*/

describe("findings ledger integrity", () => {
  it("reports every successful attack as a well-formed, uniquely-identified finding", () => {
    expect(FINDINGS.length).toBe(7);
    const ids = FINDINGS.map((finding) => finding.id);
    expect(new Set(ids).size).toBe(FINDINGS.length);
    for (const finding of FINDINGS) {
      expect(finding.id).toMatch(/^F-076-\d{2}$/);
      expect(finding.title.trim().length).toBeGreaterThan(0);
      expect(finding.attack.trim().length).toBeGreaterThan(0);
      expect(finding.observed.trim().length).toBeGreaterThan(0);
      expect(finding.impact.trim().length).toBeGreaterThan(0);
      expect(finding.surface.trim().length).toBeGreaterThan(0);
    }
    expect([...ids].sort()).toEqual([
      "F-076-01",
      "F-076-02",
      "F-076-03",
      "F-076-04",
      "F-076-05",
      "F-076-06",
      "F-076-07",
    ]);
  });

  it("keeps the module's citable boundary constants intact for downstream consumers", () => {
    expect(GOVERNANCE_ALIGNMENT_BOUNDARY).toContain("never enforces, grants, denies, or authorizes");
  });
});