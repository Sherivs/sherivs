/**
 * H3-016 (J-027) — Worker Substrate Enforcement Engineer.
 *
 * Enforcement-proof battery over the EXISTING worker contracts (read-only;
 * no contract module is modified here):
 *  - `frontend/src/lib/workforce/worker-definition.ts` — authority-bounds
 *    enforcement at the persistent-definition -> ephemeral-runtime claim
 *    boundary (risk-class ceiling, resource-scope bound, capability bound,
 *    untrusted-by-default emptiness);
 *  - `frontend/src/lib/mission/delegation-contract.ts` — delegation-DEPTH
 *    proofs: the non-escalation invariant (E-045) over deep linear chains,
 *    diamond (union-closure) topologies, forged links at depth, cycles,
 *    transitive revocation through dead links, and as-of chain evaluation
 *    where a mid-depth link is dead.
 *
 * FINDINGS (bounds missing from the contracts — documented behavior is
 * tested, nothing is weakened):
 *  - FINDING-1: `claimWorkerRuntime` does not verify that `delegationRef`
 *    is present in the definition's `delegationHistoryRefs` — a claim can
 *    cite a delegation record absent from the persistent history.
 *  - FINDING-2: the delegation contract enforces WIDTH (subset) and TIME
 *    bounds but no maximum DEPTH bound; arbitrarily deep non-escalating
 *    chains are structurally accepted.
 *  - FINDING-3: the claim boundary does not validate the ephemeral lease
 *    limits (`timeLimitMs` / `actionLimit`); any numeric values are accepted
 *    and enforcement is presumed downstream in the ephemeral lifecycle.
 */

import { describe, expect, it } from "vitest";
import { AGENT_RISK_CLASSIFICATIONS, type AgentRiskClassification } from "@/lib/agent-core";
import type { IdentityActorSource } from "@/lib/identity-actor";
import type { KernelObjectEnvelopeInput } from "@/lib/kernel/reality";
import {
  DELEGATION_CONTRACT_SCHEMA_VERSION,
  authorizeDelegatedAction,
  createDelegation,
  delegationChainIsNonEscalating,
  evaluateDelegationChainAsOf,
  revokeDelegationChain,
  stampDelegationContract,
  type DelegationLifecycle,
  type MissionDelegation,
  type MissionDelegationCore,
  type MissionDelegationInput,
} from "@/lib/mission/delegation-contract";
import type { UniversalRole } from "@/lib/universal-roles";
import {
  claimWorkerRuntime,
  defineWorkerDefinition,
  recordDelegation,
  riskClassRank,
  type WorkerDefinition,
} from "@/lib/workforce/worker-definition";

/* ─────────────────────────────────────────────────────────────
 * Fixtures
 * ────────────────────────────────────────────────────────────*/

const TENANT = "tenant-h3-016";
const NOW = "2026-10-03T00:00:00.000Z";
const FUTURE = "2027-01-01T00:00:00.000Z";
const PAST = "2026-10-01T00:00:00.000Z";

const RISK_CLASSES = AGENT_RISK_CLASSIFICATIONS;

function definition(overrides?: Partial<WorkerDefinition>): WorkerDefinition {
  const base = defineWorkerDefinition({
    id: "worker:h3-016:bounded-agent",
    tenantScope: TENANT,
    identityRef: "01970000-0000-7000-8000-000000016001",
    classification: "ai",
    capabilities: [
      { capabilityId: "cap:read", description: "Read operational records" },
      { capabilityId: "cap:write", description: "Write operational records" },
    ],
    authorityBounds: {
      maxRiskClass: "medium",
      resourceScopes: ["scope:field-a", "scope:field-b"],
    },
    lifecycle: "active",
    ...overrides,
  });
  if (!base.ok) throw new Error(`fixture definition rejected: ${base.errors.join("; ")}`);
  return base.definition;
}

function actor(overrides?: Partial<IdentityActorSource>): IdentityActorSource {
  return {
    userId: "01970000-0000-7000-8000-0000000160aa",
    role: "admin",
    schoolId: TENANT,
    isActive: true,
    lifecycle: "active",
    sessionStatus: "active",
    ...overrides,
  };
}

function claim(definitionOverride?: WorkerDefinition, overrides?: Partial<Parameters<typeof claimWorkerRuntime>[0]>) {
  return claimWorkerRuntime({
    runtimeInstanceId: "runtime:h3-016-instance-1",
    definition: definitionOverride ?? definition(),
    delegatingActor: actor(),
    delegationRef: "delegation:h3-016-001",
    delegatedCapabilities: ["cap:read"],
    claimedRiskClass: "low",
    claimedResourceScopes: ["scope:field-a"],
    timeLimitMs: 60_000,
    actionLimit: 10,
    nowMs: 1_760_000_000_000,
    ...overrides,
  });
}

function envelopeInput(): KernelObjectEnvelopeInput {
  return {
    objectType: "mission_delegation",
    schemaVersion: "1.0",
    status: "active",
    createdBy: "chief",
    updatedBy: "chief",
    provenance: { source: "h3-016:worker-bounds", originTenantId: TENANT },
    policyContext: { ruling: "E-045" },
    traceId: "trace-h3-016",
    correlationId: "corr-h3-016",
    declaredOrigin: "h3-016",
  };
}

type DelegationOverride = Partial<MissionDelegationCore> & { envelope?: KernelObjectEnvelopeInput };

function delegationInput(overrides: DelegationOverride = {}): MissionDelegationInput {
  const core: MissionDelegationCore = {
    delegationId: "del-0",
    schemaVersion: DELEGATION_CONTRACT_SCHEMA_VERSION,
    tenantId: TENANT,
    missionId: "mission-h3-016",
    delegatorRef: "chief",
    delegateRef: "actor-0",
    grantedActions: ["a.read"],
    grantedRoles: ["OPERATOR"],
    delegatorActions: ["a.read"],
    delegatorRoles: ["OPERATOR"],
    taskRefs: null,
    notBefore: null,
    expiresAt: FUTURE,
    lifecycle: "active",
    revokedAt: null,
    revokedBy: null,
    revocationReason: null,
    idempotencyKey: "idem-0",
    provenance: {
      grantedBy: "chief",
      grantedAt: PAST,
      authorityRef: "h3-016 enforcement battery",
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

function stampedLink(
  index: number,
  delegator: string,
  delegate: string,
  actions: readonly string[],
  roles: readonly UniversalRole[],
  overrides: DelegationOverride = {},
): MissionDelegation {
  return stampDelegationContract(
    delegationInput({
      delegationId: `del-${index}`,
      delegatorRef: delegator,
      delegateRef: delegate,
      grantedActions: [...actions],
      grantedRoles: [...roles],
      delegatorActions: [...actions],
      delegatorRoles: [...roles],
      idempotencyKey: `idem-${index}`,
      ...overrides,
    }),
  );
}

function linearChain(
  depth: number,
  actions: readonly string[],
  roles: readonly UniversalRole[],
  linkOverrides: (index: number) => DelegationOverride = () => ({}),
): readonly MissionDelegation[] {
  const chain: MissionDelegation[] = [];
  for (let index = 0; index < depth; index += 1) {
    const delegator = index === 0 ? "chief" : `actor-${index - 1}`;
    chain.push(stampedLink(index, delegator, `actor-${index}`, actions, roles, linkOverrides(index)));
  }
  return chain;
}

const ROOT_ACTIONS: readonly string[] = ["a.read", "a.write", "a.dispatch"];
const ROOT_ROLES: readonly UniversalRole[] = ["OPERATOR", "REVIEWER"];

/* ─────────────────────────────────────────────────────────────
 * Authority bounds at the claim boundary (worker-definition.ts)
 * ────────────────────────────────────────────────────────────*/

describe("H3-016: authority bounds — risk-class ceiling (denied, never clamped)", () => {
  it("enforces the full ceiling x claim risk-class matrix exhaustively", () => {
    for (const ceiling of RISK_CLASSES) {
      for (const claimed of RISK_CLASSES) {
        const bounded = definition({
          authorityBounds: { maxRiskClass: ceiling, resourceScopes: ["scope:field-a"] },
        });
        const result = claim(bounded, { claimedRiskClass: claimed });
        const allowed = riskClassRank(claimed) <= riskClassRank(ceiling);
        expect(result.ok, `ceiling=${ceiling} claimed=${claimed}`).toBe(allowed);
        if (result.ok) {
          // The effective ceiling is exactly what the delegation claimed —
          // never silently widened, never silently clamped upward.
          expect(result.claim.effectiveMaxRiskClass).toBe(claimed);
        } else {
          expect(result.reason).toMatch(new RegExp(`risk_class_escalation_denied:${claimed}_above_${ceiling}`));
        }
      }
    }
  });

  it("denies critical claims even against a high ceiling and low claims against no ceiling", () => {
    const high = definition({
      authorityBounds: { maxRiskClass: "high", resourceScopes: ["scope:field-a"] },
    });
    expect(claim(high, { claimedRiskClass: "critical" }).ok).toBe(false);
    expect(claim(high, { claimedRiskClass: "high" }).ok).toBe(true);
  });
});

describe("H3-016: authority bounds — resource-scope and capability bounds", () => {
  it("denies any claimed scope outside the authority bounds, even mixed with in-bounds scopes", () => {
    const result = claim(definition(), {
      claimedResourceScopes: ["scope:field-a", "scope:finance", "scope:field-b"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/resource_scope_escalation_denied:scope:finance/);
    }
  });

  it("deduplicates in-bounds claimed scopes and accepts an empty scope claim", () => {
    const duplicated = claim(definition(), {
      claimedResourceScopes: ["scope:field-b", "scope:field-b", "scope:field-a"],
    });
    expect(duplicated.ok).toBe(true);
    if (duplicated.ok) {
      expect(duplicated.claim.effectiveResourceScopes).toEqual(["scope:field-b", "scope:field-a"]);
    }
    const empty = claim(definition(), { claimedResourceScopes: [] });
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.claim.effectiveResourceScopes).toEqual([]);
  });

  it("carries exactly the delegated subset of the owned capability set (order preserved, deduplicated)", () => {
    const result = claim(definition(), {
      delegatedCapabilities: ["cap:write", "cap:write", "cap:read"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claim.effectiveCapabilities).toEqual(["cap:write", "cap:read"]);
      expect(result.claim.agentDefinition.allowedTools).toEqual([]);
    }
    const ghost = claim(definition(), { delegatedCapabilities: ["cap:read", "cap:ghost"] });
    expect(ghost.ok).toBe(false);
    if (!ghost.ok) {
      expect(ghost.reason).toMatch(/capability_escalation_denied:cap:ghost_not_in_owned_set/);
    }
  });

  it("a fully empty worker (zero capabilities, zero scopes) resolves with ZERO authority on every dimension", () => {
    const fresh = definition({
      capabilities: [],
      authorityBounds: { maxRiskClass: "low", resourceScopes: [] },
    });
    const result = claim(fresh, {
      delegatedCapabilities: [],
      claimedResourceScopes: [],
      claimedRiskClass: "low",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claim.effectiveCapabilities).toEqual([]);
      expect(result.claim.effectiveResourceScopes).toEqual([]);
      expect(result.claim.agentDefinition.permissions).toEqual([]);
    }
    for (const attemptedCapability of ["cap:read", "cap:write", "cap:anything"]) {
      expect(claim(fresh, { delegatedCapabilities: [attemptedCapability] }).ok).toBe(false);
    }
    for (const attemptedScope of ["scope:field-a", "scope:anything"]) {
      expect(claim(fresh, { claimedResourceScopes: [attemptedScope] }).ok).toBe(false);
    }
  });

  it("denies a simultaneous multi-dimensional escalation naming the first violated bound", () => {
    const result = claim(definition(), {
      delegatedCapabilities: ["cap:undeclared"],
      claimedResourceScopes: ["scope:finance"],
      claimedRiskClass: "critical",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/capability_escalation_denied/);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * FINDINGS on the claim boundary (documented behavior, read-only)
 * ────────────────────────────────────────────────────────────*/

describe("H3-016 FINDINGS: bounds missing from the claim boundary", () => {
  it("FINDING-1: a claim citing a delegationRef absent from the persistent delegation history is accepted", () => {
    // Documented behavior: `claimWorkerRuntime` requires a non-empty
    // delegationRef but never cross-checks it against
    // `definition.delegationHistoryRefs`. Enforcement of the
    // history linkage is presumed to live in a persistence layer that does
    // not exist in this contract — recorded as a FINDING for the
    // cg_worker_delegation posture adjudication (D-033/D-034).
    const noHistory = definition();
    expect(noHistory.delegationHistoryRefs).toEqual([]);
    const unrecorded = claim(noHistory, { delegationRef: "delegation:never-recorded" });
    expect(unrecorded.ok).toBe(true);

    const withHistory = recordDelegation(definition(), "delegation:recorded-001");
    expect(withHistory.ok).toBe(true);
    if (withHistory.ok) {
      const foreign = claim(withHistory.definition, { delegationRef: "delegation:other-ref" });
      expect(foreign.ok).toBe(true);
    }
  });

  it("FINDING-3: the claim boundary accepts unbounded (even negative) lease limits", () => {
    // Documented behavior: timeLimitMs/actionLimit are not validated at the
    // claim boundary; enforcement is presumed downstream in the ephemeral
    // lifecycle. Recorded as a FINDING (no resource bound at this edge).
    const unbounded = claim(definition(), { timeLimitMs: -1, actionLimit: -1 });
    expect(unbounded.ok).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Delegation depth — non-escalation over chains (delegation-contract.ts)
 * ────────────────────────────────────────────────────────────*/

describe("H3-016: delegation depth — deep linear chains (E-045)", () => {
  it("a 25-link chain built through the grant-time gate stays inside the root authority at every depth", () => {
    const DEPTH = 25;
    const chain: MissionDelegation[] = [];
    let delegator = "chief";
    let parentActions: readonly string[] = ROOT_ACTIONS;
    let parentRoles: readonly UniversalRole[] = ROOT_ROLES;
    for (let depth = 0; depth < DEPTH; depth += 1) {
      // Alternate strictly-narrowing and equal-width grants.
      const grantedActions =
        depth % 2 === 0 ? parentActions : parentActions.slice(0, Math.max(1, parentActions.length - 1));
      const grantedRoles =
        depth % 2 === 0 ? parentRoles : parentRoles.slice(0, Math.max(1, parentRoles.length - 1));
      const created = createDelegation(
        chain,
        delegationInput({
          delegationId: `del-depth-${depth}`,
          delegatorRef: delegator,
          delegateRef: `actor-${depth}`,
          grantedActions,
          grantedRoles,
          delegatorActions: parentActions,
          delegatorRoles: parentRoles,
          idempotencyKey: `idem-depth-${depth}`,
        }),
      );
      expect(created.ok, `grant at depth ${depth}`).toBe(true);
      if (created.ok) {
        chain.push(created.delegation);
        parentActions = created.delegation.grantedActions;
        parentRoles = created.delegation.grantedRoles;
        delegator = `actor-${depth}`;
      }
    }
    expect(chain.length).toBe(DEPTH);

    const structure = delegationChainIsNonEscalating(chain);
    expect(structure.ok).toBe(true);

    for (const record of chain) {
      for (const action of record.grantedActions) {
        expect(ROOT_ACTIONS.includes(action), `${record.delegationId} action ${action}`).toBe(true);
      }
      for (const role of record.grantedRoles) {
        expect(ROOT_ROLES.includes(role), `${record.delegationId} role ${role}`).toBe(true);
      }
    }

    const deepest = evaluateDelegationChainAsOf(chain, "del-depth-24", NOW);
    expect(deepest.ok).toBe(true);
    if (deepest.ok) {
      expect(deepest.path.length).toBe(DEPTH);
      expect(deepest.path[0]).toBe("del-depth-24");
    }
  });

  it("FINDING-2: the contract imposes no maximum delegation depth", () => {
    // Documented behavior: width (subset) and time are bounded; depth is
    // not. A deep non-escalating chain is structurally accepted at any
    // depth the caller can construct. Recorded as a FINDING: a governed
    // max-depth ceiling for re-delegation is a posture input for
    // cg_worker_delegation (D-033/D-034), not something this battery can
    // enforce against a contract that does not declare it.
    const chain = linearChain(25, ROOT_ACTIONS, ROOT_ROLES);
    const structure = delegationChainIsNonEscalating(chain);
    expect(structure.ok).toBe(true);
  });

  it("authorizes at depth per-record: a deep link denies an action its own grant lacks even though the root held it", () => {
    const chain: MissionDelegation[] = [
      stampedLink(0, "chief", "actor-0", ["a.read", "a.write"], ["OPERATOR"]),
      stampedLink(1, "actor-0", "actor-1", ["a.read"], ["OPERATOR"], {
        delegatorActions: ["a.read"],
      }),
      stampedLink(2, "actor-1", "actor-2", ["a.read"], ["OPERATOR"], {
        delegatorActions: ["a.read"],
      }),
    ];
    expect(delegationChainIsNonEscalating(chain).ok).toBe(true);

    const deepest = chain[2]!;
    const withinGrant = authorizeDelegatedAction(
      deepest,
      { delegateRef: "actor-2", tenantId: TENANT, missionId: "mission-h3-016", action: "a.read", taskRef: null },
      NOW,
    );
    expect(withinGrant).toEqual({ ok: true, onBehalfOf: "actor-1" });

    const beyondGrant = authorizeDelegatedAction(
      deepest,
      { delegateRef: "actor-2", tenantId: TENANT, missionId: "mission-h3-016", action: "a.write", taskRef: null },
      NOW,
    );
    expect(beyondGrant).toEqual({ ok: false, denyReason: "action_not_granted" });
  });
});

describe("H3-016: delegation depth — adversarial topologies", () => {
  it("diamond closure: authority granted by ANY parent legitimizes the child claim; authority granted by NONE is rejected", () => {
    const root1 = stampedLink(0, "chief", "parent-1", ["a.read"], ["OPERATOR"]);
    const root2 = stampedLink(1, "chief", "parent-2", ["a.write"], ["REVIEWER"]);
    const unionChild = stampedLink(2, "parent-1", "child", ["a.read"], ["OPERATOR"], {
      delegatorActions: ["a.read"],
    });
    // A second parent record feeding the same child delegate.
    const secondParentEdge = stampedLink(3, "parent-2", "child", ["a.write"], ["REVIEWER"], {
      delegatorActions: ["a.write"],
    });
    // The child then claims exactly the union of what its two parents granted.
    const childClaim = stampDelegationContract(
      delegationInput({
        delegationId: "del-4",
        delegatorRef: "child",
        delegateRef: "grandchild",
        grantedActions: ["a.read", "a.write"],
        grantedRoles: ["OPERATOR", "REVIEWER"],
        delegatorActions: ["a.read", "a.write"],
        delegatorRoles: ["OPERATOR", "REVIEWER"],
        idempotencyKey: "idem-4",
      }),
    );
    const diamond = [root1, root2, unionChild, secondParentEdge, childClaim];
    expect(delegationChainIsNonEscalating(diamond).ok).toBe(true);

    // Now the child claims an action NO parent ever granted.
    const laundered = stampDelegationContract(
      delegationInput({
        delegationId: "del-5",
        delegatorRef: "child",
        delegateRef: "grandchild-2",
        grantedActions: ["a.read", "a.delete"],
        grantedRoles: ["OPERATOR"],
        delegatorActions: ["a.read", "a.delete"],
        delegatorRoles: ["OPERATOR"],
        idempotencyKey: "idem-5",
      }),
    );
    const check = delegationChainIsNonEscalating([root1, root2, unionChild, secondParentEdge, laundered]);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.error).toContain("del-5");
      expect(check.error).toContain("a.delete");
    }
  });

  it("an escalating link injected at depth is denied by name", () => {
    const chain: MissionDelegation[] = [
      stampedLink(0, "chief", "actor-0", ["a.read", "a.write"], ["OPERATOR"]),
      stampedLink(1, "actor-0", "actor-1", ["a.read"], ["OPERATOR"], { delegatorActions: ["a.read"] }),
      // Forged: actor-1 claims delegator authority it was never granted.
      stampedLink(2, "actor-1", "actor-2", ["a.read"], ["OPERATOR"], {
        delegatorActions: ["a.read", "a.dispatch"],
      }),
      stampedLink(3, "actor-2", "actor-3", ["a.read"], ["OPERATOR"], { delegatorActions: ["a.read"] }),
    ];
    const check = delegationChainIsNonEscalating(chain);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.error).toContain("del-2");
      expect(check.error).toContain("never held");
    }
  });

  it("a cycle buried at depth is rejected as privilege laundering", () => {
    const chain: MissionDelegation[] = [
      stampedLink(0, "node-x", "node-y", ["a.read"], ["OPERATOR"]),
      stampedLink(1, "node-y", "node-z", ["a.read"], ["OPERATOR"]),
      stampedLink(2, "node-z", "node-x", ["a.read"], ["OPERATOR"]),
    ];
    const check = delegationChainIsNonEscalating(chain);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.error).toContain("cycle");
    }
  });

  it("a cross-tenant parent link anywhere in the chain is denied (multi-tenancy law)", () => {
    const parent = stampDelegationContract(
      delegationInput({
        delegationId: "del-tx-parent",
        tenantId: "tenant-other",
        delegatorRef: "chief",
        delegateRef: "actor-0",
        grantedActions: ["a.read"],
        grantedRoles: ["OPERATOR"],
        delegatorActions: ["a.read"],
        delegatorRoles: ["OPERATOR"],
        idempotencyKey: "idem-tx-parent",
        envelope: { ...envelopeInput(), provenance: { source: "h3-016:cross-tenant", originTenantId: "tenant-other" } },
      }),
    );
    const child = stampedLink(1, "actor-0", "actor-1", ["a.read"], ["OPERATOR"]);
    const check = delegationChainIsNonEscalating([parent, child]);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.error).toContain("across tenants");
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * Delegation depth — dead links, as-of evaluation, revocation
 * ────────────────────────────────────────────────────────────*/

describe("H3-016: delegation depth — dead links deny the whole downstream path", () => {
  it("an expired mid-depth link invalidates every deeper descendant but leaves upstream links usable", () => {
    const chain = linearChain(5, ROOT_ACTIONS, ROOT_ROLES, (index) =>
      index === 2 ? { expiresAt: PAST } : {},
    );
    expect(delegationChainIsNonEscalating(chain).ok).toBe(true);

    const downstream = evaluateDelegationChainAsOf(chain, "del-4", NOW);
    expect(downstream.ok).toBe(false);
    if (!downstream.ok) {
      expect(downstream.denyReason).toBe("expired");
      expect(downstream.delegationId).toBe("del-2");
      expect(downstream.error).toContain("del-2");
    }

    // An "active" stamp cannot resurrect a lapsed link: same result as-of NOW.
    const upstream = evaluateDelegationChainAsOf(chain, "del-1", NOW);
    expect(upstream.ok).toBe(true);
    if (upstream.ok) {
      expect(upstream.path).toEqual(["del-1", "del-0"]);
    }
  });

  it("a suspended or revoked link denies the downstream path with its named reason", () => {
    const suspended = linearChain(3, ROOT_ACTIONS, ROOT_ROLES, (index) =>
      index === 0 ? { lifecycle: "suspended" as DelegationLifecycle } : {},
    );
    const suspendedVerdict = evaluateDelegationChainAsOf(suspended, "del-2", NOW);
    expect(suspendedVerdict.ok).toBe(false);
    if (!suspendedVerdict.ok) {
      expect(suspendedVerdict.denyReason).toBe("suspended");
      expect(suspendedVerdict.delegationId).toBe("del-0");
    }

    const revoked = linearChain(3, ROOT_ACTIONS, ROOT_ROLES, (index) =>
      index === 0
        ? {
            lifecycle: "revoked" as DelegationLifecycle,
            revokedAt: PAST,
            revokedBy: "chief",
            revocationReason: "principal compromised",
          }
        : {},
    );
    const revokedVerdict = evaluateDelegationChainAsOf(revoked, "del-2", NOW);
    expect(revokedVerdict.ok).toBe(false);
    if (!revokedVerdict.ok) {
      expect(revokedVerdict.denyReason).toBe("revoked");
      expect(revokedVerdict.delegationId).toBe("del-0");
    }
  });

  it("an unknown target denies with record_not_found (fail closed)", () => {
    const chain = linearChain(2, ROOT_ACTIONS, ROOT_ROLES);
    const verdict = evaluateDelegationChainAsOf(chain, "del-foreign", NOW);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.denyReason).toBe("record_not_found");
    }
  });

  it("revocation propagates transitively THROUGH an expired mid-depth link, attributed on every record", () => {
    const root = stampedLink(0, "chief", "actor-0", ROOT_ACTIONS, ROOT_ROLES);
    const expiredMid = stampedLink(1, "actor-0", "actor-1", ROOT_ACTIONS, ROOT_ROLES, {
      lifecycle: "expired",
      expiresAt: PAST,
    });
    const deep1 = stampedLink(2, "actor-1", "actor-2", ROOT_ACTIONS, ROOT_ROLES);
    const deep2 = stampedLink(3, "actor-2", "actor-3", ROOT_ACTIONS, ROOT_ROLES);
    // A sibling chain in a DIFFERENT mission must stay untouched (bounded propagation).
    const otherMission = stampDelegationContract(
      delegationInput({
        delegationId: "del-other-mission",
        missionId: "mission-other",
        delegatorRef: "actor-0",
        delegateRef: "actor-other",
        grantedActions: ["a.read"],
        grantedRoles: ["OPERATOR"],
        delegatorActions: ["a.read"],
        delegatorRoles: ["OPERATOR"],
        idempotencyKey: "idem-other-mission",
      }),
    );

    const result = revokeDelegationChain(root, [expiredMid, deep1, deep2, otherMission], {
      now: NOW,
      by: "governance",
      reason: "compromised delegation tree",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.revoked.map((record) => record.delegationId);
      // The expired mid-link stays terminal, but the frontier passes THROUGH
      // it: its descendants are revoked too (DEFECT-4 composition).
      expect(ids).toEqual(["del-0", "del-2", "del-3"]);
      expect(ids).not.toContain("del-1");
      expect(ids).not.toContain("del-other-mission");
      for (const record of result.revoked) {
        expect(record.lifecycle).toBe("revoked");
        expect(record.revokedBy).toBe("governance");
        expect(record.revocationReason).toBe("compromised delegation tree");
      }
    }

    // The out-of-mission sibling remains active — propagation is scope-bounded.
    expect(otherMission.lifecycle).toBe("active");

    // After propagation, every revoked record denies as-of NOW.
    for (const record of result.ok ? result.revoked : []) {
      const verdict = evaluateDelegationChainAsOf([record], record.delegationId, NOW);
      expect(verdict.ok).toBe(false);
    }
  });
});
