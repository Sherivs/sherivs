/**
 * CoreGrid — H3 B-013 / J-012 tests: runtime guard for tenant/reality
 * switches (`frontend/src/lib/context/switch-safety-runtime.ts`).
 *
 * The runtime composes the pure switch-safety contract (`./switch-safety`,
 * read-only delegation) and this suite proves the runtime-level guarantees:
 *  1. guarded execution only under a resolved epoch, with an epoch-bound
 *     frozen scope;
 *  2. fail-closed denials BEFORE the callback runs: unresolved epoch,
 *     invalidated entry, invalid injected clock, schema-invalid input;
 *  3. no bleed across switches: non-carried derived context is invalidated
 *     by the contract, captured scopes go dead after a switch, and only the
 *     audited carry-over path (exact grant + NEW-actor permission) moves
 *     context across a boundary;
 *  4. the tenant boundary outranks any policy grant (cross-tenant carry
 *     denied even under a covering grant — Constitution §13);
 *  5. callback failures are contained: audited by error name only, epoch
 *     stays current, no error content is recorded;
 *  6. every runtime decision is audited; ledgers are append-only and never
 *     carry secret material;
 *  7. determinism and purity: identical runs produce identical ledgers;
 *     inputs are never mutated.
 */

import { describe, expect, expectTypeOf, it } from "vitest";
import {
  FreshContextScope,
  StaleContextError,
  SwitchSafetyRuntimeGuard,
  type GuardedExecutionOutcome,
  type SwitchSafetyRuntimeAuditRecord,
} from "@/lib/context/switch-safety-runtime";
import type {
  DerivedContextEntry,
  SwitchSafetyAuditRecord,
} from "@/lib/context/switch-safety";

const INSTANT_T0 = "2026-10-03T00:00:00.000Z";
const INSTANT_T1 = "2026-10-03T00:00:01.000Z";
const INSTANT_T2 = "2026-10-03T00:00:02.000Z";
const INSTANT_T3 = "2026-10-03T00:00:03.000Z";

const SECRET_FIXTURE = "secret-do-not-echo-value-0f13";

function actor(userId: string, permissions: readonly string[]) {
  return { userId, role: "operator", permissions: [...permissions] };
}

function guardWith(instants: readonly string[]): SwitchSafetyRuntimeGuard {
  const queue = [...instants];
  let ticks = 0;
  return new SwitchSafetyRuntimeGuard({
    now: () => {
      const value = queue[Math.min(ticks, queue.length - 1)] ?? INSTANT_T0;
      ticks += 1;
      return value;
    },
  });
}

/** A guard whose injected clock always returns the given (possibly invalid) instant. */
function guardWithFixed(instant: string): SwitchSafetyRuntimeGuard {
  return new SwitchSafetyRuntimeGuard({ now: () => instant });
}

const TARGET_A_V1 = { tenantRef: "tenant-a", actorRef: actor("actor-1", ["scope.read.a"]) };
const TARGET_A_V2 = { tenantRef: "tenant-a", actorRef: actor("actor-2", ["scope.read.a", "scope.carry.a"]) };
const TARGET_B_V1 = { tenantRef: "tenant-b", actorRef: actor("actor-3", ["scope.read.b", "scope.carry.b"]) };

const DERIVED_INPUT = { kind: "assembled_package" as const, tenantRef: "tenant-a", ref: "pkg:alpha" };

function resolvedGuardWithEntry(): SwitchSafetyRuntimeGuard {
  const guard = guardWith([INSTANT_T0, INSTANT_T0]);
  const resolved = guard.resolveEpoch(TARGET_A_V1);
  if (!resolved.ok) throw new Error("fixture: epoch resolution failed");
  const derived = guard.derive([DERIVED_INPUT]);
  if (!derived.ok || derived.admitted.length !== 1) {
    throw new Error("fixture: derived-context registration failed");
  }
  return guard;
}

/* ─────────────────────────────────────────────────────────────
 * 1. Guarded execution happy path + scope shape
 * ────────────────────────────────────────────────────────────*/

describe("guarded execution under a resolved epoch", () => {
  it("runs the callback only after the contract probe passes, with an epoch-bound frozen scope", () => {
    const guard = resolvedGuardWithEntry();
    const entryId = guard.auditTrail().find((r) => r.kind === "derived_context_registered")?.entryId;
    expect(entryId).toBeTruthy();

    let ran = 0;
    const outcome = guard.withFreshContext("op.consume.package", [entryId as string], (scope) => {
      ran += 1;
      expect(scope.epochId).toBe(guard.currentEpoch()?.epochId);
      expect(scope.tenantRef).toBe("tenant-a");
      expect(Object.isFrozen(scope.entries)).toBe(true);
      expect(scope.entries.map((e) => e.id)).toContain(entryId);
      return "value";
    });

    expect(ran).toBe(1);
    expect(outcome.verdict).toBe("allowed");
    if (outcome.verdict === "allowed") expect(outcome.value).toBe("value");
    expect(guard.runtimeAuditTrail().at(-1)?.kind).toBe("runtime_execution_completed");
  });

  it("denies closed when no epoch is resolved — the callback never runs", () => {
    const guard = guardWith([INSTANT_T0, INSTANT_T0]);
    let ran = 0;
    const outcome = guard.withFreshContext("op.read", ["dctx-anything"], () => {
      ran += 1;
      return "value";
    });

    expect(ran).toBe(0);
    expect(outcome.verdict).toBe("denied");
    if (outcome.verdict === "denied") {
      expect(outcome.reason).toBe("no_resolved_epoch");
      expect(outcome.scope).toBeNull();
    }
    expect(guard.auditTrail().some((r) => r.kind === "stale_context_denied")).toBe(true);
    expect(guard.runtimeAuditTrail().some((r) => r.kind === "runtime_execution_denied_freshness")).toBe(true);
  });

  it("denies closed when the declared derived entry was invalidated by a switch", () => {
    const guard = resolvedGuardWithEntry();
    const entryId = guard.auditTrail().find((r) => r.kind === "derived_context_registered")
      ?.entryId as string;
    const switched = guard.switchTo({ target: TARGET_A_V2 });
    expect(switched.applied).toBe(true);

    let ran = 0;
    const outcome = guard.withFreshContext("op.consume.package", [entryId], () => {
      ran += 1;
      return "value";
    });

    expect(ran).toBe(0);
    expect(outcome.verdict).toBe("denied");
    if (outcome.verdict === "denied") expect(outcome.reason).toBe("entry_invalidated");
  });

  it("rejects schema-invalid operation input without touching state", () => {
    const guard = resolvedGuardWithEntry();
    const before = guard.auditTrail().length;

    const emptyOperation = guard.withFreshContext("", [], () => "value");
    const emptyEntryId = guard.withFreshContext("op.read", [""], () => "value");

    expect(emptyOperation.verdict).toBe("denied");
    expect(emptyEntryId.verdict).toBe("denied");
    if (emptyOperation.verdict === "denied") expect(emptyOperation.reason).toBe("invalid_input");
    if (emptyEntryId.verdict === "denied") expect(emptyEntryId.reason).toBe("invalid_input");
    // Contract state untouched by input rejection; only runtime audit grew.
    expect(guard.auditTrail().length).toBe(before);
    expect(guard.runtimeAuditTrail().filter((r) => r.kind === "runtime_input_rejected").length).toBe(2);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Switch invalidation + carry-over (composed contract semantics)
 * ────────────────────────────────────────────────────────────*/

describe("switch invalidation and audited carry-over", () => {
  it("invalidates every non-carried entry and keeps the new epoch clean", () => {
    const guard = guardWith([INSTANT_T0, INSTANT_T0, INSTANT_T1, INSTANT_T1]);
    expect(guard.resolveEpoch(TARGET_A_V1).ok).toBe(true);
    expect(guard.derive([DERIVED_INPUT, { kind: "cached_scope", tenantRef: "tenant-a", ref: "cache:beta" }])
      .ok).toBe(true);
    const registered = guard.auditTrail()
      .filter((r) => r.kind === "derived_context_registered")
      .map((r) => r.entryId);
    expect(registered).toHaveLength(2);

    const switched = guard.switchTo({ target: TARGET_A_V2 });
    expect(switched.applied).toBe(true);
    expect(switched.epoch?.tenantRef).toBe("tenant-a");
    expect(switched.carried).toHaveLength(0);
    expect(switched.invalidated.map((e) => e.id)).toEqual(expect.arrayContaining(registered as string[]));
    expect(guard.currentEpoch()?.epochId).toBe(switched.epoch?.epochId);
    expect(switched.state.derived).toHaveLength(0);
    expect(
      guard.auditTrail().filter((r) => r.kind === "derived_context_invalidated"),
    ).toHaveLength(2);
  });

  /** Fresh guard with the epoch resolved and one derived entry registered. */
  function fixtureWithEntry(instants: readonly string[]): { guard: SwitchSafetyRuntimeGuard; entryId: string } {
    const guard = guardWith(instants);
    expect(guard.resolveEpoch(TARGET_A_V1).ok).toBe(true);
    expect(guard.derive([DERIVED_INPUT]).ok).toBe(true);
    const entryId = guard.auditTrail().find((r) => r.kind === "derived_context_registered")
      ?.entryId as string;
    return { guard, entryId };
  }

  it("carries an entry across a same-tenant switch ONLY under an exact grant held by the NEW actor", () => {
    // No grant -> denied, and the denied-carry switch still invalidates the entry.
    const noGrant = fixtureWithEntry([INSTANT_T0, INSTANT_T0, INSTANT_T1]);
    const denied = noGrant.guard.switchTo({ target: TARGET_A_V2, carryOver: [{ entryId: noGrant.entryId }] });
    expect(denied.applied).toBe(true);
    expect(denied.carried).toHaveLength(0);
    expect(denied.invalidated.map((e) => e.id)).toContain(noGrant.entryId);
    expect(noGrant.guard.auditTrail().some((r) => r.kind === "carry_over_denied_no_policy_grant")).toBe(true);

    // Grant present but NEW actor lacks the permission -> denied (fresh fixture).
    const noPerm = fixtureWithEntry([INSTANT_T0, INSTANT_T0, INSTANT_T1]);
    const deniedPerm = noPerm.guard.switchTo({
      target: { tenantRef: "tenant-a", actorRef: actor("actor-4", []) },
      carryOver: [{ entryId: noPerm.entryId }],
      policyGrants: [
        { entryId: noPerm.entryId, originTenantRef: "tenant-a", targetTenantRef: "tenant-a", permission: "scope.carry.a", policyRef: "policy:carry-1" },
      ],
    });
    expect(deniedPerm.applied).toBe(true);
    expect(deniedPerm.carried).toHaveLength(0);
    expect(noPerm.guard.auditTrail().some((r) => r.kind === "carry_over_denied_permission")).toBe(true);

    // Grant + permission -> admitted, with full provenance, re-derived under the NEW epoch.
    const admissible = fixtureWithEntry([INSTANT_T0, INSTANT_T0, INSTANT_T1]);
    const priorEpochId = admissible.guard.currentEpoch()?.epochId as string;
    const admitted = admissible.guard.switchTo({
      target: TARGET_A_V2,
      carryOver: [{ entryId: admissible.entryId }],
      policyGrants: [
        { entryId: admissible.entryId, originTenantRef: "tenant-a", targetTenantRef: "tenant-a", permission: "scope.carry.a", policyRef: "policy:carry-1" },
      ],
    });
    expect(admitted.applied).toBe(true);
    expect(admitted.carried).toHaveLength(1);
    const carried = admitted.carried[0];
    expect(carried.carriedFromEntryId).toBe(admissible.entryId);
    expect(carried.carriedFromEpochId).toBe(priorEpochId);
    expect(carried.derivedUnderEpochId).toBe(admitted.epoch?.epochId);
    expect(carried.policyRef).toBe("policy:carry-1");
    expect(admissible.guard.auditTrail().some((r) => r.kind === "carry_over_admitted")).toBe(true);
  });

  it("denies a cross-tenant carry even under a covering grant — the tenant boundary outranks policy", () => {
    const guard = guardWith([INSTANT_T0, INSTANT_T0, INSTANT_T1]);
    expect(guard.resolveEpoch(TARGET_A_V1).ok).toBe(true);
    expect(guard.derive([DERIVED_INPUT]).ok).toBe(true);
    const entryId = guard.auditTrail().find((r) => r.kind === "derived_context_registered")
      ?.entryId as string;

    const switched = guard.switchTo({
      target: TARGET_B_V1,
      carryOver: [{ entryId }],
      policyGrants: [
        { entryId, originTenantRef: "tenant-a", targetTenantRef: "tenant-b", permission: "scope.carry.b", policyRef: "policy:carry-2" },
      ],
    });

    expect(switched.applied).toBe(true);
    expect(switched.carried).toHaveLength(0);
    expect(guard.auditTrail().some((r) => r.kind === "carry_over_denied_cross_tenant")).toBe(true);
    // The new epoch holds no tenant-a material: no bleed (Constitution §13).
    expect(switched.state.derived).toHaveLength(0);
    expect(switched.state.derived.every((e) => e.tenantRef === "tenant-b")).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Captured scopes go dead after a switch (no bleed)
 * ────────────────────────────────────────────────────────────*/

describe("captured scopes fail closed across switches", () => {
  it("a scope captured before a switch throws on assertActive and reports inactive after it", () => {
    const guard = resolvedGuardWithEntry();
    const holder: { scope: FreshContextScope | null } = { scope: null };
    const first = guard.withFreshContext("op.read", [], (scope) => {
      holder.scope = scope;
      return scope.epochId;
    });
    expect(first.verdict).toBe("allowed");
    const scope = holder.scope as FreshContextScope;
    expect(scope.assertActive()).toBeUndefined();

    const switched = guard.switchTo({ target: TARGET_A_V2 });
    expect(switched.applied).toBe(true);

    expect(guard.scopeIsActive(scope)).toBe(false);
    expect(guard.validateScope(scope)).toEqual({ active: false, reason: "scope_epoch_superseded" });
    expect(() => scope.assertActive()).toThrow(StaleContextError);

    // Meanwhile, fresh guarded execution under the NEW epoch still works —
    // staleness is per-scope, not a lockout.
    const second = guard.withFreshContext("op.read", [], (fresh) => fresh.epochId);
    expect(second.verdict).toBe("allowed");
    if (second.verdict === "allowed") expect(second.scope.epochId).toBe(switched.epoch?.epochId);
  });

  it("a captured scope from epoch 1 cannot be used to read epoch-2-only entries", () => {
    const guard = resolvedGuardWithEntry();
    const holder: { scope: FreshContextScope | null } = { scope: null };
    guard.withFreshContext("op.read", [], (scope) => {
      holder.scope = scope;
      return null;
    });

    guard.switchTo({ target: TARGET_A_V2 });
    expect(guard.derive([{ kind: "assembled_package", tenantRef: "tenant-a", ref: "pkg:post-switch" }])
      .ok).toBe(true);
    const postSwitchEntry = guard.auditTrail()
      .filter((r) => r.kind === "derived_context_registered")
      .map((r) => r.entryId)
      .at(-1) as string;

    const staleScope = holder.scope as FreshContextScope;
    // Scope bound to the superseded epoch: dead on inspection...
    expect(guard.scopeIsActive(staleScope)).toBe(false);
    expect(() => staleScope.assertActive()).toThrow(StaleContextError);
    // ...and the superseded scope can never see post-switch material.
    expect(staleScope.entries.map((e) => e.id)).not.toContain(postSwitchEntry);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. Callback failures are contained; state never strands stale context
 * ────────────────────────────────────────────────────────────*/

describe("guarded execution failure containment", () => {
  it("audits a throwing callback by error NAME only and keeps the epoch current", () => {
    const guard = resolvedGuardWithEntry();

    const outcome = guard.withFreshContext("op.risky", [], () => {
      throw new Error(SECRET_FIXTURE);
    });
    expect(outcome.verdict).toBe("failed");
    if (outcome.verdict === "failed") expect(outcome.scope).toBeNull();

    const failed = guard.runtimeAuditTrail().find((r) => r.kind === "runtime_execution_failed");
    expect(failed).toBeTruthy();
    // Error name is recorded; the error MESSAGE (which could carry secrets) is not.
    expect(failed?.detail).toContain("Error");
    expect(failed?.detail).not.toContain(SECRET_FIXTURE);
    // Epoch stayed current: the next guarded run is still allowed.
    const followUp = guard.withFreshContext("op.after-failure", [], (scope) => scope.epochId);
    expect(followUp.verdict).toBe("allowed");
    expect(guard.currentEpoch()?.epochId).toBe(
      guard.auditTrail().find((r) => r.kind === "epoch_resolved")?.epochId,
    );
  });

  it("contains non-Error throws without recording their content", () => {
    const guard = resolvedGuardWithEntry();
    const outcome = guard.withFreshContext("op.risky", [], () => {
      throw SECRET_FIXTURE;
    });
    expect(outcome.verdict).toBe("failed");
    const failed = guard.runtimeAuditTrail().find((r) => r.kind === "runtime_execution_failed");
    expect(failed?.detail).toContain("non_error_throw");
    expect(failed?.detail).not.toContain(SECRET_FIXTURE);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. Invalid injected clock fails EVERYTHING closed
 * ────────────────────────────────────────────────────────────*/

describe("invalid injected clock (fail-closed)", () => {
  it("denies resolution, derivation, switching and guarded execution; nothing executes", () => {
    const guard = guardWithFixed("not-a-timestamp");
    let ran = 0;

    expect(guard.resolveEpoch(TARGET_A_V1)).toMatchObject({ ok: false, reason: "invalid_clock" });
    expect(guard.derive([DERIVED_INPUT])).toMatchObject({ ok: false, admitted: [], denied: [] });
    expect(guard.switchTo({ target: TARGET_A_V2 })).toMatchObject({
      applied: false,
      reason: "invalid_clock",
      carried: [],
    });
    const outcome = guard.withFreshContext("op.read", [], () => {
      ran += 1;
      return "value";
    });
    expect(ran).toBe(0);
    expect(outcome.verdict).toBe("denied");
    if (outcome.verdict === "denied") expect(outcome.reason).toBe("invalid_clock");

    expect(guard.currentEpoch()).toBeNull();
    expect(guard.runtimeAuditTrail().filter((r) => r.kind === "runtime_guard_denied_invalid_clock"))
      .toHaveLength(4);
    // No contract audit could even be stamped — the ledger stays empty.
    expect(guard.auditTrail()).toHaveLength(0);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 6. Zod boundary validation on every operation
 * ────────────────────────────────────────────────────────────*/

describe("schema-invalid boundary input is rejected fail-closed", () => {
  it("rejects malformed targets, derived inputs and switch requests without touching state", () => {
    const guard = resolvedGuardWithEntry();
    const epochBefore = guard.currentEpoch()?.epochId;
    const auditBefore = guard.auditTrail().length;

    expect(guard.resolveEpoch({ tenantRef: "", actorRef: actor("x", []) }))
      .toMatchObject({ ok: false, reason: "invalid_target" });
    expect(guard.resolveEpoch({ tenantRef: "tenant-a", actorRef: actor("", []) }))
      .toMatchObject({ ok: false, reason: "invalid_target" });
    expect(
      guard.derive([{ kind: "not-a-kind" as unknown as "assembled_package", tenantRef: "tenant-a", ref: "x" }]),
    ).toMatchObject({ ok: false, admitted: [] });
    expect(guard.switchTo({ target: { tenantRef: "tenant-a", actorRef: { userId: "x", role: "operator", permissions: "not-array" as unknown as string[] } } }))
      .toMatchObject({ applied: false, reason: "invalid_target" });

    expect(guard.currentEpoch()?.epochId).toBe(epochBefore);
    expect(guard.auditTrail().length).toBe(auditBefore);
    expect(
      guard.runtimeAuditTrail().filter((r) => r.kind === "runtime_input_rejected").length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("delegates valid input to the contract — the contract's own audit kinds appear verbatim", () => {
    const guard = resolvedGuardWithEntry();
    const kinds = guard.auditTrail().map((r) => r.kind);
    expect(kinds).toContain("epoch_resolved");
    expect(kinds).toContain("derived_context_registered");
    // Runtime owns NO freshness/switch decisions of its own: it composes the contract.
    const runtimeKindVocabulary = new Set([
      "runtime_input_rejected",
      "runtime_guard_denied_invalid_clock",
      "runtime_scope_issued",
      "runtime_execution_denied_freshness",
      "runtime_execution_completed",
      "runtime_execution_failed",
    ]);
    for (const record of guard.runtimeAuditTrail()) {
      expect(runtimeKindVocabulary.has(record.kind)).toBe(true);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 7. Audit hygiene, determinism, purity
 * ────────────────────────────────────────────────────────────*/

describe("audit hygiene, determinism and purity", () => {
  it("ledgers are append-only, timestamped with the injected instant, and secret-free", () => {
    const guard = guardWith([INSTANT_T0, INSTANT_T0, INSTANT_T1, INSTANT_T1, INSTANT_T2]);
    expect(guard.resolveEpoch(TARGET_A_V1).ok).toBe(true);
    expect(guard.derive([DERIVED_INPUT]).ok).toBe(true);
    const entryId = guard.auditTrail().find((r) => r.kind === "derived_context_registered")
      ?.entryId as string;
    guard.withFreshContext("op.read", [entryId], () => SECRET_FIXTURE);
    guard.switchTo({ target: TARGET_A_V2, carryOver: [{ entryId }] });

    const contractLedger: readonly SwitchSafetyAuditRecord[] = guard.auditTrail();
    const runtimeLedger: readonly SwitchSafetyRuntimeAuditRecord[] = guard.runtimeAuditTrail();
    expect(contractLedger.length).toBeGreaterThan(3);
    expect(runtimeLedger.length).toBeGreaterThanOrEqual(2);
    expect(runtimeLedger.some((r) => r.kind === "runtime_scope_issued")).toBe(true);
    expect(runtimeLedger.some((r) => r.kind === "runtime_execution_completed")).toBe(true);

    const injectedInstants = new Set([INSTANT_T0, INSTANT_T1, INSTANT_T2]);
    let lastMs = -Infinity;
    for (const record of contractLedger) {
      expect(injectedInstants.has(record.recordedAt)).toBe(true);
      // Append-only in time as well: never earlier than the previous record.
      const ms = Date.parse(record.recordedAt);
      expect(ms).toBeGreaterThanOrEqual(lastMs);
      lastMs = ms;
      expect(JSON.stringify(record)).not.toContain(SECRET_FIXTURE);
    }
    const runtimeInstants = new Set(runtimeLedger.map((r) => r.recordedAt));
    expect(injectedInstants.has(INSTANT_T1)).toBe(true);
    for (const instant of runtimeInstants) {
      expect(injectedInstants.has(instant)).toBe(true);
    }
    // The guarded execution produced records at its operation instant.
    expect(runtimeInstants.has(INSTANT_T1)).toBe(true);
    for (const record of runtimeLedger) {
      expect(JSON.stringify(record)).not.toContain(SECRET_FIXTURE);
      expect(record.id.startsWith("switch-runtime-audit-")).toBe(true);
    }
  });

  it("identical operation sequences over the same injected instants produce identical ledgers", () => {
    const run = (): { contract: string; runtime: string } => {
      const guard = guardWith([INSTANT_T0, INSTANT_T0, INSTANT_T1, INSTANT_T1]);
      guard.resolveEpoch(TARGET_A_V1);
      guard.derive([DERIVED_INPUT]);
      const entryId = guard.auditTrail().find((r) => r.kind === "derived_context_registered")
        ?.entryId as string;
      guard.withFreshContext("op.read", [entryId], () => null);
      guard.switchTo({ target: TARGET_A_V2, carryOver: [{ entryId }] });
      return {
        contract: JSON.stringify(guard.auditTrail()),
        runtime: JSON.stringify(guard.runtimeAuditTrail()),
      };
    };
    const first = run();
    const second = run();
    expect(second.contract).toBe(first.contract);
    expect(second.runtime).toBe(first.runtime);
  });

  it("never mutates caller-provided inputs (purity)", () => {
    const guard = guardWith([INSTANT_T0, INSTANT_T0, INSTANT_T1]);
    const entries = Object.freeze([
      Object.freeze({ kind: "assembled_package" as const, tenantRef: "tenant-a", ref: "pkg:alpha" }),
    ]) as readonly { kind: "assembled_package"; tenantRef: string; ref: string }[];
    expect(guard.resolveEpoch(TARGET_A_V1).ok).toBe(true);
    const result = guard.derive(entries);
    expect(result.ok).toBe(true);
    expect(entries).toHaveLength(1);
    expect(Object.isFrozen(entries)).toBe(true);
    const admitted: readonly DerivedContextEntry[] = (result as { admitted: readonly DerivedContextEntry[] }).admitted;
    expect(admitted[0]?.ref).toBe("pkg:alpha");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 8. Type-level contract surface
 * ────────────────────────────────────────────────────────────*/

describe("type surface", () => {
  it("outcomes are discriminated unions; scopes are typed and frozen by contract", () => {
    expectTypeOf<GuardedExecutionOutcome<string>>().toExtend<
      | { verdict: "allowed"; value: string; scope: FreshContextScope }
      | { verdict: "denied"; reason: string; detail: string; scope: null }
      | { verdict: "failed"; error: unknown; scope: null }
    >();
    expectTypeOf<FreshContextScope["entries"]>().toExtend<readonly DerivedContextEntry[]>();
    expectTypeOf<SwitchSafetyRuntimeGuard["switchTo"]>().returns.toExtend<{ applied: boolean }>();
    expectTypeOf(new StaleContextError("x").name).toEqualTypeOf<string>();
  });
});