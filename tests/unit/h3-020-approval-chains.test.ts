/**
 * CoreGrid — H3-020 (J-032) Approval Chain Engineer.
 *
 * Proof suite for the ESCALATE / REQUIRE_APPROVAL resolution-flow contracts
 * in `frontend/src/lib/approval/chains.ts` (Constitution §7, §12, §16, §21,
 * §29). Invariants under test:
 *
 * - §16 routing: only ESCALATE and REQUIRE_APPROVAL enter the flow; the
 *   terminal engine decisions (ALLOW / DENY / REDACT) fail closed with a
 *   typed code — this module never re-decides what the engine decided.
 * - Risk-classified routing: every risk tier mandates a resolution depth
 *   (single-resolver / two-person / quorum) and a chain that cannot satisfy
 *   the mandated depth with independent eligible humans is BLOCKED at
 *   routing time.
 * - Human closure laws: an AI identity can never resolve; the requester can
 *   never resolve its own case; capability, tenant scope, pool membership,
 *   evidence, append-only uniqueness and the deadline are enforced at
 *   record time and re-derived at resolution time.
 * - Fail-closed when no approver resolves: a deadline that passes without
 *   human closure yields blocked_unresolved — never approved, never
 *   dropped.
 * - Typed outcomes and the execution gate: ONLY the approved outcome allows
 *   execution; every other outcome DENIES with named reasons and a full
 *   audit record. Denial is a decision, not an exception.
 *
 * All instants are fixed literals — the suite is offline and wall-clock
 * independent. No database, no network, no secrets.
 */
import { describe, expect, it } from "vitest";
import {
  DEPTH_MINIMUM_RESOLVERS,
  MANDATED_RESOLUTION_DEPTH,
  ResolutionFlowError,
  RESOLUTION_OUTCOME_KINDS,
  declareApprovalChain,
  gateExecutionOnResolution,
  mandatedResolutionDepth,
  mandatedResolverCount,
  openResolutionFlow,
  openResolutionFlowForAuthorizationOutcome,
  recordResolution,
  resolveFlow,
  routeToApprovalChain,
  type ApprovalChainConfig,
  type EscalationCase,
  type ResolutionFlowInput,
  type ResolutionInput,
  type ResolutionOutcome,
  type ResolutionRecord,
  type ResolutionRiskTier,
  type ResolvableDecision,
  type RoutingResult,
} from "@/lib/approval/chains";
import type { AuthorizationResult } from "@/lib/identity";

/* ─────────────────────────────────────────────────────────────
 * Fixtures — fixed instants, offline and deterministic
 * ────────────────────────────────────────────────────────────*/

const TENANT_A = "tenant-1";
const TENANT_B = "tenant-2";
const CAP = "approval:resolve";

const REQUESTER_AI = "agent-proposer-001";
const ALICE = "human-alice";
const BOB = "human-bob";
const CAROL = "human-carol";
const DAVE = "human-dave";

const REQUESTED_AT = "2026-10-01T00:00:00.000Z";
const DECIDE_1 = "2026-10-01T06:00:00.000Z";
const DECIDE_2 = "2026-10-01T08:00:00.000Z";
const DECIDE_3 = "2026-10-01T10:00:00.000Z";
const DEADLINE = "2026-10-02T00:00:00.000Z";
const AFTER_DEADLINE = "2026-10-03T00:00:00.000Z";
const BEFORE_REQUEST = "2026-09-30T00:00:00.000Z";

const SUBJECT = { operation: "rotate", target: "credential-store-7" };

function baseInput(overrides: Partial<ResolutionFlowInput> = {}): ResolutionFlowInput {
  return {
    requestId: "req-100",
    tenantId: TENANT_A,
    policyId: "policy-ops-1",
    decision: "REQUIRE_APPROVAL",
    riskTier: "routine",
    reason: "deferred pending human review",
    requesterRef: REQUESTER_AI,
    requesterKind: "ai",
    requestedAt: REQUESTED_AT,
    subject: SUBJECT,
    ...overrides,
  };
}

/** Flow input without the decision — the decision comes from the engine outcome. */
function baseInputWithoutDecision(
  overrides: Partial<Omit<ResolutionFlowInput, "decision">> = {},
): Omit<ResolutionFlowInput, "decision"> {
  const { decision, ...rest } = baseInput();
  return { ...rest, ...overrides };
}

function pool(refs: readonly string[], capabilities: readonly string[] = [CAP]) {
  return refs.map((resolverRef) => ({
    resolverRef,
    identityKind: resolverRef.startsWith("agent-") ? ("ai" as const) : ("human" as const),
    capabilities: [...capabilities],
  }));
}

function chain(
  refs: readonly string[],
  overrides: Partial<ApprovalChainConfig> = {},
): ApprovalChainConfig {
  return {
    chainId: "chain-ops-1",
    tenantId: TENANT_A,
    capabilityRequired: CAP,
    resolvers: pool(refs),
    resolveBy: DEADLINE,
    ...overrides,
  };
}

/**
 * Chain overrides for `routed` — resolvers are declared as pool ref strings
 * (mapped through `pool()` inside `chain()`), all other fields match the
 * `ApprovalChainConfig` contract verbatim.
 */
type RoutedChainOverrides = Omit<Partial<ApprovalChainConfig>, "resolvers"> & {
  resolvers?: readonly string[];
};

/** Open a case + route it through a chain (the common happy prefix). */
function routed(
  inputOverrides: Partial<ResolutionFlowInput> = {},
  chainOverrides: RoutedChainOverrides = {},
): { kase: EscalationCase; routing: RoutingResult } {
  const kase = openResolutionFlow(baseInput(inputOverrides));
  const { resolvers, ...chainRest } = chainOverrides;
  const refs: readonly string[] = resolvers ?? [ALICE, BOB, CAROL, DAVE];
  const routing = routeToApprovalChain(kase, declareApprovalChain(chain(refs, chainRest)));
  return { kase, routing };
}

function approve(
  kase: EscalationCase,
  routing: RoutingResult,
  chainConfig: ApprovalChainConfig,
  resolverRef: string,
  overrides: Partial<ResolutionInput> = {},
): ResolutionRecord {
  return recordResolution(kase, routing, declareApprovalChain(chainConfig), [], {
    resolutionId: `res-${resolverRef}`,
    verdict: "approve",
    resolverRef,
    identityKind: "human",
    tenantId: kase.tenantId,
    capabilities: [CAP],
    decidedAt: DECIDE_1,
    evidence: `reviewed and approved by ${resolverRef}`,
    ...overrides,
  });
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof ResolutionFlowError) return error.code;
    throw error;
  }
  throw new Error("expected a ResolutionFlowError but the call succeeded");
}

/* ─────────────────────────────────────────────────────────────
 * 1. Case opening — the §16 routing contract
 * ────────────────────────────────────────────────────────────*/

describe("case opening (§16 routing contract)", () => {
  it("opens a case from an ESCALATE engine outcome with engine provenance", () => {
    const kase = openResolutionFlowForAuthorizationOutcome(
      { decision: "ESCALATE", reason: "risk above escalation threshold" },
      baseInputWithoutDecision(),
    );
    expect(kase.decision).toBe("ESCALATE");
    expect(kase.authorizationReason).toBe("risk above escalation threshold");
    expect(kase.schemaVersion).toBe("1.0");
    expect(kase.subjectDigest.startsWith("sha256:")).toBe(true);
    expect(kase.requesterKind).toBe("ai");
    expect(Object.isFrozen(kase)).toBe(true);
  });

  it("opens a case from a REQUIRE_APPROVAL engine outcome", () => {
    const kase = openResolutionFlowForAuthorizationOutcome(
      { decision: "REQUIRE_APPROVAL", reason: "policy mandates human approval" },
      baseInputWithoutDecision(),
    );
    expect(kase.decision).toBe("REQUIRE_APPROVAL");
    expect(kase.requiredResolvers).toBe(1);
  });

  it("is content-addressed: same decision opens the same case, changed subject voids it", () => {
    const a = openResolutionFlow(baseInput({}));
    const b = openResolutionFlow(baseInput({}));
    expect(b.caseId).toBe(a.caseId);
    const c = openResolutionFlow(baseInput({ subject: { operation: "rotate", target: "credential-store-8" } }));
    expect(c.subjectDigest).not.toBe(a.subjectDigest);
    expect(c.caseId).not.toBe(a.caseId);
  });

  it("fails closed on terminal engine decisions — ALLOW, DENY, REDACT never enter the flow", () => {
    for (const decision of ["ALLOW", "DENY", "REDACT"] as const) {
      expect(
        codeOf(() =>
          openResolutionFlowForAuthorizationOutcome(
            { decision, reason: "terminal" },
            baseInputWithoutDecision(),
          ),
        ),
      ).toBe("decision_not_routable");
    }
  });

  it("fails closed on an outcome that does not match the engine decision contract", () => {
    expect(
      codeOf(() =>
        openResolutionFlowForAuthorizationOutcome(
          { decision: "ESCALATE" } as unknown as AuthorizationResult,
          baseInputWithoutDecision(),
        ),
      ),
    ).toBe("invalid_input");
  });

  it("fails closed on invalid flow inputs", () => {
    expect(codeOf(() => openResolutionFlow(baseInput({ tenantId: "   " })))).toBe("invalid_input");
    expect(codeOf(() => openResolutionFlow(baseInput({ requestId: "" })))).toBe("invalid_input");
    expect(codeOf(() => openResolutionFlow(baseInput({ requestedAt: "not-a-time" })))).toBe("invalid_input");
    expect(codeOf(() => openResolutionFlow(baseInput({ policyId: undefined })))).toBe("invalid_input");
    expect(
      codeOf(() =>
        openResolutionFlow(baseInput({ decision: "ALLOW" as unknown as ResolvableDecision })),
      ),
    ).toBe("invalid_input");
    expect(
      codeOf(() =>
        openResolutionFlow(baseInput({ riskTier: "cosmic" as unknown as ResolutionRiskTier })),
      ),
    ).toBe("invalid_input");
  });

  it("opens directly (without an engine outcome) with null authorization provenance", () => {
    const kase = openResolutionFlow(baseInput({ decision: "ESCALATE" }));
    expect(kase.decision).toBe("ESCALATE");
    expect(kase.authorizationReason).toBeNull();
    expect(kase.mandatedDepth).toBe("single-resolver");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Risk-classified routing to human approval chains
 * ────────────────────────────────────────────────────────────*/

describe("risk-classified routing", () => {
  it("mandates a resolution depth for every risk tier — no tier resolves on AI authority alone", () => {
    expect(MANDATED_RESOLUTION_DEPTH.routine).toBe("single-resolver");
    expect(MANDATED_RESOLUTION_DEPTH.elevated).toBe("two-person");
    expect(MANDATED_RESOLUTION_DEPTH.critical).toBe("quorum");
    expect(mandatedResolutionDepth("routine")).toBe("single-resolver");
    expect(mandatedResolverCount("routine")).toBe(1);
    expect(mandatedResolverCount("elevated")).toBe(2);
    expect(mandatedResolverCount("critical")).toBe(3);
    expect(DEPTH_MINIMUM_RESOLVERS.quorum).toBe(3);
  });

  it("routes when the chain satisfies the mandated depth with eligible humans", () => {
    const { kase, routing } = routed({ riskTier: "routine" }, { resolvers: [ALICE, BOB] });
    expect(routing.ok).toBe(true);
    if (routing.ok) {
      expect(routing.routing.requiredResolvers).toBe(1);
      expect(routing.routing.eligibleResolverRefs).toContain(ALICE);
      expect(routing.routing.capabilityRequired).toBe(CAP);
      expect(routing.routing.resolveBy).toBe(DEADLINE);
      expect(kase.caseId.length).toBeGreaterThan(0);
    }
  });

  it("excludes the requester from routing positions — independence at routing time", () => {
    const { kase, routing } = routed(
      { requesterRef: ALICE, requesterKind: "human", riskTier: "routine" },
      { resolvers: [ALICE, BOB] },
    );
    expect(routing.ok).toBe(true);
    if (routing.ok) {
      expect(routing.routing.eligibleResolverRefs).not.toContain(kase.requesterRef);
      expect(routing.routing.eligibleResolverRefs).toEqual([BOB]);
    }
  });

  it("fails closed when the eligible human pool cannot satisfy the mandated depth", () => {
    const { routing } = routed({ riskTier: "elevated" }, { resolvers: [ALICE] });
    expect(routing.ok).toBe(false);
    if (!routing.ok) {
      expect(routing.code).toBe("no_eligible_resolver");
      expect(routing.detail).toContain("two-person");
      expect(routing.detail).toContain("fail-closed");
    }
  });

  it("fails closed on an AI-only pool — AI can never occupy a resolver position", () => {
    const { routing } = routed({ riskTier: "critical" }, { resolvers: [REQUESTER_AI, "agent-2", "agent-3"] });
    expect(routing.ok).toBe(false);
    if (!routing.ok) expect(routing.code).toBe("no_eligible_resolver");
  });

  it("fails closed when no pool member holds the required capability", () => {
    const { routing } = routed({ riskTier: "routine" }, { resolvers: [ALICE, BOB], capabilityRequired: "approval:resolve-critical" });
    expect(routing.ok).toBe(false);
    if (!routing.ok) expect(routing.code).toBe("no_eligible_resolver");
  });

  it("fails closed on a chain scoped to another tenant (§13)", () => {
    const { routing } = routed({ riskTier: "routine" }, { tenantId: TENANT_B });
    expect(routing.ok).toBe(false);
    if (!routing.ok) {
      expect(routing.code).toBe("chain_tenant_mismatch");
      expect(routing.detail).toContain(TENANT_B);
    }
  });

  it("fails closed on a chain whose deadline is not in the future of the case request", () => {
    const { routing } = routed({ riskTier: "routine" }, { resolveBy: BEFORE_REQUEST });
    expect(routing.ok).toBe(false);
    if (!routing.ok) expect(routing.code).toBe("deadline_invalid");
  });

  it("fails closed on an unparseable chain deadline", () => {
    expect(codeOf(() => declareApprovalChain(chain([ALICE], { resolveBy: "garbage" })))).toBe("invalid_input");
  });

  it("accepts an unbounded chain (no deadline)", () => {
    const declared = declareApprovalChain(chain([ALICE], { resolveBy: undefined }));
    expect(declared.resolveBy).toBeNull();
    expect(Object.isFrozen(declared)).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Human resolution records — closure laws at record time
 * ────────────────────────────────────────────────────────────*/

describe("human resolution records (§7, §12)", () => {
  it("records a valid human approval bound to the case with trimmed evidence", () => {
    const { kase, routing } = routed({ riskTier: "routine" }, { resolvers: [ALICE, BOB] });
    const record = approve(kase, routing, chain([ALICE, BOB]), ALICE, { evidence: "  approved after review  " });
    expect(record.caseId).toBe(kase.caseId);
    expect(record.verdict).toBe("approve");
    expect(record.evidence).toBe("approved after review");
    expect(record.identityKind).toBe("human");
    expect(record.capabilities).toEqual([CAP]);
    expect(Object.isFrozen(record)).toBe(true);
  });

  it("rejects an AI resolver — AI can never resolve a deferred decision", () => {
    const { kase, routing } = routed({ riskTier: "routine" }, { resolvers: [ALICE, BOB] });
    expect(
      codeOf(() =>
        approve(kase, routing, chain([ALICE, BOB]), ALICE, { resolverRef: REQUESTER_AI, identityKind: "ai" }),
      ),
    ).toBe("resolver_not_human");
  });

  it("rejects a resolver without the required capability", () => {
    const { kase, routing } = routed({ riskTier: "routine" }, { resolvers: [ALICE, BOB] });
    expect(
      codeOf(() => approve(kase, routing, chain([ALICE, BOB]), ALICE, { capabilities: ["other:cap"] })),
    ).toBe("capability_missing");
  });

  it("rejects a resolver scoped to another tenant (§13)", () => {
    const { kase, routing } = routed({ riskTier: "routine" }, { resolvers: [ALICE, BOB] });
    expect(
      codeOf(() => approve(kase, routing, chain([ALICE, BOB]), ALICE, { tenantId: TENANT_B })),
    ).toBe("tenant_scope_mismatch");
  });

  it("rejects self-resolution — the requester can never resolve its own case", () => {
    const kase = openResolutionFlow(baseInput({ requesterRef: ALICE, requesterKind: "human", riskTier: "routine" }));
    const routing = routeToApprovalChain(kase, declareApprovalChain(chain([ALICE, BOB])));
    expect(routing.ok).toBe(true);
    expect(
      codeOf(() => approve(kase, routing, chain([ALICE, BOB]), ALICE)),
    ).toBe("self_resolution_rejected");
  });

  it("rejects a resolver holding no routing position", () => {
    const { kase, routing } = routed({ riskTier: "routine" }, { resolvers: [ALICE, BOB] });
    expect(
      codeOf(() => approve(kase, routing, chain([ALICE, BOB]), CAROL)),
    ).toBe("resolver_not_in_pool");
  });

  it("rejects any resolution when the case never routed — blocked has no positions", () => {
    const kase = openResolutionFlow(baseInput({ riskTier: "elevated" }));
    const routing = routeToApprovalChain(kase, declareApprovalChain(chain([ALICE])));
    expect(routing.ok).toBe(false);
    expect(
      codeOf(() => approve(kase, routing, chain([ALICE]), ALICE)),
    ).toBe("case_not_routed");
  });

  it("enforces append-only uniqueness: no duplicate record id and no double-position resolver", () => {
    const { kase, routing } = routed({ riskTier: "elevated" }, { resolvers: [ALICE, BOB, CAROL] });
    const first = approve(kase, routing, chain([ALICE, BOB, CAROL]), ALICE);
    expect(
      codeOf(() =>
        recordResolution(kase, routing, declareApprovalChain(chain([ALICE, BOB, CAROL])), [first], {
          resolutionId: `res-${ALICE}`,
          verdict: "approve",
          resolverRef: BOB,
          identityKind: "human",
          tenantId: TENANT_A,
          capabilities: [CAP],
          decidedAt: DECIDE_2,
          evidence: "second record reusing the first id",
        }),
      ),
    ).toBe("duplicate_resolution");
    expect(
      codeOf(() =>
        recordResolution(kase, routing, declareApprovalChain(chain([ALICE, BOB, CAROL])), [first], {
          resolutionId: "res-again",
          verdict: "approve",
          resolverRef: ALICE,
          identityKind: "human",
          tenantId: TENANT_A,
          capabilities: [CAP],
          decidedAt: DECIDE_2,
          evidence: "same resolver occupying a second position",
        }),
      ),
    ).toBe("duplicate_resolver");
  });

  it("rejects resolutions outside the case window — before the request or at/past the deadline", () => {
    const { kase, routing } = routed({ riskTier: "routine" }, { resolvers: [ALICE, BOB] });
    expect(
      codeOf(() => approve(kase, routing, chain([ALICE, BOB]), ALICE, { decidedAt: BEFORE_REQUEST })),
    ).toBe("invalid_timestamp");
    expect(
      codeOf(() => approve(kase, routing, chain([ALICE, BOB]), ALICE, { decidedAt: DEADLINE })),
    ).toBe("deadline_exceeded");
    expect(
      codeOf(() => approve(kase, routing, chain([ALICE, BOB]), ALICE, { decidedAt: AFTER_DEADLINE })),
    ).toBe("deadline_exceeded");
  });

  it("rejects an evidence-free resolution", () => {
    const { kase, routing } = routed({ riskTier: "routine" }, { resolvers: [ALICE, BOB] });
    expect(codeOf(() => approve(kase, routing, chain([ALICE, BOB]), ALICE, { evidence: "   " }))).toBe(
      "evidence_required",
    );
    expect(codeOf(() => approve(kase, routing, chain([ALICE, BOB]), ALICE, { evidence: "" }))).toBe(
      "evidence_required",
    );
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. Typed flow outcomes
 * ────────────────────────────────────────────────────────────*/

describe("typed flow outcomes", () => {
  it("exposes the frozen outcome vocabulary", () => {
    expect([...RESOLUTION_OUTCOME_KINDS]).toEqual([
      "approved",
      "rejected",
      "pending",
      "blocked_no_eligible_resolver",
      "blocked_unresolved",
      "invalid",
    ]);
  });

  it("approves a routine case on one independent human approval", () => {
    const { kase, routing } = routed({ riskTier: "routine" }, { resolvers: [ALICE, BOB] });
    const record = approve(kase, routing, chain([ALICE, BOB]), ALICE);
    const outcome = resolveFlow(kase, routing, [record], DECIDE_1);
    expect(outcome.kind).toBe("approved");
    if (outcome.kind === "approved") {
      expect(outcome.requiredResolvers).toBe(1);
      expect(outcome.depth).toBe("single-resolver");
      expect(outcome.approvals.map((r) => r.resolverRef)).toEqual([ALICE]);
    }
    expect(Object.isFrozen(outcome)).toBe(true);
  });

  it("holds an elevated case pending until the mandated two-person depth is met", () => {
    const { kase, routing } = routed({ riskTier: "elevated" }, { resolvers: [ALICE, BOB, CAROL] });
    const c = chain([ALICE, BOB, CAROL]);
    const first = approve(kase, routing, c, ALICE);
    const pending = resolveFlow(kase, routing, [first], DECIDE_1);
    expect(pending.kind).toBe("pending");
    if (pending.kind === "pending") {
      expect(pending.requiredResolvers).toBe(2);
      expect(pending.resolveBy).toBe(DEADLINE);
    }
    const second = recordResolution(kase, routing, declareApprovalChain(c), [first], {
      resolutionId: "res-bob",
      verdict: "approve",
      resolverRef: BOB,
      identityKind: "human",
      tenantId: TENANT_A,
      capabilities: [CAP],
      decidedAt: DECIDE_2,
      evidence: "independent second review",
    });
    const approved = resolveFlow(kase, routing, [first, second], DECIDE_2);
    expect(approved.kind).toBe("approved");
  });

  it("closes a critical case only at quorum depth", () => {
    const { kase, routing } = routed({ riskTier: "critical" }, { resolvers: [ALICE, BOB, CAROL, DAVE] });
    const c = chain([ALICE, BOB, CAROL, DAVE]);
    const a1 = approve(kase, routing, c, ALICE);
    const a2 = recordResolution(kase, routing, declareApprovalChain(c), [a1], {
      resolutionId: "res-bob",
      verdict: "approve",
      resolverRef: BOB,
      identityKind: "human",
      tenantId: TENANT_A,
      capabilities: [CAP],
      decidedAt: DECIDE_2,
      evidence: "second quorum vote",
    });
    expect(resolveFlow(kase, routing, [a1, a2], DECIDE_2).kind).toBe("pending");
    const a3 = recordResolution(kase, routing, declareApprovalChain(c), [a1, a2], {
      resolutionId: "res-carol",
      verdict: "approve",
      resolverRef: CAROL,
      identityKind: "human",
      tenantId: TENANT_A,
      capabilities: [CAP],
      decidedAt: DECIDE_3,
      evidence: "third quorum vote",
    });
    const outcome = resolveFlow(kase, routing, [a1, a2, a3], DECIDE_3);
    expect(outcome.kind).toBe("approved");
    if (outcome.kind === "approved") expect(outcome.depth).toBe("quorum");
  });

  it("closes the case as rejected on any human rejection — even with sufficient approvals", () => {
    const { kase, routing } = routed({ riskTier: "elevated" }, { resolvers: [ALICE, BOB, CAROL] });
    const c = chain([ALICE, BOB, CAROL]);
    const a = approve(kase, routing, c, ALICE);
    const r = recordResolution(kase, routing, declareApprovalChain(c), [a], {
      resolutionId: "res-bob",
      verdict: "reject",
      resolverRef: BOB,
      identityKind: "human",
      tenantId: TENANT_A,
      capabilities: [CAP],
      decidedAt: DECIDE_2,
      evidence: "declined: risk not acceptable this cycle",
    });
    const outcome = resolveFlow(kase, routing, [a, r], DECIDE_2);
    expect(outcome.kind).toBe("rejected");
    if (outcome.kind === "rejected") {
      expect(outcome.rejection.resolverRef).toBe(BOB);
      expect(outcome.reason).toContain("declined");
    }
  });

  it("fails closed when the deadline passes without human closure — never approved, never dropped", () => {
    const { kase, routing } = routed({ riskTier: "elevated" }, { resolvers: [ALICE, BOB] });
    const c = chain([ALICE, BOB]);
    const only = approve(kase, routing, c, ALICE);
    const outcome: ResolutionOutcome = resolveFlow(kase, routing, [only], AFTER_DEADLINE);
    expect(outcome.kind).toBe("blocked_unresolved");
    if (outcome.kind === "blocked_unresolved") {
      expect(outcome.detail).toContain("1/2");
      expect(outcome.detail).toContain("fail-closed");
    }
  });

  it("stays blocked forever when routing failed — no approver can ever resolve", () => {
    const kase = openResolutionFlow(baseInput({ riskTier: "critical" }));
    const routing = routeToApprovalChain(kase, declareApprovalChain(chain([ALICE])));
    const outcome = resolveFlow(kase, routing, [], AFTER_DEADLINE);
    expect(outcome.kind).toBe("blocked_no_eligible_resolver");
    if (outcome.kind === "blocked_no_eligible_resolver") expect(outcome.code).toBe("no_eligible_resolver");
  });

  it("surfaces a forged record set as invalid — wrong case binding, non-human caster, missing capability, self-resolution", () => {
    const { kase, routing } = routed({ riskTier: "routine" }, { resolvers: [ALICE, BOB] });
    const forgedCases: readonly ResolutionRecord[] = [
      { ...approve(kase, routing, chain([ALICE, BOB]), ALICE), caseId: "case-other" },
      { ...approve(kase, routing, chain([ALICE, BOB]), ALICE), identityKind: "ai" },
      { ...approve(kase, routing, chain([ALICE, BOB]), ALICE), capabilities: ["other:cap"] },
      { ...approve(kase, routing, chain([ALICE, BOB]), ALICE), resolverRef: kase.requesterRef },
      { ...approve(kase, routing, chain([ALICE, BOB]), ALICE), tenantId: TENANT_B },
      { ...approve(kase, routing, chain([ALICE, BOB]), ALICE), evidence: "  " },
      { ...approve(kase, routing, chain([ALICE, BOB]), ALICE), decidedAt: BEFORE_REQUEST },
      { ...approve(kase, routing, chain([ALICE, BOB]), ALICE), decidedAt: AFTER_DEADLINE },
      { ...approve(kase, routing, chain([ALICE, BOB]), ALICE), resolverRef: CAROL },
    ];
    for (const forged of forgedCases) {
      const outcome = resolveFlow(kase, routing, [forged], DECIDE_1);
      expect(outcome.kind).toBe("invalid");
      if (outcome.kind === "invalid") expect(outcome.reasons.length).toBeGreaterThan(0);
    }
  });

  it("surfaces a duplicate-filled record array as invalid even if every entry is valid", () => {
    const { kase, routing } = routed({ riskTier: "routine" }, { resolvers: [ALICE, BOB] });
    const record = approve(kase, routing, chain([ALICE, BOB]), ALICE);
    const outcome = resolveFlow(kase, routing, [record, record], DECIDE_1);
    expect(outcome.kind).toBe("invalid");
    if (outcome.kind === "invalid") {
      expect(outcome.reasons.some((reason) => reason.includes("more than once"))).toBe(true);
      expect(outcome.reasons.some((reason) => reason.includes("more than one resolution position"))).toBe(true);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. Execution gate — human closure required before execution
 * ────────────────────────────────────────────────────────────*/

describe("execution gate (human closure before execution, §21, §29)", () => {
  it("allows execution only for the approved outcome and binds the resolver set into the audit", () => {
    const { kase, routing } = routed({ riskTier: "elevated" }, { resolvers: [ALICE, BOB] });
    const c = chain([ALICE, BOB]);
    const a1 = approve(kase, routing, c, ALICE);
    const a2 = recordResolution(kase, routing, declareApprovalChain(c), [a1], {
      resolutionId: "res-bob",
      verdict: "approve",
      resolverRef: BOB,
      identityKind: "human",
      tenantId: TENANT_A,
      capabilities: [CAP],
      decidedAt: DECIDE_2,
      evidence: "independent second review",
    });
    const outcome = resolveFlow(kase, routing, [a1, a2], DECIDE_2);
    const gate = gateExecutionOnResolution(kase, outcome, DECIDE_2);
    expect(gate.gateDecision).toBe("ALLOWED");
    expect(gate.audit.outcomeKind).toBe("approved");
    expect(gate.audit.resolverRefs).toEqual([ALICE, BOB]);
    expect(gate.audit.reasons[0]).toContain("human closure satisfied");
    expect(gate.audit.caseId).toBe(kase.caseId);
    expect(gate.audit.subjectDigest).toBe(kase.subjectDigest);
    expect(gate.audit.policyId).toBe(kase.policyId);
    expect(Object.isFrozen(gate)).toBe(true);
  });

  it("produces a deterministic, content-addressed audit id", () => {
    const { kase, routing } = routed({ riskTier: "routine" }, { resolvers: [ALICE, BOB] });
    const record = approve(kase, routing, chain([ALICE, BOB]), ALICE);
    const outcome = resolveFlow(kase, routing, [record], DECIDE_1);
    const gateA = gateExecutionOnResolution(kase, outcome, DECIDE_1);
    const gateB = gateExecutionOnResolution(kase, outcome, DECIDE_1);
    expect(gateB.audit.auditId).toBe(gateA.audit.auditId);
    expect(gateA.audit.auditId.startsWith("sha256:")).toBe(true);
  });

  it("denies a pending case — closure not yet reached", () => {
    const { kase, routing } = routed({ riskTier: "elevated" }, { resolvers: [ALICE, BOB] });
    const record = approve(kase, routing, chain([ALICE, BOB]), ALICE);
    const gate = gateExecutionOnResolution(kase, resolveFlow(kase, routing, [record], DECIDE_1), DECIDE_1);
    expect(gate.gateDecision).toBe("DENIED");
    expect(gate.audit.reasons[0]).toContain("1/2");
  });

  it("denies a rejected case", () => {
    const { kase, routing } = routed({ riskTier: "routine" }, { resolvers: [ALICE, BOB] });
    const r = recordResolution(kase, routing, declareApprovalChain(chain([ALICE, BOB])), [], {
      resolutionId: "res-alice",
      verdict: "reject",
      resolverRef: ALICE,
      identityKind: "human",
      tenantId: TENANT_A,
      capabilities: [CAP],
      decidedAt: DECIDE_1,
      evidence: "declined",
    });
    const gate = gateExecutionOnResolution(kase, resolveFlow(kase, routing, [r], DECIDE_1), DECIDE_1);
    expect(gate.gateDecision).toBe("DENIED");
    expect(gate.audit.reasons[0]).toContain("rejected");
    expect(gate.audit.resolverRefs).toEqual([ALICE]);
  });

  it("denies a deadline-passed case — fail-closed when no approver resolves", () => {
    const { kase, routing } = routed({ riskTier: "elevated" }, { resolvers: [ALICE, BOB] });
    const only = approve(kase, routing, chain([ALICE, BOB]), ALICE);
    const gate = gateExecutionOnResolution(
      kase,
      resolveFlow(kase, routing, [only], AFTER_DEADLINE),
      AFTER_DEADLINE,
    );
    expect(gate.gateDecision).toBe("DENIED");
    expect(gate.audit.outcomeKind).toBe("blocked_unresolved");
    expect(gate.audit.reasons[0]).toContain("never reached");
  });

  it("denies an unrouteable case — the flow never waits on an impossible chain", () => {
    const kase = openResolutionFlow(baseInput({ riskTier: "critical" }));
    const routing = routeToApprovalChain(kase, declareApprovalChain(chain([ALICE])));
    const gate = gateExecutionOnResolution(kase, resolveFlow(kase, routing, [], DECIDE_1), DECIDE_1);
    expect(gate.gateDecision).toBe("DENIED");
    expect(gate.audit.outcomeKind).toBe("blocked_no_eligible_resolver");
  });

  it("denies an invalid record set and names every forged-record reason", () => {
    const { kase, routing } = routed({ riskTier: "routine" }, { resolvers: [ALICE, BOB] });
    const forged: ResolutionRecord = {
      ...approve(kase, routing, chain([ALICE, BOB]), ALICE),
      tenantId: TENANT_B,
    };
    const gate = gateExecutionOnResolution(kase, resolveFlow(kase, routing, [forged], DECIDE_1), DECIDE_1);
    expect(gate.gateDecision).toBe("DENIED");
    expect(gate.audit.outcomeKind).toBe("invalid");
    expect(gate.audit.reasons.length).toBeGreaterThan(0);
  });

  it("always emits an audit record with requester provenance — denial is a recorded decision, not silence", () => {
    const { kase, routing } = routed({ riskTier: "routine" }, { resolvers: [ALICE, BOB] });
    const outcomes = [
      resolveFlow(kase, routing, [], DECIDE_1),
      resolveFlow(kase, routing, [], AFTER_DEADLINE),
    ];
    for (const outcome of outcomes) {
      const gate = gateExecutionOnResolution(kase, outcome, DECIDE_1);
      expect(gate.audit.auditId.startsWith("sha256:")).toBe(true);
      expect(gate.audit.at).toBe(DECIDE_1);
      expect(gate.audit.requesterRef).toBe(REQUESTER_AI);
      expect(gate.audit.requesterKind).toBe("ai");
      expect(gate.audit.riskTier).toBe("routine");
      expect(gate.audit.mandatedDepth).toBe("single-resolver");
      expect(gate.audit.requiredResolvers).toBe(1);
      expect(gate.audit.reasons.length).toBeGreaterThan(0);
      expect(gate.audit.decision).toBe(kase.decision);
      expect(Object.isFrozen(gate.audit)).toBe(true);
    }
  });
});