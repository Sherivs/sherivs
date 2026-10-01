/**
 * CoreGrid — platform-wide command idempotency contract tests
 * (J-030 / V1CAP-054).
 *
 * Validates exactly-once replay, collision rejection, TTL expiry,
 * key derivation determinism, registration rejection of non-idempotent
 * consequential commands, and tenant/actor scoping of keys.
 */

import { describe, expect, it } from "vitest";
import {
  InMemoryIdempotencyStore,
  canonicalJson,
  deriveIdempotencyKey,
  executeIdempotent,
  payloadDigest,
  registerConsequentialCommand,
  type IdempotentExecutionResult,
} from "@/lib/command/idempotency";

const NOW = "2026-10-01T00:00:00.000Z";
const TTL_MS = 60_000;

function iso(offsetMs: number): string {
  return new Date(Date.parse(NOW) + offsetMs).toISOString();
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    key: "idem:enrollment:actor-1:<digest>",
    scope: "enrollment",
    actorId: "actor-1",
    intent: "enroll-student",
    payload: { studentId: "s-1", term: "term-1" },
    recordTtlMs: TTL_MS,
    ...overrides,
  };
}

function okExecution(responseRef: string): IdempotentExecutionResult {
  return {
    status: "succeeded",
    reason: null,
    externalEffect: "recorded_intent",
    responseRef,
  };
}

describe("key derivation", () => {
  it("derives identical keys for identical commands", () => {
    const a = deriveIdempotencyKey({
      scope: "enrollment",
      actorId: "actor-1",
      intent: "enroll-student",
      payload: { studentId: "s-1", term: "term-1" },
    });
    const b = deriveIdempotencyKey({
      scope: "enrollment",
      actorId: "actor-1",
      intent: "enroll-student",
      payload: { term: "term-1", studentId: "s-1" },
    });
    expect(a).toBe(b);
  });

  it("derives different keys for different actors, scopes, or payloads", () => {
    const base = deriveIdempotencyKey({
      scope: "enrollment",
      actorId: "actor-1",
      intent: "enroll-student",
      payload: { studentId: "s-1" },
    });
    const otherActor = deriveIdempotencyKey({
      scope: "enrollment",
      actorId: "actor-2",
      intent: "enroll-student",
      payload: { studentId: "s-1" },
    });
    const otherPayload = deriveIdempotencyKey({
      scope: "enrollment",
      actorId: "actor-1",
      intent: "enroll-student",
      payload: { studentId: "s-2" },
    });
    const otherIntent = deriveIdempotencyKey({
      scope: "enrollment",
      actorId: "actor-1",
      intent: "expel-student",
      payload: { studentId: "s-1" },
    });
    expect(new Set([base, otherActor, otherPayload, otherIntent]).size).toBe(4);
  });

  it("canonicalizes nested payloads order-independently", () => {
    expect(canonicalJson({ a: 1, b: { c: 2, d: [1, 2] } })).toBe(
      canonicalJson({ b: { d: [1, 2], c: 2 }, a: 1 }),
    );
    expect(payloadDigest({ x: "1" })).not.toBe(payloadDigest({ x: 1 }));
  });
});

describe("command registration", () => {
  it("accepts a consequential command with mandatory idempotency", () => {
    const result = registerConsequentialCommand({
      intent: "enroll-student",
      scope: "enrollment",
      consequential: true,
      idempotency: { required: true },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a consequential command without mandatory idempotency", () => {
    const result = registerConsequentialCommand({
      intent: "enroll-student",
      scope: "enrollment",
      consequential: true,
      idempotency: { required: false },
    });
    expect(result).toEqual({ ok: false, reason: "idempotency_key_required" });
  });

  it("rejects malformed definitions", () => {
    const result = registerConsequentialCommand({
      intent: "  ",
      scope: "enrollment",
      consequential: false,
      idempotency: { required: false },
    });
    expect(result).toEqual({ ok: false, reason: "invalid_definition" });
  });
});

describe("exactly-once semantics", () => {
  it("executes once and replays the recorded outcome on retry", () => {
    const store = new InMemoryIdempotencyStore();
    let executions = 0;
    const run = (): IdempotentExecutionResult => {
      executions += 1;
      return okExecution("resp-1");
    };
    const cmd = command();

    const first = executeIdempotent(store, cmd, NOW, run);
    expect(first.kind).toBe("executed");
    if (first.kind === "executed") {
      expect(first.result.externalEffect).toBe("recorded_intent");
      expect(first.result.responseRef).toBe("resp-1");
      expect(first.record.envelope.scope).toBe("enrollment");
      expect(first.record.envelope.intent).toBe("enroll-student");
    }

    const retry = executeIdempotent(store, cmd, iso(1_000), run);
    expect(retry.kind).toBe("replayed");
    if (retry.kind === "replayed") {
      expect(retry.result.responseRef).toBe("resp-1");
      expect(retry.result.externalEffect).toBe("none");
    }
    expect(executions).toBe(1);
  });

  it("rejects same key with different payload as a collision", () => {
    const store = new InMemoryIdempotencyStore();
    let executions = 0;
    const run = (): IdempotentExecutionResult => {
      executions += 1;
      return okExecution("resp-1");
    };

    const cmd = command();
    const first = executeIdempotent(store, cmd, NOW, run);
    expect(first.kind).toBe("executed");

    const collision = executeIdempotent(
      store,
      command({ payload: { studentId: "s-1", term: "term-2" } }),
      iso(1_000),
      run,
    );
    expect(collision.kind).toBe("collision");
    if (collision.kind === "collision") {
      expect(collision.key).toBe(cmd.key);
      expect(collision.recordedPayloadDigest).not.toBe(collision.incomingPayloadDigest);
    }
    expect(executions).toBe(1);
  });

  it("keys are scoped: same payload under a different key executes separately", () => {
    const store = new InMemoryIdempotencyStore();
    let executions = 0;
    const run = (): IdempotentExecutionResult => {
      executions += 1;
      return okExecution(`resp-${executions}`);
    };
    const first = executeIdempotent(
      store,
      command({ key: "idem:enrollment:actor-1:aaa" }),
      NOW,
      run,
    );
    const second = executeIdempotent(
      store,
      command({ key: "idem:enrollment:actor-1:bbb" }),
      NOW,
      run,
    );
    expect(first.kind).toBe("executed");
    expect(second.kind).toBe("executed");
    expect(executions).toBe(2);
  });

  it("rejects malformed commands", () => {
    const store = new InMemoryIdempotencyStore();
    const run = (): IdempotentExecutionResult => okExecution("x");
    expect(executeIdempotent(store, command({ key: "  " }), NOW, run).kind).toBe("rejected");
    expect(executeIdempotent(store, command({ recordTtlMs: 0 }), NOW, run).kind).toBe("rejected");
    expect(executeIdempotent(store, command({ actorId: "" }), NOW, run).kind).toBe("rejected");
  });
});

describe("TTL expiry of idempotency records", () => {
  it("stops replaying once the record expires and re-executes fresh", () => {
    const store = new InMemoryIdempotencyStore();
    let executions = 0;
    const run = (): IdempotentExecutionResult => {
      executions += 1;
      return okExecution(`resp-${executions}`);
    };
    const cmd = command();

    const first = executeIdempotent(store, cmd, NOW, run);
    expect(first.kind).toBe("executed");

    // Within TTL: replay.
    const withinTtl = executeIdempotent(store, cmd, iso(TTL_MS - 1), run);
    expect(withinTtl.kind).toBe("replayed");
    expect(executions).toBe(1);

    // Past TTL: the record is dead (fail-safe); the key is freed and the
    // command re-executes fresh with a new record.
    const afterTtl = executeIdempotent(store, cmd, iso(TTL_MS + 1), run);
    expect(afterTtl.kind).toBe("executed");
    expect(executions).toBe(2);
    if (afterTtl.kind === "executed") {
      expect(afterTtl.record.createdAt).toBe(iso(TTL_MS + 1));
      expect(afterTtl.record.expiresAt).toBe(iso(2 * TTL_MS + 1));
    }
  });

  it("prunes expired records from the store", () => {
    const store = new InMemoryIdempotencyStore();
    executeIdempotent(store, command({ key: "k1" }), NOW, () => okExecution("r1"));
    executeIdempotent(store, command({ key: "k2" }), NOW, () => okExecution("r2"));
    expect(store.prune(iso(1))).toBe(0);
    expect(store.prune(iso(TTL_MS + 1))).toBe(2);
    expect(store.get("k1", iso(TTL_MS + 2))).toBeNull();
  });
});

