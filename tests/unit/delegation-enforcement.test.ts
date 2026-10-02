/**
 * CoreGrid delegation ENFORCEMENT tests (DEFECT-4 fix + MISSION-R-52 /
 * V1CAP-021 mission wiring, wave 3).
 *
 * Validates that delegation expiry is ENFORCED, not just representable:
 * - as-of evaluation over an explicit instant (the contract receives time;
 *   no implicit Date.now()) — before/after/at the expiry and notBefore
 *   boundaries;
 * - future-dated rejection (notBefore in the future authorizes nothing);
 * - structural status transitions — a contract cannot be active/suspended
 *   after its expiry, nor expired before it, nor revoked in the future;
 * - the transitive law composes revocation WITH expiry: chains routed
 *   through an expired or revoked link are invalidated downstream, and
 *   revocation propagation routes through non-usable links;
 * - the mission-runner delegation gate: mission execution under delegation
 *   validates the contract at execution time, blocks expired/revoked/
 *   insufficient delegations with a typed failure, records the gate verdict
 *   as a mission lifecycle signal (DEFECT-4 defect reference on expiry
 *   denials), and re-evaluates on the next gated action of a long-running
 *   step.
 */

import { describe, expect, it } from "vitest";
import {
  DELEGATION_CONTRACT_SCHEMA_VERSION,
  authorizeDelegatedAction,
  evaluateDelegationAsOf,
  evaluateDelegationChainAsOf,
  markExpiredDelegations,
  revokeDelegationChain,
  stampDelegationContract,
  transitionDelegation,
  validateDelegationContract,
  type MissionDelegation,
  type MissionDelegationCore,
  type MissionDelegationInput,
} from "@/lib/mission/delegation-contract";
import {
  evaluateDelegatedStepGate,
  type DelegatedStepAttempt,
} from "@/lib/agent-runtime/mission-runner";
import type { MissionIntent } from "@/lib/control-plane/foundation-mission";
import type { KernelObjectEnvelopeInput } from "@/lib/kernel/reality";

const TENANT_A = "tenant-a";
const T0 = "2026-10-01T12:00:00.000Z";
const T1 = "2026-10-01T13:00:00.000Z";
const T2 = "2026-10-01T14:00:00.000Z";
const EXPIRY = "2026-10-01T12:30:00.000Z";

function envelopeInput(): KernelObjectEnvelopeInput {
  return {
    objectType: "mission_delegation",
    schemaVersion: "1.0",
    status: "active",
    createdBy: "chief",
    updatedBy: "chief",
    provenance: { source: "delegation:enforcement-suite", originTenantId: TENANT_A },
    policyContext: { ruling: "RULING-3" },
    traceId: "trace-delegation-enf-1",
    correlationId: "corr-delegation-enf-1",
    declaredOrigin: "suite-root",
  };
}

function delegation(
  overrides: Partial<MissionDelegationCore> & { envelope?: KernelObjectEnvelopeInput } = {},
): MissionDelegationInput {
  const core: MissionDelegationCore = {
    delegationId: "del-1",
    schemaVersion: DELEGATION_CONTRACT_SCHEMA_VERSION,
    tenantId: TENANT_A,
    missionId: "mission-1",
    delegatorRef: "chief",
    delegateRef: "agent-1",
    grantedActions: ["a.write", "a.review"],
    grantedRoles: ["CONTRIBUTOR"],
    delegatorActions: ["a.write", "a.review", "a.publish"],
    delegatorRoles: ["CONTRIBUTOR", "REVIEWER", "OPERATOR"],
    taskRefs: null,
    notBefore: null,
    expiresAt: EXPIRY,
    lifecycle: "active",
    revokedAt: null,
    revokedBy: null,
    revocationReason: null,
    idempotencyKey: "idem-1",
    provenance: {
      grantedBy: "chief",
      grantedAt: "2026-10-01T00:00:00.000Z",
      authorityRef: "MISSION-R-52 grant",
      sourceRef: null,
      generatedByAi: false,
      verified: true,
    },
  };
  const merged = { ...core, ...overrides };
  return {
    ...merged,
    envelope: overrides.envelope ?? envelopeInput(),
    provenance: overrides.provenance ?? { ...core.provenance, grantedBy: merged.delegatorRef },
  };
}

function stamped(overrides: Partial<MissionDelegationCore> = {}): MissionDelegation {
  return stampDelegationContract(delegation(overrides));
}

function missionIntent(): MissionIntent {
  return {
    missionId: "mission-1",
    version: "v1",
    tenantId: TENANT_A,
    purpose: "Annotate anomalies under delegation",
    authorityRef: "authority:mission-board",
    contextRef: "cprim-1",
    ownerRef: "owner:mission-board",
    nonScope: ["a.delete"],
    authorizedActions: ["a.write", "a.review"],
    lifecycle: "authorized",
    expiresAt: "2026-10-02T00:00:00.000Z",
  };
}

function attempt(overrides: Partial<DelegatedStepAttempt> = {}): DelegatedStepAttempt {
  return {
    stepId: "step-1",
    action: "a.write",
    taskRef: null,
    delegateRef: "agent-1",
    ...overrides,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Expiry enforcement as-of an explicit instant (DEFECT-4)
 * ────────────────────────────────────────────────────────────*/

describe("DEFECT-4: expiry is enforced as-of an explicit instant", () => {
  it("allows inside the window, denies at and after the expiry boundary", () => {
    const current = stamped();
    const before = evaluateDelegationAsOf(current, T0);
    expect(before).toEqual({ ok: true, onBehalfOf: "chief" });

    // AT the boundary: expiresAt <= now is already expired (fail closed).
    const atBoundary = evaluateDelegationAsOf(current, EXPIRY);
    expect(atBoundary).toEqual({
      ok: false,
      denyReason: "expired",
      error: expect.stringContaining("expired at"),
    });
    expect(authorizeDelegatedAction(
      current,
      { delegateRef: "agent-1", tenantId: TENANT_A, missionId: "mission-1", action: "a.write", taskRef: null },
      EXPIRY,
    )).toEqual({ ok: false, denyReason: "expired" });

    const after = evaluateDelegationAsOf(current, T2);
    expect(after).toEqual({
      ok: false,
      denyReason: "expired",
      error: expect.stringContaining("expired at"),
    });
    expect(authorizeDelegatedAction(
      current,
      { delegateRef: "agent-1", tenantId: TENANT_A, missionId: "mission-1", action: "a.write", taskRef: null },
      T2,
    )).toEqual({ ok: false, denyReason: "expired" });
  });

  it("never trusts declared status over the time window — an 'active' stamp cannot resurrect a lapsed grant", () => {
    const stale = stamped({ expiresAt: T0 });
    expect(stale.lifecycle).toBe("active");
    const verdict = evaluateDelegationAsOf(stale, T1);
    expect(verdict).toEqual({ ok: false, denyReason: "expired", error: expect.stringContaining("expired at") });
  });

  it("rejects future-dated delegations (notBefore) before they take effect", () => {
    const future = stamped({ notBefore: "2026-10-01T12:15:00.000Z" });
    expect(evaluateDelegationAsOf(future, T0)).toEqual({
      ok: false,
      denyReason: "not_yet_effective",
      error: expect.stringContaining("not effective before"),
    });
    expect(authorizeDelegatedAction(
      future,
      { delegateRef: "agent-1", tenantId: TENANT_A, missionId: "mission-1", action: "a.write", taskRef: null },
      T0,
    )).toEqual({ ok: false, denyReason: "not_yet_effective" });
    // AT the boundary the delegation becomes effective (notBefore > now denies).
    expect(evaluateDelegationAsOf(future, "2026-10-01T12:15:00.000Z")).toEqual({ ok: true, onBehalfOf: "chief" });
  });

  it("fails closed on an unparseable evaluation instant", () => {
    expect(evaluateDelegationAsOf(stamped(), "not-a-timestamp")).toEqual({
      ok: false,
      denyReason: "invalid_contract",
      error: expect.stringContaining("parseable"),
    });
  });

  it("denies revoked, expired and suspended statuses as-of the instant", () => {
    const base = { delegateRef: "agent-1", tenantId: TENANT_A, missionId: "mission-1", action: "a.write", taskRef: null };
    const revoked = stamped({ lifecycle: "revoked", revokedAt: T0, revokedBy: "chief", revocationReason: "r" });
    expect(evaluateDelegationAsOf(revoked, T0)).toEqual({
      ok: false,
      denyReason: "revoked",
      error: expect.stringContaining("revoked"),
    });
    expect(evaluateDelegationAsOf(stamped({ lifecycle: "expired" }), T0)).toEqual({
      ok: false,
      denyReason: "expired",
      error: expect.stringContaining("expired"),
    });
    expect(evaluateDelegationAsOf(stamped({ lifecycle: "suspended" }), T0)).toEqual({
      ok: false,
      denyReason: "suspended",
      error: expect.stringContaining("suspended"),
    });
    expect(authorizeDelegatedAction(revoked, base, T0)).toEqual({ ok: false, denyReason: "revoked" });
  });
});

/* ─────────────────────────────────────────────────────────────
 * Structural status transitions (DEFECT-4)
 * ────────────────────────────────────────────────────────────*/

describe("DEFECT-4: status transitions are structural, never advisory", () => {
  it("rejects an active or suspended contract past its expiry when validated as-of a time", () => {
    const stale = stamped({ expiresAt: T0 });
    expect(validateDelegationContract(stale, T1)).toEqual({
      ok: false,
      error: expect.stringContaining("cannot be active after its expiresAt"),
    });
    const suspended = stamped({ lifecycle: "suspended", expiresAt: T0 });
    expect(validateDelegationContract(suspended, T1)).toEqual({
      ok: false,
      error: expect.stringContaining("cannot be suspended after its expiresAt"),
    });
    // Without an instant, the historical validation laws still hold alone.
    expect(validateDelegationContract(stamped())).toEqual({ ok: true });
  });

  it("rejects premature expiry: a contract cannot be 'expired' before its expiresAt", () => {
    const premature = stamped({ lifecycle: "expired" });
    expect(validateDelegationContract(premature, T0)).toEqual({
      ok: false,
      error: expect.stringContaining("marked expired before its expiresAt"),
    });
  });

  it("rejects future-dated revocation timestamps when validated as-of a time", () => {
    const futureRevoked = stamped({
      lifecycle: "revoked",
      revokedAt: T2,
      revokedBy: "chief",
      revocationReason: "r",
    });
    expect(validateDelegationContract(futureRevoked, T0)).toEqual({
      ok: false,
      error: expect.stringContaining("revoked at a future instant"),
    });
  });

  it("keeps bounded expiry on the state machine: expiry cannot be pre-empted by state", () => {
    const current = stamped();
    const early = transitionDelegation(current, "expired", { now: T0 });
    expect(early).toEqual({
      ok: false,
      denyReason: "not_yet_expired",
      error: expect.stringContaining("bounded expiry"),
    });
    const late = transitionDelegation(current, "expired", { now: T2 });
    expect(late.ok).toBe(true);
    if (late.ok) expect(late.delegation.lifecycle).toBe("expired");
  });

  it("flips lapsed non-terminal statuses (active AND suspended) to expired", () => {
    const active = stamped({ delegationId: "del-active", idempotencyKey: "k-active" });
    const suspended = stamped({
      delegationId: "del-suspended",
      idempotencyKey: "k-suspended",
      lifecycle: "suspended",
    });
    const revoked = stamped({
      delegationId: "del-revoked",
      idempotencyKey: "k-revoked",
      lifecycle: "revoked",
      revokedAt: T0,
      revokedBy: "chief",
      revocationReason: "r",
    });
    const marked = markExpiredDelegations([active, suspended, revoked], T2);
    expect(marked.find((record) => record.delegationId === "del-active")?.lifecycle).toBe("expired");
    expect(marked.find((record) => record.delegationId === "del-suspended")?.lifecycle).toBe("expired");
    expect(marked.find((record) => record.delegationId === "del-revoked")?.lifecycle).toBe("revoked");
    const untouched = markExpiredDelegations([active], T0);
    expect(untouched.find((record) => record.delegationId === "del-active")?.lifecycle).toBe("active");
  });
});

/* ─────────────────────────────────────────────────────────────
 * Transitive law: revocation composes with expiry
 * ────────────────────────────────────────────────────────────*/

describe("transitive law: revocation composes with expiry", () => {
  function chain(childOverrides: Partial<MissionDelegationCore> = {}): readonly MissionDelegation[] {
    const root = stamped({
      delegationId: "del-root",
      delegateRef: "agent-1",
      expiresAt: "2026-10-02T00:00:00.000Z",
      idempotencyKey: "k-root",
    });
    const child = stamped({
      delegationId: "del-child",
      delegatorRef: "agent-1",
      delegateRef: "agent-2",
      grantedActions: ["a.write"],
      grantedRoles: ["CONTRIBUTOR"],
      delegatorActions: ["a.write", "a.review"],
      delegatorRoles: ["CONTRIBUTOR"],
      idempotencyKey: "k-child",
      ...childOverrides,
    });
    const grandchild = stamped({
      delegationId: "del-grandchild",
      delegatorRef: "agent-2",
      delegateRef: "agent-3",
      grantedActions: ["a.write"],
      grantedRoles: ["CONTRIBUTOR"],
      delegatorActions: ["a.write"],
      delegatorRoles: ["CONTRIBUTOR"],
      expiresAt: "2026-10-02T00:00:00.000Z",
      idempotencyKey: "k-grandchild",
    });
    return [root, child, grandchild];
  }

  it("invalidates a descendant whose chain passes through an expired link", () => {
    const [root, child, grandchild] = chain();
    expect(evaluateDelegationChainAsOf([root, child, grandchild], "del-grandchild", T0)).toEqual({
      ok: true,
      path: ["del-grandchild", "del-child", "del-root"],
    });
    const expiredChild = transitionDelegation(child, "expired", { now: T1 });
    expect(expiredChild.ok).toBe(true);
    const lapsedChain = expiredChild.ok ? [root, expiredChild.delegation, grandchild] : [];
    const verdict = evaluateDelegationChainAsOf(lapsedChain, "del-grandchild", T1);
    expect(verdict).toEqual({
      ok: false,
      denyReason: "expired",
      error: expect.stringContaining('broken at "del-child"'),
      delegationId: "del-child",
    });
  });

  it("invalidates a descendant whose chain passes through a revoked link", () => {
    const [root, child, grandchild] = chain();
    const revokedChild = transitionDelegation(child, "revoked", {
      now: T0,
      by: "chief",
      reason: "grant withdrawn",
    });
    expect(revokedChild.ok).toBe(true);
    const brokenChain = revokedChild.ok ? [root, revokedChild.delegation, grandchild] : [];
    expect(evaluateDelegationChainAsOf(brokenChain, "del-grandchild", T0)).toEqual({
      ok: false,
      denyReason: "revoked",
      error: expect.stringContaining('broken at "del-child"'),
      delegationId: "del-child",
    });
  });

  it("propagates revocation THROUGH an expired link to its descendants", () => {
    const [root, child, grandchild] = chain();
    const expiredChild = transitionDelegation(child, "expired", { now: T1 });
    expect(expiredChild.ok).toBe(true);
    const lapsedChild = expiredChild.ok ? expiredChild.delegation : child;
    const result = revokeDelegationChain(root, [lapsedChild, grandchild], {
      now: T1,
      by: "chief",
      reason: "root grant withdrawn",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.revoked.map((record) => record.delegationId);
      expect(ids).toEqual(["del-root", "del-grandchild"]);
      const lapsedGrandchild = result.revoked.find((record) => record.delegationId === "del-grandchild");
      expect(lapsedGrandchild?.lifecycle).toBe("revoked");
      expect(lapsedGrandchild?.revokedBy).toBe("chief");
      expect(lapsedGrandchild?.revokedAt).toBe(T1);
    }
  });

  it("names the broken record and fails closed on structural chain violations", () => {
    const [root, child, grandchild] = chain();
    expect(evaluateDelegationChainAsOf([root, child], "del-grandchild", T0)).toEqual({
      ok: false,
      denyReason: "record_not_found",
      error: expect.stringContaining("not part of the evaluated chain"),
      delegationId: "del-grandchild",
    });
    expect(evaluateDelegationChainAsOf([root, child, grandchild], "missing-id", T0)).toEqual({
      ok: false,
      denyReason: "record_not_found",
      error: expect.stringContaining("missing-id"),
      delegationId: "missing-id",
    });
    // A structurally invalid chain (forged authority claim) is rejected outright.
    const forged = stamped({
      delegationId: "del-forged",
      delegatorRef: "agent-3",
      delegateRef: "agent-4",
      grantedActions: ["a.write"],
      grantedRoles: ["CONTRIBUTOR"],
      delegatorActions: ["a.write", "a.publish"],
      delegatorRoles: ["CONTRIBUTOR"],
      idempotencyKey: "k-forged",
    });
    expect(evaluateDelegationChainAsOf([root, child, grandchild, forged], "del-forged", T0)).toEqual({
      ok: false,
      denyReason: "chain_not_non_escalating",
      error: expect.stringContaining("never held"),
      delegationId: null,
    });
  });
});

/* ─────────────────────────────────────────────────────────────
 * Mission-runner wiring (MISSION-R-52 / V1CAP-021)
 * ────────────────────────────────────────────────────────────*/

describe("mission-runner delegation gate (execution-time enforcement)", () => {
  const mission = missionIntent();

  function gate(
    delegationOrNull: MissionDelegation | null,
    chain: readonly MissionDelegation[],
    stepAttempt: DelegatedStepAttempt,
    now: string,
  ) {
    return evaluateDelegatedStepGate({ mission, delegation: delegationOrNull, chain }, stepAttempt, now);
  }

  it("authorizes a delegated step inside the window and records the verdict signal", () => {
    const current = stamped();
    const decision = gate(current, [current], attempt(), T0);
    expect(decision).toEqual({
      ok: true,
      onBehalfOf: "chief",
      signal: {
        signalKind: "delegation_gate_verdict",
        missionId: "mission-1",
        stepId: "step-1",
        delegationId: "del-1",
        verdict: "allow",
        denyCode: null,
        defectRef: null,
        onBehalfOf: "chief",
        evaluatedAt: T0,
      },
    });
  });

  it("blocks an expired delegation with a typed DEFECT-4 failure and a deny signal", () => {
    const current = stamped();
    const decision = gate(current, [current], attempt(), T2);
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe("expired");
      expect(decision.reason).toContain("expired at");
      expect(decision.signal.verdict).toBe("deny");
      expect(decision.signal.denyCode).toBe("expired");
      expect(decision.signal.defectRef).toBe("DEFECT-4");
      expect(decision.signal.evaluatedAt).toBe(T2);
    }
  });

  it("blocks a delegation that has not yet taken effect with the DEFECT-4 reference", () => {
    const future = stamped({ notBefore: "2026-10-01T12:15:00.000Z" });
    const decision = gate(future, [future], attempt(), T0);
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe("not_yet_effective");
      expect(decision.signal.defectRef).toBe("DEFECT-4");
    }
  });

  it("blocks revoked delegations and insufficient bounds with their named codes", () => {
    const revoked = stamped({ lifecycle: "revoked", revokedAt: T0, revokedBy: "chief", revocationReason: "r" });
    const revokedDecision = gate(revoked, [revoked], attempt(), T0);
    expect(revokedDecision.ok).toBe(false);
    if (!revokedDecision.ok) {
      expect(revokedDecision.code).toBe("revoked");
      expect(revokedDecision.signal.defectRef).toBeNull();
    }
    const current = stamped();
    const insufficient = gate(current, [current], attempt({ action: "a.deploy" }), T0);
    expect(insufficient.ok).toBe(false);
    if (!insufficient.ok) expect(insufficient.code).toBe("action_not_granted");
    const wrongTask = stamped({ taskRefs: ["task-1"] });
    const outOfScope = gate(wrongTask, [wrongTask], attempt({ taskRef: "task-9" }), T0);
    expect(outOfScope.ok).toBe(false);
    if (!outOfScope.ok) expect(outOfScope.code).toBe("task_out_of_scope");
    const impostor = gate(current, [current], attempt({ delegateRef: "agent-9" }), T0);
    expect(impostor.ok).toBe(false);
    if (!impostor.ok) expect(impostor.code).toBe("delegate_mismatch");
  });

  it("denies a delegated step with no delegation record — workers never self-assign", () => {
    const decision = gate(null, [], attempt(), T0);
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe("delegation_missing");
      expect(decision.signal.delegationId).toBeNull();
      expect(decision.signal.verdict).toBe("deny");
    }
  });

  it("blocks a step whose delegation chain passes through an expired upstream link", () => {
    const root = stamped({
      delegationId: "del-root",
      delegateRef: "agent-1",
      expiresAt: "2026-10-02T00:00:00.000Z",
      idempotencyKey: "k-root",
    });
    const child = stamped({
      delegationId: "del-child",
      delegatorRef: "agent-1",
      delegateRef: "agent-2",
      grantedActions: ["a.write"],
      grantedRoles: ["CONTRIBUTOR"],
      delegatorActions: ["a.write", "a.review"],
      delegatorRoles: ["CONTRIBUTOR"],
      idempotencyKey: "k-child",
    });
    const grandchild = stamped({
      delegationId: "del-grandchild",
      delegatorRef: "agent-2",
      delegateRef: "agent-3",
      grantedActions: ["a.write"],
      grantedRoles: ["CONTRIBUTOR"],
      delegatorActions: ["a.write"],
      delegatorRoles: ["CONTRIBUTOR"],
      expiresAt: "2026-10-02T00:00:00.000Z",
      idempotencyKey: "k-grandchild",
    });
    const expiredChild = transitionDelegation(child, "expired", { now: T1 });
    expect(expiredChild.ok).toBe(true);
    const lapsedChain = expiredChild.ok ? [root, expiredChild.delegation, grandchild] : [];
    // The grandchild record itself is unexpired — the broken upstream link blocks it.
    const decision = gate(grandchild, lapsedChain, attempt({ stepId: "step-gc", delegateRef: "agent-3" }), T1);
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe("expired");
      expect(decision.reason).toContain("del-child");
      expect(decision.signal.defectRef).toBe("DEFECT-4");
    }
  });

  it("re-evaluates on the next gated action of a long-running step (expiry during execution)", () => {
    const current = stamped();
    const first = gate(current, [current], attempt({ stepId: "step-1" }), T0);
    expect(first.ok).toBe(true);
    const second = gate(current, [current], attempt({ stepId: "step-2" }), T1);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.code).toBe("expired");
      expect(second.signal.denyCode).toBe("expired");
      expect(second.signal.evaluatedAt).toBe(T1);
    }
  });

  it("evaluates a lone delegation record without chain context", () => {
    const current = stamped();
    const decision = gate(current, [], attempt(), T0);
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.onBehalfOf).toBe("chief");
  });
});