/**
 * CoreGrid — H3-075 simulation-engine adversarial verification suite (Squad G,
 * mission G-075, Verifier — phase 37 simulation-engine).
 *
 * Adversarial verification against the COMPLETED contract module
 * `frontend/src/lib/simulation-engine/contracts.ts` (landed by H3-057).
 * The module is imported READ-ONLY and is never modified by this suite;
 * H3-057's own suite is deepened here, not duplicated: every probe below
 * is an ATTACK an untrusted caller could mount, and the expected verdict
 * is a typed, fail-closed denial.
 *
 * Attack classes covered (mission G-075):
 *   1. origin forgery — relabelling derived intelligence as canonical;
 *   2. writeback bypass — forged / absent / expired / malformed approvals
 *      against `decideSimulatedWriteback` (the ONLY §9/§16/§21 bridge);
 *   3. tenant smuggling — across scenario / run / outcome / proposal /
 *      approval artifacts;
 *   4. expiry evasion — clock manipulation against injected `nowMs`;
 *   5. unbounded cardinality — outcome/subject/parameter flooding.
 *
 * VERIFICATION CONTRACT: every attack must be contained with a typed
 * denial. Where an attack SUCCEEDS against the module as landed, the
 * test is named `FINDING H3-075/F-n`, asserts the precise unsafe
 * behavior observed, and is recorded in `progress/h3-wave/H3-075.report.md`.
 * The module itself was NOT fixed by this verifier (read-only law).
 *
 * Pure offline: no network, no database, no secrets, injected clocks only.
 */
import { describe, expect, it } from "vitest";
import {
  DERIVED_ORIGIN,
  SIMULATION_CONTRACT_SCHEMA_VERSION,
  SimulationRunBundleSchema,
  SimulatedOutcomeSchema,
  ScenarioDefinitionSchema,
  compareAgainstObservation,
  decideSimulatedWriteback,
  usabilityForDecisionSupport,
  validateSimulationRunBundle,
  type SimulationRunBundle,
  type SimulatedOutcome,
  type WritebackApproval,
} from "../../frontend/src/lib/simulation-engine/contracts";

const NOW_MS = 1_767_225_600_000; // 2026-01-01T00:00:00.000Z — injected, never the wall clock
const NAN_CLOCK = Number.NaN; // degenerate clock an attacker may inject

const TENANT_A = "tenant-alpha";
const TENANT_B = "tenant-beta";
const TENANT_C = "tenant-gamma";

type RawRecord = Record<string, unknown>;

const PROVENANCE: RawRecord = {
  declaredBy: "principal:verifier-h3-075",
  authority: "AGENTS.md §42 / H3 wave mission G-075",
  recordedAtMs: NOW_MS - 60_000,
};

function scenario(overrides: RawRecord = {}): RawRecord {
  return {
    schemaVersion: SIMULATION_CONTRACT_SCHEMA_VERSION,
    scenarioId: "scenario-alpha",
    tenantRef: TENANT_A,
    title: "bounded forward model under test",
    status: "approved",
    subjectRefs: ["subject:1", "subject:2"],
    assumptions: [
      {
        assumptionId: "a-1",
        statement: "input rates remain within the declared band",
        provenance: PROVENANCE,
      },
    ],
    parameters: [{ key: "rate", value: 0.5, unit: "per-step" }],
    horizonSteps: 10,
    maxRuns: 5,
    canonicalWriteback: false,
    provenance: PROVENANCE,
    ...overrides,
  };
}

function run(overrides: RawRecord = {}): RawRecord {
  return {
    runId: "run-1",
    scenarioId: "scenario-alpha",
    tenantRef: TENANT_A,
    seed: 42,
    horizonSteps: 10,
    purpose: "decision-support evaluation under verification",
    requestedBy: "role:simulation-operator",
    requestedAtMs: NOW_MS - 30_000,
    executionIsolation: "isolated",
    ...overrides,
  };
}

function outcome(overrides: RawRecord = {}): RawRecord {
  return {
    outcomeId: "outcome-1",
    runId: "run-1",
    tenantRef: TENANT_A,
    origin: DERIVED_ORIGIN,
    subjectRefs: ["subject:1"],
    horizonStep: 5,
    estimate: 100,
    lowerBound: 90,
    upperBound: 110,
    confidence: 0.8,
    generatedAtMs: NOW_MS - 10_000,
    validUntilMs: NOW_MS + 60_000,
    auditRef: "audit:run-1",
    provenance: PROVENANCE,
    ...overrides,
  };
}

function bundle(overrides: RawRecord = {}): RawRecord {
  return {
    schemaVersion: SIMULATION_CONTRACT_SCHEMA_VERSION,
    scenario: scenario(),
    run: run(),
    status: "completed",
    outcomes: [outcome()],
    ...overrides,
  };
}

function proposal(overrides: RawRecord = {}): RawRecord {
  return {
    proposalId: "prop-1",
    tenantRef: TENANT_A,
    targetSubjectRef: "subject:1",
    purpose: "reconciliation support under verification",
    policyRef: "policy:derived-writeback",
    auditDestinationRef: "audit:writeback",
    outcome: outcome(),
    ...overrides,
  };
}

function approval(overrides: RawRecord = {}): RawRecord {
  return {
    approvalId: "appr-1",
    approvedBy: "principal:human-operator",
    approvedAtMs: NOW_MS - 60_000,
    expiresAtMs: NOW_MS + 60_000,
    tenantRef: TENANT_A,
    subjectRefs: ["subject:1"],
    revoked: false,
    ...overrides,
  };
}

function parseBundle(raw: RawRecord): SimulationRunBundle {
  return SimulationRunBundleSchema.parse(raw);
}

function parseOutcome(raw: RawRecord): SimulatedOutcome {
  return SimulatedOutcomeSchema.parse(raw);
}

/**
 * A runtime-forged "approval": shaped by an attacker, never parsed by the
 * gate. Typed via double-cast (no `any`) to cross the module's trusted
 * option boundary exactly the way an untrusted runtime caller would.
 */
function forgedApproval(raw: RawRecord): WritebackApproval {
  return raw as unknown as WritebackApproval;
}

function issueCodes(result: ReturnType<typeof validateSimulationRunBundle>): string[] {
  if (result.ok) return [];
  return result.issues.map((issue) => issue.code);
}

/* ─────────────────────────────────────────────────────────────
 * 1. ORIGIN FORGERY (§9): derived intelligence can never be
 *    relabelled as canonical truth.
 * ────────────────────────────────────────────────────────────*/

describe("attack 1 — origin forgery (derived → canonical relabel)", () => {
  const FORGED_LABELS: unknown[] = [
    "canonical",
    "observed",
    "measured",
    "recorded",
    "Derived",
    "CANONICAL",
    " derived",
    "derived ",
    "derived\u00a0", // trailing non-breaking space
    0,
    1,
    true,
    null,
    { label: "canonical" },
    ["derived"],
  ];

  it("denies every forged origin label at the outcome schema — the literal admits only 'derived'", () => {
    for (const forgery of FORGED_LABELS) {
      const result = SimulatedOutcomeSchema.safeParse(outcome({ origin: forgery }));
      expect(result.success, `forgery ${JSON.stringify(forgery)} must not parse`).toBe(false);
    }
  });

  it("denies a missing origin — unlabelled intelligence does not parse", () => {
    const raw = outcome();
    delete raw.origin;
    expect(SimulatedOutcomeSchema.safeParse(raw).success).toBe(false);
  });

  it("denies relabelling inside a full bundle — forgery cannot hide in bundle context", () => {
    const result = validateSimulationRunBundle(
      bundle({ outcomes: [outcome({ origin: "canonical" })] }),
      { nowMs: NOW_MS },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(issueCodes(result)).toContain("invalid_input");
  });

  it("denies relabelling at the writeback bridge — canonical forgeries are invalid input, never proposals", () => {
    for (const forgery of ["canonical", "observed", "Derived", 1]) {
      const decision = decideSimulatedWriteback(
        proposal({ outcome: outcome({ origin: forgery }) }),
        { nowMs: NOW_MS, approval: forgedApproval(approval()) },
      );
      expect(decision).toEqual({ decision: "DENY", reason: "invalid_input" });
    }
  });

  it("denies relabelling in the scenario-level canonical-writeback flag — only literal false parses", () => {
    for (const forgery of [true, "false", 0, null, "derived"]) {
      expect(
        ScenarioDefinitionSchema.safeParse(scenario({ canonicalWriteback: forgery })).success,
        `forgery ${JSON.stringify(forgery)} must not parse`,
      ).toBe(false);
    }
  });

  it("keeps the diagnostic comparison derived even for hostile observed inputs", () => {
    const parsed = parseOutcome(outcome());
    const hostile = compareAgainstObservation(parsed, Number.NaN);
    expect(hostile.label).toBe(DERIVED_ORIGIN);
    const beyond = compareAgainstObservation(parsed, Number.MAX_VALUE);
    expect(beyond.label).toBe(DERIVED_ORIGIN);
    expect(beyond.withinPredictedBounds).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. WRITEBACK BYPASS (§9/§16/§21): forged, absent, expired and
 *    malformed approvals against the only canonical bridge.
 * ────────────────────────────────────────────────────────────*/

describe("attack 2 — writeback bypass (forged / absent / expired approvals)", () => {
  it("never executes without an approval: absence escalates to REQUIRE_APPROVAL, even with policy and audit present", () => {
    const decision = decideSimulatedWriteback(proposal(), { nowMs: NOW_MS });
    expect(decision).toEqual({ decision: "REQUIRE_APPROVAL" });
  });

  it("denies before approval: an unparseable proposal is invalid_input whatever the caller supplies", () => {
    for (const junk of [null, undefined, 42, "writeback", [], {}, { proposalId: "x" }]) {
      const decision = decideSimulatedWriteback(junk, {
        nowMs: NOW_MS,
        approval: forgedApproval(approval()),
      });
      expect(decision).toEqual({ decision: "DENY", reason: "invalid_input" });
    }
  });

  it("denies absolute-path target subjects at shape — the bridge cannot target filesystem/canonical paths", () => {
    for (const target of ["/canonical/records/1", "/etc/passwd"]) {
      const decision = decideSimulatedWriteback(
        proposal({ targetSubjectRef: target }),
        { nowMs: NOW_MS, approval: forgedApproval(approval()) },
      );
      expect(decision).toEqual({ decision: "DENY", reason: "invalid_input" });
    }
  });

  it("denies relative-path target subjects as out-of-scope — typed denial, though only absolute paths are caught at shape", () => {
    // "./relative/ref" passes SubjectRefSchema's leading-slash refine and
    // reaches the approval gate; it is still contained there with a typed
    // denial (see Known Risks in the H3-075 report for the refine gap).
    const decision = decideSimulatedWriteback(
      proposal({ targetSubjectRef: "./relative/ref" }),
      { nowMs: NOW_MS, approval: forgedApproval(approval()) },
    );
    expect(decision).toEqual({ decision: "DENY", reason: "approval_mismatch_subject" });
  });

  it("orders gates fail-closed: no-policy wins even when approval is present, and policy precedes audit and approval", () => {
    const raw = proposal();
    delete raw.policyRef;
    delete raw.auditDestinationRef;
    const decision = decideSimulatedWriteback(raw, {
      nowMs: NOW_MS,
      approval: forgedApproval(approval()),
    });
    expect(decision).toEqual({ decision: "DENY", reason: "no_policy" });
  });

  it("denies a whitespace-only policy reference — trimmed away, no decision surface", () => {
    const decision = decideSimulatedWriteback(proposal({ policyRef: "   " }), {
      nowMs: NOW_MS,
      approval: forgedApproval(approval()),
    });
    expect(decision).toEqual({ decision: "DENY", reason: "no_policy" });
  });

  it("denies approvals scoped to another tenant, including case- and whitespace-smuggled variants", () => {
    for (const smuggledTenant of [TENANT_B, "Tenant-alpha", " tenant-alpha", `${TENANT_A}\u0000`]) {
      const decision = decideSimulatedWriteback(proposal(), {
        nowMs: NOW_MS,
        approval: forgedApproval(approval({ tenantRef: smuggledTenant })),
      });
      expect(decision).toEqual({ decision: "DENY", reason: "approval_mismatch_tenant" });
    }
  });

  it("denies when the proposal's embedded outcome carries a foreign tenant — tenant smuggling via the outcome payload", () => {
    const decision = decideSimulatedWriteback(
      proposal({ outcome: outcome({ tenantRef: TENANT_B }) }),
      { nowMs: NOW_MS, approval: forgedApproval(approval()) },
    );
    expect(decision).toEqual({ decision: "DENY", reason: "approval_mismatch_tenant" });
  });

  it("denies approvals that do not cover the target subject — including malformed empty coverage", () => {
    const notCovered = decideSimulatedWriteback(proposal(), {
      nowMs: NOW_MS,
      approval: forgedApproval(approval({ subjectRefs: ["subject:2"] })),
    });
    expect(notCovered).toEqual({ decision: "DENY", reason: "approval_mismatch_subject" });

    const emptyCoverage = decideSimulatedWriteback(proposal(), {
      nowMs: NOW_MS,
      approval: forgedApproval(approval({ subjectRefs: [] })),
    });
    expect(emptyCoverage).toEqual({ decision: "DENY", reason: "approval_mismatch_subject" });

    const outcomeLacksTarget = decideSimulatedWriteback(
      proposal({ outcome: outcome({ subjectRefs: ["subject:2"] }) }),
      { nowMs: NOW_MS, approval: forgedApproval(approval()) },
    );
    expect(outcomeLacksTarget).toEqual({ decision: "DENY", reason: "approval_mismatch_subject" });
  });

  it("denies expired approvals at and beyond the boundary (AGENTS §31: expired access fails)", () => {
    const boundary = decideSimulatedWriteback(proposal(), {
      nowMs: NOW_MS,
      approval: forgedApproval(approval({ expiresAtMs: NOW_MS })),
    });
    expect(boundary).toEqual({ decision: "DENY", reason: "approval_expired" });

    const expired = decideSimulatedWriteback(proposal(), {
      nowMs: NOW_MS,
      approval: forgedApproval(approval({ expiresAtMs: NOW_MS - 1 })),
    });
    expect(expired).toEqual({ decision: "DENY", reason: "approval_expired" });
  });

  it("grants only one millisecond of unexpired window — expiry is inclusive-fail-closed", () => {
    const decision = decideSimulatedWriteback(proposal(), {
      nowMs: NOW_MS,
      approval: forgedApproval(approval({ expiresAtMs: NOW_MS + 1 })),
    });
    expect(decision).toEqual({ decision: "ALLOW" });
  });

  it("denies revoked approvals; expiry precedes revocation in the denial reason", () => {
    const revoked = decideSimulatedWriteback(proposal(), {
      nowMs: NOW_MS,
      approval: forgedApproval(approval({ revoked: true })),
    });
    expect(revoked).toEqual({ decision: "DENY", reason: "approval_revoked" });

    const revokedAndExpired = decideSimulatedWriteback(proposal(), {
      nowMs: NOW_MS,
      approval: forgedApproval(approval({ revoked: true, expiresAtMs: NOW_MS - 1 })),
    });
    expect(revokedAndExpired).toEqual({ decision: "DENY", reason: "approval_expired" });
  });

  it("FINDING H3-075/F-1 — a forged approval missing `expiresAtMs` and `revoked` is granted ALLOW: the gate never re-validates options.approval against WritebackApprovalSchema", () => {
    // Expected fail-closed behavior: DENY (invalid/malformed approval).
    // Observed: the approval enters unchecked; `undefined <= nowMs` is false,
    // so the expiry gate is skipped and the bridge reaches ALLOW.
    const forged = forgedApproval({
      approvalId: "appr-forged",
      approvedBy: "principal:attacker",
      approvedAtMs: NOW_MS - 60_000,
      tenantRef: TENANT_A,
      subjectRefs: ["subject:1"],
    });
    const decision = decideSimulatedWriteback(proposal(), { nowMs: NOW_MS, approval: forged });
    expect(decision).toEqual({ decision: "ALLOW" });
  });

  it("FINDING H3-075/F-2 — a forged approval missing `subjectRefs` crashes the gate with TypeError instead of a typed denial", () => {
    // Expected fail-closed behavior: a typed DENY (invalid approval input).
    // Observed: `approval.subjectRefs.includes(...)` throws before any
    // typed decision is produced — denial-by-exception, not typed denial.
    const forged = forgedApproval({
      approvalId: "appr-forged",
      approvedBy: "principal:attacker",
      approvedAtMs: NOW_MS - 60_000,
      expiresAtMs: NOW_MS + 60_000,
      tenantRef: TENANT_A,
    });
    expect(() =>
      decideSimulatedWriteback(proposal(), { nowMs: NOW_MS, approval: forged }),
    ).toThrow(TypeError);
  });

  it("FINDING H3-075/F-4 — an expired or validity-inverted embedded outcome is granted ALLOW at the bridge: outcome freshness is never re-checked", () => {
    // Expected fail-closed behavior: DENY — expired derived intelligence is
    // not usable (AGENTS §31) and must never be approved toward a canonical
    // surface. Observed: the gate checks approval/subject/policy/audit but
    // never the outcome's validity window.
    const expiredOutcome = decideSimulatedWriteback(
      proposal({ outcome: outcome({ generatedAtMs: NOW_MS - 20_000, validUntilMs: NOW_MS - 10_000 }) }),
      { nowMs: NOW_MS, approval: forgedApproval(approval()) },
    );
    expect(expiredOutcome).toEqual({ decision: "ALLOW" });

    const invertedValidity = decideSimulatedWriteback(
      proposal({
        outcome: outcome({ generatedAtMs: NOW_MS - 5_000, validUntilMs: NOW_MS - 10_000 }),
      }),
      { nowMs: NOW_MS, approval: forgedApproval(approval()) },
    );
    expect(invertedValidity).toEqual({ decision: "ALLOW" });
  });

  it("FINDING H3-075/F-8 — a whitespace-only audit destination passes the audit gate while an identical policyRef is trimmed away", () => {
    // Expected fail-closed behavior: DENY no_audit_destination for "   ".
    // Observed: only `undefined` is checked for the audit destination.
    const decision = decideSimulatedWriteback(proposal({ auditDestinationRef: "   " }), {
      nowMs: NOW_MS,
      approval: forgedApproval(approval()),
    });
    expect(decision).toEqual({ decision: "ALLOW" });
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. TENANT SMUGGLING (§13): across scenario / run / outcome,
 *    and through every pairwise artifact combination.
 * ────────────────────────────────────────────────────────────*/

describe("attack 3 — tenant smuggling across scenario / run / outcome", () => {
  it("denies run-only tenant mismatch", () => {
    const result = validateSimulationRunBundle(
      bundle({ run: run({ tenantRef: TENANT_B }) }),
      { nowMs: NOW_MS },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(issueCodes(result)).toEqual(["tenant_mismatch"]);
  });

  it("denies outcome-only tenant mismatch", () => {
    const result = validateSimulationRunBundle(
      bundle({ outcomes: [outcome({ tenantRef: TENANT_B })] }),
      { nowMs: NOW_MS },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(issueCodes(result)).toEqual(["tenant_mismatch"]);
  });

  it("denies fully split tenancy — scenario, run and outcome each claim a different tenant", () => {
    const result = validateSimulationRunBundle(
      bundle({
        run: run({ tenantRef: TENANT_B }),
        outcomes: [outcome({ tenantRef: TENANT_C })],
      }),
      { nowMs: NOW_MS },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(issueCodes(result).filter((code) => code === "tenant_mismatch").length).toBe(2);
    }
  });

  it("denies case-variant and whitespace-padded tenant smuggling — no normalization collapses tenant identities", () => {
    for (const smuggled of ["Tenant-alpha", " tenant-alpha", `${TENANT_A}\u0000`]) {
      const asRun = validateSimulationRunBundle(
        bundle({ run: run({ tenantRef: smuggled }) }),
        { nowMs: NOW_MS },
      );
      expect(asRun.ok, `smuggled tenant ${JSON.stringify(smuggled)} (run) must be denied`).toBe(
        false,
      );
      if (!asRun.ok) expect(issueCodes(asRun)).toContain("tenant_mismatch");

      const asOutcome = validateSimulationRunBundle(
        bundle({ outcomes: [outcome({ tenantRef: smuggled })] }),
        { nowMs: NOW_MS },
      );
      expect(asOutcome.ok, `smuggled tenant ${JSON.stringify(smuggled)} (outcome) must be denied`).toBe(
        false,
      );
      if (!asOutcome.ok) expect(issueCodes(asOutcome)).toContain("tenant_mismatch");
    }
  });

  it("denies foreign subjects — outcome references are scoped to what the scenario reads", () => {
    const result = validateSimulationRunBundle(
      bundle({ outcomes: [outcome({ subjectRefs: ["tenant-beta:subject:1"] })] }),
      { nowMs: NOW_MS },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(issueCodes(result)).toContain("unknown_subject");
  });

  it("keeps scenario tenancy anchored: a bundle whose scenario is rewritten to a foreign tenant fails on the run", () => {
    const result = validateSimulationRunBundle(
      bundle({ scenario: scenario({ tenantRef: TENANT_B }) }),
      { nowMs: NOW_MS },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(issueCodes(result)).toContain("tenant_mismatch");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. EXPIRY EVASION (§31): clock manipulation against the
 *    injected `nowMs` and forged artifact timestamps.
 * ────────────────────────────────────────────────────────────*/

describe("attack 4 — expiry evasion via clock manipulation", () => {
  it("treats validUntilMs === nowMs as already expired — no grace window", () => {
    const result = validateSimulationRunBundle(
      bundle({ outcomes: [outcome({ validUntilMs: NOW_MS })] }),
      { nowMs: NOW_MS },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(issueCodes(result)).toContain("inverted_validity");

    const verdict = usabilityForDecisionSupport(
      parseBundle(bundle()),
      parseOutcome(outcome({ validUntilMs: NOW_MS })),
      { nowMs: NOW_MS },
    );
    expect(verdict).toEqual({ usable: false, reason: "expired" });
  });

  it("marks a far-future expiry unusable in decision support — freshness is enforced at usability time", () => {
    const verdict = usabilityForDecisionSupport(parseBundle(bundle()), parseOutcome(outcome()), {
      nowMs: NOW_MS + 3_600_000,
    });
    expect(verdict).toEqual({ usable: false, reason: "expired" });
  });

  it("FINDING H3-075/F-3 — a NaN injected clock evades every expiry check in the module", () => {
    // Expected fail-closed behavior: a degenerate clock must fail closed
    // (treat as expired/deny). Observed: `x <= NaN` is false everywhere,
    // so expired artifacts and expired approvals pass as fresh.
    const expiredApprovalAllowed = decideSimulatedWriteback(proposal(), {
      nowMs: NAN_CLOCK,
      approval: forgedApproval(approval({ expiresAtMs: NOW_MS - 1 })),
    });
    expect(expiredApprovalAllowed).toEqual({ decision: "ALLOW" });

    const expiredOutcomeValid = validateSimulationRunBundle(
      bundle({ outcomes: [outcome({ generatedAtMs: NOW_MS - 20_000, validUntilMs: NOW_MS - 10_000 })] }),
      { nowMs: NAN_CLOCK },
    );
    expect(expiredOutcomeValid.ok).toBe(true);

    const expiredOutcomeUsable = usabilityForDecisionSupport(
      parseBundle(bundle()),
      parseOutcome(outcome({ generatedAtMs: NOW_MS - 20_000, validUntilMs: NOW_MS - 10_000 })),
      { nowMs: NAN_CLOCK },
    );
    expect(expiredOutcomeUsable).toEqual({ usable: true, reason: null });
  });

  it("FINDING H3-075/F-5 — future-dated provenance passes validation: an outcome can defer its expiry indefinitely by forging generation/validity timestamps beyond the clock", () => {
    // Expected fail-closed behavior: timestamps claiming to be generated
    // AFTER the observation clock should be rejected (an artifact cannot
    // pre-date its own provenance relative to now). Observed: accepted,
    // leaving the outcome permanently "fresh" until the forged horizon.
    const future = validateSimulationRunBundle(
      bundle({
        outcomes: [
          outcome({
            generatedAtMs: NOW_MS + 86_400_000,
            validUntilMs: NOW_MS + 86_400_000 * 2,
            provenance: { declaredBy: "principal:attacker", authority: "forged", recordedAtMs: NOW_MS + 86_400_000 },
          }),
        ],
      }),
      { nowMs: NOW_MS },
    );
    expect(future.ok).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. UNBOUNDED CARDINALITY: flood and cap evasion.
 * ────────────────────────────────────────────────────────────*/

describe("attack 5 — unbounded cardinality attacks", () => {
  it("holds the declared parameter cap at its boundary — 64 parse, 65 deny", () => {
    const params = (n: number): RawRecord[] =>
      Array.from({ length: n }, (_, i) => ({ key: `param-${i}`, value: i, unit: "per-step" }));

    expect(
      ScenarioDefinitionSchema.safeParse(scenario({ parameters: params(64) })).success,
    ).toBe(true);
    expect(
      ScenarioDefinitionSchema.safeParse(scenario({ parameters: params(65) })).success,
    ).toBe(false);
  });

  it("honours the opt-in runaway guard when the caller supplies maxHorizonSteps", () => {
    const result = validateSimulationRunBundle(
      bundle({ run: run({ horizonSteps: 11 }) }),
      { nowMs: NOW_MS, maxHorizonSteps: 5 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = issueCodes(result);
      expect(codes.filter((code) => code === "horizon_exceeded").length).toBe(2);
    }
  });

  it("FINDING H3-075/F-7 — outcome and subject cardinality are unbounded: a 1500-outcome flood bundle and a 10000-subject scenario both parse and validate", () => {
    // Expected fail-closed behavior: arrays should carry declared maxima
    // (parameters are capped at 64 — outcomes, subjectRefs and assumptions
    // are not), so a flood bundle is rejected by shape before validation.
    // Observed: shape accepts any cardinality; only per-item invariants apply.
    const flood = Array.from({ length: 1500 }, (_, i) =>
      outcome({ outcomeId: `outcome-flood-${i}`, horizonStep: i % 10 }),
    );
    const flooded = validateSimulationRunBundle(bundle({ outcomes: flood }), { nowMs: NOW_MS });
    expect(flooded.ok).toBe(true);

    const subjects = Array.from({ length: 10_000 }, (_, i) => `subject:${i}`);
    const wide = validateSimulationRunBundle(
      bundle({
        scenario: scenario({ subjectRefs: subjects }),
        outcomes: [outcome({ subjectRefs: ["subject:0", "subject:9999"] })],
      }),
      { nowMs: NOW_MS },
    );
    expect(wide.ok).toBe(true);
  });

  it("FINDING H3-075/F-9 — the absolute horizon cap is opt-in: without caller-supplied maxHorizonSteps a MAX_SAFE_INTEGER-step run validates", () => {
    // The module header declares "an unbounded simulation is invalid", but
    // the governed maximum exists only in optional options. With both the
    // scenario bound and the run horizon attacker-supplied, nothing bounds
    // the simulation unless the server caller opts in.
    const huge = Number.MAX_SAFE_INTEGER;
    const result = validateSimulationRunBundle(
      bundle({
        scenario: scenario({ horizonSteps: huge }),
        run: run({ horizonSteps: huge }),
      }),
      { nowMs: NOW_MS },
    );
    expect(result.ok).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 6. CROSS-ARTIFACT LAUNDERING: decision-support usability as a
 *    bypass surface (deepening H3-057's usability tests, which
 *    only ever fed it a matched bundle/outcome pair).
 * ────────────────────────────────────────────────────────────*/

describe("attack 6 — decision-support laundering (outcome ↔ bundle binding)", () => {
  it("refuses usability for a run that did not complete, even with fresh high-confidence intelligence", () => {
    const pending = parseBundle(bundle({ status: "running", outcomes: [] }));
    const verdict = usabilityForDecisionSupport(pending, parseOutcome(outcome()), {
      nowMs: NOW_MS,
    });
    expect(verdict).toEqual({ usable: false, reason: "not_completed" });
  });

  it("FINDING H3-075/F-6 — usabilityForDecisionSupport performs no outcome↔bundle binding: a laundered outcome from another run and another tenant is marked usable", () => {
    // Expected fail-closed behavior: usability must be evaluated only for
    // outcomes bound to the given bundle (run, tenant, subject scope).
    // Observed: only bundle.status, outcome.validUntilMs and confidence are
    // consulted; a foreign/out-of-scope outcome is laundered into "usable".
    const legitimateBundle = parseBundle(bundle());
    const laundered = parseOutcome(
      outcome({
        outcomeId: "outcome-foreign",
        runId: "run-foreign",
        tenantRef: TENANT_B,
        subjectRefs: ["subject:99"],
        validUntilMs: NOW_MS + 86_400_000,
        confidence: 0.99,
      }),
    );
    const verdict = usabilityForDecisionSupport(legitimateBundle, laundered, {
      nowMs: NOW_MS,
      minConfidence: 0.5,
    });
    expect(verdict).toEqual({ usable: true, reason: null });
  });
});

/* ─────────────────────────────────────────────────────────────
 * 7. BASELINE: the controlled path remains intact (the module
 *    is not broken by default — only the adversarial surfaces
 *    above leak).
 * ────────────────────────────────────────────────────────────*/

describe("baseline — the governed path still works under adversarial scrutiny", () => {
  it("a fully governed proposal with a matching, fresh, non-expired approval is ALLOW", () => {
    const decision = decideSimulatedWriteback(proposal(), {
      nowMs: NOW_MS,
      approval: forgedApproval(approval()),
    });
    expect(decision).toEqual({ decision: "ALLOW" });
  });

  it("a consistent completed bundle validates against the injected clock", () => {
    const result = validateSimulationRunBundle(bundle(), { nowMs: NOW_MS });
    expect(result.ok).toBe(true);
  });

  it("duplicate outcome ids are surfaced, never absorbed — even at three-way collision", () => {
    const result = validateSimulationRunBundle(
      bundle({
        outcomes: [outcome(), outcome({ horizonStep: 6 }), outcome({ horizonStep: 7 })],
      }),
      { nowMs: NOW_MS },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(issueCodes(result).filter((code) => code === "duplicate_outcome").length).toBe(2);
    }
  });
});