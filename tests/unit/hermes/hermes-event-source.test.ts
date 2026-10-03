/**
 * V1 wave team R4 (HERMES-PORT) — Hermes event→observation wiring.
 *
 * Proves, at unit level (pure adapter + structural fake Supabase client —
 * no real database, no network):
 *  1. a registered kernel event maps to a provenance-stamped, event-sourced
 *     observation recorded through the port (deterministic digest identity);
 *  2. duplicate deliveries and same-content replays collapse / replay —
 *     exactly-once recording (§10);
 *  3. fail-closed consumption: unknown event types, missing temporal
 *     coordinates and missing tenant context are rejected/excluded, never
 *     silently consumed;
 *  4. fail-closed substrate gaps: an absent cg_event substrate or an absent
 *     observation substrate aborts the ingestion with `{ ok: false }` and
 *     records NOTHING (no invented observations);
 *  5. the DB wiring reads pending cg_event rows tenant-scoped and records
 *     through HermesObservationPortDb end-to-end.
 */

import { describe, expect, it } from "vitest";
import { KERNEL_BUILTIN_EVENT_TYPES, isKnownEventType } from "@/lib/kernel/event-semantics";
import type { KernelEventRecord } from "@/lib/kernel/event-semantics";
import {
  HERMES_EVENT_SOURCE_ORIGIN,
  hermesEventObservationId,
  ingestEventsAsObservations,
  observationFromEvent,
} from "@/lib/hermes/hermes-event-source";
import { createHermesEventObservationSource } from "@/lib/hermes/hermes-event-source-db.server";
import {
  createInMemoryHermesObservationPort,
  type HermesObservationRecorder,
} from "@/lib/hermes/hermes-observation";
import {
  createHermesObservationPortDb,
  HERMES_OBSERVATION_SUBSTRATE_GAP,
} from "@/lib/hermes/hermes-observation-db.server";

/* ─────────────────────────────────────────────────────────────
 * Fixtures
 * ────────────────────────────────────────────────────────────*/

const TENANT = "tenant-alpha";
const HERMES = "hermes-1";
const NOW = "2026-10-01T12:00:00.000Z";
const T0 = "2026-10-01T11:00:00.000Z";

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

function ingest(port: HermesObservationRecorder, events: KernelEventRecord[]) {
  return ingestEventsAsObservations(port, events, {
    tenantId: TENANT,
    hermesId: HERMES,
    now: NOW,
  });
}

/* ─────────────────────────────────────────────────────────────
 * 1. Event → observation mapping (§9/§12)
 * ────────────────────────────────────────────────────────────*/

describe("Event → observation mapping", () => {
  it("the kernel builtin taxonomy is registered (the adapter consumes known types only)", () => {
    for (const declaration of KERNEL_BUILTIN_EVENT_TYPES) {
      expect(isKnownEventType(declaration.eventType)).toBe(true);
    }
  });

  it("maps a registered event to a provenance-stamped, event-sourced observation", () => {
    const mapping = observationFromEvent(event(), { tenantId: TENANT, hermesId: HERMES });
    expect(mapping.ok).toBe(true);
    if (!mapping.ok) throw new Error(mapping.reason);

    const observation = mapping.observation;
    expect(observation.observationId).toBe(hermesEventObservationId(event()));
    expect(observation.source).toBe("event");
    expect(observation.eventRef).toBe("11111111-1111-4111-8111-111111111111");
    expect(observation.kind).toBe("event_observation");
    expect(observation.tenantId).toBe(TENANT);
    expect(observation.subjectRef).toBe("cg_event:mission_execution:exec-1");
    expect(observation.declaredOrigin).toBe(HERMES_EVENT_SOURCE_ORIGIN);
    expect(observation.observedAt).toBe(T0);
    expect(observation.correlationId).toBe("corr-1");
    expect(observation.statement.eventType).toBe("core.state.changed");
    expect(observation.statement.significance).toBe("routine");
  });

  it("records the observation through the port with §12/§9 stamps the caller cannot claim", async () => {
    const port = createInMemoryHermesObservationPort();
    const result = await ingest(port, [event()]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.ingestion.recorded).toHaveLength(1);
    expect(result.ingestion.rejected).toEqual([]);

    const listed = await port.listObservations(TENANT);
    if (!listed.ok) throw new Error(listed.error);
    expect(listed.observations).toHaveLength(1);
    const observation = listed.observations[0];
    expect(observation.recordedBy).toBe(HERMES);
    expect(observation.generatedByAi).toBe(true);
    expect(observation.verified).toBe(false);
    expect(observation.source).toBe("event");
    expect(observation.recordedAt).toBe(NOW);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Exactly-once recording (§10) under duplicate delivery
 * ────────────────────────────────────────────────────────────*/

describe("Duplicate delivery collapse / replay", () => {
  it("collapses duplicate deliveries of the same event into one observation", async () => {
    const port = createInMemoryHermesObservationPort();
    const result = await ingest(port, [event(), event(), event()]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.ingestion.considered).toBe(3);
    expect(result.ingestion.collapsed).toBe(2);
    expect(result.ingestion.recorded).toHaveLength(1);
    expect(port.size()).toBe(1);
  });

  it("a same-content event with a DIFFERENT cause digests differently — never collapses", async () => {
    const port = createInMemoryHermesObservationPort();
    const first = event({ causation_id: "cause-a" });
    const second = event({ causation_id: "cause-b" });
    const result = await ingest(port, [first, second]);
    if (!result.ok) throw new Error(result.reason);
    expect(result.ingestion.recorded).toHaveLength(2);
    expect(port.size()).toBe(2);
  });

  it("an event with no id uses its digest as the event ref — still deterministic", () => {
    const idless = event({ id: null });
    const mapping = observationFromEvent(idless, { tenantId: TENANT, hermesId: HERMES });
    if (!mapping.ok) throw new Error(mapping.reason);
    expect(mapping.observation.eventRef).toMatch(/^digest:[0-9a-f]{16}$/);
    expect(hermesEventObservationId(idless)).toBe(hermesEventObservationId(event({ id: "other" })));
  });

  it("a re-ingestion over unchanged state replays — zero new observations", async () => {
    const port = createInMemoryHermesObservationPort();
    const first = await ingest(port, [event()]);
    if (!first.ok) throw new Error(first.reason);
    expect(first.ingestion.recorded).toHaveLength(1);

    const second = await ingest(port, [event()]);
    if (!second.ok) throw new Error(second.reason);
    expect(second.ingestion.recorded).toHaveLength(0);
    expect(second.ingestion.replayed).toHaveLength(1);
    expect(port.size()).toBe(1);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Fail-closed consumption (no silent classification)
 * ────────────────────────────────────────────────────────────*/

describe("Fail-closed event consumption", () => {
  it("rejects an event whose type is NOT registered in the taxonomy", async () => {
    const port = createInMemoryHermesObservationPort();
    const unregistered = event({ event_type: "totally.unknown.event" });
    expect(isKnownEventType(unregistered.event_type)).toBe(false);

    const result = await ingest(port, [unregistered]);
    expect(result.ok).toBe(true); // the BATCH is consumed; the event is rejected
    if (!result.ok) throw new Error(result.reason);
    expect(result.ingestion.recorded).toHaveLength(0);
    expect(result.ingestion.rejected).toHaveLength(1);
    expect(result.ingestion.rejected[0].reason).toContain("not registered in the event taxonomy");
    expect(port.size()).toBe(0);
  });

  it("rejects an event without a parsable temporal coordinate", async () => {
    const port = createInMemoryHermesObservationPort();
    const timeless = event({ occurred_at: null, recorded_at: null });
    const result = await ingest(port, [timeless]);
    if (!result.ok) throw new Error(result.reason);
    expect(result.ingestion.rejected.map((r) => r.reason)).toEqual([
      expect.stringContaining("no parsable occurred_at/recorded_at"),
    ]);
    expect(port.size()).toBe(0);
  });

  it("excludes events without tenant context or from another tenant (§13)", async () => {
    const port = createInMemoryHermesObservationPort();
    const result = await ingest(port, [
      event({ tenant_id: null }),
      event({ tenant_id: "tenant-beta" }),
    ]);
    if (!result.ok) throw new Error(result.reason);
    expect(result.ingestion.excludedOtherTenant).toBe(2);
    expect(result.ingestion.rejected).toEqual([]);
    expect(port.size()).toBe(0);

    // The other tenant's event is never recorded into tenant-alpha's port.
    const otherTenant = await port.listObservations("tenant-beta");
    if (!otherTenant.ok) throw new Error(otherTenant.error);
    expect(otherTenant.observations).toEqual([]);
  });

  it("rejects an event with malformed aggregate coordinates or payload", async () => {
    const port = createInMemoryHermesObservationPort();
    const result = await ingest(port, [
      event({ aggregate_type: "  " }),
      event({ payload: [1, 2, 3] as unknown as Record<string, unknown> }),
    ]);
    if (!result.ok) throw new Error(result.reason);
    expect(result.ingestion.rejected).toHaveLength(2);
    expect(port.size()).toBe(0);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. Fail-closed substrate gaps (nothing invented, nothing faked)
 * ────────────────────────────────────────────────────────────*/

describe("Fail-closed substrate gaps", () => {
  it("a recorder failure aborts the ingestion closed", async () => {
    const failingPort: HermesObservationRecorder = {
      backend: "db",
      async recordObservation() {
        return { ok: false, error: "observation_substrate_missing: injected gap" };
      },
      async listObservations() {
        return { ok: false, error: "observation_substrate_missing: injected gap" };
      },
    };
    const result = await ingest(failingPort, [event(), event({ aggregate_id: "exec-2" })]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("must fail closed");
    expect(result.reason).toContain("failed closed");
    expect(result.ingestion.recorded).toHaveLength(0);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. DB wiring: pending cg_event rows → cg_hermes_observation
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

describe("Hermes event source over the cg_event substrate (db)", () => {
  it("consumes pending events end-to-end into the observation substrate", async () => {
    const client = fakeSupabaseClient({
      cg_event: { rows: [eventRow()] },
    });
    const source = createHermesEventObservationSource(client as never);

    const result = await source.ingestPendingEvents({
      tenantId: TENANT,
      hermesId: HERMES,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.ingestion.recorded).toHaveLength(1);
    expect(result.ingestion.rejected).toEqual([]);

    // The observation landed in cg_hermes_observation, fully stamped.
    const observationInsert = client.inserted.find((i) => i.table === "cg_hermes_observation");
    expect(observationInsert).toBeDefined();
    if (!observationInsert) throw new Error("no observation persisted");
    expect(observationInsert.row.source).toBe("event");
    expect(observationInsert.row.event_ref).toBe("11111111-1111-4111-8111-111111111111");
    expect(observationInsert.row.created_by).toBe(HERMES);
    expect(observationInsert.row.generated_by_ai).toBe(true);
    expect(observationInsert.row.verified).toBe(false);

    // Read-only over cg_event: no event state was touched.
    expect(client.inserted.filter((i) => i.table === "cg_event")).toHaveLength(0);
  });

  it("FAILS CLOSED when the cg_event substrate is absent — zero observations recorded", async () => {
    const client = fakeSupabaseClient({
      cg_event: { selectError: "relation cg_event does not exist" },
    });
    const source = createHermesEventObservationSource(client as never);

    const result = await source.ingestPendingEvents({
      tenantId: TENANT,
      hermesId: HERMES,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("must fail closed");
    expect(result.reason).toContain("cg_event substrate is absent");
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
    const source = createHermesEventObservationSource(client as never);

    const result = await source.ingestPendingEvents({
      tenantId: TENANT,
      hermesId: HERMES,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("must fail closed");
    expect(result.reason).toContain(HERMES_OBSERVATION_SUBSTRATE_GAP);
    expect(client.inserted).toHaveLength(0);
  });

  it("consumes only the requested tenant's pending events (§13) and validates rows", async () => {
    const client = fakeSupabaseClient({
      cg_event: {
        rows: [
          eventRow(),
          eventRow({ id: "22222222-2222-4222-8222-222222222222", tenant_id: "tenant-beta" }),
        ],
      },
    });
    const source = createHermesEventObservationSource(client as never);

    const result = await source.ingestPendingEvents({
      tenantId: TENANT,
      hermesId: HERMES,
      now: NOW,
    });
    if (!result.ok) throw new Error(result.reason);
    // The SQL filter sees only tenant-alpha rows; nothing else is considered.
    expect(result.ingestion.considered).toBe(1);
    expect(result.ingestion.excludedOtherTenant).toBe(0);
  });

  it("a malformed cg_event row fails the batch closed", async () => {
    const client = fakeSupabaseClient({
      cg_event: { rows: [eventRow({ event_type: "" })] },
    });
    const source = createHermesEventObservationSource(client as never);
    const result = await source.ingestPendingEvents({
      tenantId: TENANT,
      hermesId: HERMES,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("row validation rejected");
  });
});
