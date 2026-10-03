/**
 * CoreGrid — durable DB-backed idempotency store tests (H3-028 / L-T-012).
 *
 * Offline suite: the `cg_idempotency_record` substrate is never touched —
 * the DB client is a mock that emulates the statements the store issues,
 * including the UNIQUE (tenant_id, idempotency_key) exactly-once arbitration
 * and the replace-expired-only conflict clause of the authored migration.
 *
 * Proven targets:
 * - exactly-once under restart: an outcome recorded by process instance 1 is
 *   replayed after a simulated process restart (fresh store + fresh client
 *   connection over the same database state) with NO new external effect;
 * - the replay and collision decisions are made by the REAL contract module
 *   (`executeIdempotent`), fed the durable record loaded from the DB;
 * - TTL fail-safe (expired == absent), prune hygiene, per-tenant isolation,
 *   first-record-wins arbitration, and fail-closed error/validation paths.
 */

import { describe, expect, it } from "vitest";
import {
  InMemoryIdempotencyStore,
  deriveIdempotencyKey,
  executeIdempotent,
  payloadDigest,
  type IdempotencyRecord,
  type IdempotentExecution,
  type IdempotentExecutionResult,
} from "@/lib/command/idempotency";
import {
  DbIdempotencyStore,
  IdempotencyStoreDbError,
  type IdempotencyDbClient,
} from "@/lib/command/idempotency-store.db";

/* ─────────────────────────────────────────────────────────────
 * Mock substrate — emulates cg_idempotency_record exactly
 * ────────────────────────────────────────────────────────────*/

interface MockRow {
  tenant_id: string;
  idempotency_key: string;
  scope: string;
  actor_id: string;
  intent: string;
  payload_digest: string;
  status: string;
  reason: string | null;
  external_effect: string;
  response_ref: string;
  created_at: string;
  expires_at: string;
}

function rowKeyOf(tenant: string, key: string): string {
  return `${tenant}\u0000${key}`;
}

/**
 * Shared backing state (one "database"); each `client()` call hands out a
 * fresh connection — two connections over the same backing state model two
 * process instances of the same deployment.
 */
class MockIdempotencyDatabase {
  private readonly rows = new Map<string, MockRow>();
  private nextFailure: Error | null = null;

  failNextQuery(error: Error): void {
    this.nextFailure = error;
  }

  client(): IdempotencyDbClient {
    return {
      query: async (
        text: string,
        values?: readonly unknown[],
      ): Promise<{ rows: readonly Record<string, unknown>[]; rowCount?: number | null }> => {
        if (this.nextFailure !== null) {
          const failure = this.nextFailure;
          this.nextFailure = null;
          throw failure;
        }
        return this.execute(text, values ?? []);
      },
    };
  }

  private async execute(
    text: string,
    values: readonly unknown[],
  ): Promise<{ rows: readonly Record<string, unknown>[]; rowCount?: number | null }> {
    if (text.includes("SELECT idempotency_key")) {
      const [tenant, key, now] = values as [string, string, string];
      const row = this.rows.get(rowKeyOf(tenant, key));
      if (row === undefined || Date.parse(row.expires_at) <= Date.parse(now)) {
        return { rows: [] };
      }
      return { rows: [{ ...row } as Record<string, unknown>] };
    }
    if (text.includes("INSERT INTO public.cg_idempotency_record")) {
      const row = this.rowFromValues(values);
      const existing = this.rows.get(rowKeyOf(row.tenant_id, row.idempotency_key));
      // Emulates: ON CONFLICT ... DO UPDATE SET ... WHERE existing.expires_at
      // <= EXCLUDED.created_at — a LIVE record is never overwritten.
      if (existing === undefined || Date.parse(existing.expires_at) <= Date.parse(row.created_at)) {
        this.rows.set(rowKeyOf(row.tenant_id, row.idempotency_key), row);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (text.includes("DELETE FROM public.cg_idempotency_record")) {
      const [tenant, now] = values as [string, string];
      let removed = 0;
      for (const [mapKey, row] of this.rows) {
        if (row.tenant_id === tenant && Date.parse(row.expires_at) <= Date.parse(now)) {
          this.rows.delete(mapKey);
          removed += 1;
        }
      }
      return { rows: [], rowCount: removed };
    }
    throw new Error(`mock substrate: unrecognized statement: ${text.split("\n")[0]}`);
  }

  private rowFromValues(values: readonly unknown[]): MockRow {
    const [
      tenant_id,
      idempotency_key,
      scope,
      actor_id,
      intent,
      payload_digest,
      status,
      reason,
      external_effect,
      response_ref,
      created_at,
      expires_at,
    ] = values as [string, string, string, string, string, string, string, string | null, string, string, string, string];
    return {
      tenant_id,
      idempotency_key,
      scope,
      actor_id,
      intent,
      payload_digest,
      status,
      reason,
      external_effect,
      response_ref,
      created_at,
      expires_at,
    };
  }

  rowCount(): number {
    return this.rows.size;
  }
}

/* ─────────────────────────────────────────────────────────────
 * Fixtures
 * ────────────────────────────────────────────────────────────*/

const NOW = "2026-10-01T00:00:00.000Z";
const TTL_MS = 60_000;

function iso(offsetMs: number): string {
  return new Date(Date.parse(NOW) + offsetMs).toISOString();
}

const PAYLOAD = { studentId: "s-1", term: "term-1" } as const;
const KEY = deriveIdempotencyKey({ scope: "enrollment", actorId: "actor-1", intent: "enroll-student", payload: PAYLOAD });

let externalEffects = 0;

function resetEffects(): void {
  externalEffects = 0;
}

function executor(responseRef: string): IdempotentExecutionResult {
  externalEffects += 1;
  return { status: "succeeded", reason: null, externalEffect: "recorded_intent", responseRef };
}

function recordFromExecution(execution: IdempotentExecution): IdempotencyRecord {
  if (execution.kind !== "executed") {
    throw new Error(`expected a fresh execution, got "${execution.kind}"`);
  }
  return execution.record;
}

/* ─────────────────────────────────────────────────────────────
 * Tests
 * ────────────────────────────────────────────────────────────*/

describe("h3-028: durable idempotency store", () => {
  it("persists exactly the contract's record shape (reference <-> durable parity)", async () => {
    const database = new MockIdempotencyDatabase();
    const reference = new InMemoryIdempotencyStore();
    const store = new DbIdempotencyStore({ client: database.client(), tenantId: "tenant-a" });

    const executed = executeIdempotent(reference, { key: KEY, scope: "enrollment", actorId: "actor-1", intent: "enroll-student", payload: PAYLOAD, recordTtlMs: TTL_MS }, NOW, () => executor("resp:1"));
    expect(executed.kind).toBe("executed");

    const record = recordFromExecution(executed);
    await store.put(record);

    const loaded = await store.get(KEY, iso(1));
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(record);
  });

  it("replays the recorded outcome after a simulated process restart with no new external effect", async () => {
    resetEffects();
    const database = new MockIdempotencyDatabase();

    // ── process instance 1: executes and records durably ──
    const process1 = new DbIdempotencyStore({ client: database.client(), tenantId: "tenant-a" });
    const reference1 = new InMemoryIdempotencyStore();
    const first = executeIdempotent(reference1, { key: KEY, scope: "enrollment", actorId: "actor-1", intent: "enroll-student", payload: PAYLOAD, recordTtlMs: TTL_MS }, NOW, () => executor("resp:1"));
    expect(first.kind).toBe("executed");
    await process1.put(recordFromExecution(first));
    expect(externalEffects).toBe(1);

    // ── simulated restart: fresh store + fresh connection, same database ──
    const process2 = new DbIdempotencyStore({ client: database.client(), tenantId: "tenant-a" });
    const loaded = await process2.get(KEY, iso(1));
    expect(loaded).not.toBeNull();
    expect(loaded?.outcome.status).toBe("succeeded");
    expect(loaded?.responseRef).toBe("resp:1");

    // ── the REAL contract replays the durable record: no new effect ──
    const reference2 = new InMemoryIdempotencyStore();
    if (loaded !== null) reference2.put(loaded);
    const replay = executeIdempotent(reference2, { key: KEY, scope: "enrollment", actorId: "actor-1", intent: "enroll-student", payload: PAYLOAD, recordTtlMs: TTL_MS }, iso(1), () => executor("resp:2"));
    expect(replay.kind).toBe("replayed");
    expect(externalEffects).toBe(1);
    if (replay.kind === "replayed") {
      expect(replay.result.externalEffect).toBe("none");
      expect(replay.result.responseRef).toBe("resp:1");
    }
  });

  it("rejects a same-key/different-payload collision using the durable digest", async () => {
    resetEffects();
    const database = new MockIdempotencyDatabase();
    const store = new DbIdempotencyStore({ client: database.client(), tenantId: "tenant-a" });
    const reference = new InMemoryIdempotencyStore();

    const first = executeIdempotent(reference, { key: KEY, scope: "enrollment", actorId: "actor-1", intent: "enroll-student", payload: PAYLOAD, recordTtlMs: TTL_MS }, NOW, () => executor("resp:1"));
    await store.put(recordFromExecution(first));

    const loaded = await store.get(KEY, iso(1));
    if (loaded === null) throw new Error("durable record must survive");
    const seeded = new InMemoryIdempotencyStore();
    seeded.put(loaded);

    const collision = executeIdempotent(seeded, { key: KEY, scope: "enrollment", actorId: "actor-1", intent: "enroll-student", payload: { studentId: "s-2", term: "term-1" }, recordTtlMs: TTL_MS }, iso(1), () => executor("resp:2"));
    expect(collision.kind).toBe("collision");
    if (collision.kind === "collision") {
      expect(collision.recordedPayloadDigest).toBe(payloadDigest(PAYLOAD));
      expect(collision.incomingPayloadDigest).toBe(payloadDigest({ studentId: "s-2", term: "term-1" }));
    }
    expect(externalEffects).toBe(1);
  });

  it("arbitrates a concurrent race first-record-wins: a live record is never overwritten", async () => {
    const database = new MockIdempotencyDatabase();
    const store = new DbIdempotencyStore({ client: database.client(), tenantId: "tenant-a" });

    const winner: IdempotencyRecord = {
      key: KEY,
      envelope: { scope: "enrollment", actorId: "actor-1", intent: "enroll-student", payloadDigest: payloadDigest(PAYLOAD) },
      outcome: { status: "succeeded", reason: null, externalEffect: "recorded_intent" },
      responseRef: "resp:1",
      createdAt: NOW,
      expiresAt: iso(TTL_MS),
    };
    const loser: IdempotencyRecord = { ...winner, outcome: { status: "failed", reason: "duplicate", externalEffect: "none" }, responseRef: "resp:2" };

    await store.put(winner);
    await store.put(loser);

    const loaded = await store.get(KEY, iso(1));
    expect(loaded?.responseRef).toBe("resp:1");
    expect(loaded?.outcome.status).toBe("succeeded");
  });

  it("is fail-safe at TTL expiry: expired == absent, and the key is freed for a fresh execution", async () => {
    resetEffects();
    const database = new MockIdempotencyDatabase();
    const store = new DbIdempotencyStore({ client: database.client(), tenantId: "tenant-a" });
    const reference = new InMemoryIdempotencyStore();

    const first = executeIdempotent(reference, { key: KEY, scope: "enrollment", actorId: "actor-1", intent: "enroll-student", payload: PAYLOAD, recordTtlMs: TTL_MS }, NOW, () => executor("resp:1"));
    await store.put(recordFromExecution(first));

    expect(await store.get(KEY, iso(TTL_MS))).toBeNull();

    // Re-execution after expiry records a fresh outcome (replace-expired law).
    const second = executeIdempotent(reference, { key: KEY, scope: "enrollment", actorId: "actor-1", intent: "enroll-student", payload: PAYLOAD, recordTtlMs: TTL_MS }, iso(TTL_MS), () => executor("resp:2"));
    expect(second.kind).toBe("executed");
    await store.put(recordFromExecution(second));

    const reloaded = await store.get(KEY, iso(TTL_MS + 1));
    expect(reloaded?.responseRef).toBe("resp:2");
  });

  it("prunes only expired records and returns the removed count", async () => {
    const database = new MockIdempotencyDatabase();
    const store = new DbIdempotencyStore({ client: database.client(), tenantId: "tenant-a" });
    const reference = new InMemoryIdempotencyStore();

    const executed = executeIdempotent(reference, { key: KEY, scope: "enrollment", actorId: "actor-1", intent: "enroll-student", payload: PAYLOAD, recordTtlMs: TTL_MS }, NOW, () => executor("resp:1"));
    await store.put(recordFromExecution(executed));
    const liveKey = deriveIdempotencyKey({ scope: "enrollment", actorId: "actor-1", intent: "enroll-student", payload: { studentId: "s-live" } });
    await store.put({
      key: liveKey,
      envelope: { scope: "enrollment", actorId: "actor-1", intent: "enroll-student", payloadDigest: payloadDigest({ studentId: "s-live" }) },
      outcome: { status: "succeeded", reason: null, externalEffect: "recorded_intent" },
      responseRef: "resp:live",
      createdAt: iso(TTL_MS),
      expiresAt: iso(2 * TTL_MS),
    });

    expect(await store.prune(iso(TTL_MS))).toBe(1);
    expect(database.rowCount()).toBe(1);
    expect(await store.get(liveKey, iso(TTL_MS))).not.toBeNull();
    expect(await store.prune(iso(2 * TTL_MS))).toBe(1);
  });

  it("is tenant-scoped: tenant B can never read or collide with tenant A's records", async () => {
    const database = new MockIdempotencyDatabase();
    const storeA = new DbIdempotencyStore({ client: database.client(), tenantId: "tenant-a" });
    const storeB = new DbIdempotencyStore({ client: database.client(), tenantId: "tenant-b" });

    const reference = new InMemoryIdempotencyStore();
    const executed = executeIdempotent(reference, { key: KEY, scope: "enrollment", actorId: "actor-1", intent: "enroll-student", payload: PAYLOAD, recordTtlMs: TTL_MS }, NOW, () => executor("resp:1"));
    await storeA.put(recordFromExecution(executed));

    expect(await storeB.get(KEY, iso(1))).toBeNull();

    // The same key in tenant B is an independent identity (UNIQUE per tenant pair).
    await storeB.put(recordFromExecution(executed));
    expect(database.rowCount()).toBe(2);
  });

  it("fails closed: invalid records and provider errors are thrown, never conflated with 'absent'", async () => {
    const database = new MockIdempotencyDatabase();
    const store = new DbIdempotencyStore({ client: database.client(), tenantId: "tenant-a" });

    const badDigest: IdempotencyRecord = {
      key: KEY,
      envelope: { scope: "enrollment", actorId: "actor-1", intent: "enroll-student", payloadDigest: "not-a-digest" },
      outcome: { status: "succeeded", reason: null, externalEffect: "recorded_intent" },
      responseRef: "resp:1",
      createdAt: NOW,
      expiresAt: iso(TTL_MS),
    };
    await expect(store.put(badDigest)).rejects.toMatchObject({ code: "invalid_input" });

    const nonPositiveTtl: IdempotencyRecord = { ...badDigest, envelope: { ...badDigest.envelope, payloadDigest: payloadDigest(PAYLOAD) }, expiresAt: NOW };
    await expect(store.put(nonPositiveTtl)).rejects.toMatchObject({ code: "invalid_input" });

    await expect(store.get("   ", NOW)).rejects.toMatchObject({ code: "invalid_input" });

    database.failNextQuery(new Error("connection refused"));
    await expect(store.get(KEY, NOW)).rejects.toBeInstanceOf(IdempotencyStoreDbError);
    await expect(store.get(KEY, NOW)).resolves.toBeNull();
  });
});
