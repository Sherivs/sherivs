/**
 * CoreGrid — H3 C-030 (L-T-016) Context-Bleed Adversary battery.
 *
 * Adversarial switch-safety battery against the runtime guard
 * (`frontend/src/lib/context/switch-safety-runtime.ts`, owned by H3 B-013,
 * imported READ-ONLY) and its underlying pure contract
 * (`frontend/src/lib/context/switch-safety.ts`, imported READ-ONLY).
 * NOTHING here modifies either module; every attack is driven through the
 * public, typed surface a hostile caller would actually see.
 *
 * Attack classes (mission C-030):
 *   1. CAPTURED SCOPES USED AFTER A SWITCH — a scope issued under epoch E
 *      is smuggled past a tenant switch and re-used.
 *   2. STALE-EPOCH CALLBACK INJECTION — callbacks and probes that present
 *      superseded epoch identities.
 *   3. CROSS-TENANT SCOPE SMUGGLING — forged grants, forged targets and
 *      mutated entries trying to move tenant-a material into tenant-b.
 *   4. CLOCK MANIPULATION — invalid instants and instant replay.
 *   5. FORGED AUDIT ENTRIES — attempts to rewrite or append to the ledgers.
 *   6. CALLBACK-THROW CONTAINMENT ESCAPE — throws of every shape trying to
 *      escape the guarded-execution sandbox.
 *   7. ZOD-BOUNDARY BYPASS — malformed and type-confused boundary inputs.
 *
 * CONTAINMENT LAW: every attack that the guard contains must be contained
 * with a TYPED denial (discriminated verdict/reason, or a typed audit
 * record). Where an attack SUCCEEDS, the success is asserted honestly and
 * labelled as a FINDING (H3-030-F*) — the module is NOT fixed here; that
 * decision belongs to the owning team (B-013) and the coordinator.
 *
 * FINDINGS recorded by this battery (evidence below, one test each):
 *
 *   F1 — EPOCH-IDENTITY REPLAY: epoch ids are FNV-1a over
 *        tenant|userId|role|now. Replaying the ORIGINAL resolution instant
 *        through the injected clock while switching back to the identical
 *        target mints a NEW epoch with the SAME epoch id, so a captured
 *        pre-switch scope passes `assertActive()`/`scopeIsActive()`/
 *        `validateScope()` again — scope LIVENESS is forged across a
 *        tenant-b interlude. (Entry-level consumption remains denied.)
 *
 *   F2 — LEDGERS ARE NOT RUNTIME-APPEND-ONLY: `auditTrail()` and
 *        `runtimeAuditTrail()` return LIVE mutable arrays of mutable
 *        records. An in-process hostile holder can append forged records
 *        and rewrite existing ones (§29 append-only is type-level only).
 *
 *   F3 — CROSS-TENANT SMUGGLING VIA SHALLOW-FROZEN SCOPE: the issued
 *        scope freezes only the entries ARRAY; the entry objects are live
 *        references shared with the guard's canonical state. A tenant-a
 *        callback can rewrite `tenantRef` of an entry, then ride the
 *        audited carry-over path (grant now "consistent" with the mutated
 *        truth) to smuggle tenant-a material into a tenant-b epoch, where
 *        guarded consumption is ALLOWED. (Constitution §13 bypass.)
 *
 *   F4 — AUDIT-DETAIL INJECTION: the Zod boundary accepts any non-empty
 *        operation string, which flows verbatim into ledger `detail`
 *        fields — an attacker-controlled operation name forges audit
 *        narrative content (log forging).
 *
 *   F5 — SCOPE OVER-GRANT: `withFreshContext` probes only the DECLARED
 *        entryIds but issues a scope exposing ALL active derived entries,
 *        so an operation receives context it never declared (least-
 *        privilege violation; also the natural delivery vehicle for F3).
 *
 * Pure and offline: no I/O, no network, no database, no secrets, no wall
 * clock (all time is injected constants).
 */

import { describe, expect, it } from "vitest";
import {
  StaleContextError,
  SwitchSafetyRuntimeGuard,
  type FreshContextScope,
  type GuardedExecutionOutcome,
  type SwitchSafetyRuntimeAuditRecord,
} from "@/lib/context/switch-safety-runtime";
import {
  assertFreshContext,
  initialSwitchSafetyState,
  resolveContextEpoch,
  switchContext,
  type DerivedContextEntry,
  type SwitchSafetyAuditRecord,
} from "@/lib/context/switch-safety";

/* ─────────────────────────────────────────────────────────────
 * Deterministic fixtures (all time injected; no wall clock)
 * ────────────────────────────────────────────────────────────*/

const T0 = "2026-10-03T00:00:00.000Z";
const T1 = "2026-10-03T00:00:01.000Z";
const T2 = "2026-10-03T00:00:02.000Z";
const T3 = "2026-10-03T00:00:03.000Z";

/** Instants `Date.parse` refuses — the fail-closed clock trap. */
const INVALID_INSTANTS: readonly string[] = [
  "",
  "not-a-timestamp",
  "2026-13-45T00:00:00.000Z",
  "0000-00-00T00:00:00Z",
];

const ACTOR_A = { userId: "actor-1", role: "operator", permissions: ["scope.read.a"] } as const;
const ACTOR_B = {
  userId: "actor-3",
  role: "operator",
  permissions: ["scope.read.b", "scope.carry.b"],
} as const;
const TARGET_A = { tenantRef: "tenant-a", actorRef: ACTOR_A };
const TARGET_B = { tenantRef: "tenant-b", actorRef: ACTOR_B };

const ENTRY_A_INPUT = {
  kind: "assembled_package" as const,
  tenantRef: "tenant-a",
  ref: "pkg:tenant-a-alpha",
};
const FOREIGN_ENTRY_INPUT = {
  kind: "cached_scope" as const,
  tenantRef: "tenant-b",
  ref: "scope:tenant-b-smuggled",
};

interface GuardHandle {
  readonly guard: SwitchSafetyRuntimeGuard;
  /** Move the injected clock to an arbitrary instant (manipulation harness). */
  setInstant(instant: string): void;
}

function guardAt(instant: string): GuardHandle {
  let current = instant;
  const guard = new SwitchSafetyRuntimeGuard({ now: () => current });
  return { guard, setInstant: (next: string) => (current = next) };
}

/** Resolve tenant-a and register one derived entry; abort if the fixture broke. */
function resolvedGuardWithEntryA(instant: string = T0): GuardHandle {
  const handle = guardAt(instant);
  const resolved = handle.guard.resolveEpoch(TARGET_A);
  if (!resolved.ok) throw new Error(`fixture: epoch resolution failed (${String(resolved.reason)})`);
  const derived = handle.guard.derive([ENTRY_A_INPUT]);
  if (!derived.ok || derived.admitted.length !== 1) {
    throw new Error("fixture: derived-context registration failed");
  }
  return handle;
}

function firstRegisteredEntryId(guard: SwitchSafetyRuntimeGuard): string {
  const record = guard.auditTrail().find((r) => r.kind === "derived_context_registered");
  if (!record?.entryId) throw new Error("fixture: no registered derived entry");
  return record.entryId;
}

/** Typed lens on a frozen-scope entry — the mutation surface used by F3. */
interface MutableEntryLens {
  tenantRef: string;
  ref: string;
}

function expectDenied(
  outcome: GuardedExecutionOutcome<unknown>,
  reason: string,
): asserts outcome is Extract<GuardedExecutionOutcome<unknown>, { verdict: "denied" }> {
  if (outcome.verdict !== "denied") {
    throw new Error(`expected typed denial "${reason}", got verdict "${outcome.verdict}"`);
  }
  expect(outcome.reason).toBe(reason);
  expect(outcome.scope).toBeNull();
}

function runtimeKinds(guard: SwitchSafetyRuntimeGuard): SwitchSafetyRuntimeAuditRecord["kind"][] {
  return guard.runtimeAuditTrail().map((r) => r.kind);
}

/** Extract the scope the runtime issued for an allowed operation (typed). */
function issuedScopeOrThrow<T>(outcome: GuardedExecutionOutcome<T>): FreshContextScope {
  if (outcome.verdict !== "allowed") {
    throw new Error(`fixture: expected an allowed outcome, got verdict "${outcome.verdict}"`);
  }
  return outcome.scope;
}

/* ─────────────────────────────────────────────────────────────
 * 0. Control — the benign flow the attacks below perturb
 * ────────────────────────────────────────────────────────────*/

describe("control — benign guarded flow", () => {
  it("a declared operation under the current epoch is allowed with an epoch-bound scope", () => {
    const { guard } = resolvedGuardWithEntryA();
    const entryId = firstRegisteredEntryId(guard);
    const outcome = guard.withFreshContext("op.read.package", [entryId], (scope) => {
      expect(scope.tenantRef).toBe("tenant-a");
      return scope.epochId;
    });
    expect(outcome.verdict).toBe("allowed");
    if (outcome.verdict === "allowed") {
      expect(outcome.scope.epochId).toBe(guard.currentEpoch()?.epochId);
      expect(Object.isFrozen(outcome.scope)).toBe(true);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 1. Captured scopes used after a switch
 * ────────────────────────────────────────────────────────────*/

describe("attack: captured scope re-used after a switch", () => {
  it("assertActive() on a captured scope throws StaleContextError after a tenant switch", () => {
    const { guard, setInstant } = resolvedGuardWithEntryA(T0);
    const entryId = firstRegisteredEntryId(guard);
    const captured = issuedScopeOrThrow(guard.withFreshContext("op.capture", [entryId], () => true));

    setInstant(T1);
    const switched = guard.switchTo({ target: TARGET_B });
    expect(switched.applied).toBe(true);

    expect(() => captured.assertActive()).toThrow(StaleContextError);
    try {
      captured.assertActive();
      expect.unreachable("stale scope liveness must throw");
    } catch (error: unknown) {
      expect((error as Error).name).toBe("StaleContextError");
    }
    expect(guard.scopeIsActive(captured)).toBe(false);
    expect(guard.validateScope(captured)).toEqual({
      active: false,
      reason: "scope_epoch_superseded",
    });
  });

  it("captured entryIds are dead after a switch: guarded consumption is typed-denied entry_invalidated", () => {
    const { guard, setInstant } = resolvedGuardWithEntryA(T0);
    const entryId = firstRegisteredEntryId(guard);
    guard.withFreshContext("op.capture", [entryId], () => true);

    setInstant(T1);
    expect(guard.switchTo({ target: TARGET_B }).applied).toBe(true);

    expectDenied(guard.withFreshContext("op.reuse.stale.entry", [entryId], () => "bleed"), "entry_invalidated");
    expect(runtimeKinds(guard)).toContain("runtime_execution_denied_freshness");
  });

  it("the scope snapshot persists but confers no new authority: the guard never accepts an external scope", () => {
    const { guard, setInstant } = resolvedGuardWithEntryA(T0);
    const entryId = firstRegisteredEntryId(guard);
    const snapshot = issuedScopeOrThrow(guard.withFreshContext("op.capture", [entryId], () => true)).entries;

    setInstant(T1);
    guard.switchTo({ target: TARGET_B });

    // The dead scope still carries its (already-authorized) snapshot — the
    // runtime cannot retract memory it already issued — but no guard API
    // accepts a caller-supplied scope as authority, so the snapshot cannot
    // be converted into fresh execution. Enforcement stays internal.
    expect(snapshot.map((e) => e.id)).toContain(entryId);
    const forged = {
      epochId: guard.currentEpoch()?.epochId ?? "",
      tenantRef: "tenant-b",
      issuedAt: T1,
      entries: snapshot,
      assertActive: (): void => undefined,
    } as FreshContextScope;
    // Advisory identity checks read attacker data verbatim — cosmetic only.
    expect(guard.scopeIsActive(forged)).toBe(true);
    // But the enforcement path probes internal state, not the forged scope.
    expectDenied(guard.withFreshContext("op.forged.scope.entry", [entryId], () => "bleed"), "entry_invalidated");
  });

  it("stale-epoch injection at the contract boundary is typed-denied stale_epoch", () => {
    // Build the state independently through the READ-ONLY contract, exactly
    // the way the runtime composes it, then inject a superseded epoch id.
    const initial = initialSwitchSafetyState();
    const resolved = resolveContextEpoch(initial, TARGET_A, { now: T0 });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const staleEpochId = resolved.epoch.epochId;
    const switched = switchContext(resolved.state, { target: TARGET_B }, { now: T1 });
    expect(switched.applied).toBe(true);
    const tenantBState = switched.state;

    const probe = assertFreshContext(
      tenantBState,
      { operation: "op.inject.stale.epoch", epochId: staleEpochId },
      { now: T1 },
    );
    expect(probe.verdict).toBe("denied");
    if (probe.verdict === "denied") {
      expect(probe.reason).toBe("stale_epoch");
    }
    // And an AMBIGUOUS probe (no epoch id at all) fails closed too.
    const ambiguous = assertFreshContext(
      tenantBState,
      { operation: "op.inject.ambiguous" },
      { now: T1 },
    );
    if (ambiguous.verdict === "denied") {
      expect(ambiguous.reason).toBe("ambiguous_epoch");
    }
    expect(switched.epoch?.epochId).not.toBe(staleEpochId);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Stale-epoch callback injection
 * ────────────────────────────────────────────────────────────*/

describe("attack: stale-epoch callback injection", () => {
  it("a callback re-using a captured pre-switch scope fails INSIDE the sandbox and is contained", () => {
    const { guard, setInstant } = resolvedGuardWithEntryA(T0);
    const entryId = firstRegisteredEntryId(guard);
    const staleScope = issuedScopeOrThrow(guard.withFreshContext("op.capture", [entryId], () => true));

    setInstant(T1);
    guard.switchTo({ target: TARGET_B });

    // Register a LEGITIMATE tenant-b entry so the guarded callback actually
    // runs — the stale tenant-a entry alone would be denied before the
    // callback (that containment is pinned separately below).
    const derivedB = guard.derive([
      { kind: "cached_scope" as const, tenantRef: "tenant-b", ref: "scope:tenant-b-legit" },
    ]);
    if (!derivedB.ok || derivedB.admitted.length !== 1) {
      throw new Error("fixture: tenant-b derived-context registration failed");
    }
    const freshEntryId = derivedB.admitted[0].id;
    const outcome = guard.withFreshContext("op.use.stale.scope", [freshEntryId], () => {
      // Hostile callback: consume the stale tenant-a scope under tenant-b.
      staleScope.assertActive();
      return "stale-bleed";
    });
    expect(outcome.verdict).toBe("failed");
    if (outcome.verdict === "failed") {
      expect(outcome.error).toBeInstanceOf(StaleContextError);
      expect(outcome.scope).toBeNull();
    }
    // Containment: the tenant-b epoch remains current; the throw was
    // audited (by name only) and the stale tenant-a entry is not
    // consumable — it was invalidated by the switch.
    expect(guard.currentEpoch()?.tenantRef).toBe("tenant-b");
    expect(runtimeKinds(guard)).toContain("runtime_execution_failed");
    expectDenied(
      guard.withFreshContext("op.post.failed.consume.stale.entry", [entryId], () => "bleed"),
      "entry_invalidated",
    );
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Cross-tenant scope smuggling
 * ────────────────────────────────────────────────────────────*/

describe("attack: cross-tenant scope smuggling", () => {
  it("derived context referencing a foreign tenant is denied at registration", () => {
    const { guard, setInstant } = resolvedGuardWithEntryA(T0);
    const result = guard.derive([FOREIGN_ENTRY_INPUT]);
    expect(result.ok).toBe(true); // per-entry verdicts; the call itself is not an error
    expect(result.admitted).toHaveLength(0);
    expect(result.denied.map((r) => r.kind)).toContain("derived_context_denied_cross_tenant");
    expect(guard.currentEpoch()?.tenantRef).toBe("tenant-a");
  });

  it("a forged grant with a mismatched origin tenant is denied (no policy grant)", () => {
    const { guard, setInstant } = resolvedGuardWithEntryA(T0);
    const entryId = firstRegisteredEntryId(guard);
    setInstant(T1);
    const forged = guard.switchTo({
      target: TARGET_B,
      carryOver: [{ entryId }],
      policyGrants: [
        {
          entryId,
          originTenantRef: "tenant-b", // LIE: entry truth is tenant-a
          targetTenantRef: "tenant-b",
          permission: "scope.read.b",
          policyRef: "policy.forged.origin",
        },
      ],
    });
    expect(forged.applied).toBe(true); // the switch itself is legitimate
    expect(forged.carried).toHaveLength(0);
    expect(forged.invalidated.map((e) => e.id)).toContain(entryId);
    expect(guard.auditTrail().at(-1)?.kind).toBe("switch_applied");
    expect(
      guard
        .auditTrail()
        .some((r) => r.kind === "carry_over_denied_no_policy_grant" && r.entryId === entryId),
    ).toBe(true);
  });

  it("a grant that covers the entry is still outranked by the tenant boundary (carry_over_denied_cross_tenant)", () => {
    const { guard, setInstant } = resolvedGuardWithEntryA(T0);
    const entryId = firstRegisteredEntryId(guard);
    setInstant(T1);
    const result = guard.switchTo({
      target: TARGET_B,
      carryOver: [{ entryId }],
      policyGrants: [
        {
          entryId,
          originTenantRef: "tenant-a",
          targetTenantRef: "tenant-b",
          permission: "scope.read.b",
          policyRef: "policy.boundary.override",
        },
      ],
    });
    expect(result.applied).toBe(true);
    expect(result.carried).toHaveLength(0);
    expect(
      guard
        .auditTrail()
        .some((r) => r.kind === "carry_over_denied_cross_tenant" && r.entryId === entryId),
    ).toBe(true);
    // Constitution §13: the tenant boundary survives a "covering" grant.
    expect(guard.currentEpoch()?.tenantRef).toBe("tenant-b");
    expect(guard.auditTrail().some((r) => r.kind === "derived_context_invalidated")).toBe(true);
  });

  it("a covering grant is worthless when the NEW actor lacks the granted permission", () => {
    // Same-tenant re-auth switch (tenant-a -> tenant-a): this is the only
    // shape where the permission gate is reachable — a cross-tenant carry
    // dies at the tenant boundary first (pinned in the previous test).
    const { guard, setInstant } = resolvedGuardWithEntryA(T0);
    const entryId = firstRegisteredEntryId(guard);
    setInstant(T1);
    const poorActor = { userId: "actor-9", role: "operator", permissions: ["scope.read.other"] };
    const result = guard.switchTo({
      target: { tenantRef: "tenant-a", actorRef: poorActor },
      carryOver: [{ entryId }],
      policyGrants: [
        {
          entryId,
          originTenantRef: "tenant-a",
          targetTenantRef: "tenant-a",
          permission: "scope.carry.a",
          policyRef: "policy.permission.missing",
        },
      ],
    });
    expect(result.applied).toBe(true);
    expect(result.carried).toHaveLength(0);
    expect(
      guard.auditTrail().some((r) => r.kind === "carry_over_denied_permission" && r.entryId === entryId),
    ).toBe(true);
    expect(guard.currentEpoch()?.tenantRef).toBe("tenant-a");
  });

  it("FINDING H3-030-F3 — a tenant-a callback mutates an entry's tenantRef through the shallow-frozen scope and smuggles it into tenant-b, where consumption is ALLOWED", () => {
    const { guard, setInstant } = resolvedGuardWithEntryA(T0);
    const entryId = firstRegisteredEntryId(guard);

    const captured = issuedScopeOrThrow(
      guard.withFreshContext("op.capture.tenant-a", [entryId], () => true),
    );

    // The attack: the scope froze only the array; the entry object is a
    // live reference into the guard's canonical state. Rewrite canonical
    // tenant truth from inside the tenant-a callback.
    const liveEntry = captured.entries[0] as unknown as MutableEntryLens;
    expect(Object.isFrozen(liveEntry)).toBe(false);
    liveEntry.tenantRef = "tenant-b";

    // Now the audited carry-over path sees "consistent" (mutated) truth.
    setInstant(T1);
    const smuggled = guard.switchTo({
      target: TARGET_B,
      carryOver: [{ entryId }],
      policyGrants: [
        {
          entryId,
          originTenantRef: "tenant-b",
          targetTenantRef: "tenant-b",
          permission: "scope.read.b",
          policyRef: "policy.smuggled.mutation",
        },
      ],
    });

    // SMUGGLING SUCCEEDED — the tenant-a entry crossed into tenant-b.
    expect(smuggled.applied).toBe(true);
    expect(smuggled.carried).toHaveLength(1);
    const carriedEntry = smuggled.carried[0];
    expect(carriedEntry.tenantRef).toBe("tenant-b");
    expect(carriedEntry.ref).toBe("pkg:tenant-a-alpha"); // tenant-a material, tenant-b epoch

    // And the smuggled material is CONSUMABLE under tenant-b.
    const outcome = guard.withFreshContext("op.consume.smuggled", [carriedEntry.id], (scope) => {
      expect(scope.tenantRef).toBe("tenant-b");
      return scope.entries.map((e) => e.ref);
    });
    expect(outcome.verdict).toBe("allowed");
    if (outcome.verdict === "allowed") {
      expect(outcome.value).toContain("pkg:tenant-a-alpha");
    }
    // FINDING H3-030-F3 recorded: Constitution §13 bypass via shallow-frozen
    // scope + mutated canonical entry truth. NOT fixed here (ownership B-013).
  });

  it("FINDING H3-030-F5 — withFreshContext issues a scope exposing ALL active derived entries, including ones the operation never declared", () => {
    const { guard, setInstant } = resolvedGuardWithEntryA(T0);
    const entryId = firstRegisteredEntryId(guard);
    guard.derive([
      { kind: "cached_scope", tenantRef: "tenant-a", ref: "scope:undeclared-neighbor" },
    ]);

    const outcome = guard.withFreshContext("op.declares.nothing", [], (scope) => scope.entries.length);
    expect(outcome.verdict).toBe("allowed");
    if (outcome.verdict === "allowed") {
      // The operation declared NO entries (nothing probed) yet received
      // every active derived entry — least-privilege violation; this is
      // also the natural delivery vehicle for the F3 mutation attack.
      expect(outcome.value).toBeGreaterThanOrEqual(2);
      expect(outcome.scope.entries.map((e) => e.id)).toContain(entryId);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. Clock manipulation
 * ────────────────────────────────────────────────────────────*/

describe("attack: clock manipulation", () => {
  it("every operation fails closed with a typed invalid_clock denial under a broken clock", () => {
    for (const broken of INVALID_INSTANTS) {
      const { guard } = guardAt(broken);
      const resolution = guard.resolveEpoch(TARGET_A);
      expect(resolution.ok).toBe(false);
      if (!resolution.ok) expect(resolution.reason).toBe("invalid_clock");
      const derived = guard.derive([ENTRY_A_INPUT]);
      expect(derived.ok).toBe(false);
      expect(guard.currentEpoch()).toBeNull();
      const switched = guard.switchTo({ target: TARGET_A });
      expect(switched.applied).toBe(false);
      expect(switched.reason).toBe("invalid_clock");
      expectDenied(guard.withFreshContext("op.under.broken.clock", [], () => "x"), "invalid_clock");
      expect(runtimeKinds(guard)).toContain("runtime_guard_denied_invalid_clock");
    }
  });

  it("a clock that turns invalid mid-session strands nothing: prior epoch survives every denial", () => {
    const { guard, setInstant } = resolvedGuardWithEntryA(T0);
    const entryId = firstRegisteredEntryId(guard);
    const epochBefore = guard.currentEpoch();

    setInstant("garbage-after-t1");
    const derived = guard.derive([ENTRY_A_INPUT]);
    expect(derived.ok).toBe(false);
    const switched = guard.switchTo({ target: TARGET_B });
    expect(switched.applied).toBe(false);
    expect(switched.reason).toBe("invalid_clock");
    expectDenied(guard.withFreshContext("op.mid.session", [entryId], () => "x"), "invalid_clock");

    // No half-state: the epoch and derived set are exactly as before.
    expect(guard.currentEpoch()).toEqual(epochBefore);
    expectDenied(guard.withFreshContext("op.recovery", [entryId], () => "x"), "invalid_clock");
  });

  it("FINDING H3-030-F1 — replaying the original resolution instant while switching back resurrects the dead epoch id and forges scope liveness", () => {
    const { guard, setInstant } = resolvedGuardWithEntryA(T1);
    const entryId = firstRegisteredEntryId(guard);
    const originalEpochId = guard.currentEpoch()?.epochId ?? "";

    const captured = issuedScopeOrThrow(
      guard.withFreshContext("op.capture.original", [entryId], () => true),
    );

    // Switch away to tenant-b at a later instant.
    setInstant(T2);
    expect(guard.switchTo({ target: TARGET_B }).applied).toBe(true);
    expect(() => captured.assertActive()).toThrow(StaleContextError);

    // THE ATTACK: manipulate the clock back to the ORIGINAL instant and
    // switch to the identical tenant-a target. The epoch id is FNV-1a over
    // tenant|userId|role|now — the replay mints a NEW epoch with the SAME id.
    setInstant(T1);
    const replayed = guard.switchTo({ target: TARGET_A });
    expect(replayed.applied).toBe(true);
    expect(replayed.epoch?.epochId).toBe(originalEpochId);

    // LIVENESS FORGED: the pre-switch scope now "passes" again.
    expect(guard.scopeIsActive(captured)).toBe(true);
    expect(guard.validateScope(captured)).toEqual({ active: true });
    expect(() => captured.assertActive()).not.toThrow();

    // Containment that STILL holds: consumption of the stale entry is
    // denied (the replayed epoch's derived set does not contain it).
    expectDenied(guard.withFreshContext("op.consume.replayed.entry", [entryId], () => "bleed"), "entry_invalidated");
    // FINDING H3-030-F1 recorded: epoch identity is replayable via the
    // injected clock; scope liveness checks are fooled across a tenant-b
    // interlude. NOT fixed here (ownership B-013).
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. Forged audit entries
 * ────────────────────────────────────────────────────────────*/

describe("attack: forged audit entries", () => {
  it("FINDING H3-030-F2 — both ledgers are live mutable arrays: forged records can be appended and honest records rewritten", () => {
    const { guard, setInstant } = resolvedGuardWithEntryA(T0);
    const runtimeTrail = guard.runtimeAuditTrail();
    const contractTrail = guard.auditTrail();

    // Evidence: neither view is runtime-frozen.
    expect(Object.isFrozen(runtimeTrail)).toBe(false);
    expect(Object.isFrozen(contractTrail)).toBe(false);

    const forgedRuntime: SwitchSafetyRuntimeAuditRecord = {
      id: "forged-runtime-record",
      kind: "runtime_execution_completed",
      detail: "FABRICATED: nothing was executed",
      recordedAt: T0,
      epochId: guard.currentEpoch()?.epochId ?? null,
      entryIds: [],
    };
    (runtimeTrail as unknown as SwitchSafetyRuntimeAuditRecord[]).push(forgedRuntime);
    expect(guard.runtimeAuditTrail().at(-1)?.id).toBe("forged-runtime-record");

    const forgedContract: SwitchSafetyAuditRecord = {
      id: "forged-contract-record",
      kind: "switch_applied",
      detail: "FABRICATED: no switch happened",
      recordedAt: T0,
      epochId: null,
      entryId: null,
      tenantRef: null,
      policyRef: null,
      permission: null,
    };
    (contractTrail as unknown as SwitchSafetyAuditRecord[]).push(forgedContract);
    expect(guard.auditTrail().at(-1)?.id).toBe("forged-contract-record");

    // And an honest record can be rewritten in place.
    const victim = guard.runtimeAuditTrail()[0] as unknown as { detail: string };
    const originalDetail = victim.detail;
    victim.detail = "TAMPERED";
    expect(guard.runtimeAuditTrail()[0].detail).toBe("TAMPERED");
    expect(originalDetail).not.toBe("TAMPERED");
    // FINDING H3-030-F2 recorded: §29 append-only is type-level only; an
    // in-process hostile holder can forge/tamper audit evidence. NOT fixed
    // here (ownership B-013).
  });

  it("FINDING H3-030-F4 — attacker-controlled operation text flows verbatim into audit detail (log forging)", () => {
    const { guard, setInstant } = resolvedGuardWithEntryA(T0);
    const entryId = firstRegisteredEntryId(guard);
    const hostileOperation = 'op.read\nFAKE audit: switch_applied tenant "tenant-b" granted root';
    const outcome = guard.withFreshContext(hostileOperation, [entryId], () => "value");
    expect(outcome.verdict).toBe("allowed");
    const issued = guard
      .runtimeAuditTrail()
      .find((r) => r.kind === "runtime_scope_issued");
    expect(issued?.detail).toContain(hostileOperation);
    // FINDING H3-030-F4 recorded: the Zod boundary validates only
    // non-emptiness; unsanitized attacker text lands in the audit
    // narrative, defeating single-line log integrity. NOT fixed here.
  });
});

/* ─────────────────────────────────────────────────────────────
 * 6. Callback-throw containment escape
 * ────────────────────────────────────────────────────────────*/

describe("attack: callback-throw containment escape", () => {
  it("an Error throw is contained: typed failed verdict, epoch intact, message NEVER recorded", () => {
    const { guard, setInstant } = resolvedGuardWithEntryA(T0);
    const entryId = firstRegisteredEntryId(guard);
    const secretMessage = "payload-should-never-reach-the-ledger";
    const outcome = guard.withFreshContext("op.throwing", [entryId], () => {
      throw new Error(secretMessage);
    });
    expect(outcome.verdict).toBe("failed");
    if (outcome.verdict === "failed") {
      expect(outcome.error).toBeInstanceOf(Error);
      expect(outcome.scope).toBeNull();
    }
    expect(guard.currentEpoch()?.tenantRef).toBe("tenant-a");
    const failure = guard.runtimeAuditTrail().find((r) => r.kind === "runtime_execution_failed");
    expect(failure?.detail).toContain('"Error"');
    expect(JSON.stringify(guard.runtimeAuditTrail())).not.toContain(secretMessage);
    // The epoch stays usable for the NEXT operation.
    const next = guard.withFreshContext("op.after.failure", [entryId], () => "ok");
    expect(next.verdict).toBe("allowed");
  });

  it("non-Error throws (string and object payloads) are contained as non_error_throw with no payload leakage", () => {
    const { guard, setInstant } = resolvedGuardWithEntryA(T0);
    const entryId = firstRegisteredEntryId(guard);

    const stringThrow = guard.withFreshContext("op.throw.string", [entryId], () => {
      throw "raw-string-payload";
    });
    expect(stringThrow.verdict).toBe("failed");
    expect(JSON.stringify(guard.runtimeAuditTrail())).not.toContain("raw-string-payload");

    const objectThrow = guard.withFreshContext("op.throw.object", [entryId], () => {
      throw { exfiltrated: "object-payload" };
    });
    expect(objectThrow.verdict).toBe("failed");
    expect(JSON.stringify(guard.runtimeAuditTrail())).not.toContain("object-payload");
    const names = guard
      .runtimeAuditTrail()
      .filter((r) => r.kind === "runtime_execution_failed")
      .map((r) => r.detail);
    expect(names.some((d) => d.includes("non_error_throw"))).toBe(true);
  });

  it("a hostile callback cannot mutate guard state through the frozen scope (assignment throws; tenant unchanged)", () => {
    const { guard, setInstant } = resolvedGuardWithEntryA(T0);
    const entryId = firstRegisteredEntryId(guard);
    const outcome = guard.withFreshContext("op.scope.mutation", [entryId], (scope) => {
      "use strict";
      const tampered = scope as unknown as { tenantRef: string };
      expect(() => {
        tampered.tenantRef = "tenant-b";
      }).toThrow(TypeError);
      expect(() => {
        (scope.entries as unknown as DerivedContextEntry[]).push({
          id: "forged-entry",
          kind: "resolved_tenant",
          tenantRef: "tenant-b",
          derivedUnderEpochId: scope.epochId,
          derivedAt: T0,
          ref: "scope:forged",
        });
      }).toThrow(TypeError);
      return "no-escape";
    });
    expect(outcome.verdict).toBe("allowed");
    expect(guard.currentEpoch()?.tenantRef).toBe("tenant-a");
  });

  it("a callback that switches tenants mid-flight is contained: its own switch stands, the outer scope goes dead, the epoch does not strand", () => {
    const { guard, setInstant } = resolvedGuardWithEntryA(T0);
    const entryId = firstRegisteredEntryId(guard);
    const outcome = guard.withFreshContext("op.reentrant.switch", [entryId], (scope) => {
      setInstant(T1);
      const inner = guard.switchTo({ target: TARGET_B });
      expect(inner.applied).toBe(true);
      return "switched-inside";
    });
    // The callback succeeded and its switch is the committed reality.
    expect(outcome.verdict).toBe("allowed");
    expect(guard.currentEpoch()?.tenantRef).toBe("tenant-b");
    // But the outer scope is dead — no stale-context stranding.
    const outerScope = issuedScopeOrThrow(outcome);
    expect(guard.scopeIsActive(outerScope)).toBe(false);
    expect(() => outerScope.assertActive()).toThrow(StaleContextError);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 7. Zod-boundary bypass attempts
 * ────────────────────────────────────────────────────────────*/

describe("attack: Zod-boundary bypass", () => {
  it("malformed epoch-resolution targets are typed-rejected without touching state", () => {
    const malformedTargets: readonly unknown[] = [
      { tenantRef: "", actorRef: ACTOR_A },
      { tenantRef: "tenant-a" },
      { tenantRef: "tenant-a", actorRef: { userId: "", role: "operator", permissions: [] } },
      { tenantRef: "tenant-a", actorRef: { userId: "actor-1", role: "operator", permissions: "root" } },
      null,
      "tenant-a",
    ];
    for (const hostile of malformedTargets) {
      const { guard } = guardAt(T0);
      const result = guard.resolveEpoch(hostile as Parameters<SwitchSafetyRuntimeGuard["resolveEpoch"]>[0]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("invalid_target");
      expect(guard.currentEpoch()).toBeNull();
      expect(runtimeKinds(guard)).toContain("runtime_input_rejected");
    }
  });

  it("forged extra fields at the boundary are stripped and can never reach the contract", () => {
    const { guard } = guardAt(T0);
    const forged = {
      ...TARGET_A,
      epochId: "forged-epoch-id",
      permissions: ["*"],
      resolved: true,
    } as Parameters<SwitchSafetyRuntimeGuard["resolveEpoch"]>[0];
    const result = guard.resolveEpoch(forged);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The minted epoch derives ONLY from the schema-admitted fields.
      expect(result.epoch.tenantRef).toBe("tenant-a");
      expect(result.epoch.actorRef.permissions).toEqual(["scope.read.a"]);
      expect(Object.keys(result.epoch)).toEqual(
        expect.arrayContaining(["epochId", "tenantRef", "actorRef", "resolvedAt", "traceId"]),
      );
    }
  });

  it("a switch request with a schema-invalid grant fails the WHOLE switch closed", () => {
    const { guard, setInstant } = resolvedGuardWithEntryA(T0);
    const entryId = firstRegisteredEntryId(guard);
    const epochBefore = guard.currentEpoch();
    const result = guard.switchTo({
      target: TARGET_B,
      carryOver: [{ entryId }],
      policyGrants: [
        {
          entryId,
          originTenantRef: "tenant-a",
          targetTenantRef: "tenant-b",
          permission: "", // schema-invalid: empty permission
          policyRef: "policy.empty.permission",
        },
      ] as Parameters<SwitchSafetyRuntimeGuard["switchTo"]>[0]["policyGrants"],
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("invalid_target");
    expect(guard.currentEpoch()).toEqual(epochBefore);
    expect(runtimeKinds(guard)).toContain("runtime_input_rejected");
  });

  it("carry-over items cannot smuggle authority fields past the boundary schema", () => {
    const { guard, setInstant } = resolvedGuardWithEntryA(T0);
    const entryId = firstRegisteredEntryId(guard);
    const result = guard.switchTo({
      target: TARGET_B,
      carryOver: [
        { entryId, permission: "*", policyRef: "self-granted", originTenantRef: "tenant-a" },
      ] as unknown as Parameters<SwitchSafetyRuntimeGuard["switchTo"]>[0]["carryOver"],
      policyGrants: [],
    });
    // The forged per-item fields are stripped; without a REAL grant the
    // carry is denied and the entry invalidated.
    expect(result.applied).toBe(true);
    expect(result.carried).toHaveLength(0);
    expect(
      guard.auditTrail().some((r) => r.kind === "carry_over_denied_no_policy_grant" && r.entryId === entryId),
    ).toBe(true);
  });

  it("derived-context registration with an invalid kind enum is rejected wholesale", () => {
    const { guard, setInstant } = resolvedGuardWithEntryA(T0);
    const before = guard.runtimeAuditTrail().length;
    const result = guard.derive([
      { kind: "root_kernel_bypass" as unknown as "assembled_package", tenantRef: "tenant-a", ref: "pkg:bypass" },
    ]);
    expect(result.ok).toBe(false);
    expect(result.admitted).toHaveLength(0);
    expect(guard.runtimeAuditTrail().length).toBeGreaterThan(before);
    expect(runtimeKinds(guard)).toContain("runtime_input_rejected");
  });

  it("guarded operations reject empty operation names and type-confused entry id lists", () => {
    const { guard, setInstant } = resolvedGuardWithEntryA(T0);
    const entryId = firstRegisteredEntryId(guard);

    expectDenied(guard.withFreshContext("", [entryId], () => "x"), "invalid_input");
    expectDenied(
      guard.withFreshContext("op.confused", null as unknown as readonly string[], () => "x"),
      "invalid_input",
    );
    expectDenied(
      guard.withFreshContext("op.confused", [42 as unknown as string], () => "x"),
      "invalid_input",
    );
    expectDenied(
      guard.withFreshContext(1337 as unknown as string, [entryId], () => "x"),
      "invalid_input",
    );
    // An operation BEFORE any epoch resolution is typed-denied too.
    const freshGuard = guardAt(T0).guard;
    expectDenied(freshGuard.withFreshContext("op.premature", [], () => "x"), "no_resolved_epoch");
  });
});