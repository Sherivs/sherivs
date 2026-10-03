/**
 * CoreGrid — H3-062 zero-trust-defense contract tests (mission G-062).
 * Zod validation of phase-42 adversarial-defense substrate contracts:
 * untrusted-by-default input classification (AGENTS §5), recommendation-only
 * defense verdicts over the §16 decision vocabulary (structurally minus
 * `allow`), fail-closed escalation paths to human oversight, and cross-record
 * parse invariants. Pure offline: no network, no database, no secrets.
 */
import { describe, expect, it } from "vitest";
import {
  DECISION_VOCABULARY,
  MAX_CLASSIFICATIONS_PER_BATCH,
  SIGNAL_DETAIL_MAX_LENGTH,
  STATEMENT_MAX_LENGTH,
  UNTRUSTED_BY_DEFAULT_POSTURE,
  ZERO_TRUST_DEFENSE_BOUNDARY,
  decideEscalationPath,
  defenseEscalationPolicySchema,
  defenseEscalationRecordSchema,
  defenseVerdictRecordSchema,
  defenseVerdictSchema,
  inputClassificationSchema,
  parseDefenseSurface,
  recommendedDefenseAction,
  severityAtLeast,
  summarizeDefenseSurface,
  type DefenseVerdictRecord,
  type InputClassification,
} from "../../frontend/src/lib/zero-trust-defense/contracts";

const ASSERTED_AT = "2026-10-03T00:00:00.000Z";
const CLASSIFIED_AT = "2026-10-03T01:00:00.000Z";

const PROVENANCE = {
  assertedBy: "role:contract-architect",
  authority: "AGENTS.md §42 / H3 wave mission G-062",
  assertedAt: ASSERTED_AT,
};

function classification(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    classificationId: "classify_prompt_payload_01",
    inputRef: "input:req-41-payload",
    origin: "autonomous_agent",
    subject: { subjectRef: "agent:worker-7", subjectKind: "autonomous_agent" },
    outcome: "benign",
    signals: [],
    classifiedBy: "role:defense-evaluator",
    classifiedAt: CLASSIFIED_AT,
    provenance: PROVENANCE,
    ...overrides,
  };
}

function signal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    signalKind: "instruction_override_attempt",
    severity: "warning",
    detail: "payload attempted to replace its declared handling instructions",
    ...overrides,
  };
}

function evidence(ref: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    evidenceRef: ref,
    capturedAt: CLASSIFIED_AT,
    capturedBy: "role:defense-evaluator",
    ...overrides,
  };
}

function verdict(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    verdictId: "verdict_payload_01",
    classificationId: "classify_prompt_payload_01",
    subject: { subjectRef: "agent:worker-7", subjectKind: "autonomous_agent" },
    verdict: "redact",
    severity: "warning",
    rationale: "suspect payload — minimize before any downstream processing",
    evidence: [evidence("obs_001")],
    issuedAt: CLASSIFIED_AT,
    issuedBy: "role:defense-evaluator",
    recommendsOnly: true,
    ...overrides,
  };
}

function escalation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    escalationId: "escalate_payload_01",
    verdictId: "verdict_payload_01",
    classificationId: "classify_prompt_payload_01",
    routedTo: "role:human-oversight",
    routedAt: CLASSIFIED_AT,
    status: "open",
    authorizes: false,
    ...overrides,
  };
}

function policy(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    policyId: "defense_escalation_default",
    minEscalationSeverity: "warning",
    oversightRole: "role:human-oversight",
    requiresHumanClosure: true,
    recommendsOnly: true,
    ...overrides,
  };
}

function typedClassification(overrides: Record<string, unknown> = {}): InputClassification {
  const parsed = inputClassificationSchema.safeParse(classification(overrides));
  if (!parsed.success) throw new Error(`fixture must parse: ${JSON.stringify(parsed.error.issues)}`);
  return parsed.data;
}

function typedVerdict(overrides: Record<string, unknown> = {}): DefenseVerdictRecord {
  const parsed = defenseVerdictRecordSchema.safeParse(verdict(overrides));
  if (!parsed.success) throw new Error(`fixture must parse: ${JSON.stringify(parsed.error.issues)}`);
  return parsed.data;
}

describe("phase-42 boundary constants", () => {
  it("declares the recommendation-only defense boundary", () => {
    expect(ZERO_TRUST_DEFENSE_BOUNDARY).toContain("never grants, revokes or overrides access");
    expect(ZERO_TRUST_DEFENSE_BOUNDARY).toContain("recommends");
  });

  it("declares the untrusted-by-default posture", () => {
    expect(UNTRUSTED_BY_DEFAULT_POSTURE).toContain("untrusted by default");
    expect(UNTRUSTED_BY_DEFAULT_POSTURE).toContain("never permanent");
  });
});

describe("decision vocabulary (AGENTS §16)", () => {
  it("encodes the full platform decision vocabulary as a reference", () => {
    expect([...DECISION_VOCABULARY]).toEqual([
      "allow",
      "deny",
      "redact",
      "escalate",
      "require_approval",
    ]);
  });

  it("structurally excludes `allow` from defense verdicts — the surface cannot express a grant", () => {
    const result = defenseVerdictSchema.safeParse("allow");
    expect(result.success).toBe(false);
    for (const restrictive of ["deny", "redact", "escalate", "require_approval"] as const) {
      expect(defenseVerdictSchema.safeParse(restrictive).success).toBe(true);
    }
  });
});

describe("input classification schema (untrusted by default)", () => {
  it("parses a benign classification with zero signals", () => {
    const parsed = inputClassificationSchema.safeParse(classification());
    expect(parsed.success).toBe(true);
  });

  it("rejects a classification above benign with no signals — nothing asserted from silence", () => {
    for (const outcome of ["suspect", "hostile"] as const) {
      const parsed = inputClassificationSchema.safeParse(classification({ outcome }));
      expect(parsed.success).toBe(false);
    }
  });

  it("parses a suspect classification backed by at least one signal", () => {
    const parsed = inputClassificationSchema.safeParse(
      classification({ outcome: "suspect", signals: [signal()] }),
    );
    expect(parsed.success).toBe(true);
  });

  it("requires indeterminateReason when outcome is indeterminate — no silent passes", () => {
    const withSignals = classification({ outcome: "indeterminate", signals: [signal()] });
    expect(inputClassificationSchema.safeParse(withSignals).success).toBe(false);
    expect(
      inputClassificationSchema.safeParse({
        ...withSignals,
        indeterminateReason: "signals_conflicting",
      }).success,
    ).toBe(true);
  });

  it("rejects indeterminateReason on a determinate outcome", () => {
    const parsed = inputClassificationSchema.safeParse(
      classification({ indeterminateReason: "signals_conflicting" }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects self-classification by a non-human subject", () => {
    const parsed = inputClassificationSchema.safeParse(
      classification({
        subject: { subjectRef: "agent:worker-7", subjectKind: "autonomous_agent" },
        classifiedBy: "agent:worker-7",
      }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects unknown keys (strict object)", () => {
    const parsed = inputClassificationSchema.safeParse(
      classification({ trustedPermanently: true }),
    );
    expect(parsed.success).toBe(false);
  });

  it("enforces identifier and bounded-text ceilings", () => {
    expect(
      inputClassificationSchema.safeParse(classification({ classificationId: "Bad-Id" })).success,
    ).toBe(false);
    expect(
      inputClassificationSchema.safeParse(
        classification({
          outcome: "suspect",
          signals: [signal({ detail: "x".repeat(SIGNAL_DETAIL_MAX_LENGTH + 1) })],
        }),
      ).success,
    ).toBe(false);
    expect(
      inputClassificationSchema.safeParse(
        classification({
          provenance: { ...PROVENANCE, assertedBy: "x".repeat(300) },
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects unknown origins and unknown subject kinds", () => {
    expect(inputClassificationSchema.safeParse(classification({ origin: "trusted_peer" })).success).toBe(
      false,
    );
    expect(
      inputClassificationSchema.safeParse(
        classification({ subject: { subjectRef: "svc:x", subjectKind: "permanently_trusted" } }),
      ).success,
    ).toBe(false);
  });
});

describe("recommended defense action (fail-closed defaults)", () => {
  it("abstains on benign — abstention is not an allow", () => {
    const decision = recommendedDefenseAction(typedClassification());
    expect(decision.kind).toBe("defense_abstains");
    if (decision.kind === "defense_abstains") {
      expect(decision.detail).toContain("abstention is not an allow");
      expect(decision.detail).toContain("ZERO_TRUST_DEFENSE_BOUNDARY");
    }
  });

  it("recommends redact on suspect (minimize, AGENTS §19)", () => {
    const decision = recommendedDefenseAction(
      typedClassification({ outcome: "suspect", signals: [signal()] }),
    );
    expect(decision.kind).toBe("defense_verdict");
    if (decision.kind === "defense_verdict") {
      expect(decision.verdict).toBe("redact");
    }
  });

  it("recommends deny on hostile — enforcement remains downstream", () => {
    const decision = recommendedDefenseAction(
      typedClassification({ outcome: "hostile", signals: [signal({ severity: "critical" })] }),
    );
    expect(decision.kind).toBe("defense_verdict");
    if (decision.kind === "defense_verdict") {
      expect(decision.verdict).toBe("deny");
      expect(decision.rationale).toContain("enforcement authority remains with the authorization phase");
    }
  });

  it("escalates on indeterminate — an unclassifiable input never passes silently", () => {
    const decision = recommendedDefenseAction(
      typedClassification({
        outcome: "indeterminate",
        signals: [signal()],
        indeterminateReason: "signals_conflicting",
      }),
    );
    expect(decision.kind).toBe("defense_verdict");
    if (decision.kind === "defense_verdict") {
      expect(decision.verdict).toBe("escalate");
      expect(decision.rationale).toContain("never passes silently");
    }
  });
});

describe("defense verdict records (recommendation-only by construction)", () => {
  it("parses a verdict with recommendsOnly literal true", () => {
    expect(defenseVerdictRecordSchema.safeParse(verdict()).success).toBe(true);
  });

  it("rejects recommendsOnly false — a verdict can never claim enforcement authority", () => {
    expect(defenseVerdictRecordSchema.safeParse(verdict({ recommendsOnly: false })).success).toBe(
      false,
    );
  });

  it("requires an escalation route on an escalate verdict — no routeless escalations", () => {
    const base = verdict({ verdict: "escalate", severity: "critical" });
    expect(defenseVerdictRecordSchema.safeParse(base).success).toBe(false);
    expect(
      defenseVerdictRecordSchema.safeParse({ ...base, escalationRouteRef: "route:oversight" })
        .success,
    ).toBe(true);
  });

  it("requires at least one evidence item — verdicts are never assumed", () => {
    expect(defenseVerdictRecordSchema.safeParse(verdict({ evidence: [] })).success).toBe(false);
  });

  it("bounds the rationale text", () => {
    expect(
      defenseVerdictRecordSchema.safeParse(
        verdict({ rationale: "x".repeat(STATEMENT_MAX_LENGTH + 1) }),
      ).success,
    ).toBe(false);
  });
});

describe("escalation policy and records (human oversight only)", () => {
  it("rejects a policy that does not require human closure", () => {
    expect(defenseEscalationPolicySchema.safeParse(policy({ requiresHumanClosure: false })).success).toBe(
      false,
    );
    expect(defenseEscalationPolicySchema.safeParse(policy({ recommendsOnly: false })).success).toBe(
      false,
    );
  });

  it("forbids info-severity escalation thresholds — the floor is notice, critical is never exemptable", () => {
    expect(defenseEscalationPolicySchema.safeParse(policy({ minEscalationSeverity: "info" })).success).toBe(
      false,
    );
    expect(severityAtLeast("critical", "notice")).toBe(true);
  });

  it("parses an escalation with authorizes literal false — it can never authorize", () => {
    expect(defenseEscalationRecordSchema.safeParse(escalation()).success).toBe(true);
    expect(defenseEscalationRecordSchema.safeParse(escalation({ authorizes: true })).success).toBe(
      false,
    );
  });

  it("requires a human closure record to close — machine closure does not exist", () => {
    const closing = escalation({ status: "closed_by_human" });
    expect(defenseEscalationRecordSchema.safeParse(closing).success).toBe(false);
    expect(
      defenseEscalationRecordSchema.safeParse({
        ...closing,
        closedByHuman: { humanRef: "human:platform-steward", decidedAt: CLASSIFIED_AT, note: "resolved" },
      }).success,
    ).toBe(true);
  });

  it("rejects closedByHuman on a non-closed escalation", () => {
    expect(
      defenseEscalationRecordSchema.safeParse(
        escalation({
          closedByHuman: { humanRef: "human:platform-steward", decidedAt: CLASSIFIED_AT, note: "n/a" },
        }),
      ).success,
    ).toBe(false);
  });

  it("requires acknowledgedAt on an acknowledged escalation", () => {
    expect(defenseEscalationRecordSchema.safeParse(escalation({ status: "acknowledged" })).success).toBe(
      false,
    );
    expect(
      defenseEscalationRecordSchema.safeParse(escalation({ status: "acknowledged", acknowledgedAt: CLASSIFIED_AT }))
        .success,
    ).toBe(true);
  });
});

describe("escalation path decision (critical always escalates)", () => {
  it("routes an escalate verdict to the oversight role", () => {
    const decision = decideEscalationPath(
      defenseEscalationPolicySchema.parse(policy()),
      typedVerdict({ verdict: "escalate", severity: "critical", escalationRouteRef: "route:oversight" }),
    );
    expect(decision.decision).toBe("escalate");
    if (decision.decision === "escalate") {
      expect(decision.routedTo).toBe("role:human-oversight");
      expect(decision.detail).toContain("authorizes nothing");
    }
  });

  it("escalates critical severity even below the policy threshold — policies never exempt critical", () => {
    const lenient = defenseEscalationPolicySchema.parse(policy({ minEscalationSeverity: "critical" }));
    const criticalNonEscalate = typedVerdict({ verdict: "deny", severity: "critical" });
    expect(decideEscalationPath(lenient, criticalNonEscalate).decision).toBe("escalate");
  });

  it("monitors findings below the threshold without absorbing them silently", () => {
    const decision = decideEscalationPath(
      defenseEscalationPolicySchema.parse(policy({ minEscalationSeverity: "critical" })),
      typedVerdict({ verdict: "redact", severity: "notice" }),
    );
    expect(decision.decision).toBe("monitor");
    if (decision.decision === "monitor") {
      expect(decision.detail).toContain("never absorbed silently");
    }
  });
});

describe("parseDefenseSurface (fail-closed, cross-record invariants)", () => {
  function surfaceInput(): Record<string, unknown> {
    return {
      classifications: [
        classification(),
        classification({
          classificationId: "classify_prompt_payload_02",
          inputRef: "input:req-42-payload",
          outcome: "hostile",
          signals: [signal({ severity: "critical" })],
        }),
      ],
      verdicts: [
        verdict({
          verdictId: "verdict_payload_02",
          classificationId: "classify_prompt_payload_02",
          verdict: "deny",
          severity: "critical",
        }),
      ],
      escalations: [
        escalation({
          verdictId: "verdict_payload_02",
          classificationId: "classify_prompt_payload_02",
        }),
      ],
    };
  }

  it("parses a consistent surface", () => {
    const result = parseDefenseSurface(surfaceInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.surface.classifications).toHaveLength(2);
      expect(result.surface.verdicts).toHaveLength(1);
      expect(result.surface.escalations).toHaveLength(1);
    }
  });

  it("fails closed when a verdict references an unknown classification", () => {
    const input = surfaceInput();
    (input.verdicts as Record<string, unknown>[])[0].classificationId = "classify_unknown";
    const result = parseDefenseSurface(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("cross_record_invariant");
      expect(result.issues[0].message).toContain("unknown classification");
    }
  });

  it("fails closed when an escalation references an unknown verdict", () => {
    const input = surfaceInput();
    (input.escalations as Record<string, unknown>[])[0].verdictId = "verdict_unknown";
    const result = parseDefenseSurface(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("cross_record_invariant");
      expect(result.issues[0].message).toContain("unknown verdict");
    }
  });

  it("rejects duplicate identifiers", () => {
    const input = surfaceInput();
    (input.verdicts as Record<string, unknown>[]).push(verdict({ verdictId: "verdict_payload_02" }));
    const result = parseDefenseSurface(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("cross_record_invariant");
      expect(result.issues.some((issue) => issue.message.includes("duplicate verdict id"))).toBe(true);
    }
  });

  it("enforces the batch ceiling", () => {
    const input = surfaceInput();
    input.classifications = Array.from({ length: MAX_CLASSIFICATIONS_PER_BATCH + 1 }, (_, index) =>
      classification({ classificationId: `classify_item_${index}` }),
    );
    const result = parseDefenseSurface(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_shape");
    }
  });

  it("rejects malformed shapes with structured issues and never a partial surface", () => {
    const result = parseDefenseSurface({ classifications: "not-an-array" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_shape");
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });
});

describe("summarizeDefenseSurface (unresolved threats are defects)", () => {
  it("reports ok only when every non-benign classification is verdicted and escalations closed", () => {
    const parsed = parseDefenseSurface({
      classifications: [classification()],
      verdicts: [],
      escalations: [],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const summary = summarizeDefenseSurface(parsed.surface);
      expect(summary.ok).toBe(true);
      expect(summary.detail).toBeNull();
    }
  });

  it("marks a hostile classification without a verdict as unresolved", () => {
    const parsed = parseDefenseSurface({
      classifications: [
        classification({
          classificationId: "classify_prompt_payload_02",
          inputRef: "input:req-42-payload",
          outcome: "hostile",
          signals: [signal({ severity: "critical" })],
        }),
      ],
      verdicts: [],
      escalations: [],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const summary = summarizeDefenseSurface(parsed.surface);
      expect(summary.ok).toBe(false);
      expect(summary.unresolvedClassificationIds).toEqual(["classify_prompt_payload_02"]);
      expect(summary.detail).toContain("fail-closed");
    }
  });

  it("counts indeterminate as a defense defect, never a pass", () => {
    const parsed = parseDefenseSurface({
      classifications: [
        classification({
          classificationId: "classify_prompt_payload_03",
          inputRef: "input:req-43-payload",
          outcome: "indeterminate",
          signals: [signal()],
          indeterminateReason: "signals_insufficient",
        }),
      ],
      verdicts: [],
      escalations: [],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const summary = summarizeDefenseSurface(parsed.surface);
      expect(summary.indeterminate).toBe(1);
      expect(summary.ok).toBe(false);
      expect(summary.detail).toContain("defense defect, never a pass");
    }
  });

  it("counts open escalations as defects even when verdicts exist", () => {
    const parsed = parseDefenseSurface({
      classifications: [classification(), classification({ classificationId: "classify_two", outcome: "benign" })],
      verdicts: [verdict({ verdictId: "verdict_one", classificationId: "classify_prompt_payload_01" })],
      escalations: [escalation({ verdictId: "verdict_one", classificationId: "classify_prompt_payload_01" })],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const summary = summarizeDefenseSurface(parsed.surface);
      expect(summary.openEscalations).toBe(1);
      expect(summary.ok).toBe(false);
    }
  });

  it("is satisfied once the escalation is human-closed", () => {
    const parsed = parseDefenseSurface({
      classifications: [classification()],
      verdicts: [verdict({ verdictId: "verdict_one", classificationId: "classify_prompt_payload_01" })],
      escalations: [
        escalation({
          verdictId: "verdict_one",
          classificationId: "classify_prompt_payload_01",
          status: "closed_by_human",
          closedByHuman: { humanRef: "human:platform-steward", decidedAt: CLASSIFIED_AT, note: "resolved" },
        }),
      ],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(summarizeDefenseSurface(parsed.surface).ok).toBe(true);
    }
  });
});