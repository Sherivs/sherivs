/**
 * CoreGrid — reliability idempotency contract tests (J-030 / MISSION H2-18).
 * Caller-supplied idempotency keys on consequential commands: key binding,
 * recorded-outcome replay, tenant-scoped denial (cross-tenant replay is a
 * DENIAL, not a hit), and §12 audit provenance on every decision. §31.
 */
import { describe, expect, it } from "vitest";
import {
  appendAudit,
  bindCallerKey,
  canonicalJson,
  executeIdempotent,
  InMemoryIdempotencyStore,
  payloadDigest,
  type CommandOutcome,
  type ConsequentialCommand,
} from "../../frontend/src/lib/reliability/idempotency";

const NOW = "2026-10-02T20:00:00.000Z";

function command(overrides: Partial<ConsequentialCommand> = {}): ConsequentialCommand {
  return {
    callerKey: "key-0001",
    operationClass: "payment.capture",
    tenantId: "tenant-a",
    actorId: "actor-1",
    payload: { amount: 1000, currency: "ZAR" },
    ...overrides,
  };
}

function outcome(status: "succeeded" | "failed" = "succeeded"): CommandOutcome {
  return { status, reason: status === "succeeded" ? null : "provider_declined", responseRef: "resp_0001" };
}

/** Executor spy: counts invocations so tests can prove no re-execution. */
function spyingExecutor(result: CommandOutcome = outcome()) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    run: (): CommandOutcome => {
      calls += 1;
      return result;
    },
  };
}

describe("bindCallerKey (key derivation)", () => {
  it("binds the caller key to operation class + tenant deterministically", () => {
    const first = bindCallerKey({
      callerKey: "abc",
      operationClass: "payment.capture",
      tenantId: "tenant-a",
    });
    const second = bindCallerKey({
      callerKey: "abc",
      operationClass: "payment.capture",
      tenantId: "tenant-a",
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.key).toBe(second.key);
      expect(first.key).toBe(`idem:payment.capture:tenant-a:${first.callerKeyDigest}`);
      expect(first.callerKeyDigest).toBe(second.callerKeyDigest);
    }
  });

  it("scopes the same caller key differently per tenant and per class", () => {
    const a = bindCallerKey({ callerKey: "abc", operationClass: "payment.capture", tenantId: "tenant-a" });
    const b = bindCallerKey({ callerKey: "abc", operationClass: "payment.capture", tenantId: "tenant-b" });
    const c = bindCallerKey({ callerKey: "abc", operationClass: "payment.refund", tenantId: "tenant-a" });
    if (a.ok && b.ok && c.ok) {
      expect(a.key).not.toBe(b.key);
      expect(a.key).not.toBe(c.key);
    }
  });

  it("never regenerates a missing or blank caller key", () => {
    const blank = bindCallerKey({ callerKey: "   ", operationClass: "payment.capture", tenantId: "tenant-a" });
    expect(blank).toEqual({ ok: false, reason: "caller_key_required" });

    const noClass = bindCallerKey({ callerKey: "abc", operationClass: "", tenantId: "tenant-a" });
    expect(noClass).toEqual({ ok: false, reason: "operation_class_required" });

    const noTenant = bindCallerKey({ callerKey: "abc", operationClass: "payment.capture", tenantId: " " });
    expect(noTenant).toEqual({ ok: false, reason: "tenant_required" });
  });

  it("does not normalize the raw caller key (whitespace is significant)", () => {
    const raw = bindCallerKey({ callerKey: "abc", operationClass: "c", tenantId: "t" });
    const padded = bindCallerKey({ callerKey: "  abc", operationClass: "c", tenantId: "t" });
    if (raw.ok && padded.ok) {
      expect(raw.callerKeyDigest).not.toBe(padded.callerKeyDigest);
    }
  });
});

describe("payload fingerprinting", () => {
  it("is order-independent for objects and order-preserving for arrays", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(payloadDigest({ b: 1, a: 2 })).toBe(payloadDigest({ a: 2, b: 1 }));
  });
});

describe("executeIdempotent (first execution)", () => {
  it("executes once, records the outcome, and marks the effect applied", () => {
    const store = new InMemoryIdempotencyStore();
    const exec = spyingExecutor();
    const result = executeIdempotent(store, command(), NOW, exec.run);

    expect(result.kind).toBe("executed");
    if (result.kind === "executed") {
      expect(exec.calls).toBe(1);
      expect(result.result).toEqual({ ...outcome(), externalEffect: "applied" });
      expect(result.record.tenantId).toBe("tenant-a");
      expect(result.record.operationClass).toBe("payment.capture");
      expect(result.record.payloadDigest).toBe(payloadDigest({ amount: 1000, currency: "ZAR" }));
      expect(result.record.recordedAt).toBe(NOW);
      expect(store.get(result.record.callerKeyDigest)).not.toBeNull();
    }
  });

  it("fails closed on invalid commands without invoking the executor", () => {
    const store = new InMemoryIdempotencyStore();
    const exec = spyingExecutor();

    for (const bad of [
      command({ callerKey: "" }),
      command({ callerKey: "  " }),
      command({ operationClass: " " }),
      command({ tenantId: "" }),
      command({ actorId: " " }),
    ]) {
      const result = executeIdempotent(store, bad, NOW, exec.run);
      expect(result.kind).toBe("rejected");
      if (result.kind === "rejected") expect(result.reason).toBe("invalid_command");
    }
    expect(exec.calls).toBe(0);
  });
});

describe("executeIdempotent (replay semantics)", () => {
  it("replays the recorded original outcome and never re-executes", () => {
    const store = new InMemoryIdempotencyStore();
    const first = executeIdempotent(store, command(), NOW, () => outcome());
    const exec = spyingExecutor(outcome("failed"));
    const replay = executeIdempotent(store, command(), "2026-10-02T20:05:00.000Z", exec.run);

    expect(first.kind).toBe("executed");
    expect(exec.calls).toBe(0);
    expect(replay.kind).toBe("replayed");
    if (first.kind === "executed" && replay.kind === "replayed") {
      expect(replay.record).toBe(first.record);
      expect(replay.result).toEqual({
        status: "succeeded",
        reason: null,
        responseRef: "resp_0001",
        externalEffect: "none",
      });
    }
  });

  it("replays a recorded FAILURE verbatim — the outcome is authoritative", () => {
    const store = new InMemoryIdempotencyStore();
    executeIdempotent(store, command(), NOW, () => outcome("failed"));
    const replay = executeIdempotent(store, command(), "2026-10-02T20:05:00.000Z", spyingExecutor().run);
    expect(replay.kind).toBe("replayed");
    if (replay.kind === "replayed") {
      expect(replay.result.status).toBe("failed");
      expect(replay.result.reason).toBe("provider_declined");
      expect(replay.result.externalEffect).toBe("none");
    }
  });

  it("denies a different payload under the same key instead of re-executing", () => {
    const store = new InMemoryIdempotencyStore();
    executeIdempotent(store, command(), NOW, () => outcome());
    const exec = spyingExecutor();
    const result = executeIdempotent(store, command({ payload: { amount: 9999, currency: "ZAR" } }), NOW, exec.run);

    expect(exec.calls).toBe(0);
    expect(result.kind).toBe("denied");
    if (result.kind === "denied") expect(result.reason).toBe("payload_mismatch");
  });
});

describe("executeIdempotent (scope rules)", () => {
  it("DENIES the same caller key replayed across tenants — never a hit", () => {
    const store = new InMemoryIdempotencyStore();
    executeIdempotent(store, command({ tenantId: "tenant-a" }), NOW, () => outcome());

    const exec = spyingExecutor();
    const intruding = executeIdempotent(
      store,
      command({ tenantId: "tenant-b" }),
      "2026-10-02T20:05:00.000Z",
      exec.run,
    );

    expect(exec.calls).toBe(0);
    expect(intruding.kind).toBe("denied");
    if (intruding.kind === "denied") {
      expect(intruding.reason).toBe("cross_tenant");
      expect(intruding.audit.decision).toBe("denied");
      expect(intruding.audit.tenantId).toBe("tenant-b");
      expect(intruding.audit.externalEffect).toBe("none");
    }
  });

  it("does not leak the other tenant's record through the denial", () => {
    const store = new InMemoryIdempotencyStore();
    executeIdempotent(store, command({ tenantId: "tenant-a" }), NOW, () => outcome());
    const intruding = executeIdempotent(store, command({ tenantId: "tenant-b" }), NOW, spyingExecutor().run);
    expect(intruding.kind).toBe("denied");
    expect(intruding).not.toHaveProperty("record");
    expect(intruding).not.toHaveProperty("result");
  });

  it("denies the same caller key across operation classes in the same tenant", () => {
    const store = new InMemoryIdempotencyStore();
    executeIdempotent(store, command({ operationClass: "payment.capture" }), NOW, () => outcome());
    const exec = spyingExecutor();
    const result = executeIdempotent(
      store,
      command({ operationClass: "payment.refund" }),
      NOW,
      exec.run,
    );
    expect(exec.calls).toBe(0);
    expect(result.kind).toBe("denied");
    if (result.kind === "denied") expect(result.reason).toBe("cross_operation_class");
  });

  it("executes independently for distinct caller keys in the same tenant", () => {
    const store = new InMemoryIdempotencyStore();
    const exec = spyingExecutor();
    executeIdempotent(store, command({ callerKey: "key-1" }), NOW, exec.run);
    const second = executeIdempotent(store, command({ callerKey: "key-2" }), NOW, exec.run);
    expect(exec.calls).toBe(2);
    expect(second.kind).toBe("executed");
  });

  it("mutates the store only on first execution (replays and denials are pure)", () => {
    const store = new InMemoryIdempotencyStore();
    const first = executeIdempotent(store, command(), NOW, () => outcome());
    expect(first.kind).toBe("executed");
    if (first.kind !== "executed") return;
    const snapshot = store.get(first.record.callerKeyDigest);

    executeIdempotent(store, command(), NOW, spyingExecutor().run);
    executeIdempotent(store, command({ tenantId: "tenant-b" }), NOW, spyingExecutor().run);
    executeIdempotent(store, command({ payload: { different: true } }), NOW, spyingExecutor().run);
    expect(store.get(first.record.callerKeyDigest)).toEqual(snapshot);
  });
});

describe("audit (§12 provenance on every decision)", () => {
  it("carries a provenance-bearing audit entry for every decision kind", () => {
    const store = new InMemoryIdempotencyStore();
    const exec = spyingExecutor();

    const executed = executeIdempotent(store, command(), NOW, exec.run);
    const replayed = executeIdempotent(store, command(), NOW, exec.run);
    const denied = executeIdempotent(store, command({ tenantId: "tenant-b" }), NOW, exec.run);
    const rejected = executeIdempotent(store, command({ callerKey: "" }), NOW, exec.run);

    for (const decision of [executed, replayed, denied, rejected]) {
      expect(decision.audit.at).toBe(NOW);
      expect(decision.audit.externalEffect).toBe(decision.kind === "executed" ? "applied" : "none");
    }
    if (executed.kind === "executed") {
      expect(executed.audit).toMatchObject({
        decision: "executed",
        actorId: "actor-1",
        tenantId: "tenant-a",
        operationClass: "payment.capture",
        reason: "first_execution",
      });
      expect(executed.audit.key).toBe(executed.record.key);
    }
    expect(replayed.audit.decision).toBe("replayed");
    expect(denied.audit.decision).toBe("denied");
    expect(rejected.audit.decision).toBe("rejected");
    expect(rejected.audit.key).toBe("");
    expect(exec.calls).toBe(1);
  });

  it("appendAudit is append-only and never mutates the input trail", () => {
    const store = new InMemoryIdempotencyStore();
    const first = executeIdempotent(store, command(), NOW, () => outcome());
    const trail: ReturnType<typeof appendAudit> = [];
    const one = appendAudit(trail, first.audit);
    const two = appendAudit(one, first.audit);
    expect(trail).toHaveLength(0);
    expect(one).toHaveLength(1);
    expect(two).toHaveLength(2);
    expect(two[0]).toBe(first.audit);
  });
});

/* The store's scope-independent index is obtained through the module's own
 * binding, never reimplemented in tests. */