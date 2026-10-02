/**
 * MISSION-H2-22 (J-012 / G-070) — contract-level context-switch safety across
 * realities/tenants (frontend/src/lib/context/switch-safety.ts).
 *
 * A switch between tenants/realities is a first-class operation that:
 *  (a) invalidates ALL derived in-memory context (assembled packages, cached
 *      scopes, resolved tenant) unless explicitly carried over under policy;
 *  (b) never smuggles data across boundaries — carry-over is an explicit,
 *      audited allow-list and never overrides the tenant boundary (§13);
 *  (c) fails closed: an operation executed under a stale/ambiguous context
 *      after a switch is denied AND audited.
 *
 * Security negatives are mandatory (Constitution §31). The module is pure:
 * clock injected, ids deterministic, inputs never mutated.
 */
import { describe, expect, it } from "vitest";
import {
  assertFreshContext,
  deriveContext,
  initialSwitchSafetyState,
  resolveContextEpoch,
  switchContext,
  type ContextActorRef,
  type DerivedContextEntry,
  type DerivedContextInput,
  type SwitchCarryPolicyGrant,
  type SwitchSafetyState,
} from "@/lib/context/switch-safety";

const NOW = "2026-10-01T00:00:00.000Z";
const LATER = "2026-10-01T01:00:00.000Z";
const INVALID_CLOCK = "not-a-timestamp";

const ACTOR_A: ContextActorRef = {
  userId: "user-1",
  role: "operator",
  permissions: ["read:operations", "carry:context"],
};
const ACTOR_B: ContextActorRef = {
  userId: "user-2",
  role: "operator",
  permissions: ["read:operations", "carry:context"],
};
const ACTOR_NO_CARRY: ContextActorRef = {
  userId: "user-9",
  role: "operator",
  permissions: ["read:operations"],
};

function makeTarget(tenantRef: string, actorRef: ContextActorRef = ACTOR_B) {
  return { tenantRef, actorRef };
}

const DERIVED_INPUTS: DerivedContextInput[] = [
  { kind: "assembled_package", tenantRef: "tenant-a", ref: "ctx-trace-package-1" },
  { kind: "cached_scope", tenantRef: "tenant-a", ref: "scope:operations:read" },
  { kind: "resolved_tenant", tenantRef: "tenant-a", ref: "tenant-a" },
];

function resolveA(state: SwitchSafetyState = initialSwitchSafetyState(), now: string = NOW) {
  return resolveContextEpoch(state, makeTarget("tenant-a", ACTOR_A), { now });
}

function deriveDefaults(state: SwitchSafetyState, now: string = NOW) {
  return deriveContext(state, DERIVED_INPUTS, { now });
}

function expectDeniedAudited(
  state: SwitchSafetyState,
  kinds: readonly string[],
  baselineAuditCount: number,
): void {
  expect(state.audit.length - baselineAuditCount).toBe(kinds.length);
  const recorded = state.audit.slice(baselineAuditCount).map((record) => record.kind);
  expect(recorded).toEqual(kinds);
}

/* ═══════════════════════════════════════════════════════════
 * (a) A switch invalidates all derived in-memory context
 * ═══════════════════════════════════════════════════════════*/

describe("switchContext — switch clears every derived cache (J-012 (a))", () => {
  it("invalidates assembled packages, cached scopes and the resolved tenant; active set is empty without carry", () => {
    const resolved = resolveA();
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const derived = deriveDefaults(resolved.state);
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.state.derived).toHaveLength(3);

    const result = switchContext(derived.state, { target: makeTarget("tenant-b") }, { now: LATER });

    expect(result.applied).toBe(true);
    expect(result.epoch?.tenantRef).toBe("tenant-b");
    expect(result.carried).toHaveLength(0);
    expect(result.invalidated.map((entry) => entry.kind)).toEqual([
      "assembled_package",
      "cached_scope",
      "resolved_tenant",
    ]);
    // Nothing from the prior epoch stays active.
    expect(result.state.derived).toHaveLength(0);
    expect(result.state.derived).toEqual(result.carried);
    // Every invalidation is a first-class audit record with the switch instant.
    expect(
      result.state.audit
        .filter((record) => record.kind === "derived_context_invalidated")
        .map((record) => record.recordedAt),
    ).toEqual([LATER, LATER, LATER]);
    expect(result.state.audit.some((record) => record.kind === "switch_applied")).toBe(true);
    // The prior epoch id survives only as provenance, never as the current epoch.
    expect(
      result.invalidated.every((entry) => entry.derivedUnderEpochId === resolved.epoch.epochId),
    ).toBe(true);
    expect(result.state.epoch?.epochId).not.toBe(resolved.epoch.epochId);
  });

  it("denies derived-context registration with no resolved epoch (fail closed)", () => {
    const derived = deriveContext(initialSwitchSafetyState(), DERIVED_INPUTS, { now: NOW });
    expect(derived.ok).toBe(false);
    expect(derived.admitted).toHaveLength(0);
    expect(derived.denied.map((record) => record.kind)).toEqual([
      "derived_context_denied_no_epoch",
    ]);
  });

  it("re-resolution is not a switch: changing tenant requires the first-class operation", () => {
    const resolved = resolveA();
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const again = resolveContextEpoch(resolved.state, makeTarget("tenant-b"), { now: LATER });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.reason).toBe("epoch_already_resolved");
    // The current epoch is untouched — no ambient reassignment.
    expect(again.state.epoch?.epochId).toBe(resolved.epoch.epochId);
  });

  it("denies a derived entry referencing another tenant than the resolved epoch (Constitution §13)", () => {
    const resolved = resolveA();
    if (!resolved.ok) throw new Error("expected epoch resolution");
    const derived = deriveContext(
      resolved.state,
      [...DERIVED_INPUTS, { kind: "cached_scope", tenantRef: "tenant-b", ref: "scope:foreign" }],
      { now: NOW },
    );
    expect(derived.ok).toBe(true);
    expect(derived.admitted).toHaveLength(3);
    expect(derived.denied.map((record) => record.kind)).toEqual([
      "derived_context_denied_cross_tenant",
    ]);
  });
});

/* ═══════════════════════════════════════════════════════════
 * (b) Carry-over is an explicit, audited allow-list
 * ═══════════════════════════════════════════════════════════*/

describe("switchContext — carry-over without a policy grant is denied (J-012 (b))", () => {
  it("denies a carry request with no allow-list entry and invalidates the entry instead", () => {
    const resolved = resolveA();
    if (!resolved.ok) throw new Error("expected epoch resolution");
    const derived = deriveDefaults(resolved.state);
    if (!derived.ok) throw new Error("expected derivation");
    const packageEntry = derived.admitted[0];

    const result = switchContext(
      derived.state,
      {
        target: makeTarget("tenant-a"),
        carryOver: [{ entryId: packageEntry.id }],
      },
      { now: LATER },
    );

    expect(result.applied).toBe(true);
    expect(result.carried).toHaveLength(0);
    expect(
      result.state.audit.filter((record) => record.kind === "carry_over_denied_no_policy_grant"),
    ).toEqual([
      expect.objectContaining({
        entryId: packageEntry.id,
        recordedAt: LATER,
        policyRef: null,
      }),
    ]);
    // The un-granted entry did NOT cross: it was invalidated like everything else.
    expect(result.invalidated.map((entry) => entry.id)).toContain(packageEntry.id);
    expect(result.state.derived).toHaveLength(0);
  });

  it("admits carry-over only when the allow-list grant names the entry, tenants, permission and policy", () => {
    // Within-tenant reality switch: carry-over is possible, but ONLY under an
    // explicit allow-list grant (a tenant-a -> tenant-b switch can never
    // carry tenant-a data — see the cross-tenant denial test below).
    const resolved = resolveA();
    if (!resolved.ok) throw new Error("expected epoch resolution");
    const derived = deriveDefaults(resolved.state);
    if (!derived.ok) throw new Error("expected derivation");
    const packageEntry = derived.admitted[0];
    const scopeEntry = derived.admitted[1];

    const grants: SwitchCarryPolicyGrant[] = [
      {
        entryId: packageEntry.id,
        originTenantRef: "tenant-a",
        targetTenantRef: "tenant-a",
        permission: "carry:context",
        policyRef: "policy:operations-carry",
      },
    ];

    const result = switchContext(
      derived.state,
      {
        target: makeTarget("tenant-a"),
        carryOver: [{ entryId: packageEntry.id }, { entryId: scopeEntry.id }],
        policyGrants: grants,
      },
      { now: LATER },
    );

    expect(result.applied).toBe(true);
    expect(result.carried).toHaveLength(1);
    expect(result.carried[0]).toMatchObject({
      ref: packageEntry.ref,
      kind: "assembled_package",
      tenantRef: "tenant-a",
      carriedFromEntryId: packageEntry.id,
      carriedFromEpochId: resolved.epoch.epochId,
      policyRef: "policy:operations-carry",
      derivedUnderEpochId: result.epoch?.epochId,
    });
    // The carried entry is now active in the NEW epoch and re-derived, not reused.
    expect(result.state.derived).toHaveLength(1);
    expect(result.state.derived[0].derivedUnderEpochId).toBe(result.epoch?.epochId);
    expect(result.state.audit.some((record) => record.kind === "carry_over_admitted")).toBe(true);
  });

  it("denies carry-over when the NEW-scope actor lacks the granted permission", () => {
    const resolved = resolveA();
    if (!resolved.ok) throw new Error("expected epoch resolution");
    const derived = deriveDefaults(resolved.state);
    if (!derived.ok) throw new Error("expected derivation");
    const packageEntry = derived.admitted[0];

    const result = switchContext(
      derived.state,
      {
        target: makeTarget("tenant-a", ACTOR_NO_CARRY),
        carryOver: [{ entryId: packageEntry.id }],
        policyGrants: [
          {
            entryId: packageEntry.id,
            originTenantRef: "tenant-a",
            targetTenantRef: "tenant-a",
            permission: "carry:context",
            policyRef: "policy:operations-carry",
          },
        ],
      },
      { now: LATER },
    );

    expect(result.carried).toHaveLength(0);
    expect(
      result.state.audit.some(
        (record) =>
          record.kind === "carry_over_denied_permission" && record.permission === "carry:context",
      ),
    ).toBe(true);
  });

  it("denies a carry request that references an entry unknown to the prior epoch", () => {
    const resolved = resolveA();
    if (!resolved.ok) throw new Error("expected epoch resolution");

    const result = switchContext(
      resolved.state,
      { target: makeTarget("tenant-a"), carryOver: [{ entryId: "dctx-ghost" }] },
      { now: LATER },
    );
    expect(
      result.state.audit.some((record) => record.kind === "carry_over_denied_unknown_entry"),
    ).toBe(true);
    expect(result.carried).toHaveLength(0);
  });

  it("denies the same entry being carried twice", () => {
    const resolved = resolveA();
    if (!resolved.ok) throw new Error("expected epoch resolution");
    const derived = deriveDefaults(resolved.state);
    if (!derived.ok) throw new Error("expected derivation");
    const packageEntry = derived.admitted[0];
    const grant: SwitchCarryPolicyGrant = {
      entryId: packageEntry.id,
      originTenantRef: "tenant-a",
      targetTenantRef: "tenant-a",
      permission: "carry:context",
      policyRef: "policy:operations-carry",
    };

    const result = switchContext(
      derived.state,
      {
        target: makeTarget("tenant-a"),
        carryOver: [{ entryId: packageEntry.id }, { entryId: packageEntry.id }],
        policyGrants: [grant],
      },
      { now: LATER },
    );
    expect(result.carried).toHaveLength(1);
    expect(result.state.audit.some((record) => record.kind === "carry_over_denied_duplicate")).toBe(
      true,
    );
  });

  it("denies a cross-tenant data reference even when a grant claims to authorize it (Constitution §13)", () => {
    const resolved = resolveA();
    if (!resolved.ok) throw new Error("expected epoch resolution");
    const derived = deriveDefaults(resolved.state);
    if (!derived.ok) throw new Error("expected derivation");
    const packageEntry = derived.admitted[0];
    expect(packageEntry.tenantRef).toBe("tenant-a");

    const result = switchContext(
      derived.state,
      {
        target: makeTarget("tenant-b"),
        carryOver: [{ entryId: packageEntry.id }],
        policyGrants: [
          {
            entryId: packageEntry.id,
            originTenantRef: "tenant-a",
            targetTenantRef: "tenant-b",
            permission: "carry:context",
            policyRef: "policy:smuggler-carry",
          },
        ],
      },
      { now: LATER },
    );

    expect(result.applied).toBe(true);
    expect(result.carried).toHaveLength(0);
    expect(
      result.state.audit.filter((record) => record.kind === "carry_over_denied_cross_tenant"),
    ).toEqual([
      expect.objectContaining({
        entryId: packageEntry.id,
        tenantRef: "tenant-a",
        policyRef: "policy:smuggler-carry",
        recordedAt: LATER,
      }),
    ]);
    // The cross-tenant entry did not survive the switch in any form.
    expect(result.invalidated.map((entry) => entry.id)).toContain(packageEntry.id);
    expect(result.state.derived).toHaveLength(0);
  });

  it("denies a grant whose declared origin tenant does not match the entry's canonical tenant", () => {
    const resolved = resolveA();
    if (!resolved.ok) throw new Error("expected epoch resolution");
    const derived = deriveDefaults(resolved.state);
    if (!derived.ok) throw new Error("expected derivation");
    const packageEntry = derived.admitted[0];

    const result = switchContext(
      derived.state,
      {
        target: makeTarget("tenant-a"),
        carryOver: [{ entryId: packageEntry.id }],
        policyGrants: [
          {
            entryId: packageEntry.id,
            originTenantRef: "tenant-other",
            targetTenantRef: "tenant-a",
            permission: "carry:context",
            policyRef: "policy:mismatched",
          },
        ],
      },
      { now: LATER },
    );
    expect(
      result.state.audit.some((record) => record.kind === "carry_over_denied_no_policy_grant"),
    ).toBe(true);
    expect(result.carried).toHaveLength(0);
  });

  it("carried entries survive a further same-tenant hop only via a fresh grant, and never re-cross tenants", () => {
    const resolved = resolveA();
    if (!resolved.ok) throw new Error("expected epoch resolution");
    const derived = deriveDefaults(resolved.state);
    if (!derived.ok) throw new Error("expected derivation");
    const packageEntry = derived.admitted[0];

    // First hop: within-tenant reality switch under an explicit grant.
    const first = switchContext(
      derived.state,
      {
        target: makeTarget("tenant-a"),
        carryOver: [{ entryId: packageEntry.id }],
        policyGrants: [
          {
            entryId: packageEntry.id,
            originTenantRef: "tenant-a",
            targetTenantRef: "tenant-a",
            permission: "carry:context",
            policyRef: "policy:hop-1",
          },
        ],
      },
      { now: LATER },
    );
    expect(first.carried).toHaveLength(1);

    // Second hop within tenant-a: the carried entry needs a fresh, explicit grant.
    const second = switchContext(
      first.state,
      { target: makeTarget("tenant-a"), carryOver: [{ entryId: first.carried[0].id }] },
      { now: "2026-10-01T02:00:00.000Z" },
    );
    expect(second.applied).toBe(true);
    expect(second.carried).toHaveLength(0);
    expect(
      second.state.audit.some((record) => record.kind === "carry_over_denied_no_policy_grant"),
    ).toBe(true);

    // A further cross-tenant hop is denied even under a grant naming the
    // entry's true canonical tenant: the boundary is not grant-overridable.
    const third = switchContext(
      first.state,
      {
        target: makeTarget("tenant-c"),
        carryOver: [{ entryId: first.carried[0].id }],
        policyGrants: [
          {
            entryId: first.carried[0].id,
            originTenantRef: "tenant-a",
            targetTenantRef: "tenant-c",
            permission: "carry:context",
            policyRef: "policy:hop-3",
          },
        ],
      },
      { now: "2026-10-01T03:00:00.000Z" },
    );
    expect(third.carried).toHaveLength(0);
    expect(
      third.state.audit.some(
        (record) =>
          record.kind === "carry_over_denied_cross_tenant" && record.tenantRef === "tenant-a",
      ),
    ).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════
 * (c) Fail closed: stale/ambiguous post-switch operations
 * ═══════════════════════════════════════════════════════════*/

describe("assertFreshContext — post-switch use of stale resolution is denied + audited (J-012 (c))", () => {
  it("denies an operation presenting the pre-switch epoch id, and audits the denial", () => {
    const resolved = resolveA();
    if (!resolved.ok) throw new Error("expected epoch resolution");
    const derived = deriveDefaults(resolved.state);
    if (!derived.ok) throw new Error("expected derivation");
    const staleEpochId = resolved.epoch.epochId;

    const switched = switchContext(
      derived.state,
      { target: makeTarget("tenant-b") },
      { now: LATER },
    );
    expect(switched.applied).toBe(true);
    const baseline = switched.state.audit.length;

    const verdict = assertFreshContext(
      switched.state,
      { operation: "assemble_context_package", epochId: staleEpochId },
      { now: LATER },
    );
    expect(verdict.verdict).toBe("denied");
    if (verdict.verdict !== "denied") return;
    expect(verdict.reason).toBe("stale_epoch");
    expect(verdict.auditedAt).toBe(LATER);
    expectDeniedAudited(verdict.state, ["stale_context_denied"], baseline);
    expect(verdict.state.audit[verdict.state.audit.length - 1]).toMatchObject({
      epochId: switched.epoch?.epochId,
      recordedAt: LATER,
    });
  });

  it("denies an operation that presents NO epoch id (ambiguous context fails closed)", () => {
    const resolved = resolveA();
    if (!resolved.ok) throw new Error("expected epoch resolution");
    const switched = switchContext(
      resolved.state,
      { target: makeTarget("tenant-b") },
      { now: LATER },
    );

    for (const epochId of [null, undefined, ""]) {
      const verdict = assertFreshContext(
        switched.state,
        { operation: "consume_cached_scope", epochId },
        { now: LATER },
      );
      expect(verdict.verdict).toBe("denied");
      if (verdict.verdict === "denied") expect(verdict.reason).toBe("ambiguous_epoch");
    }
  });

  it("allows an operation presenting the CURRENT epoch id and the current derived entry", () => {
    const resolved = resolveA();
    if (!resolved.ok) throw new Error("expected epoch resolution");
    const derived = deriveDefaults(resolved.state);
    if (!derived.ok) throw new Error("expected derivation");
    const packageEntry: DerivedContextEntry = derived.admitted[0];

    const verdict = assertFreshContext(
      derived.state,
      {
        operation: "consume_assembled_package",
        epochId: resolved.epoch.epochId,
        entryId: packageEntry.id,
      },
      { now: LATER },
    );
    expect(verdict.verdict).toBe("allowed");
    if (verdict.verdict !== "allowed") return;
    expect(verdict.epochId).toBe(resolved.epoch.epochId);
    // Allowed probes are not audited; the ledger records denials only.
    expect(verdict.state.audit.length).toBe(derived.state.audit.length);
  });

  it("denies consuming an entry invalidated by the switch, with the pre-switch epoch id or otherwise", () => {
    const resolved = resolveA();
    if (!resolved.ok) throw new Error("expected epoch resolution");
    const derived = deriveDefaults(resolved.state);
    if (!derived.ok) throw new Error("expected derivation");
    const packageEntry: DerivedContextEntry = derived.admitted[0];

    const switched = switchContext(
      derived.state,
      { target: makeTarget("tenant-b") },
      { now: LATER },
    );
    const staleVerdict = assertFreshContext(
      switched.state,
      {
        operation: "consume_assembled_package",
        epochId: resolved.epoch.epochId,
        entryId: packageEntry.id,
      },
      { now: LATER },
    );
    expect(staleVerdict.verdict).toBe("denied");
    if (staleVerdict.verdict === "denied") expect(staleVerdict.reason).toBe("stale_epoch");

    const invalidEntryVerdict = assertFreshContext(
      switched.state,
      {
        operation: "consume_assembled_package",
        epochId: switched.epoch?.epochId,
        entryId: packageEntry.id,
      },
      { now: LATER },
    );
    expect(invalidEntryVerdict.verdict).toBe("denied");
    if (invalidEntryVerdict.verdict === "denied")
      expect(invalidEntryVerdict.reason).toBe("entry_invalidated");
  });

  it("denies any operation before an epoch is resolved", () => {
    const verdict = assertFreshContext(
      initialSwitchSafetyState(),
      { operation: "anything", epochId: "ctx-epoch-guess" },
      { now: NOW },
    );
    expect(verdict.verdict).toBe("denied");
    if (verdict.verdict === "denied") expect(verdict.reason).toBe("no_resolved_epoch");
  });

  it("fails closed on an invalid injected clock", () => {
    const resolved = resolveA();
    if (!resolved.ok) throw new Error("expected epoch resolution");
    const verdict = assertFreshContext(
      resolved.state,
      { operation: "consume_assembled_package", epochId: resolved.epoch.epochId },
      { now: INVALID_CLOCK },
    );
    expect(verdict.verdict).toBe("denied");
    if (verdict.verdict === "denied") expect(verdict.reason).toBe("invalid_clock");
  });
});

/* ═══════════════════════════════════════════════════════════
 * Contract mechanics: fail-closed switches, purity, determinism
 * ═══════════════════════════════════════════════════════════*/

describe("switchContext — switch denials and purity", () => {
  it("fails closed on an invalid clock or target and leaves the prior epoch current", () => {
    const resolved = resolveA();
    if (!resolved.ok) throw new Error("expected epoch resolution");

    const badClock = switchContext(
      resolved.state,
      { target: makeTarget("tenant-b") },
      { now: INVALID_CLOCK },
    );
    expect(badClock.applied).toBe(false);
    expect(badClock.reason).toBe("invalid_clock");
    expect(badClock.state.epoch?.epochId).toBe(resolved.epoch.epochId);

    const badTarget = switchContext(
      resolved.state,
      { target: { tenantRef: "", actorRef: ACTOR_B } },
      { now: LATER },
    );
    expect(badTarget.applied).toBe(false);
    expect(badTarget.reason).toBe("invalid_target");
    expect(badTarget.state.epoch?.epochId).toBe(resolved.epoch.epochId);
  });

  it("denies a switch before any epoch is resolved", () => {
    const result = switchContext(
      initialSwitchSafetyState(),
      { target: makeTarget("tenant-a") },
      { now: NOW },
    );
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("no_resolved_epoch");
  });

  it("is pure: operations never mutate the input state (verified against deep-frozen inputs)", () => {
    const deepFreeze = <T>(value: T): T => {
      if (value && typeof value === "object") {
        Object.values(value as object).forEach(deepFreeze);
        Object.freeze(value);
      }
      return value;
    };

    const resolved = resolveA();
    if (!resolved.ok) throw new Error("expected epoch resolution");
    const derived = deriveDefaults(resolved.state);
    if (!derived.ok) throw new Error("expected derivation");
    const frozen = deepFreeze(derived.state);

    const switched = switchContext(
      frozen,
      {
        target: makeTarget("tenant-a"),
        carryOver: [{ entryId: derived.admitted[0].id }],
        policyGrants: [
          {
            entryId: derived.admitted[0].id,
            originTenantRef: "tenant-a",
            targetTenantRef: "tenant-a",
            permission: "carry:context",
            policyRef: "policy:operations-carry",
          },
        ],
      },
      { now: LATER },
    );
    expect(switched.applied).toBe(true);
    // The frozen prior state is untouched by the operation.
    expect(frozen.derived).toHaveLength(3);
    expect(frozen.epoch?.tenantRef).toBe("tenant-a");

    const frozenStale = deepFreeze(switched.state);
    const verdict = assertFreshContext(
      frozenStale,
      { operation: "probe", epochId: "ctx-epoch-stale" },
      { now: LATER },
    );
    expect(verdict.verdict).toBe("denied");
    expect(frozenStale.audit.length).toBe(switched.state.audit.length);
  });

  it("is deterministic: identical operations under an injected clock derive identical identifiers", () => {
    const run = (): SwitchSafetyState => {
      const resolved = resolveA();
      if (!resolved.ok) throw new Error("expected epoch resolution");
      const derived = deriveDefaults(resolved.state);
      if (!derived.ok) throw new Error("expected derivation");
      const switched = switchContext(
        derived.state,
        {
          target: makeTarget("tenant-a"),
          carryOver: [{ entryId: derived.admitted[0].id }],
          policyGrants: [
            {
              entryId: derived.admitted[0].id,
              originTenantRef: "tenant-a",
              targetTenantRef: "tenant-a",
              permission: "carry:context",
              policyRef: "policy:operations-carry",
            },
          ],
        },
        { now: LATER },
      );
      return switched.state;
    };

    const first = run();
    const second = run();
    expect(second.epoch?.epochId).toBe(first.epoch?.epochId);
    expect(second.epoch?.traceId).toBe(first.epoch?.traceId);
    expect(second.derived.map((entry) => entry.id)).toEqual(first.derived.map((entry) => entry.id));
    expect(second.audit.map((record) => record.id)).toEqual(first.audit.map((record) => record.id));
  });

  it("records a complete audit trail across resolution, derivation, switch and stale denial", () => {
    const resolved = resolveA();
    if (!resolved.ok) throw new Error("expected epoch resolution");
    const derived = deriveDefaults(resolved.state);
    if (!derived.ok) throw new Error("expected derivation");

    const switched = switchContext(
      derived.state,
      { target: makeTarget("tenant-b") },
      { now: LATER },
    );
    const denied = assertFreshContext(
      switched.state,
      { operation: "consume_cached_scope", epochId: resolved.epoch.epochId },
      { now: LATER },
    );
    if (denied.verdict !== "denied") throw new Error("expected denial");

    const kinds = denied.state.audit.map((record) => record.kind);
    expect(kinds).toEqual([
      "epoch_resolved",
      "derived_context_registered",
      "derived_context_registered",
      "derived_context_registered",
      "derived_context_invalidated",
      "derived_context_invalidated",
      "derived_context_invalidated",
      "switch_applied",
      "stale_context_denied",
    ]);
    expect(
      denied.state.audit.every(
        (record) => record.recordedAt === NOW || record.recordedAt === LATER,
      ),
    ).toBe(true);
    expect(new Set(denied.state.audit.map((record) => record.id)).size).toBe(
      denied.state.audit.length,
    );
  });
});
