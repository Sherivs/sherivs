/**
 * V1 wave follow-up team T-E (HERMES-WIRE) — Hermes event-observation
 * runtime trigger wiring.
 *
 * Proves, at unit level (structural fake Supabase client — no real database,
 * no network), that the runtime consumption point (`runHermesEventObservationStep`)
 * actually drives the event→observation flow:
 *  1. backend selection is respected: unset/memory (the DEFAULT) is a typed
 *     no-op that changes nothing and touches nothing; db consumes PENDING
 *     cg_event rows through the DB adapter; an unknown backend fails the
 *     step closed (typed, observable, never a crash);
 *  2. the wiring records observations from event fixtures, fully §12-stamped;
 *  3. fail-closed on substrate-missing (cg_event OR cg_hermes_observation
 *     absent → typed failure, ZERO observations invented);
 *  4. exactly-once: duplicate deliveries collapse and repeated steps replay —
 *     no observation is recorded twice for the same event ref (§10).
 */

import { afterEach, describe, expect, it } from "vitest";
import type { KernelEventRecord } from "@/lib/kernel/event-semantics";
import {
  HERMES_EVENT_TRIGGER_DELIVERY_REJECTION,
  HERMES_EVENT_TRIGGER_MEMORY_SKIP_REASON,
  runHermesEventObservationStep,
} from "@/lib/hermes/hermes-observation-trigger.server";
import {
  createInMemoryHermesObservationPort,
  type HermesObservationRecorder,
} from "@/lib/hermes/hermes-observation";
import { HERMES_OBSERVATION_SUBSTRATE_GAP } from "@/lib/hermes/hermes-observation-db.server";

/* ─────────────────────────────────────────────────────────────
 * Fixtures
 * ────────────────────────────────────────────────────────────*/

const TENANT = "tenant-alpha";
const HERMES = "hermes-wire-1";
const NOW = "2026-10-03T12:00:00.000Z";
const T0 = "2026-10-03T11:00:00.000Z";

/** A registered kernel builtin event (core.state.changed, routine). */
function event(overrides?: Partial<KernelEventRecord>): KernelEventRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    event_type: "core.state.changed",
    tenant_id: TENANT,
    aggregate_type: "mission_execution",
    aggregate_id: "exec-1",
    payload: { stage: "assigned" },
    occurred_at: T0,
    recorded_at: T0,
    correlation_id: "corr-1",
    causation_id: null,
    parent_event_id: null,
    declared_origin: null,
    ...overrides,
  };
}

const BACKEND_ENV = "HERMES_OBSERVATION_BACKEND";

afterEach(() => {
  delete process.env[BACKEND_ENV];
});

/* ─────────────────────────────────────────────────────────────
 * Structural fake Supabase client (same pattern as the R4 tests)
 * ────────────────────────────────────────────────────────────*/

type Row = Record<string, unknown>;

interface TableSpec {
  rows?: Row[];
  selectError?: string;
  insertError?: { message: string; code?: string };
}

function fakeSupabaseClient(specs: Record<string, TableSpec> = {}) {
  const inserted: Array<{ table: string; row: Row }> = [];
  const resolved = new Map<string, TableSpec>();
  const specFor = (table: string): TableSpec => {
    const existing = resolved.get(table);
    if (existing) return existing;
    const created = specs[table] ?? {};
    resolved.set(table, created);
    return created;
  };
  return {
    inserted,
    from(table: string) {
      const spec = specFor(table);
      const filters: Array<["eq" | "in", string, unknown]> = [];
      let limitN: number | null = null;
      const applyFilters = (): Row[] => {
        let out = spec.rows ?? [];
        for (const [op, column, value] of filters) {
          out =
            op === "eq"
              ? out.filter((row) => row[column] === value)
              : out.filter((row) =>
                  Array.isArray(value) ? value.includes(row[column] as string) : false,
                );
        }
        if (limitN !== null) out = out.slice(0, limitN);
        return out;
      };
      const builder = {
        select(_columns: string) {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push(["eq", column, value]);
          return builder;
        },
        in(column: string, values: unknown[]) {
          filters.push(["in", column, values]);
          return builder;
        },
        order(_column: string, _opts?: unknown) {
          return builder;
        },
        limit(n: number) {
          limitN = n;
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({
            data: (applyFilters()[0] ?? null) as Row | null,
            error: spec.selectError ? { message: spec.selectError } : null,
          });
        },
        then(
          onFulfilled?: (value: { data: Row[]; error: { message: string } | null }) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          const result = {
            data: applyFilters(),
            error: spec.selectError ? { message: spec.selectError } : null,
          };
          return Promise.resolve(result).then(onFulfilled, onRejected);
        },
        insert(row: Row) {
          inserted.push({ table, row });
          if (spec.insertError) {
            return Promise.resolve({ data: null, error: spec.insertError });
          }
          (spec.rows ??= []).push(row);
          return Promise.resolve({ data: row, error: null });
        },
      };
      return builder;
    },
  };
}

/** A cg_event row as the substrate holds it (state pending = undelivered). */
function eventRow(overrides?: Record<string, unknown>): Row {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    event_type: "core.state.changed",
    aggregate_type: "mission_execution",
    aggregate_id: "exec-1",
    actor_identity: "operator-1",
    tenant_id: TENANT,
    occurred_at: T0,
    recorded_at: T0,
    correlation_id: "corr-1",
    idempotency_key: "idem-1",
    payload: { stage: "assigned" },
    payload_version: 1,
    state: "pending",
    attempts: 0,
    last_error: null,
    created_at: T0,
    updated_at: T0,
    ...overrides,
  };
}

const stepInput = { tenantId: TENANT, hermesId: HERMES, now: NOW } as const;

/* ─────────────────────────────────────────────────────────────
 * 1. Backend selection is respected
 * ────────────────────────────────────────────────────────────*/

describe("Backend selection", () => {
  it("the DEFAULT (unset env) backend is memory: a typed no-op that changes nothing", async () => {
    const result = await runHermesEventObservationStep(stepInput);
    expect(result.backend).toBe("memory");
    expect(result.ok).toBe(true);
    expect(result.consumed).toBe("skipped");
    expect(result.reason).toBe(HERMES_EVENT_TRIGGER_MEMORY_SKIP_REASON);
    expect(result.ingestion).toBeNull();
  });

  it("an explicit HERMES_OBSERVATION_BACKEND=memory behaves identically", async () => {
    process.env[BACKEND_ENV] = "memory";
    const result = await runHermesEventObservationStep(stepInput);
    expect(result.backend).toBe("memory");
    expect(result.consumed).toBe("skipped");
  });

  it("a memory skip touches NEITHER the client NOR the recorder (existing paths unchanged)", async () => {
    const client = fakeSupabaseClient();
    const recorder = createInMemoryHermesObservationPort();
    const result = await runHermesEventObservationStep(stepInput, {
      backend: "memory",
      client: client as never,
      recorder,
    });
    expect(result.consumed).toBe("skipped");
    expect(client.inserted).toHaveLength(0);
    expect(recorder.size()).toBe(0);
  });

  it("HERMES_OBSERVATION_BACKEND=db consumes PENDING cg_event rows through the DB adapter", async () => {
    process.env[BACKEND_ENV] = "db";
    const client = fakeSupabaseClient({ cg_event: { rows: [eventRow()] } });

    const result = await runHermesEventObservationStep(stepInput, { client: client as never });
    expect(result.backend).toBe("db");
    expect(result.ok).toBe(true);
    expect(result.consumed).toBe("ingested");
    expect(result.reason).toBeNull();
    if (!result.ok || !result.ingestion) throw new Error("step must ingest");
    expect(result.ingestion.recorded).toHaveLength(1);
    expect(result.ingestion.rejected).toEqual([]);

    // The observation landed in cg_hermes_observation, fully §12-stamped.
    const observationInsert = client.inserted.find((i) => i.table === "cg_hermes_observation");
    expect(observationInsert).toBeDefined();
    expect(observationInsert?.row.source).toBe("event");
    expect(observationInsert?.row.event_ref).toBe("11111111-1111-4111-8111-111111111111");
    expect(observationInsert?.row.created_by).toBe(HERMES);
    expect(observationInsert?.row.generated_by_ai).toBe(true);
    expect(observationInsert?.row.verified).toBe(false);

    // cg_event stays READ-ONLY — the outbox owns delivery state.
    expect(client.inserted.filter((i) => i.table === "cg_event")).toHaveLength(0);
  });

  it("an unknown backend value fails the step closed — typed, observable, no crash", async () => {
    process.env[BACKEND_ENV] = "redis";
    const result = await runHermesEventObservationStep(stepInput);
    expect(result.ok).toBe(false);
    expect(result.backend).toBe("unresolved");
    expect(result.consumed).toBe("failed");
    expect(result.reason).toContain("not a registered Hermes observation backend");
    expect(result.ingestion).toBeNull();
  });

  it("an injected backend override is validated too", async () => {
    const result = await runHermesEventObservationStep(stepInput, {
      backend: "s3" as never,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not a registered Hermes observation backend");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Memory mode: in-process deliveries through the in-memory port
 * ────────────────────────────────────────────────────────────*/

describe("Memory mode with explicit in-process deliveries", () => {
  it("records observations from event fixtures through the in-memory port (§12 stamps)", async () => {
    const recorder = createInMemoryHermesObservationPort();
    const result = await runHermesEventObservationStep(
      { ...stepInput, deliveries: [event()] },
      { backend: "memory", recorder },
    );
    expect(result.ok).toBe(true);
    expect(result.consumed).toBe("ingested");
    if (!result.ok || !result.ingestion) throw new Error("must ingest");
    expect(result.ingestion.recorded).toHaveLength(1);

    const listed = await recorder.listObservations(TENANT);
    if (!listed.ok) throw new Error(listed.error);
    expect(listed.observations).toHaveLength(1);
    const observation = listed.observations[0];
    expect(observation.recordedBy).toBe(HERMES);
    expect(observation.generatedByAi).toBe(true);
    expect(observation.verified).toBe(false);
    expect(observation.source).toBe("event");
    expect(observation.eventRef).toBe("11111111-1111-4111-8111-111111111111");
    expect(observation.kind).toBe("event_observation");
  });

  it("duplicate deliveries inside one step collapse — exactly-once (§10)", async () => {
    const recorder = createInMemoryHermesObservationPort();
    const result = await runHermesEventObservationStep(
      { ...stepInput, deliveries: [event(), event(), event()] },
      { backend: "memory", recorder },
    );
    if (!result.ok || !result.ingestion) throw new Error("must ingest");
    expect(result.ingestion.collapsed).toBe(2);
    expect(result.ingestion.recorded).toHaveLength(1);
    expect(recorder.size()).toBe(1);
  });

  it("a repeated step over the same event ref REPLAYS — nothing recorded twice", async () => {
    const recorder = createInMemoryHermesObservationPort();
    const first = await runHermesEventObservationStep(
      { ...stepInput, deliveries: [event()] },
      { backend: "memory", recorder },
    );
    if (!first.ok || !first.ingestion) throw new Error("first step must ingest");
    expect(first.ingestion.recorded).toHaveLength(1);

    const second = await runHermesEventObservationStep(
      { ...stepInput, deliveries: [event()] },
      { backend: "memory", recorder },
    );
    expect(second.ok).toBe(true);
    if (!second.ok || !second.ingestion) throw new Error("second step must ingest");
    expect(second.ingestion.recorded).toHaveLength(0);
    expect(second.ingestion.replayed).toHaveLength(1);
    expect(recorder.size()).toBe(1);
  });

  it("excludes deliveries without tenant context or from another tenant (§13)", async () => {
    const recorder = createInMemoryHermesObservationPort();
    const result = await runHermesEventObservationStep(
      {
        ...stepInput,
        deliveries: [event({ tenant_id: null }), event({ tenant_id: "tenant-beta" })],
      },
      { backend: "memory", recorder },
    );
    if (!result.ok || !result.ingestion) throw new Error("step must complete");
    expect(result.ingestion.excludedOtherTenant).toBe(2);
    expect(result.ingestion.recorded).toHaveLength(0);
    expect(recorder.size()).toBe(0);
  });

  it("a recorder failure fails the step closed", async () => {
    const failingRecorder: HermesObservationRecorder = {
      backend: "memory",
      async recordObservation() {
        return { ok: false, error: "observation_substrate_missing: injected gap" };
      },
      async listObservations() {
        return { ok: false, error: "observation_substrate_missing: injected gap" };
      },
    };
    const result = await runHermesEventObservationStep(
      { ...stepInput, deliveries: [event()] },
      { backend: "memory", recorder: failingRecorder },
    );
    expect(result.ok).toBe(false);
    expect(result.consumed).toBe("failed");
    expect(result.reason).toContain("failed closed");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. DB mode: fail-closed substrate gaps + exactly-once across steps
 * ────────────────────────────────────────────────────────────*/

describe("DB mode: fail-closed and exactly-once", () => {
  it("FAILS CLOSED when the cg_event substrate is absent — zero observations recorded", async () => {
    const client = fakeSupabaseClient({
      cg_event: { selectError: "relation cg_event does not exist" },
    });
    const result = await runHermesEventObservationStep(stepInput, {
      backend: "db",
      client: client as never,
    });
    expect(result.ok).toBe(false);
    expect(result.consumed).toBe("failed");
    expect(result.reason).toContain("cg_event substrate is absent");
    expect(result.ingestion?.recorded ?? []).toHaveLength(0);
    expect(client.inserted).toHaveLength(0);
  });

  it("FAILS CLOSED when the observation substrate is absent — zero observations recorded", async () => {
    const client = fakeSupabaseClient({
      cg_event: { rows: [eventRow()] },
      cg_hermes_observation: {
        selectError: "relation cg_hermes_observation does not exist",
        insertError: { message: "relation cg_hermes_observation does not exist" },
      },
    });
    const result = await runHermesEventObservationStep(stepInput, {
      backend: "db",
      client: client as never,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain(HERMES_OBSERVATION_SUBSTRATE_GAP);
    expect(client.inserted).toHaveLength(0);
  });

  it("repeated db steps over the same pending event replay — recorded exactly once", async () => {
    const client = fakeSupabaseClient({ cg_event: { rows: [eventRow()] } });
    const first = await runHermesEventObservationStep(stepInput, {
      backend: "db",
      client: client as never,
    });
    expect(first.ok).toBe(true);
    if (!first.ok || !first.ingestion) throw new Error("first step must ingest");
    expect(first.ingestion.recorded).toHaveLength(1);

    // The outbox state is untouched, so the row still reads as pending — the
    // deterministic digest identity + port replay make this a replay (§10).
    const second = await runHermesEventObservationStep(stepInput, {
      backend: "db",
      client: client as never,
    });
    expect(second.ok).toBe(true);
    if (!second.ok || !second.ingestion) throw new Error("second step must ingest");
    expect(second.ingestion.recorded).toHaveLength(0);
    expect(second.ingestion.replayed).toHaveLength(1);
    expect(client.inserted.filter((i) => i.table === "cg_hermes_observation")).toHaveLength(1);
  });

  it("rejects explicit deliveries in db mode — the cg_event substrate is authoritative", async () => {
    const client = fakeSupabaseClient({ cg_event: { rows: [eventRow()] } });
    const result = await runHermesEventObservationStep(
      { ...stepInput, deliveries: [event()] },
      { backend: "db", client: client as never },
    );
    expect(result.ok).toBe(false);
    expect(result.consumed).toBe("failed");
    expect(result.reason).toBe(HERMES_EVENT_TRIGGER_DELIVERY_REJECTION);
    expect(client.inserted).toHaveLength(0);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. Input validation (fail-closed before any consumption)
 * ────────────────────────────────────────────────────────────*/

describe("Step input validation", () => {
  it("rejects a step without tenant context (§13)", async () => {
    const result = await runHermesEventObservationStep({ ...stepInput, tenantId: "  " });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("event observation step rejected");
    expect(result.ingestion).toBeNull();
  });

  it("rejects a step without a governed Hermes identity or a parseable record instant", async () => {
    const noIdentity = await runHermesEventObservationStep({ ...stepInput, hermesId: "" });
    expect(noIdentity.ok).toBe(false);

    const badClock = await runHermesEventObservationStep({ ...stepInput, now: "not-a-time" });
    expect(badClock.ok).toBe(false);
  });

  it("rejects an out-of-bounds batch limit", async () => {
    const result = await runHermesEventObservationStep({ ...stepInput, limit: 0 });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("event observation step rejected");
  });
});
