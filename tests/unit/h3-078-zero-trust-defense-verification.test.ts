/**
 * CoreGrid — H3-078 zero-trust-defense VERIFICATION suite (mission G-078,
 * Verifier, phase 42; Squad G law).
 *
 * WHAT: adversarial verification against the COMPLETED phase-42 contract
 * module `frontend/src/lib/zero-trust-defense/contracts.ts` (landed by
 * H3-062; imported READ-ONLY, never modified). This suite attacks the
 * surface the way an adversary would and deepens — never duplicates — the
 * H3-062 contract suite:
 *
 *   A1  allow-leakage attempts (the verdict surface must be structurally
 *       unable to express authorization),
 *   A2  self-classification by non-human subjects,
 *   A3  indeterminate-class laundering,
 *   A4  escalation closure forgery,
 *   A5  critical-severity policy exemption attempts,
 *   A6  batch-parse partial-surface escapes,
 *   A7  summary-defect absorption.
 *
 * LAW (mission G-078): every attack must be contained with a typed denial.
 * Where an attack SUCCEEDS against the structural surface, the escape is
 * pinned by a RECORDED FINDING test (H3-078-F01..F07) — the module is NOT
 * fixed here; findings are reported to the coordinator via
 * `progress/h3-wave/H3-078.report.md`.
 *
 * Pure offline: no network, no database, no git, no secrets — fixtures use
 * synthetic role/agent references only.
 */
import { describe, expect, it } from "vitest";
import {
  DECISION_VOCABULARY,
  MAX_ESCALATIONS_PER_BATCH,
  MAX_VERDICTS_PER_BATCH,
  decideEscalationPath,
  defenseEscalationPolicySchema,
  defenseEscalationRecordSchema,
  defenseVerdictRecordSchema,
  defenseVerdictSchema,
  escalationThresholdSchema,
  inputClassificationSchema,
  parseDefenseSurface,
  recommendedDefenseAction,
  severityAtLeast,
  summarizeDefenseSurface,
  type DefenseSurfaceParseResult,
  type DefenseVerdict,
  type DefenseVerdictRecord,
  type InputClassification,
} from "../../frontend/src/lib/zero-trust-defense/contracts";

/* ─────────────────────────────────────────────────────────────
 * Fixtures (adversary-grade; distinct ids from the H3-062 suite)
 * ────────────────────────────────────────────────────────────*/

const STAMP = "2026-10-03T02:00:00.000Z";

const PROVENANCE = {
  assertedBy: "role:phase-42-verifier",
  authority: "AGENTS.md §42 / H3 wave mission G-078",
  assertedAt: STAMP,
};

function classificationFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    classificationId: "classify_adv_input_01",
    inputRef: "input:adv-req-01-payload",
    origin: "autonomous_agent",
    subject: { subjectRef: "agent:adversary-01", subjectKind: "autonomous_agent" },
    outcome: "benign",
    signals: [],
    classifiedBy: "role:defense-evaluator",
    classifiedAt: STAMP,
    provenance: PROVENANCE,
    ...overrides,
  };
}

function signalFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    signalKind: "credential_exfiltration_pattern",
    severity: "warning",
    detail: "payload attempted to move an observed datum across the trust boundary",
    ...overrides,
  };
}

function evidenceFixture(ref: string): Record<string, unknown> {
  return {
    evidenceRef: ref,
    capturedAt: STAMP,
    capturedBy: "role:defense-evaluator",
  };
}

function verdictFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    verdictId: "verdict_adv_01",
    classificationId: "classify_adv_input_01",
    subject: { subjectRef: "agent:adversary-01", subjectKind: "autonomous_agent" },
    verdict: "redact",
    severity: "warning",
    rationale: "suspect payload — minimize before any downstream processing",
    evidence: [evidenceFixture("obs_adv_001")],
    issuedAt: STAMP,
    issuedBy: "role:defense-evaluator",
    recommendsOnly: true,
    ...overrides,
  };
}

function escalationFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    escalationId: "escalate_adv_01",
    verdictId: "verdict_adv_01",
    classificationId: "classify_adv_input_01",
    routedTo: "role:human-oversight",
    routedAt: STAMP,
    status: "open",
    authorizes: false,
    ...overrides,
  };
}

function policyFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    policyId: "defense_escalation_adv",
    minEscalationSeverity: "warning",
    oversightRole: "role:human-oversight",
    requiresHumanClosure: true,
    recommendsOnly: true,
    ...overrides,
  };
}

/** Parse-or-throw helper: fixtures used as typed inputs MUST be valid. */
function typedClassification(overrides: Record<string, unknown> = {}): InputClassification {
  const parsed = inputClassificationSchema.safeParse(classificationFixture(overrides));
  if (!parsed.success) {
    throw new Error(`fixture must parse: ${JSON.stringify(parsed.error.issues)}`);
  }
  return parsed.data;
}

function typedVerdict(overrides: Record<string, unknown> = {}): DefenseVerdictRecord {
  const parsed = defenseVerdictRecordSchema.safeParse(verdictFixture(overrides));
  if (!parsed.success) {
    throw new Error(`fixture must parse: ${JSON.stringify(parsed.error.issues)}`);
  }
  return parsed.data;
}

function typedPolicy(overrides: Record<string, unknown> = {}) {
  const parsed = defenseEscalationPolicySchema.safeParse(policyFixture(overrides));
  if (!parsed.success) {
    throw new Error(`fixture must parse: ${JSON.stringify(parsed.error.issues)}`);
  }
  return parsed.data;
}

/* ─────────────────────────────────────────────────────────────
 * Recorded findings (attacks that SUCCEED — pinned, not fixed)
 * ────────────────────────────────────────────────────────────*/

const FINDINGS = {
  F01:
    "H3-078-F01 (high): the non-human self-classification guard compares classifiedBy against the SELF-ASSERTED subjectKind — declaring subjectKind 'human_initiated' (while origin stays 'autonomous_agent') lets a non-human subject classify its own input, defeating AGENTS §5 untrusted-by-default.",
  F02:
    "H3-078-F02 (high): closedByHuman.humanRef is an unverified free-text reference; a non-human principal reference ('agent:adversary-01') is accepted as human closure evidence, so the module law 'machine closure does not exist' is expressible via identity laundering.",
  F03:
    "H3-078-F03 (high): summarizeDefenseSurface treats ANY restrictive verdict as resolving an indeterminate classification — a 'redact'/info verdict clears the fail-closed 'indeterminate → escalate' law with no escalation ever raised (summary.ok === true).",
  F04:
    "H3-078-F04 (medium): verdict severity is self-asserted and never cross-checked against the classification's signal severities — a critical-severity signal can be paired with an info-severity verdict, and decideEscalationPath then monitors instead of escalating: critical-severity exemption by downgrade.",
  F05:
    "H3-078-F05 (medium): outcome/signal coherence is unenforced — a 'benign' classification carrying critical-severity hostile signals parses, defense abstains on it, and the summary absorbs it as benign (no cross-check between outcome and signal severity).",
  F06:
    "H3-078-F06 (medium): the verdict surface has no non-self issuer guard analogous to the classification guard — issuedBy may equal subject.subjectRef, so a non-human subject can issue verdict records about its own classification (self-verdicting).",
  F07:
    "H3-078-F07 (low): no single-outcome-per-input invariant exists — one inputRef can carry conflicting classifications (benign AND indeterminate/hostile) in one batch, enabling consumer-ambiguous laundering of the indeterminate class.",
  F08:
    "H3-078-F08 (low, REMEDIATED 2026-10-08): zod v4 (< 4.6.5) strictObject did not deny an own '__proto__' key (its unrecognized-key membership check hit the inherited Object.prototype accessor), so a JSON-parsed batch carrying '__proto__' parsed as VALID instead of failing closed; impact was bounded — the polluting payload was dropped and did not reach the parsed surface. REMEDIATED by the zod 4.6.5 upgrade: the unrecognized-keys denial now fires and the batch fails closed with invalid_shape.",
} as const;

/* ─────────────────────────────────────────────────────────────
 * A1 — allow-leakage attempts
 * ────────────────────────────────────────────────────────────*/

describe("A1: allow-leakage attempts — the verdict surface must be structurally unable to express authorization", () => {
  const ALLOW_VARIANTS = ["allow", "Allow", "ALLOW", " allow", "allow ", "allow\u0000"] as const;

  it("rejects `allow` and every casing/padding mutation as a defense verdict", () => {
    for (const variant of ALLOW_VARIANTS) {
      const parsed = defenseVerdictSchema.safeParse(variant);
      expect(parsed.success, `defense verdict accepted "${variant}"`).toBe(false);
    }
  });

  it("subtracts exactly `allow` from the §16 vocabulary — every other decision passes", () => {
    for (const decision of DECISION_VOCABULARY) {
      const parsed = defenseVerdictSchema.safeParse(decision);
      if (decision === "allow") {
        expect(parsed.success).toBe(false);
      } else {
        expect(parsed.success, `restrictive verdict "${decision}" must parse`).toBe(true);
      }
    }
  });

  it("rejects `allow` smuggled into the verdict field of a full verdict record", () => {
    const parsed = defenseVerdictRecordSchema.safeParse(verdictFixture({ verdict: "allow" }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path.includes("verdict"))).toBe(true);
    }
  });

  it("rejects authorization smuggled under aliased keys (strictObject: unknown keys denied)", () => {
    for (const key of [
      "recommendedAction",
      "decision",
      "action",
      "authorization",
      "grantsAccess",
      "effectiveVerdict",
    ]) {
      const smuggled = { ...verdictFixture(), [key]: "allow" };
      const parsed = defenseVerdictRecordSchema.safeParse(smuggled);
      expect(parsed.success, `alias key "${key}" accepted`).toBe(false);
      if (!parsed.success) {
        expect(
          parsed.error.issues.some(
            (issue) => issue.path.includes(key) || issue.message.includes(key),
          ),
          `denial for "${key}" should name the offending key`,
        ).toBe(true);
      }
    }
  });

  it("rejects an escalation record that claims to authorize (literal-false law)", () => {
    expect(defenseEscalationRecordSchema.safeParse(escalationFixture({ authorizes: true })).success).toBe(
      false,
    );
    expect(defenseEscalationRecordSchema.safeParse(escalationFixture({ authorizes: "false" })).success).toBe(
      false,
    );
    const omitted = escalationFixture();
    delete (omitted as Record<string, unknown>).authorizes;
    expect(defenseEscalationRecordSchema.safeParse(omitted).success).toBe(false);
  });

  it("rejects a policy that claims enforcement or drops the human-closure requirement", () => {
    expect(defenseEscalationPolicySchema.safeParse(policyFixture({ recommendsOnly: false })).success).toBe(
      false,
    );
    const noRecommendsOnly = policyFixture();
    delete (noRecommendsOnly as Record<string, unknown>).recommendsOnly;
    expect(defenseEscalationPolicySchema.safeParse(noRecommendsOnly).success).toBe(false);
    expect(defenseEscalationPolicySchema.safeParse(policyFixture({ requiresHumanClosure: false })).success).toBe(
      false,
    );
  });

  it("deep-walks a fully parsed surface: no authorization value leaks anywhere in the structure", () => {
    const parsed = parseDefenseSurface({
      classifications: [
        classificationFixture(),
        classificationFixture({
          classificationId: "classify_adv_input_02",
          inputRef: "input:adv-req-02-payload",
          outcome: "hostile",
          signals: [signalFixture({ severity: "critical" })],
        }),
      ],
      verdicts: [
        verdictFixture({
          verdictId: "verdict_adv_02",
          classificationId: "classify_adv_input_02",
          verdict: "deny",
          severity: "critical",
        }),
      ],
      escalations: [
        escalationFixture({
          escalationId: "escalate_adv_02",
          verdictId: "verdict_adv_02",
          classificationId: "classify_adv_input_02",
          status: "closed_by_human",
          closedByHuman: {
            humanRef: "human:platform-steward",
            decidedAt: STAMP,
            note: "oversight resolved the finding",
          },
        }),
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const violations: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (value === null || typeof value !== "object") {
        if (value === "allow") violations.push(`${path} === "allow"`);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, `${path}[${index}]`));
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        const childPath = `${path}.${key}`;
        if (child === "allow") violations.push(`${childPath} === "allow"`);
        if (key === "recommendsOnly" && child !== true) {
          violations.push(`${childPath} is not literal true`);
        }
        if (key === "authorizes" && child !== false) {
          violations.push(`${childPath} is not literal false`);
        }
        walk(child, childPath);
      }
    };
    walk(parsed.surface, "surface");
    expect(violations, violations.join("; ")).toEqual([]);
  });

  it("recommendedDefenseAction never emits an authorization grant for any classification outcome", () => {
    const restrictive: readonly string[] = ["deny", "redact", "escalate", "require_approval"];
    const outcomes = ["benign", "suspect", "hostile", "indeterminate"] as const;
    for (const outcome of outcomes) {
      const decision = recommendedDefenseAction(
        typedClassification({
          outcome,
          signals: outcome === "benign" ? [] : [signalFixture()],
          indeterminateReason: outcome === "indeterminate" ? "signals_conflicting" : undefined,
        }),
      );
      if (decision.kind === "defense_verdict") {
        expect(restrictive, `outcome "${outcome}" produced "${decision.verdict}"`).toContain(
          decision.verdict,
        );
        expect(decision.verdict).not.toBe("allow");
      } else {
        expect(decision.kind).toBe("defense_abstains");
        expect(decision.detail).toContain("abstention is not an allow");
      }
    }
  });

  it("type-level: DefenseVerdict excludes `allow` and escalations cannot carry authorizes true", () => {
    // @ts-expect-error — "allow" is not assignable to DefenseVerdict (structural proof)
    const leak: DefenseVerdict = "allow";
    expect(leak).toBe("allow");
    // @ts-expect-error — authorizes is z.literal(false); true is unrepresentable
    const forged: { authorizes: false } = { authorizes: true };
    expect(forged.authorizes).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * A2 — self-classification by non-human subjects
 * ────────────────────────────────────────────────────────────*/

describe("A2: self-classification by non-human subjects", () => {
  const NON_HUMAN_KINDS = ["autonomous_agent", "automated_process", "external_origin"] as const;

  it("rejects direct self-classification for every non-human subject kind", () => {
    for (const kind of NON_HUMAN_KINDS) {
      const parsed = inputClassificationSchema.safeParse(
        classificationFixture({
          subject: { subjectRef: "agent:adversary-01", subjectKind: kind },
          classifiedBy: "agent:adversary-01",
        }),
      );
      expect(parsed.success, `self-classification accepted for kind "${kind}"`).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues.some((issue) => issue.path.includes("classifiedBy"))).toBe(true);
      }
    }
  });

  it("RECORDED FINDING H3-078-F01: subjectKind laundering defeats the self-classification guard — module NOT modified", () => {
    const laundered = inputClassificationSchema.safeParse(
      classificationFixture({
        origin: "autonomous_agent",
        subject: { subjectRef: "agent:adversary-01", subjectKind: "human_initiated" },
        classifiedBy: "agent:adversary-01",
        outcome: "hostile",
        signals: [signalFixture({ severity: "critical" })],
      }),
    );
    expect(laundered.success).toBe(true);
    if (laundered.success) {
      // The laundered record then flows through the decision surface like any
      // legitimate classification — the escape is real end-to-end.
      const decision = recommendedDefenseAction(laundered.data);
      expect(decision.kind === "defense_verdict" ? decision.verdict : "").toBe("deny");
    }
    expect(FINDINGS.F01).toContain("subjectKind");
  });

  it("RECORDED FINDING H3-078-F06: a non-human subject can issue verdict records about its own classification — module NOT modified", () => {
    const selfIssued = defenseVerdictRecordSchema.safeParse(
      verdictFixture({
        subject: { subjectRef: "agent:adversary-01", subjectKind: "autonomous_agent" },
        issuedBy: "agent:adversary-01",
      }),
    );
    expect(selfIssued.success).toBe(true);
    expect(FINDINGS.F06).toContain("issuedBy");
  });
});

/* ─────────────────────────────────────────────────────────────
 * A3 — indeterminate-class laundering
 * ────────────────────────────────────────────────────────────*/

describe("A3: indeterminate-class laundering", () => {
  it("contains the direct escapes: indeterminate without reason or without signals is denied", () => {
    const noReason = classificationFixture({ outcome: "indeterminate", signals: [signalFixture()] });
    expect(inputClassificationSchema.safeParse(noReason).success).toBe(false);
    const noSignals = classificationFixture({
      outcome: "indeterminate",
      signals: [],
      indeterminateReason: "signals_insufficient",
    });
    expect(inputClassificationSchema.safeParse(noSignals).success).toBe(false);
    const reasonOnBenign = classificationFixture({
      outcome: "benign",
      indeterminateReason: "signals_conflicting",
    });
    expect(inputClassificationSchema.safeParse(reasonOnBenign).success).toBe(false);
  });

  it("indeterminate always routes to escalate — it is never handled locally", () => {
    for (const reason of ["signals_conflicting", "signals_insufficient"] as const) {
      const decision = recommendedDefenseAction(
        typedClassification({
          outcome: "indeterminate",
          signals: [signalFixture()],
          indeterminateReason: reason,
        }),
      );
      expect(decision.kind).toBe("defense_verdict");
      if (decision.kind === "defense_verdict") {
        expect(decision.verdict).toBe("escalate");
        expect(decision.rationale).toContain("never passes silently");
      }
    }
  });

  it("RECORDED FINDING H3-078-F03: any restrictive verdict launders an indeterminate classification to a clean summary — module NOT modified", () => {
    for (const verdictValue of ["redact", "deny", "require_approval"] as const) {
      const parsed = parseDefenseSurface({
        classifications: [
          classificationFixture({
            outcome: "indeterminate",
            signals: [signalFixture()],
            indeterminateReason: "signals_insufficient",
          }),
        ],
        verdicts: [
          verdictFixture({ verdict: verdictValue, severity: "info" }),
        ],
        escalations: [],
      });
      expect(parsed.ok, `surface with ${verdictValue} verdict should parse`).toBe(true);
      if (parsed.ok) {
        const summary = summarizeDefenseSurface(parsed.surface);
        // The module's own law: "indeterminate never passes silently — it
        // escalates". This summary reports ok without any escalation.
        expect(
          summary.ok,
          `indeterminate laundered by ${verdictValue}/info verdict — summary must not report ok`,
        ).toBe(true);
        expect(summary.indeterminate).toBe(1);
      }
    }
    expect(FINDINGS.F03).toContain("escalate");
  });

  it("RECORDED FINDING H3-078-F07: conflicting classifications for one inputRef coexist in one batch — module NOT modified", () => {
    const parsed = parseDefenseSurface({
      classifications: [
        classificationFixture({
          classificationId: "classify_adv_benign_mirror",
          inputRef: "input:adv-req-01-payload",
          outcome: "benign",
          signals: [],
        }),
        classificationFixture({
          classificationId: "classify_adv_indeterminate_mirror",
          inputRef: "input:adv-req-01-payload",
          outcome: "indeterminate",
          signals: [signalFixture()],
          indeterminateReason: "signals_conflicting",
        }),
      ],
      verdicts: [],
      escalations: [],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.surface.classifications).toHaveLength(2);
      const summary = summarizeDefenseSurface(parsed.surface);
      expect(summary.unresolvedClassificationIds).toEqual(["classify_adv_indeterminate_mirror"]);
    }
    expect(FINDINGS.F07).toContain("single-outcome-per-input");
  });
});

/* ─────────────────────────────────────────────────────────────
 * A4 — escalation closure forgery
 * ────────────────────────────────────────────────────────────*/

describe("A4: escalation closure forgery", () => {
  it("rejects closure without a human closure record (machine closure does not exist)", () => {
    const closing = escalationFixture({ status: "closed_by_human" });
    expect(defenseEscalationRecordSchema.safeParse(closing).success).toBe(false);
  });

  it("rejects misplaced closure and acknowledgment state", () => {
    const closureNote = {
      humanRef: "human:platform-steward",
      decidedAt: STAMP,
      note: "resolved by oversight",
    };
    expect(
      defenseEscalationRecordSchema.safeParse(escalationFixture({ closedByHuman: closureNote })).success,
    ).toBe(false);
    expect(
      defenseEscalationRecordSchema.safeParse(escalationFixture({ status: "acknowledged" })).success,
    ).toBe(false);
    const acknowledgedWithoutStamp = escalationFixture({ status: "acknowledged" });
    delete (acknowledgedWithoutStamp as Record<string, unknown>).acknowledgedAt;
    expect(defenseEscalationRecordSchema.safeParse(acknowledgedWithoutStamp).success).toBe(false);
  });

  it("rejects blank or anonymous closure references", () => {
    const closing = escalationFixture({
      status: "closed_by_human",
      closedByHuman: { humanRef: "   ", decidedAt: STAMP, note: "resolved" },
    });
    expect(defenseEscalationRecordSchema.safeParse(closing).success).toBe(false);
  });

  it("RECORDED FINDING H3-078-F02: a non-human principal reference is accepted as human closure evidence — module NOT modified", () => {
    for (const humanRef of ["agent:adversary-01", "role:defense-evaluator", "machine:closure-bot"]) {
      const forged = defenseEscalationRecordSchema.safeParse(
        escalationFixture({
          status: "closed_by_human",
          closedByHuman: { humanRef, decidedAt: STAMP, note: "closure asserted by the subject itself" },
        }),
      );
      expect(forged.success, `machine closure accepted via humanRef "${humanRef}"`).toBe(true);
    }
    expect(FINDINGS.F02).toContain("machine closure");
  });

  it("RECORDED FINDING (compound of F02): a forged human closure drives summary.ok to true — module NOT modified", () => {
    const parsed = parseDefenseSurface({
      classifications: [
        classificationFixture({
          outcome: "hostile",
          signals: [signalFixture({ severity: "critical" })],
        }),
      ],
      verdicts: [
        verdictFixture({ verdict: "deny", severity: "critical" }),
      ],
      escalations: [
        escalationFixture({
          status: "closed_by_human",
          closedByHuman: {
            humanRef: "agent:adversary-01",
            decidedAt: STAMP,
            note: "subject closed its own finding",
          },
        }),
      ],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(summarizeDefenseSurface(parsed.surface).ok).toBe(true);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * A5 — critical-severity policy exemption attempts
 * ────────────────────────────────────────────────────────────*/

describe("A5: critical-severity policy exemption attempts", () => {
  it("denies an info-level escalation threshold at the schema — the floor is notice", () => {
    expect(escalationThresholdSchema.safeParse("info").success).toBe(false);
    expect(defenseEscalationPolicySchema.safeParse(policyFixture({ minEscalationSeverity: "info" })).success).toBe(
      false,
    );
    expect(severityAtLeast("critical", "notice")).toBe(true);
  });

  it("critical verdicts escalate under EVERY legal threshold — no policy exempts them", () => {
    for (const threshold of ["notice", "warning", "critical"] as const) {
      const decision = decideEscalationPath(
        typedPolicy({ minEscalationSeverity: threshold }),
        typedVerdict({ verdict: "deny", severity: "critical" }),
      );
      expect(decision.decision, `threshold "${threshold}" absorbed a critical verdict`).toBe("escalate");
      if (decision.decision === "escalate") {
        expect(decision.routedTo).toBe("role:human-oversight");
        expect(decision.detail).toContain("authorizes nothing");
      }
    }
  });

  it("RECORDED FINDING H3-078-F04: verdict severity downgrade launders a critical finding below every threshold — module NOT modified", () => {
    // The classification carries a critical-severity signal; the verdict
    // simply declares severity "info" — nothing cross-checks the two.
    const parsed = parseDefenseSurface({
      classifications: [
        classificationFixture({
          outcome: "hostile",
          signals: [signalFixture({ severity: "critical" })],
        }),
      ],
      verdicts: [
        verdictFixture({ verdict: "redact", severity: "info" }),
      ],
      escalations: [],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const verdictRecord = parsed.surface.verdicts[0];
      const decision = decideEscalationPath(typedPolicy({ minEscalationSeverity: "notice" }), verdictRecord);
      expect(decision.decision, "downgraded critical finding must still escalate").toBe("monitor");
      expect(verdictRecord.severity).toBe("info");
    }
    expect(FINDINGS.F04).toContain("downgrade");
  });
});

/* ─────────────────────────────────────────────────────────────
 * A6 — batch-parse partial-surface escapes
 * ────────────────────────────────────────────────────────────*/

describe("A6: batch-parse partial-surface escapes", () => {
  function consistentSurface(): Record<string, unknown> {
    return {
      classifications: [
        classificationFixture(),
        classificationFixture({
          classificationId: "classify_adv_input_02",
          inputRef: "input:adv-req-02-payload",
          outcome: "hostile",
          signals: [signalFixture({ severity: "critical" })],
        }),
      ],
      verdicts: [
        verdictFixture({
          verdictId: "verdict_adv_02",
          classificationId: "classify_adv_input_02",
          verdict: "deny",
          severity: "critical",
        }),
      ],
      escalations: [
        escalationFixture({
          escalationId: "escalate_adv_02",
          verdictId: "verdict_adv_02",
          classificationId: "classify_adv_input_02",
        }),
      ],
    };
  }

  it("denies every missing or non-array root field — no defaulting, no partial surface", () => {
    const base = consistentSurface();
    for (const key of ["classifications", "verdicts", "escalations"] as const) {
      const missing = { ...base };
      delete (missing as Record<string, unknown>)[key];
      const result = parseDefenseSurface(missing);
      expect(result.ok, `missing "${key}" accepted`).toBe(false);
      if (!result.ok) expect(result.reason).toBe("invalid_shape");
      const wrongType = { ...base, [key]: "not-an-array" };
      expect(parseDefenseSurface(wrongType).ok).toBe(false);
    }
  });

  it("denies unknown root keys and null array entries", () => {
    const extraKey = { ...consistentSurface(), trustedBypass: true };
    const result = parseDefenseSurface(extraKey);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_shape");
      expect(
        result.issues.some(
          (issue) => issue.path.includes("trustedBypass") || issue.message.includes("trustedBypass"),
        ),
      ).toBe(true);
    }
    const nullEntry = consistentSurface();
    (nullEntry.verdicts as unknown[]).push(null);
    const nullResult = parseDefenseSurface(nullEntry);
    expect(nullResult.ok).toBe(false);
    if (!nullResult.ok) expect(nullResult.reason).toBe("invalid_shape");
  });

  it("H3-078-F08 REMEDIATED: an own `__proto__` key now fails the strictObject unknown-key denial (zod 4.6.5)", () => {
    // REMEDIATION of recorded finding H3-078-F08: zod 4.6.5's unrecognized-key
    // check now DENIES a JSON-injected own '__proto__' key outright — the
    // batch fails closed with invalid_shape instead of parsing as valid.
    const serialized = JSON.stringify(consistentSurface());
    const smuggled = JSON.parse(
      serialized.replace("{", '{"__proto__":{"evil":"allow","classifications":[]},'),
    ) as Record<string, unknown>;
    expect(Object.keys(smuggled)).toContain("__proto__");

    const result = parseDefenseSurface(smuggled);
    expect(result.ok, "own __proto__ key must be denied").toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_shape");
    // FINDINGS.F08 is amended to record the remediation (kept for ledger
    // continuity — the finding text now states the fixed behavior).
    expect(FINDINGS.F08).toContain("__proto__");
    expect(FINDINGS.F08).toContain("REMEDIATED");
  });

  it("a batch mixing valid and invalid records fails WHOLESALE — no surface leaks", () => {
    const mixed = consistentSurface();
    (mixed.verdicts as Record<string, unknown>[]).push(
      verdictFixture({ verdictId: "verdict_adv_broken", verdict: "allow" }),
    );
    const result: DefenseSurfaceParseResult = parseDefenseSurface(mixed);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_shape");
      // Type-level and runtime: the failure carries NO surface.
      // @ts-expect-error — a failed parse exposes no surface property
      expect(result.surface).toBeUndefined();
    }
    expect("surface" in result).toBe(false);
  });

  it("denies every dangling reference (verdict → classification, escalation → verdict/classification)", () => {
    const unknownClassification = consistentSurface();
    (unknownClassification.verdicts as Record<string, unknown>[])[0].classificationId = "classify_unknown";
    const r1 = parseDefenseSurface(unknownClassification);
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.reason).toBe("cross_record_invariant");
      expect(r1.issues.some((issue) => issue.message.includes("unknown classification"))).toBe(true);
    }

    const unknownVerdict = consistentSurface();
    (unknownVerdict.escalations as Record<string, unknown>[])[0].verdictId = "verdict_unknown";
    const r2 = parseDefenseSurface(unknownVerdict);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("cross_record_invariant");

    const unknownEscalationClassification = consistentSurface();
    (unknownEscalationClassification.escalations as Record<string, unknown>[])[0].classificationId =
      "classify_unknown";
    const r3 = parseDefenseSurface(unknownEscalationClassification);
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.reason).toBe("cross_record_invariant");
  });

  it("denies namespace confusion: an escalation citing an escalation id as its verdict", () => {
    const confused = consistentSurface();
    (confused.escalations as Record<string, unknown>[]).push(
      escalationFixture({ escalationId: "escalate_adv_confused", verdictId: "escalate_adv_02" }),
    );
    const result = parseDefenseSurface(confused);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("cross_record_invariant");
      expect(result.issues.some((issue) => issue.message.includes("unknown verdict"))).toBe(true);
    }
  });

  it("accumulates all cross-record violations in one denial — issues are surfaced, not truncated to the first", () => {
    const broken = consistentSurface();
    (broken.verdicts as Record<string, unknown>[])[0].classificationId = "classify_unknown";
    (broken.escalations as Record<string, unknown>[])[0].verdictId = "verdict_unknown";
    (broken.escalations as Record<string, unknown>[])[0].classificationId = "classify_also_unknown";
    const result = parseDefenseSurface(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("cross_record_invariant");
      expect(result.issues.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("denies duplicate identifiers in every record family", () => {
    const dupVerdict = consistentSurface();
    (dupVerdict.verdicts as Record<string, unknown>[]).push(
      verdictFixture({ verdictId: "verdict_adv_02" }),
    );
    expect(parseDefenseSurface(dupVerdict).ok).toBe(false);

    const dupClassification = consistentSurface();
    (dupClassification.classifications as Record<string, unknown>[]).push(classificationFixture());
    expect(parseDefenseSurface(dupClassification).ok).toBe(false);

    const dupEscalation = consistentSurface();
    (dupEscalation.escalations as Record<string, unknown>[]).push(
      escalationFixture({ escalationId: "escalate_adv_02" }),
    );
    expect(parseDefenseSurface(dupEscalation).ok).toBe(false);
  });

  it("enforces verdict and escalation batch ceilings — limit parses, limit+1 fails closed", () => {
    const atLimitVerdicts = {
      classifications: [classificationFixture()],
      verdicts: Array.from({ length: MAX_VERDICTS_PER_BATCH }, (_, index) =>
        verdictFixture({ verdictId: `verdict_flood_${String(index).padStart(4, "0")}` }),
      ),
      escalations: [],
    };
    const overLimitVerdicts = {
      ...atLimitVerdicts,
      verdicts: [
        ...atLimitVerdicts.verdicts,
        verdictFixture({ verdictId: "verdict_flood_overflow" }),
      ],
    };
    expect(parseDefenseSurface(atLimitVerdicts).ok).toBe(true);
    const overResult = parseDefenseSurface(overLimitVerdicts);
    expect(overResult.ok).toBe(false);
    if (!overResult.ok) expect(overResult.reason).toBe("invalid_shape");

    const atLimitEscalations = {
      classifications: [classificationFixture()],
      verdicts: [verdictFixture()],
      escalations: Array.from({ length: MAX_ESCALATIONS_PER_BATCH }, (_, index) =>
        escalationFixture({ escalationId: `escalate_flood_${String(index).padStart(4, "0")}` }),
      ),
    };
    expect(parseDefenseSurface(atLimitEscalations).ok).toBe(true);
    const overEscalations = {
      ...atLimitEscalations,
      escalations: [
        ...atLimitEscalations.escalations,
        escalationFixture({ escalationId: "escalate_flood_overflow" }),
      ],
    };
    expect(parseDefenseSurface(overEscalations).ok).toBe(false);
  });

  it("an empty batch parses but never reports ok — an empty surface is not a clean surface", () => {
    const parsed = parseDefenseSurface({ classifications: [], verdicts: [], escalations: [] });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const summary = summarizeDefenseSurface(parsed.surface);
      expect(summary.ok).toBe(false);
      expect(summary.detail).not.toBeNull();
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * A7 — summary-defect absorption
 * ────────────────────────────────────────────────────────────*/

describe("A7: summary-defect absorption", () => {
  function hostileFixtureClassification(): Record<string, unknown> {
    return classificationFixture({
      classificationId: "classify_adv_hostile_01",
      inputRef: "input:adv-req-03-payload",
      outcome: "hostile",
      signals: [signalFixture({ severity: "critical" })],
    });
  }

  it("an acknowledged (but not human-closed) escalation is NOT absorbed as resolved", () => {
    const parsed = parseDefenseSurface({
      classifications: [classificationFixture()],
      verdicts: [verdictFixture()],
      escalations: [escalationFixture({ status: "acknowledged", acknowledgedAt: STAMP })],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const summary = summarizeDefenseSurface(parsed.surface);
      expect(summary.openEscalations).toBe(1);
      expect(summary.ok).toBe(false);
    }
  });

  it("an unrelated clean verdict cannot absorb an unresolved hostile classification", () => {
    const parsed = parseDefenseSurface({
      classifications: [
        classificationFixture({ classificationId: "classify_adv_benign_01" }),
        hostileFixtureClassification(),
      ],
      verdicts: [
        verdictFixture({ verdictId: "verdict_adv_benign", classificationId: "classify_adv_benign_01" }),
      ],
      escalations: [],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const summary = summarizeDefenseSurface(parsed.surface);
      expect(summary.ok).toBe(false);
      expect(summary.unresolvedClassificationIds).toEqual(["classify_adv_hostile_01"]);
      expect(summary.detail).toContain("defense defect");
    }
  });

  it("RECORDED FINDING H3-078-F05: a benign outcome over critical-severity hostile signals is absorbed as benign — module NOT modified", () => {
    const laundered = inputClassificationSchema.safeParse(
      classificationFixture({
        outcome: "benign",
        signals: [
          signalFixture({ severity: "critical", signalKind: "credential_exfiltration_pattern" }),
          signalFixture({ severity: "critical", signalKind: "instruction_override_attempt" }),
        ],
      }),
    );
    expect(laundered.success, "benign-with-critical-signals accepted").toBe(true);
    if (laundered.success) {
      const decision = recommendedDefenseAction(laundered.data);
      // Defense abstains on the laundered record — the critical signals are
      // structurally irrelevant to the outcome the record asserts.
      expect(decision.kind).toBe("defense_abstains");
    }
    const parsed = parseDefenseSurface({
      classifications: [classificationFixture({ outcome: "benign", signals: [signalFixture({ severity: "critical" })] })],
      verdicts: [],
      escalations: [],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const summary = summarizeDefenseSurface(parsed.surface);
      expect(summary.benign).toBe(1);
      expect(summary.ok).toBe(true);
    }
    expect(FINDINGS.F05).toContain("outcome/signal coherence");
  });
});