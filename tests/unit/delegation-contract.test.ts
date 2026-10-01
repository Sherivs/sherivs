/**
 * CoreGrid Delegation object contract tests (J-025 / V1CAP-046, MISSION-R-50).
 *
 * Validates the pure contract in
 * frontend/src/lib/mission/delegation-contract.ts:
 * - full lifecycle transitions (legal and illegal), terminal immutability;
 * - the NON-ESCALATION invariant (E-045): property test over arbitrary
 *   delegation chains — a delegate never holds more authority than its
 *   delegator; escalation attempts are denied at grant time; forged chain
 *   claims and delegation cycles are rejected;
 * - revocation propagation (transitive down the chain);
 * - bounded expiry and notBefore windows;
 * - idempotent re-delegation and idempotent delegated-action records;
 * - acting-on-behalf-of identity linkage and envelope presence.
 */

import { describe, expect, it } from "vitest";
import {
  DELEGATION_CONTRACT_SCHEMA_VERSION,
  authorizeDelegatedAction,
  createDelegation,
  delegationChainIsNonEscalating,
  isDelegationNonEscalating,
  isDelegationTransitionAllowed,
  markExpiredDelegations,
  recordDelegatedAction,
  revokeDelegationChain,
  stampDelegationContract,
  transitionDelegation,
  validateDelegationContract,
  type DelegatedActionRecord,
  type MissionDelegation,
  type MissionDelegationCore,
  type MissionDelegationInput,
} from "@/lib/mission/delegation-contract";
import type { KernelObjectEnvelopeInput } from "@/lib/kernel/reality";
import { KERNEL_ENVELOPE_COLUMNS } from "@/lib/kernel/reality";
import { UNIVERSAL_ROLES } from "@/lib/universal-roles";

const TENANT_A = "tenant-a";
const NOW = "2026-10-01T12:00:00.000Z";
const FUTURE = "2027-01-01T00:00:00.000Z";

function envelopeInput(): KernelObjectEnvelopeInput {
  return {
    objectType: "mission_delegation",
    schemaVersion: "1.0",
    status: "active",
    createdBy: "chief",
    updatedBy: "chief",
    provenance: { source: "delegation:contract-suite", originTenantId: TENANT_A },
    policyContext: { ruling: "RULING-3" },
    traceId: "trace-delegation-1",
    correlationId: "corr-delegation-1",
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
    expiresAt: FUTURE,
    lifecycle: "active",
    revokedAt: null,
    revokedBy: null,
    revocationReason: null,
    idempotencyKey: "idem-1",
    provenance: {
      grantedBy: "chief",
      grantedAt: "2026-10-01T00:00:00.000Z",
      authorityRef: "MISSION-R-50 grant",
      sourceRef: null,
      generatedByAi: false,
      verified: true,
    },
  };
  const merged = { ...core, ...overrides };
  return {
    ...merged,
    envelope: overrides.envelope ?? envelopeInput(),
    // Acting-on-behalf-of linkage follows the (possibly overridden) delegator.
    provenance: overrides.provenance ?? { ...core.provenance, grantedBy: merged.delegatorRef },
  };
}

interface DelegatedActionInputLike {
  recordId: string;
  delegateRef: string;
  tenantId: string;
  missionId: string;
  action: string;
  taskRef: string | null;
  idempotencyKey: string;
}

function action(overrides: Partial<DelegatedActionInputLike> = {}): DelegatedActionInputLike {
  return {
    recordId: "rec-1",
    delegateRef: "agent-1",
    tenantId: TENANT_A,
    missionId: "mission-1",
    action: "a.write",
    taskRef: null,
    idempotencyKey: "act-1",
    ...overrides,
  };
}

function activeDelegation(overrides: Partial<MissionDelegationCore> = {}): MissionDelegation {
  return stampDelegationContract(delegation(overrides));
}

/* ─────────────────────────────────────────────────────────────
 * Deterministic pseudo-random generator for the chain property test
 * ────────────────────────────────────────────────────────────*/

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function pickNonEmptySubset<T>(values: readonly T[], random: () => number): T[] {
  const subset = values.filter(() => random() < 0.5);
  if (subset.length > 0) return subset;
  return [values[Math.floor(random() * values.length)]!];
}

interface ChainSeed {
  readonly depth: number;
  readonly actions: readonly string[];
  readonly roles: readonly string[];
}

const CHAIN_SEEDS: readonly ChainSeed[] = [
  {
    depth: 1,
    actions: ["a.write", "a.review", "a.publish", "a.deploy", "a.read"],
    roles: ["OPERATOR", "CONTRIBUTOR", "REVIEWER", "WORKER"],
  },
  {
    depth: 3,
    actions: ["a.write", "a.review", "a.publish", "a.deploy", "a.read", "a.notify"],
    roles: ["CONTRIBUTOR", "REVIEWER", "SUPERVISOR", "WORKER", "AGENT"],
  },
  {
    depth: 6,
    actions: ["a.write", "a.review", "a.publish", "a.read", "a.audit"],
    roles: ["MANAGER", "CONTRIBUTOR", "REVIEWER", "AUDITOR", "AGENT"],
  },
];

/* ─────────────────────────────────────────────────────────────
 * Validation (fail closed)
 * ────────────────────────────────────────────────────────────*/

describe("delegation contract validation (fail closed)", () => {
  it("accepts a fully-declared bounded delegation", () => {
    const stamped = activeDelegation();
    expect(validateDelegationContract(stamped)).toEqual({ ok: true });
    expect(stamped.envelope.object_type).toBe("mission_delegation");
  });

  it("rejects malformed delegations", () => {
    expect(() => stampDelegationContract(delegation({ delegateRef: "chief" }))).toThrow(/self-delegation/);
    expect(() => stampDelegationContract(delegation({ grantedActions: [] }))).toThrow(/at least one action/);
    expect(() => stampDelegationContract(delegation({ delegatorActions: [] }))).toThrow(
      /delegatorActions|escalates/,
    );
    expect(() =>
      stampDelegationContract(
        delegation({ provenance: { ...delegation().provenance, grantedBy: "someone-else" } }),
      ),
    ).toThrow(/identity linkage/);
    expect(() => stampDelegationContract(delegation({ idempotencyKey: "" }))).toThrow(/idempotencyKey/);
    expect(() => stampDelegationContract(delegation({ notBefore: FUTURE, expiresAt: NOW }))).toThrow(
      /notBefore must precede/,
    );
    expect(() => stampDelegationContract(delegation({ taskRefs: [] }))).toThrow(/taskRefs/);
  });

  it("denies ESCALATION at grant time (E-045) — actions and roles", () => {
    const escalateAction = createDelegation([], delegation({ grantedActions: ["a.write", "a.deploy"] }));
    expect(escalateAction).toEqual({
      ok: false,
      denyReason: "escalation_denied",
      error: expect.stringContaining("escalates"),
    });
    const escalateRole = createDelegation([], delegation({ grantedRoles: ["ADMINISTRATOR"] }));
    expect(escalateRole).toEqual({
      ok: false,
      denyReason: "escalation_denied",
      error: expect.stringContaining("escalates"),
    });
    expect(isDelegationNonEscalating(delegation({ grantedActions: ["a.deploy"] }))).toBe(false);
  });

  it("rejects revoked records missing attribution", () => {
    expect(() =>
      stampDelegationContract(
        delegation({ lifecycle: "revoked", revokedAt: null, revokedBy: null, revocationReason: null }),
      ),
    ).toThrow(/revokedAt/);
    expect(() =>
      stampDelegationContract(
        delegation({ lifecycle: "active", revokedAt: NOW, revokedBy: "chief", revocationReason: "oops" }),
      ),
    ).toThrow(/revocation fields must be null/);
  });

  it("carries every kernel envelope column on the persistent object", () => {
    const stamped = activeDelegation();
    const envelope = stamped.envelope as unknown as Record<string, unknown>;
    for (const column of KERNEL_ENVELOPE_COLUMNS) {
      expect(envelope[column], `missing envelope column ${column}`).toBeDefined();
    }
    expect(() =>
      stampDelegationContract(
        delegation({
          envelope: {
            ...envelopeInput(),
            objectType: "mission_intent",
            causationId: null,
            parentEventId: null,
            declaredOrigin: null,
          },
        }),
      ),
    ).toThrow();
  });
});

/* ─────────────────────────────────────────────────────────────
 * Lifecycle (legal and illegal transitions)
 * ────────────────────────────────────────────────────────────*/

describe("delegation lifecycle (legal and illegal transitions)", () => {
  it("walks active -> suspended -> active -> revoked", () => {
    let current = activeDelegation();
    const steps = [
      ["suspended", { now: NOW }],
      ["active", { now: NOW }],
      ["revoked", { now: NOW, by: "chief", reason: "grant withdrawn" }],
    ] as const;
    for (const [to, ctx] of steps) {
      const result = transitionDelegation(current, to, ctx);
      expect(result.ok, `transition to ${to}`).toBe(true);
      if (result.ok) current = result.delegation;
    }
    expect(current.lifecycle).toBe("revoked");
    expect(current.revokedBy).toBe("chief");
    expect(current.revocationReason).toBe("grant withdrawn");
  });

  it("enforces bounded expiry: expires only once expiresAt has passed", () => {
    const current = activeDelegation();
    const early = transitionDelegation(current, "expired", { now: NOW });
    expect(early).toEqual({
      ok: false,
      denyReason: "not_yet_expired",
      error: expect.stringContaining("bounded expiry"),
    });
    const late = transitionDelegation(current, "expired", { now: "2027-06-01T00:00:00.000Z" });
    expect(late.ok).toBe(true);
    if (late.ok) expect(late.delegation.lifecycle).toBe("expired");
  });

  it("denies every illegal transition pair (exhaustive) and terminal mutation", () => {
    const states = ["active", "suspended", "revoked", "expired"] as const;
    const legalPairs = new Set(
      states.flatMap((from) =>
        states.filter((to) => isDelegationTransitionAllowed(from, to)).map((to) => `${from}->${to}`),
      ),
    );
    for (const from of states) {
      for (const to of states) {
        const current =
          from === "revoked"
            ? activeDelegation({ lifecycle: "revoked", revokedAt: NOW, revokedBy: "chief", revocationReason: "r" })
            : from === "expired"
              ? activeDelegation({ lifecycle: "expired" })
              : activeDelegation({ lifecycle: from });
        const result = transitionDelegation(current, to, {
          now: to === "expired" ? "2027-06-01T00:00:00.000Z" : NOW,
          by: "chief",
          reason: "r",
        });
        if (legalPairs.has(`${from}->${to}`)) {
          expect(result.ok, `${from}->${to} should be legal`).toBe(true);
        } else {
          expect(result.ok, `${from}->${to} should be illegal`).toBe(false);
        }
      }
    }
    const revoked = activeDelegation({
      lifecycle: "revoked",
      revokedAt: NOW,
      revokedBy: "chief",
      revocationReason: "r",
    });
    expect(transitionDelegation(revoked, "active", { now: NOW }).ok).toBe(false);
    const expired = activeDelegation({ lifecycle: "expired" });
    expect(transitionDelegation(expired, "active", { now: NOW }).ok).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Non-escalation invariant over arbitrary chains (property test)
 * ────────────────────────────────────────────────────────────*/

describe("non-escalation invariant over arbitrary chains (property test)", () => {
  it("every generated chain keeps delegate authority within the root delegator's authority", () => {
    for (const [seedIndex, seed] of CHAIN_SEEDS.entries()) {
      const random = lcg(20261001 + seedIndex);
      const chain: MissionDelegation[] = [];
      let parentActions = seed.actions;
      let parentRoles = seed.roles;
      let delegator = "chief";
      for (let depth = 0; depth < seed.depth; depth += 1) {
        const grantedActions = pickNonEmptySubset(parentActions, random);
        const grantedRoles = pickNonEmptySubset(parentRoles, random);
        const delegate = `delegate-${seedIndex}-${depth}`;
        const created = createDelegation(
          chain,
          delegation({
            delegationId: `del-${seedIndex}-${depth}`,
            delegatorRef: delegator,
            delegateRef: delegate,
            grantedActions,
            grantedRoles: grantedRoles as MissionDelegationCore["grantedRoles"],
            delegatorActions: parentActions,
            delegatorRoles: parentRoles as MissionDelegationCore["delegatorRoles"],
            idempotencyKey: `idem-${seedIndex}-${depth}`,
          }),
        );
        expect(created.ok, `chain ${seedIndex} depth ${depth}`).toBe(true);
        if (created.ok) {
          chain.push(created.delegation);
          parentActions = created.delegation.grantedActions;
          parentRoles = created.delegation.grantedRoles;
          delegator = delegate;
        }
      }
      expect(chain.length).toBe(seed.depth);

      const check = delegationChainIsNonEscalating(chain);
      expect(check.ok, `chain ${seedIndex} structural non-escalation`).toBe(true);

      for (const record of chain) {
        for (const granted of record.grantedActions) {
          expect(seed.actions.includes(granted), `${record.delegationId} action ${granted}`).toBe(true);
        }
        for (const role of record.grantedRoles) {
          expect(seed.roles.includes(role), `${record.delegationId} role ${role}`).toBe(true);
        }
      }
    }
  });

  it("rejects a forged chain where a delegate claims authority its delegator never granted", () => {
    const first = activeDelegation({
      delegationId: "del-A",
      delegateRef: "agent-1",
      grantedActions: ["a.write"],
      delegatorActions: ["a.write", "a.review"],
    });
    const forged = activeDelegation({
      delegationId: "del-B",
      delegatorRef: "agent-1",
      delegateRef: "agent-2",
      grantedActions: ["a.write"],
      delegatorActions: ["a.write", "a.publish"],
    });
    expect(validateDelegationContract(forged)).toEqual({ ok: true });
    const check = delegationChainIsNonEscalating([first, forged]);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.error).toContain("never held");
  });

  it("rejects delegation cycles as privilege laundering", () => {
    const a = activeDelegation({
      delegationId: "del-cycle-a",
      delegatorRef: "x",
      delegateRef: "y",
      grantedActions: ["a.write"],
      delegatorActions: ["a.write"],
    });
    const b = activeDelegation({
      delegationId: "del-cycle-b",
      delegatorRef: "y",
      delegateRef: "x",
      grantedActions: ["a.write"],
      delegatorActions: ["a.write"],
    });
    expect(validateDelegationContract(a)).toEqual({ ok: true });
    expect(validateDelegationContract(b)).toEqual({ ok: true });
    const check = delegationChainIsNonEscalating([a, b]);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.error).toContain("cycle");
  });
});

/* ─────────────────────────────────────────────────────────────
 * Bounded authorization: acting on behalf of
 * ────────────────────────────────────────────────────────────*/

describe("bounded authorization: acting on behalf of", () => {
  it("authorizes a granted action and names the accountable delegator", () => {
    const current = activeDelegation();
    const authorization = authorizeDelegatedAction(
      current,
      { delegateRef: "agent-1", tenantId: TENANT_A, missionId: "mission-1", action: "a.write", taskRef: null },
      NOW,
    );
    expect(authorization).toEqual({ ok: true, onBehalfOf: "chief" });
  });

  it("fails closed with named deny reasons", () => {
    const current = activeDelegation();
    const base = {
      delegateRef: "agent-1",
      tenantId: TENANT_A,
      missionId: "mission-1",
      action: "a.write",
      taskRef: null,
    };
    expect(authorizeDelegatedAction(current, { ...base, action: "a.deploy" }, NOW)).toEqual({
      ok: false,
      denyReason: "action_not_granted",
    });
    expect(authorizeDelegatedAction(current, { ...base, delegateRef: "agent-9" }, NOW)).toEqual({
      ok: false,
      denyReason: "delegate_mismatch",
    });
    expect(authorizeDelegatedAction(current, { ...base, tenantId: "tenant-b" }, NOW)).toEqual({
      ok: false,
      denyReason: "cross_tenant",
    });
    expect(authorizeDelegatedAction(current, { ...base, missionId: "mission-2" }, NOW)).toEqual({
      ok: false,
      denyReason: "mission_mismatch",
    });
    const scoped = activeDelegation({ taskRefs: ["task-1"] });
    expect(authorizeDelegatedAction(scoped, { ...base, taskRef: "task-9" }, NOW)).toEqual({
      ok: false,
      denyReason: "task_out_of_scope",
    });
    expect(authorizeDelegatedAction(scoped, { ...base, taskRef: "task-1" }, NOW)).toEqual({
      ok: true,
      onBehalfOf: "chief",
    });
    const future = activeDelegation({ notBefore: "2026-12-01T00:00:00.000Z" });
    expect(authorizeDelegatedAction(future, base, NOW)).toEqual({ ok: false, denyReason: "not_yet_effective" });
    expect(authorizeDelegatedAction(activeDelegation({ lifecycle: "suspended" }), base, NOW)).toEqual({
      ok: false,
      denyReason: "suspended",
    });
    expect(authorizeDelegatedAction(activeDelegation({ lifecycle: "expired" }), base, NOW)).toEqual({
      ok: false,
      denyReason: "expired",
    });
    const revoked = activeDelegation({
      lifecycle: "revoked",
      revokedAt: NOW,
      revokedBy: "chief",
      revocationReason: "r",
    });
    expect(authorizeDelegatedAction(revoked, base, NOW)).toEqual({ ok: false, denyReason: "revoked" });
  });

  it("records delegated actions idempotently with the acting-on-behalf-of linkage", () => {
    const current = activeDelegation();
    const first = recordDelegatedAction(current, [], action(), NOW);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.replay).toBe(false);
      expect(first.record.onBehalfOf).toBe("chief");
      expect(first.record.delegateRef).toBe("agent-1");
    }
    const replay = recordDelegatedAction(current, first.ok ? [first.record] : [], action(), NOW);
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.replay).toBe(true);
      expect(replay.record.recordId).toBe("rec-1");
    }
    const denied = recordDelegatedAction(
      current,
      [],
      action({ idempotencyKey: "act-2", action: "a.deploy" }),
      NOW,
    );
    expect(denied).toEqual({
      ok: false,
      denyReason: "action_not_granted",
      error: expect.stringContaining("denied"),
    });
  });
});

/* ─────────────────────────────────────────────────────────────
 * Idempotent re-delegation
 * ────────────────────────────────────────────────────────────*/

describe("idempotent re-delegation", () => {
  it("replays the original record for the same idempotency key", () => {
    const input = delegation();
    const first = createDelegation([], input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.replay).toBe(false);
    const replay = createDelegation([first.delegation], input);
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.replay).toBe(true);
      expect(replay.delegation).toBe(first.delegation);
    }
  });

  it("rejects a reused idempotency key carrying different content", () => {
    const first = createDelegation([], delegation());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const conflict = createDelegation(
      [first.delegation],
      delegation({ grantedActions: ["a.write"], idempotencyKey: "idem-1" }),
    );
    expect(conflict).toEqual({
      ok: false,
      denyReason: "idempotent_conflict",
      error: expect.stringContaining("different delegation"),
    });
  });

  it("records a new delegation for a fresh key", () => {
    const first = createDelegation([], delegation());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = createDelegation(
      [first.delegation],
      delegation({ delegationId: "del-2", delegateRef: "agent-2", idempotencyKey: "idem-2" }),
    );
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.replay).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Revocation propagation
 * ────────────────────────────────────────────────────────────*/

describe("revocation propagation", () => {
  function chain(): readonly MissionDelegation[] {
    const root = activeDelegation({ delegationId: "del-root", delegateRef: "agent-1", idempotencyKey: "k-root" });
    const child = activeDelegation({
      delegationId: "del-child",
      delegatorRef: "agent-1",
      delegateRef: "agent-2",
      grantedActions: ["a.write"],
      delegatorActions: ["a.write", "a.review"],
      idempotencyKey: "k-child",
    });
    const grandchild = activeDelegation({
      delegationId: "del-grandchild",
      delegatorRef: "agent-2",
      delegateRef: "agent-3",
      grantedActions: ["a.write"],
      delegatorActions: ["a.write"],
      idempotencyKey: "k-grandchild",
    });
    return [root, child, grandchild];
  }

  it("propagates revocation transitively down the delegation chain", () => {
    const [root, child, grandchild] = chain();
    const result = revokeDelegationChain(root, [child, grandchild], {
      now: NOW,
      by: "chief",
      reason: "grant withdrawn",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.revoked.map((record) => record.delegationId);
      expect(ids).toEqual(["del-root", "del-child", "del-grandchild"]);
      for (const record of result.revoked) {
        expect(record.lifecycle).toBe("revoked");
        expect(record.revokedBy).toBe("chief");
        expect(record.revokedAt).toBe(NOW);
      }
    }
    const revokedRoot = result.ok ? result.revoked[0]! : null;
    if (revokedRoot) {
      expect(
        authorizeDelegatedAction(
          revokedRoot,
          { delegateRef: "agent-1", tenantId: TENANT_A, missionId: "mission-1", action: "a.write", taskRef: null },
          NOW,
        ),
      ).toEqual({ ok: false, denyReason: "revoked" });
    }
  });

  it("is attributed and refuses re-revocation and expired targets", () => {
    const [root, child] = chain();
    expect(revokeDelegationChain(root, [child], { now: NOW, by: "", reason: "r" })).toEqual({
      ok: false,
      denyReason: "unattributed_revocation",
      error: expect.stringContaining("by"),
    });
    expect(revokeDelegationChain(root, [child], { now: NOW, by: "chief", reason: "" })).toEqual({
      ok: false,
      denyReason: "unattributed_revocation",
      error: expect.stringContaining("reason"),
    });
    const first = revokeDelegationChain(root, [child], { now: NOW, by: "chief", reason: "r" });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(
        revokeDelegationChain(first.revoked[0]!, [child], { now: NOW, by: "chief", reason: "r" }),
      ).toEqual({
        ok: false,
        denyReason: "already_revoked",
        error: expect.stringContaining("already revoked"),
      });
    }
    const expired = activeDelegation({ lifecycle: "expired" });
    expect(revokeDelegationChain(expired, [], { now: NOW, by: "chief", reason: "r" })).toEqual({
      ok: false,
      denyReason: "already_expired",
      error: expect.stringContaining("expired"),
    });
  });
});

/* ─────────────────────────────────────────────────────────────
 * Bounded expiry enforcement
 * ────────────────────────────────────────────────────────────*/

describe("bounded expiry enforcement", () => {
  it("marks only active past-expiry delegations expired, idempotently", () => {
    const active = activeDelegation({ delegationId: "del-active", idempotencyKey: "ka" });
    const revoked = activeDelegation({
      delegationId: "del-revoked",
      idempotencyKey: "kr",
      lifecycle: "revoked",
      revokedAt: NOW,
      revokedBy: "chief",
      revocationReason: "r",
    });
    const alreadyExpired = activeDelegation({
      delegationId: "del-exp",
      idempotencyKey: "ke",
      lifecycle: "expired",
    });
    const marked = markExpiredDelegations([active, revoked, alreadyExpired], "2027-06-01T00:00:00.000Z");
    expect(marked.find((record) => record.delegationId === "del-active")?.lifecycle).toBe("expired");
    expect(marked.find((record) => record.delegationId === "del-revoked")?.lifecycle).toBe("revoked");
    expect(marked.find((record) => record.delegationId === "del-exp")?.lifecycle).toBe("expired");
    const notYet = markExpiredDelegations([active], NOW);
    expect(notYet[0]!.lifecycle).toBe("active");
  });

  it("denies authorization once the expiry has passed, even while still 'active'", () => {
    const current = activeDelegation();
    const base = {
      delegateRef: "agent-1",
      tenantId: TENANT_A,
      missionId: "mission-1",
      action: "a.write",
      taskRef: null,
    };
    expect(authorizeDelegatedAction(current, base, "2027-06-01T00:00:00.000Z")).toEqual({
      ok: false,
      denyReason: "expired",
    });
  });
});

/* ─────────────────────────────────────────────────────────────
 * Universal role vocabulary (RULING-4)
 * ────────────────────────────────────────────────────────────*/

describe("universal role vocabulary (RULING-4)", () => {
  it("never grants a role outside the closed universal vocabulary", () => {
    for (const role of UNIVERSAL_ROLES) {
      const input = delegation({ grantedRoles: [role], delegatorRoles: [role] });
      expect(createDelegation([], input).ok).toBe(true);
    }
    expect(() =>
      stampDelegationContract(
        delegation({
          grantedRoles: ["PRINCIPAL"] as unknown as MissionDelegationCore["grantedRoles"],
          delegatorRoles: ["PRINCIPAL", "OPERATOR"] as unknown as MissionDelegationCore["delegatorRoles"],
        }),
      ),
    ).toThrow(/universal role/);
  });
});