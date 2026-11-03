/**
 * MISSION V1-005 — DB-backed memory tier adapter (cg_memory_* persistence).
 *
 * Proves, at unit level (offline, mocked Supabase client — no real database):
 *  1. backend selection: MEMORY_TIER_BACKEND resolves "memory" (default /
 *     fallback) | "db"; an unknown backend throws rather than silently
 *     degrading durability;
 *  2. the in-memory fallback adapter preserves the pure memory-store
 *     contract semantics behind the adapter interface;
 *  3. the db adapter persists contract-accepted state ONLY: scope
 *     declarations (with declared_by provenance, §12), records (full
 *     envelope + bi-temporal columns), and access records — while pure
 *     contract rejections NEVER touch the database;
 *  4. provenance survives the round trip: who/when/source fields
 *     (created_by, provenance jsonb, trace/correlation ids, recorded_at)
 *     are persisted verbatim and re-validate through the contract's own
 *     envelope builder on read-back;
 *  5. the known schema gap is fail-closed: a write naming a subjectRef is
 *     rejected (cg_memory_record authors no subject column — nothing is
 *     silently lost);
 *  6. retrieval audits every attempt into cg_memory_access_log (granted AND
 *     denied) and FAILS CLOSED when the audit persist fails — no record is
 *     served without its audit trail;
 *  7. untrusted reads are Zod-validated: a malformed cg_memory_record row
 *     fails the load instead of entering contract state.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemoryWriteRequest } from "@/lib/memory/memory-store";

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { __mockSupabaseAdmin: true },
}));

const { createDbMemoryTierAdapter, createMemoryTierAdapter, resolveMemoryTierBackend } =
  await import("@/lib/memory/memory-db-adapter.server");
const { createInMemoryMemoryTierAdapter } = await import("@/lib/memory/memory-adapter");
const { assembleMemoryContext } = await import("@/lib/memory/memory-context.server");
const { createMemoryTierStore } = await import("@/lib/memory/memory-store");

type DbClient = Parameters<typeof createDbMemoryTierAdapter>[0];

/** Narrows a typed result union to its rejection branch (strict TS). */
function rejection(result: { ok: boolean; error?: string }): string {
  if (result.ok || result.error == null) throw new Error("expected a contract rejection");
  return result.error;
}

function unwrapStore(
  loaded:
    { ok: true; store: ReturnType<typeof createMemoryTierStore> } | { ok: false; error: string },
) {
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.store;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

/* ─────────────────────────────────────────────────────────────
 * Fixtures (mirror tests/unit/memory-store.test.ts)
 * ────────────────────────────────────────────────────────────*/

const TENANT_A = "tenant-alpha";
const ACTOR_A = "01970000-0000-7000-8000-0000000000a1";
const SCOPE_A = "scope:alpha:field-ops";
const NOW = "2026-10-01T12:00:00Z";
const FRESH = "2026-10-01T11:00:00Z";

function scopeA() {
  return {
    scopeId: SCOPE_A,
    tenantId: TENANT_A,
    missionRef: "mission:MISSION-R-36" as string | null,
    actorScope: [ACTOR_A],
    domains: ["field-ops", "roster"],
    maxSensitivity: "internal" as const,
  };
}

function envelopeInput() {
  return {
    objectType: "memory_record",
    schemaVersion: "1.0",
    status: "active" as const,
    createdBy: ACTOR_A,
    updatedBy: ACTOR_A,
    provenance: { source: "workforce:field-agent", originTenantId: TENANT_A, verified: false },
    policyContext: { purpose: "field-operations" },
    traceId: "trace:memory-1",
    correlationId: "corr:memory-1",
    declaredOrigin: "mission:MISSION-R-36",
  };
}

function writeRequest(overrides?: Partial<MemoryWriteRequest>): MemoryWriteRequest {
  return {
    recordId: "mem:alpha:001",
    scopeId: SCOPE_A,
    identityRef: ACTOR_A,
    tenantId: TENANT_A,
    missionRef: "mission:MISSION-R-36",
    memoryClass: "practical",
    domain: "field-ops",
    content: "Route B is closed for maintenance until Friday",
    sensitivity: "internal",
    requiredPermission: null,
    freshnessAt: FRESH,
    recordedAt: NOW,
    biTemporal: { validFrom: NOW },
    envelope: envelopeInput(),
    ...overrides,
  };
}

function retrievalRequest() {
  return {
    identityRef: ACTOR_A,
    tenantId: TENANT_A,
    scopeId: SCOPE_A,
    permissions: [],
    purpose: "field ops briefing",
  };
}

/* ─────────────────────────────────────────────────────────────
 * Structural fake Supabase client (stateful; no network, no DB)
 * ────────────────────────────────────────────────────────────*/

type FakeRow = Record<string, unknown>;

interface TableSpec {
  rows?: FakeRow[];
  selectError?: string;
  insertError?: string;
}

function fakeSupabaseClient(
  specs: Record<string, TableSpec> = {},
  // Columns the database fills (e.g. declared_at DEFAULT now()) — filled on
  // read-back only; `inserted` keeps the raw payload the adapter sent.
  dbDefaults: Record<string, FakeRow> = {},
) {
  const inserted: Array<{ table: string; row: FakeRow }> = [];
  const filters: Array<{ table: string; column: string; value: string }> = [];
  const resolvedSpecs = new Map<string, TableSpec>();
  const specFor = (table: string): TableSpec => {
    const existing = resolvedSpecs.get(table);
    if (existing) return existing;
    const created = specs[table] ?? {};
    resolvedSpecs.set(table, created);
    return created;
  };
  const client = {
    from(table: string) {
      const spec = specFor(table);
      return {
        select(_columns: string) {
          const result = {
            data: spec.rows ?? [],
            error: spec.selectError ? { message: spec.selectError } : null,
          };
          return {
            eq(column: string, value: string) {
              filters.push({ table, column, value });
              return Promise.resolve({
                ...result,
                data: (spec.rows ?? []).filter((row) => row[column] === value),
              });
            },
            then(
              onFulfilled?: (value: typeof result) => unknown,
              onRejected?: (reason: unknown) => unknown,
            ) {
              return Promise.resolve(result).then(onFulfilled, onRejected);
            },
          };
        },
        insert(row: FakeRow) {
          inserted.push({ table, row });
          if (spec.insertError) {
            return Promise.resolve({ data: null, error: { message: spec.insertError } });
          }
          (spec.rows ??= []).push({ ...(dbDefaults[table] ?? {}), ...row });
          return Promise.resolve({ data: row, error: null });
        },
      };
    },
  };
  return { client: client as unknown as DbClient, inserted, filters, specs };
}

function dbAdapter(specs: Record<string, TableSpec> = {}) {
  const fake = fakeSupabaseClient(specs, {
    // The migration declares declared_at timestamptz NOT NULL DEFAULT now().
    cg_memory_scope: { declared_at: NOW },
  });
  return { adapter: createDbMemoryTierAdapter(fake.client), ...fake };
}

/* ─────────────────────────────────────────────────────────────
 * 1. Backend selection
 * ────────────────────────────────────────────────────────────*/

describe("memory tier backend selection (V1-005)", () => {
  it("defaults to the in-memory fallback when unset or blank", () => {
    expect(resolveMemoryTierBackend(undefined)).toBe("memory");
    expect(resolveMemoryTierBackend("")).toBe("memory");
    expect(resolveMemoryTierBackend("   ")).toBe("memory");
  });

  it("defaults to durable storage and refuses the in-memory backend in production", () => {
    expect(resolveMemoryTierBackend(undefined, "production")).toBe("db");
    expect(() => resolveMemoryTierBackend("memory", "production")).toThrow(
      /must be "db" in production/,
    );
  });

  it("accepts the registered backends", () => {
    expect(resolveMemoryTierBackend("memory")).toBe("memory");
    expect(resolveMemoryTierBackend("db")).toBe("db");
    expect(resolveMemoryTierBackend(" db ")).toBe("db");
  });

  it("throws on an unknown backend instead of silently degrading durability", () => {
    expect(() => resolveMemoryTierBackend("vector")).toThrow(
      /not a registered memory tier backend/,
    );
  });

  it("createMemoryTierAdapter returns the in-memory fallback by default", async () => {
    vi.stubEnv("MEMORY_TIER_BACKEND", "");
    const adapter = await createMemoryTierAdapter();
    expect(adapter.backend).toBe("memory");
  });

  it("createMemoryTierAdapter returns the db adapter on MEMORY_TIER_BACKEND=db", async () => {
    vi.stubEnv("MEMORY_TIER_BACKEND", "db");
    const adapter = await createMemoryTierAdapter();
    expect(adapter.backend).toBe("db");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. In-memory fallback adapter (test default)
 * ────────────────────────────────────────────────────────────*/

describe("in-memory memory tier adapter — the fallback backend", () => {
  it("round-trips declare → write → retrieve behind the adapter interface", async () => {
    const adapter = createInMemoryMemoryTierAdapter();
    const declared = await adapter.declareScope({ scope: scopeA(), declaredBy: ACTOR_A });
    if (!declared.ok) throw new Error(declared.error);
    const written = await adapter.writeRecord(writeRequest());
    if (!written.ok) throw new Error(written.error);

    const result = await adapter.retrieve(retrievalRequest(), { now: NOW });
    expect(result.ok).toBe(true);
    expect(result.records.map((r) => r.id)).toEqual(["mem:alpha:001"]);

    const loaded = await adapter.load();
    const store = unwrapStore(loaded);
    expect(store.records).toHaveLength(1);
    expect(store.scopes).toHaveLength(1);
  });

  it("surfaces pure contract rejections as typed results", async () => {
    const adapter = createInMemoryMemoryTierAdapter();
    await adapter.declareScope({ scope: scopeA(), declaredBy: ACTOR_A });
    const rejected = await adapter.writeRecord(writeRequest({ domain: "hr" }));
    expect(rejected.ok).toBe(false);
  });

  it("requires declaredBy provenance (§12) on scope declaration", async () => {
    const adapter = createInMemoryMemoryTierAdapter();
    const rejected = await adapter.declareScope({ scope: scopeA(), declaredBy: "   " });
    expect(rejection(rejected)).toMatch(/declaredBy/);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. DB adapter — declareScope → cg_memory_scope
 * ────────────────────────────────────────────────────────────*/

describe("db memory tier adapter — declareScope", () => {
  it("persists the declared scope with declared_by provenance (§12)", async () => {
    const { adapter, inserted } = dbAdapter();
    const result = await adapter.declareScope({ scope: scopeA(), declaredBy: ACTOR_A });
    expect(result.ok).toBe(true);

    expect(inserted).toHaveLength(1);
    expect(inserted[0].table).toBe("cg_memory_scope");
    const row = inserted[0].row;
    expect(row.id).toBe(SCOPE_A);
    expect(row.tenant_id).toBe(TENANT_A);
    expect(row.mission_ref).toBe("mission:MISSION-R-36");
    expect(row.actor_scope).toEqual([ACTOR_A]);
    expect(row.domains).toEqual(["field-ops", "roster"]);
    expect(row.max_sensitivity).toBe("internal");
    expect(row.declared_by).toBe(ACTOR_A);
    // declared_at is database record time (column default) — never backdated.
    expect(row).not.toHaveProperty("declared_at");
  });

  it("rejects a duplicate declaration through the pure contract and writes nothing", async () => {
    const { adapter, inserted } = dbAdapter();
    await adapter.declareScope({ scope: scopeA(), declaredBy: ACTOR_A });
    const duplicate = await adapter.declareScope({ scope: scopeA(), declaredBy: ACTOR_A });
    expect(rejection(duplicate)).toMatch(/already declared/);
    expect(inserted).toHaveLength(1);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. DB adapter — writeRecord → cg_memory_record
 * ────────────────────────────────────────────────────────────*/

describe("db memory tier adapter — writeRecord", () => {
  it("persists the full envelope and bi-temporal columns for an accepted write", async () => {
    const { adapter, inserted } = dbAdapter();
    await adapter.declareScope({ scope: scopeA(), declaredBy: ACTOR_A });
    const result = await adapter.writeRecord(writeRequest());
    expect(result.ok).toBe(true);

    expect(inserted).toHaveLength(2);
    expect(inserted[1].table).toBe("cg_memory_record");
    const row = inserted[1].row;
    expect(row.id).toBe("mem:alpha:001");
    expect(row.tenant_id).toBe(TENANT_A);
    expect(row.scope_id).toBe(SCOPE_A);
    expect(row.memory_class).toBe("practical");
    expect(row.domain).toBe("field-ops");
    expect(row.content).toMatch(/Route B is closed/);
    // Provenance (§12): envelope stamped verbatim — who/when/source.
    expect(row.created_by).toBe(ACTOR_A);
    expect(row.updated_by).toBe(ACTOR_A);
    expect(row.recorded_at).toBe(NOW);
    expect(row.provenance).toMatchObject({
      source: "workforce:field-agent",
      originTenantId: TENANT_A,
    });
    expect(row.object_type).toBe("memory_record");
    expect(row.trace_id).toBe("trace:memory-1");
    expect(row.correlation_id).toBe("corr:memory-1");
    // Bi-temporal validity (V1CAP-004).
    expect(row.valid_from).toBe(NOW);
    expect(row.valid_until).toBeNull();
    expect(row.valid_time_known).toBe(true);
    expect(row.supersedes).toBeNull();
  });

  it("rejects a pure-contract out-of-scope write BEFORE touching the database", async () => {
    const { adapter, inserted } = dbAdapter();
    await adapter.declareScope({ scope: scopeA(), declaredBy: ACTOR_A });
    const rejected = await adapter.writeRecord(writeRequest({ domain: "hr" }));
    expect(rejection(rejected)).toMatch(/no silent scope expansion/);
    expect(inserted).toHaveLength(1); // scope insert only
  });

  it("rejects a subject-named write fail-closed (no subject column is authored)", async () => {
    const { adapter, inserted } = dbAdapter();
    await adapter.declareScope({ scope: scopeA(), declaredBy: ACTOR_A });
    const rejected = await adapter.writeRecord(writeRequest({ subjectRef: "worker:subject-1" }));
    expect(rejection(rejected)).toMatch(/subjectRef/);
    expect(rejection(rejected)).toMatch(/§12|provenance/i);
    expect(inserted).toHaveLength(1); // scope insert only
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. DB adapter — retrieve → cg_memory_access_log (audit)
 * ────────────────────────────────────────────────────────────*/

describe("db memory tier adapter — retrieve", () => {
  it("returns authorized records and audits the granted attempt", async () => {
    const { adapter, inserted } = dbAdapter();
    await adapter.declareScope({ scope: scopeA(), declaredBy: ACTOR_A });
    await adapter.writeRecord(writeRequest());

    const result = await adapter.retrieve(retrievalRequest(), { now: NOW });
    expect(result.ok).toBe(true);
    expect(result.records.map((r) => r.id)).toEqual(["mem:alpha:001"]);

    const accessRow = inserted.find((i) => i.table === "cg_memory_access_log");
    expect(accessRow).toBeDefined();
    expect(accessRow?.row.outcome).toBe("granted");
    expect(accessRow?.row.identity_ref).toBe(ACTOR_A);
    expect(accessRow?.row.scope_id).toBe(SCOPE_A);
    expect(accessRow?.row.returned_record_ids).toEqual(["mem:alpha:001"]);
    expect(accessRow?.row.recorded_at).toBe(NOW);
  });

  it("persists an audit row for every memory retrieval assembled into model context", async () => {
    const { adapter, inserted } = dbAdapter();
    await adapter.declareScope({ scope: scopeA(), declaredBy: ACTOR_A });
    await adapter.writeRecord(writeRequest());

    const context = await assembleMemoryContext(
      {
        scopeId: SCOPE_A,
        permissions: [],
        domains: ["field-ops"],
        maxSensitivity: "internal",
        maxAgeSeconds: 3600,
        maxItems: 5,
        maxChars: 2000,
        tenantRef: TENANT_A,
        actorRef: ACTOR_A,
        purpose: "field operations briefing",
        missionRef: "mission:MISSION-R-36",
        now: NOW,
      },
      adapter,
    );

    expect(context.assembledContent).toContain("Route B is closed");
    const accessRows = inserted.filter((row) => row.table === "cg_memory_access_log");
    expect(accessRows).toHaveLength(1);
    expect(accessRows[0].row).toMatchObject({
      tenant_id: TENANT_A,
      identity_ref: ACTOR_A,
      scope_id: SCOPE_A,
      outcome: "granted",
      returned_record_ids: ["mem:alpha:001"],
    });
  });

  it("excludes same-tenant records from another scope and persists the exclusion", async () => {
    const { adapter, inserted } = dbAdapter();
    await adapter.declareScope({ scope: scopeA(), declaredBy: ACTOR_A });
    await adapter.declareScope({
      scope: {
        ...scopeA(),
        scopeId: "scope:alpha:other",
      },
      declaredBy: ACTOR_A,
    });
    await adapter.writeRecord(writeRequest());
    await adapter.writeRecord(
      writeRequest({
        recordId: "mem:alpha:other",
        scopeId: "scope:alpha:other",
      }),
    );

    const result = await adapter.retrieve(retrievalRequest(), { now: NOW });

    expect(result.records.map((record) => record.id)).toEqual(["mem:alpha:001"]);
    expect(result.accessRecord.exclusions).toEqual([
      expect.objectContaining({
        recordId: "mem:alpha:other",
        reason: "outside_declared_scope",
      }),
    ]);
    expect(inserted.find((i) => i.table === "cg_memory_access_log")?.row.exclusions).toEqual([
      expect.objectContaining({
        recordId: "mem:alpha:other",
        reason: "outside_declared_scope",
      }),
    ]);
  });

  it("audits a DENIED attempt (undeclared scope) with the denial reason", async () => {
    const { adapter, inserted } = dbAdapter();
    await adapter.declareScope({ scope: scopeA(), declaredBy: ACTOR_A });

    const denied = await adapter.retrieve(
      { ...retrievalRequest(), scopeId: "scope:alpha:undeclared" },
      { now: NOW },
    );
    expect(denied.ok).toBe(false);
    expect(denied.outcome).toBe("denied");

    const accessRows = inserted.filter((i) => i.table === "cg_memory_access_log");
    expect(accessRows).toHaveLength(1);
    expect(accessRows[0].row.outcome).toBe("denied");
    expect(accessRows[0].row.denial_reason).toMatch(/not declared/);
    expect(accessRows[0].row.returned_record_ids).toEqual([]);
  });

  it("fails retrieval CLOSED when the access audit cannot be persisted", async () => {
    const { adapter } = dbAdapter({
      cg_memory_access_log: { insertError: "audit insert refused" },
    });
    await expect(adapter.retrieve(retrievalRequest(), { now: NOW })).rejects.toThrow(
      /persistence failed for cg_memory_access_log/,
    );
  });

  it("uses unique audit ids and reads access history only for the requesting tenant", async () => {
    const { adapter, inserted, filters } = dbAdapter({
      // A foreign tenant's access audit already occupies mem-access-000001.
      cg_memory_access_log: {
        rows: [
          {
            id: "mem-access-000001",
            tenant_id: "tenant-beta",
            identity_ref: null,
            scope_id: null,
            purpose: "",
            outcome: "denied",
            returned_record_ids: [],
            exclusions: [],
            denial_reason: "x",
            recorded_at: NOW,
          },
        ],
      },
    });
    await adapter.declareScope({ scope: scopeA(), declaredBy: ACTOR_A });
    await adapter.writeRecord(writeRequest());
    const first = await adapter.retrieve(retrievalRequest(), { now: NOW });
    const second = await adapter.retrieve(retrievalRequest(), { now: NOW });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const accessRows = inserted.filter((row) => row.table === "cg_memory_access_log");
    expect(accessRows).toHaveLength(2);
    const accessIds = accessRows.map((row) => row.row.id);
    expect(accessIds[0]).toMatch(
      /^mem-access-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(accessIds[1]).toMatch(
      /^mem-access-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(accessIds[0]).not.toBe(accessIds[1]);
    expect(first.store.accessLog.map((row) => row.tenantId)).toEqual([TENANT_A]);
    expect(
      filters.some(
        (filter) =>
          filter.table === "cg_memory_access_log" &&
          filter.column === "tenant_id" &&
          filter.value === TENANT_A,
      ),
    ).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 6. DB adapter — untrusted reads + load
 * ────────────────────────────────────────────────────────────*/

describe("db memory tier adapter — load and untrusted row validation", () => {
  it("round-trips a persisted record back through the contract (envelope re-validated)", async () => {
    const { adapter } = dbAdapter();
    await adapter.declareScope({ scope: scopeA(), declaredBy: ACTOR_A });
    const written = await adapter.writeRecord(writeRequest());
    if (!written.ok) throw new Error(written.error);

    const loaded = await adapter.load();
    const store = unwrapStore(loaded);
    expect(store.records).toHaveLength(1);
    expect(store.records[0]).toEqual(written.record);
    expect(store.scopes).toHaveLength(1);
    expect(store.accessLog).toHaveLength(0);
  });

  it("reports a backend failure as a typed load error (never throws)", async () => {
    const { adapter } = dbAdapter({
      cg_memory_scope: { selectError: "database unreachable" },
    });
    const loaded = await adapter.load();
    expect(rejection(loaded)).toMatch(/load failed for cg_memory_scope/);
  });

  it("fails closed on a malformed cg_memory_record row (missing envelope)", async () => {
    const { adapter } = dbAdapter({
      cg_memory_record: {
        rows: [{ id: "mem:alpha:001", tenant_id: TENANT_A, content: "unstamped" }],
      },
    });
    const loaded = await adapter.load();
    expect(rejection(loaded)).toMatch(/row validation failed for cg_memory_record/);
  });

  it("loads an empty contract store from an empty backend", async () => {
    const { adapter } = dbAdapter();
    const loaded = await adapter.load();
    const store = unwrapStore(loaded);
    expect(store).toEqual(createMemoryTierStore());
  });
});
