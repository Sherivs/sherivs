/**
 * V1 wave team R4 (HERMES-PORT) — Hermes observation port.
 *
 * Proves, at unit level (in-memory port + a structural fake Supabase client
 * — no real database, no network):
 *  1. adapter contract: the in-memory port is the DEFAULT backend; the DB
 *     adapter (HermesObservationPortDb) satisfies the same recorder
 *     contract over cg_hermes_observation; backend selection via
 *     HERMES_OBSERVATION_BACKEND ("memory" default, "db", unknown throws);
 *  2. §12 provenance stamping: the PORT stamps recordedBy / generatedByAi /
 *     verified — callers cannot claim provenance; it survives the DB
 *     round trip;
 *  3. append-only semantics: record + list ONLY (no update/delete on the
 *     surface); a replayed observation id leaves the original record
 *     verbatim (§10);
 *  4. fail-closed on schema gaps: with the cg_hermes_observation substrate
 *     absent, every DB operation returns the typed
 *     `observation_substrate_missing` failure and writes NOTHING;
 *  5. untrusted reads: malformed rows are rejected, never coerced;
 *  6. tenant scoping: listObservations returns only the requested tenant's
 *     observations (§13).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { __mockSupabaseAdmin: true },
}));

const {
  createHermesObservationPortDb,
  createHermesObservationPort,
  resolveHermesObservationBackend,
  HERMES_OBSERVATION_SUBSTRATE_GAP,
} = await import("@/lib/hermes/hermes-observation-db.server");
const { createInMemoryHermesObservationPort } = await import("@/lib/hermes/hermes-observation");

type DbClient = Parameters<typeof createHermesObservationPortDb>[0];

afterEach(() => {
  vi.unstubAllEnvs();
});

/* ─────────────────────────────────────────────────────────────
 * Fixtures
 * ────────────────────────────────────────────────────────────*/

const TENANT = "tenant-alpha";
const HERMES = "hermes-1";
const NOW = "2026-10-01T12:00:00.000Z";

function observationInput(overrides?: Record<string, unknown>) {
  return {
    observationId: "hermes:obs:direct:exec-1",
    tenantId: TENANT,
    kind: "mission_observation" as const,
    subjectRef: "cg_execution_record:exec-1",
    statement: { stage: "assigned", action: "record-observation" },
    observedAt: "2026-10-01T11:59:00.000Z",
    source: "direct" as const,
    eventRef: null,
    traceId: "trace:hermes-1",
    correlationId: "corr:hermes-1",
    declaredOrigin: "hermes.observation-port",
    ...overrides,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Structural fake Supabase client (stateful; no network, no DB)
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
      let orderCol: string | null = null;
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
        if (orderCol !== null) {
          out = [...out].sort((a, b) => String(a[orderCol!]!).localeCompare(String(b[orderCol!]!)));
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
        order(column: string, _opts?: unknown) {
          orderCol = column;
          return builder;
        },
        limit(n: number) {
          limitN = n;
          return builder;
        },
        maybeSingle() {
          const result = {
            data: (applyFilters()[0] ?? null) as Row | null,
            error: spec.selectError ? { message: spec.selectError } : null,
          };
          return Promise.resolve(result);
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
          // The substrate fills its DEFAULT-now() columns (recorded_at etc.)
          // on the database clock — filled on read-back, never by the adapter.
          (spec.rows ??= []).push({ recorded_at: NOW, created_at: NOW, updated_at: NOW, ...row });
          return Promise.resolve({ data: row, error: null });
        },
      };
      return builder;
    },
  };
}

/** The row the DB substrate fills on read-back (recorded_at DB clock). */
const DB_DEFAULTS = { recorded_at: NOW, created_at: NOW, updated_at: NOW };

/** A fully persisted-shape observation row (what the DB would hold). */
function persistedRow(overrides?: Record<string, unknown>): Row {
  return {
    id: "hermes:obs:direct:exec-1",
    tenant_id: TENANT,
    kind: "mission_observation",
    subject_ref: "cg_execution_record:exec-1",
    statement: { stage: "assigned" },
    observed_at: "2026-10-01T11:59:00.000Z",
    recorded_at: NOW,
    source: "direct",
    event_ref: null,
    trace_id: "trace:hermes-1",
    correlation_id: "corr:hermes-1",
    declared_origin: "hermes.observation-port",
    created_by: HERMES,
    generated_by_ai: true,
    verified: false,
    ...overrides,
  };
}

/* ─────────────────────────────────────────────────────────────
 * 1. Backend selection (env-driven; memory is the default)
 * ────────────────────────────────────────────────────────────*/

describe("Hermes observation backend selection", () => {
  it("resolves 'memory' as the DEFAULT backend (unset/empty)", () => {
    expect(resolveHermesObservationBackend(undefined)).toBe("memory");
    expect(resolveHermesObservationBackend("")).toBe("memory");
    expect(resolveHermesObservationBackend("memory")).toBe("memory");
  });

  it("resolves 'db' when configured and THROWS on an unknown backend", () => {
    expect(resolveHermesObservationBackend("db")).toBe("db");
    expect(() => resolveHermesObservationBackend("sqlite")).toThrow(/HERMES_OBSERVATION_BACKEND/);
  });

  it("createHermesObservationPort returns the in-memory port by default", async () => {
    vi.stubEnv("HERMES_OBSERVATION_BACKEND", "");
    const port = await createHermesObservationPort();
    expect(port.backend).toBe("memory");
  });

  it("createHermesObservationPort returns the DB port (HermesObservationPortDb) when configured", async () => {
    vi.stubEnv("HERMES_OBSERVATION_BACKEND", "db");
    const port = await createHermesObservationPort();
    expect(port.backend).toBe("db");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Adapter contract + §12 provenance stamping (in-memory)
 * ────────────────────────────────────────────────────────────*/

describe("In-memory Hermes observation port (default backend)", () => {
  it("records an observation and lists it tenant-scoped", async () => {
    const port = createInMemoryHermesObservationPort();
    const recorded = await port.recordObservation({
      observation: observationInput(),
      observedBy: HERMES,
      now: NOW,
    });
    expect(recorded).toEqual({
      ok: true,
      observationId: "hermes:obs:direct:exec-1",
      recorded: true,
      replayed: false,
    });

    const listed = await port.listObservations(TENANT);
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error(listed.error);
    expect(listed.observations).toHaveLength(1);
    expect(listed.observations[0].tenantId).toBe(TENANT);
  });

  it("stamps §12 provenance itself — the caller cannot claim it", async () => {
    const port = createInMemoryHermesObservationPort();
    await port.recordObservation({ observation: observationInput(), observedBy: HERMES, now: NOW });
    const listed = await port.listObservations(TENANT);
    if (!listed.ok) throw new Error(listed.error);
    const observation = listed.observations[0];
    expect(observation.recordedBy).toBe(HERMES);
    expect(observation.generatedByAi).toBe(true);
    expect(observation.verified).toBe(false);
    expect(observation.recordedAt).toBe(NOW);
    expect(observation.observedAt).toBe("2026-10-01T11:59:00.000Z");
  });

  it("rejects observations with invalid shapes (fail-closed Zod boundary)", async () => {
    const port = createInMemoryHermesObservationPort();
    for (const bad of [
      observationInput({ observationId: "" }),
      observationInput({ kind: "mystery_kind" }),
      observationInput({ observedAt: "not-a-timestamp" }),
      // §12: an event-sourced observation must cite its event.
      observationInput({ source: "event", eventRef: null }),
      // §9: provenance is not caller input — no extra keys (strict schema).
      { ...observationInput(), verified: true },
      { ...observationInput(), generatedByAi: false },
    ]) {
      const result = await port.recordObservation({
        observation: bad as never,
        observedBy: HERMES,
        now: NOW,
      });
      expect(result.ok).toBe(false);
    }
  });

  it("rejects an empty observedBy / unparsable record instant (provenance required)", async () => {
    const port = createInMemoryHermesObservationPort();
    const noObserver = await port.recordObservation({
      observation: observationInput(),
      observedBy: "  ",
      now: NOW,
    });
    expect(noObserver.ok).toBe(false);
    const badNow = await port.recordObservation({
      observation: observationInput(),
      observedBy: HERMES,
      now: "yesterday-ish",
    });
    expect(badNow.ok).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Append-only semantics (both backends)
 * ────────────────────────────────────────────────────────────*/

describe("Append-only semantics", () => {
  it("exposes record + list ONLY — no update, no delete", async () => {
    const memory = createInMemoryHermesObservationPort();
    const client = fakeSupabaseClient();
    const db = createHermesObservationPortDb(client as unknown as DbClient);
    for (const port of [memory, db]) {
      // The recorder contract surface; `size` is the in-memory port's test
      // introspection only. NOTHING mutating exists on either backend.
      const keys = Object.keys(port);
      expect(keys).toContain("backend");
      expect(keys).toContain("recordObservation");
      expect(keys).toContain("listObservations");
      expect(keys.filter((key) => /update|delete|patch|upsert/i.test(key))).toEqual([]);
    }
  });

  it("a replayed observation id leaves the ORIGINAL record verbatim (in-memory)", async () => {
    const port = createInMemoryHermesObservationPort();
    await port.recordObservation({ observation: observationInput(), observedBy: HERMES, now: NOW });

    const replay = await port.recordObservation({
      observation: observationInput({ statement: { stage: "TAMPERED" } }),
      observedBy: "someone-else",
      now: "2026-10-01T13:00:00.000Z",
    });
    expect(replay).toEqual({
      ok: true,
      observationId: "hermes:obs:direct:exec-1",
      recorded: false,
      replayed: true,
    });

    const listed = await port.listObservations(TENANT);
    if (!listed.ok) throw new Error(listed.error);
    expect(listed.observations).toHaveLength(1);
    // The original §12 provenance stands — the replay rewrote nothing.
    expect(listed.observations[0].statement).toEqual({
      stage: "assigned",
      action: "record-observation",
    });
    expect(listed.observations[0].recordedBy).toBe(HERMES);
    expect(listed.observations[0].recordedAt).toBe(NOW);
  });

  it("a replayed observation id leaves the ORIGINAL row verbatim (db)", async () => {
    const client = fakeSupabaseClient({
      cg_hermes_observation: { rows: [persistedRow()] },
    });
    const port = createHermesObservationPortDb(client as unknown as DbClient);

    const replay = await port.recordObservation({
      observation: observationInput({ statement: { stage: "TAMPERED" } }),
      observedBy: "someone-else",
      now: "2026-10-01T13:00:00.000Z",
    });
    expect(replay).toEqual({
      ok: true,
      observationId: "hermes:obs:direct:exec-1",
      recorded: false,
      replayed: true,
    });
    // No INSERT was issued against the substrate — nothing rewritten.
    expect(client.inserted).toHaveLength(0);

    const listed = await port.listObservations(TENANT);
    if (!listed.ok) throw new Error(listed.error);
    expect(listed.observations).toHaveLength(1);
    expect(listed.observations[0].statement).toEqual({ stage: "assigned" });
    expect(listed.observations[0].recordedBy).toBe(HERMES);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. DB adapter (HermesObservationPortDb) over cg_hermes_observation
 * ────────────────────────────────────────────────────────────*/

describe("HermesObservationPortDb (cg_hermes_observation adapter)", () => {
  it("persists the stamped row and maps reads back through the contract", async () => {
    const client = fakeSupabaseClient();
    const port = createHermesObservationPortDb(client as unknown as DbClient);

    const recorded = await port.recordObservation({
      observation: observationInput(),
      observedBy: HERMES,
      now: NOW,
    });
    expect(recorded).toEqual({
      ok: true,
      observationId: "hermes:obs:direct:exec-1",
      recorded: true,
      replayed: false,
    });

    expect(client.inserted).toHaveLength(1);
    const row = client.inserted[0].row;
    expect(row.id).toBe("hermes:obs:direct:exec-1");
    expect(row.tenant_id).toBe(TENANT);
    expect(row.created_by).toBe(HERMES);
    expect(row.generated_by_ai).toBe(true);
    expect(row.verified).toBe(false);
    // recorded_at is the DATABASE clock — the adapter never backdates it.
    expect("recorded_at" in row).toBe(false);

    const listed = await port.listObservations(TENANT);
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error(listed.error);
    expect(listed.observations[0]).toEqual({
      observationId: "hermes:obs:direct:exec-1",
      tenantId: TENANT,
      kind: "mission_observation",
      subjectRef: "cg_execution_record:exec-1",
      statement: { stage: "assigned", action: "record-observation" },
      observedAt: "2026-10-01T11:59:00.000Z",
      recordedAt: NOW,
      source: "direct",
      eventRef: null,
      traceId: "trace:hermes-1",
      correlationId: "corr:hermes-1",
      declaredOrigin: "hermes.observation-port",
      recordedBy: HERMES,
      generatedByAi: true,
      verified: false,
    });
  });

  it("contract rejections never touch the database", async () => {
    const client = fakeSupabaseClient();
    const port = createHermesObservationPortDb(client as unknown as DbClient);

    const rejected = await port.recordObservation({
      observation: observationInput({ source: "event", eventRef: null }),
      observedBy: HERMES,
      now: NOW,
    });
    expect(rejected.ok).toBe(false);
    expect(client.inserted).toHaveLength(0);
  });

  it("a concurrent-writer unique violation (23505) replays — nothing rewritten", async () => {
    const client = fakeSupabaseClient({
      cg_hermes_observation: {
        insertError: { message: "duplicate key value violates unique constraint", code: "23505" },
      },
    });
    const port = createHermesObservationPortDb(client as unknown as DbClient);
    const result = await port.recordObservation({
      observation: observationInput(),
      observedBy: HERMES,
      now: NOW,
    });
    expect(result).toEqual({
      ok: true,
      observationId: "hermes:obs:direct:exec-1",
      recorded: false,
      replayed: true,
    });
  });

  it("FAILS CLOSED on a missing substrate: typed gap, nothing written (list)", async () => {
    const client = fakeSupabaseClient({
      cg_hermes_observation: {
        selectError: "relation cg_hermes_observation does not exist",
      },
    });
    const port = createHermesObservationPortDb(client as unknown as DbClient);

    const listed = await port.listObservations(TENANT);
    expect(listed.ok).toBe(false);
    if (listed.ok) throw new Error("must fail closed");
    expect(listed.error).toContain("observation_substrate_missing");
    expect(listed.error).toContain(HERMES_OBSERVATION_SUBSTRATE_GAP);
  });

  it("FAILS CLOSED on a missing substrate: typed gap, nothing written (record)", async () => {
    const client = fakeSupabaseClient({
      cg_hermes_observation: {
        selectError: "Could not find the table cg_hermes_observation in the schema cache",
        insertError: {
          message: "Could not find the table cg_hermes_observation in the schema cache",
        },
      },
    });
    const port = createHermesObservationPortDb(client as unknown as DbClient);

    const result = await port.recordObservation({
      observation: observationInput(),
      observedBy: HERMES,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("must fail closed");
    expect(result.error).toContain("observation_substrate_missing");
    expect(result.error).toContain(HERMES_OBSERVATION_SUBSTRATE_GAP);
    // Nothing persisted under a missing substrate.
    expect(client.inserted).toHaveLength(0);
  });

  it("fails closed on other persistence errors too (never invents observations)", async () => {
    const client = fakeSupabaseClient({
      cg_hermes_observation: {
        selectError: "connection terminated unexpectedly",
      },
    });
    const port = createHermesObservationPortDb(client as unknown as DbClient);
    const listed = await port.listObservations(TENANT);
    expect(listed.ok).toBe(false);
    if (!listed.ok) expect(listed.error).toContain("connection terminated");
  });

  it("rejects malformed rows on read-back (untrusted reads fail closed)", async () => {
    const client = fakeSupabaseClient({
      cg_hermes_observation: {
        // §9 intelligence-only violation: a row claiming verified state can
        // never re-enter Hermes state.
        rows: [persistedRow({ verified: true })],
      },
    });
    const port = createHermesObservationPortDb(client as unknown as DbClient);
    const listed = await port.listObservations(TENANT);
    expect(listed.ok).toBe(false);
    if (!listed.ok) expect(listed.error).toContain("row validation rejected");
  });

  it("scopes every read by tenant (§13)", async () => {
    const client = fakeSupabaseClient({
      cg_hermes_observation: {
        rows: [
          persistedRow(),
          persistedRow({ id: "hermes:obs:direct:exec-2", tenant_id: "tenant-beta" }),
        ],
      },
    });
    const port = createHermesObservationPortDb(client as unknown as DbClient);
    const listed = await port.listObservations(TENANT);
    if (!listed.ok) throw new Error(listed.error);
    expect(listed.observations.map((o) => o.tenantId)).toEqual([TENANT]);
  });
});
