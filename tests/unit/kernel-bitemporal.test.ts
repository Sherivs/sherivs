/**
 * CoreGrid — Bi-temporal discipline (V1CAP-004, MISSION-R-13 / J-003).
 *
 * Proves, at unit level, that:
 *  1. valid_time (when the fact was true in reality) is distinguished from
 *     record_time (when the system learned it) on every kernel record;
 *  2. as-of-VALID-time reconstruction is correct under late-arriving data,
 *     out-of-order records and append-only corrections (supersession with
 *     valid-time overlap handling);
 *  3. as-of-RECORD-time reconstruction never leaks records that did not
 *     exist yet, and record time is never backdated;
 *  4. unknown validity is explicitly representable and flagged — never
 *     silently assumed "now";
 *  5. supersession is append-only with a pointer: chains, cycles, dangling
 *     and cross-tenant pointers fail closed;
 *  6. as-of views are tenant-isolated;
 *  7. every bi-temporal record still passes the canonical envelope gate
 *     (V1CAP-002 compatibility);
 *  8. the bi-temporal migration and its rollback stay mechanically coherent
 *     with the TypeScript contract.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  KERNEL_BITEMPORAL_COLUMNS,
  asOfRecordTime,
  asOfValidTime,
  biTemporalColumns,
  biTemporalValidity,
  entityDraft,
  eventDraft,
  isLateArrival,
  isTimestamp,
  observationDraft,
  resolveSupersession,
  validateKernelRowEnvelope,
  type BiTemporalRecord,
  type KernelObjectEnvelopeInput,
} from "@/lib/kernel/reality";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATION = readFileSync(
  join(ROOT, "database/supabase/migrations/20261002000003_coregrid_v1_kernel_bitemporal.sql"),
  "utf8",
);
const ROLLBACK = readFileSync(
  join(ROOT, "database/supabase/rollbacks/20261002000003_coregrid_v1_kernel_bitemporal.sql"),
  "utf8",
);

const KNOWN_OBJECT_TYPES = [
  "core.entity",
  "core.relationship",
  "core.event",
  "core.observation",
] as const;

function baseEnvelope(overrides: Partial<KernelObjectEnvelopeInput> = {}): KernelObjectEnvelopeInput {
  return {
    objectType: "core.event",
    schemaVersion: "1.0",
    status: "active",
    createdBy: "identity:engineer-1",
    updatedBy: "identity:engineer-1",
    provenance: { source: "kernel:test", originTenantId: "tenant-1" },
    policyContext: { policy: "core.data.internal" },
    traceId: "trace-1",
    correlationId: "corr-1",
    declaredOrigin: "kernel:test:bootstrap",
    ...overrides,
  };
}

/** Known-validity record: true in reality from valid_from (open-ended by default). */
function knownRecord(overrides: Partial<BiTemporalRecord> & { id: string }): BiTemporalRecord {
  return {
    tenant_id: "tenant-1",
    valid_from: "2026-10-02T10:00:00.000Z",
    valid_until: null,
    valid_time_known: true,
    recorded_at: "2026-10-02T10:05:00.000Z",
    supersedes: null,
    ...overrides,
  };
}

/** Explicitly unknown-validity record: flagged, never assumed "now". */
function unknownRecord(overrides: Partial<BiTemporalRecord> & { id: string }): BiTemporalRecord {
  return {
    tenant_id: "tenant-1",
    valid_from: null,
    valid_until: null,
    valid_time_known: false,
    recorded_at: "2026-10-02T10:05:00.000Z",
    supersedes: null,
    ...overrides,
  };
}

const ids = (records: readonly BiTemporalRecord[]) => records.map((r) => r.id);

describe("bi-temporal contract — vocabulary", () => {
  it("lists exactly the bi-temporal columns the migration must author", () => {
    expect(KERNEL_BITEMPORAL_COLUMNS).toEqual([
      "valid_from",
      "valid_until",
      "valid_time_known",
      "supersedes",
    ]);
  });

  it("accepts ISO-8601 timestamps and rejects everything else", () => {
    expect(isTimestamp("2026-10-02T10:00:00.000Z")).toBe(true);
    expect(isTimestamp("2026-10-02 10:00:00")).toBe(true);
    expect(isTimestamp("2026-10-02")).toBe(true);
    expect(isTimestamp("not-a-time")).toBe(false);
    expect(isTimestamp("2026-13-40T00:00:00Z")).toBe(false);
    expect(isTimestamp(1760000000000)).toBe(false);
  });
});

describe("bi-temporal contract — write-path columns (fail-closed)", () => {
  it("builds known-validity columns: bounded and open-ended", () => {
    expect(
      biTemporalColumns({
        validFrom: "2026-10-02T10:00:00.000Z",
        validUntil: "2026-10-02T11:00:00.000Z",
      }),
    ).toEqual({
      valid_from: "2026-10-02T10:00:00.000Z",
      valid_until: "2026-10-02T11:00:00.000Z",
      valid_time_known: true,
      supersedes: null,
    });
    expect(biTemporalColumns({ validFrom: "2026-10-02T10:00:00.000Z" })).toEqual({
      valid_from: "2026-10-02T10:00:00.000Z",
      valid_until: null,
      valid_time_known: true,
      supersedes: null,
    });
  });

  it("represents explicitly unknown validity as flagged, with no interval", () => {
    expect(biTemporalColumns({ validTimeKnown: false })).toEqual({
      valid_from: null,
      valid_until: null,
      valid_time_known: false,
      supersedes: null,
    });
  });

  it("requires an explicit validity declaration — never a silent assumption", () => {
    expect(() => biTemporalColumns({})).toThrow(/valid time must be explicit/);
    expect(() => biTemporalColumns({ validTimeKnown: true })).toThrow(/valid time must be explicit/);
  });

  it("rejects unknown-validity records that claim an interval", () => {
    expect(() =>
      biTemporalColumns({ validTimeKnown: false, validFrom: "2026-10-02T10:00:00.000Z" }),
    ).toThrow(/flagged unknown must not claim/);
  });

  it("rejects inverted, empty and malformed intervals", () => {
    expect(() =>
      biTemporalColumns({
        validFrom: "2026-10-02T11:00:00.000Z",
        validUntil: "2026-10-02T10:00:00.000Z",
      }),
    ).toThrow(/strictly after/);
    expect(() =>
      biTemporalColumns({
        validFrom: "2026-10-02T10:00:00.000Z",
        validUntil: "2026-10-02T10:00:00.000Z",
      }),
    ).toThrow(/strictly after/);
    expect(() => biTemporalColumns({ validFrom: "yesterday" })).toThrow(/ISO-8601/);
  });

  it("validates the supersession pointer format", () => {
    expect(() => biTemporalColumns({ validFrom: "2026-10-02T10:00:00.000Z", supersedes: "" }))
      .toThrow(/supersedes/);
    expect(() => biTemporalColumns({ validFrom: "2026-10-02T10:00:00.000Z", supersedes: "x".repeat(161) }))
      .toThrow(/supersedes/);
  });
});

describe("bi-temporal as-of-VALID-time reconstruction", () => {
  it("applies late-arriving data only after its record time", () => {
    // Sensor fact valid from 10:00 but the system learned it at 12:00.
    const late = knownRecord({
      id: "late-1",
      valid_from: "2026-10-02T10:00:00.000Z",
      recorded_at: "2026-10-02T12:00:00.000Z",
    });
    const onTime = knownRecord({ id: "ontime-1" });
    const records = [late, onTime];

    // Without a record-time cutoff, the true history includes the late fact.
    const truth = asOfValidTime(records, "2026-10-02T10:30:00.000Z");
    expect(ids(truth.applicable).sort()).toEqual(["late-1", "ontime-1"]);

    // Before 12:00 the system could not have known it.
    const believed = asOfValidTime(records, "2026-10-02T10:30:00.000Z", {
      recordedAsOf: "2026-10-02T11:00:00.000Z",
    });
    expect(ids(believed.applicable)).toEqual(["ontime-1"]);
    expect(ids(believed.unknownValidity)).toEqual([]);

    // At the cutoff instant itself the record is already known (inclusive).
    const boundary = asOfValidTime(records, "2026-10-02T10:30:00.000Z", {
      recordedAsOf: "2026-10-02T12:00:00.000Z",
    });
    expect(ids(boundary.applicable).sort()).toEqual(["late-1", "ontime-1"]);
  });

  it("reconstructs the same history from out-of-order records", () => {
    const a = knownRecord({
      id: "a",
      valid_from: "2026-10-02T10:00:00.000Z",
      recorded_at: "2026-10-02T10:20:00.000Z",
    });
    const b = knownRecord({
      id: "b",
      valid_from: "2026-10-02T09:00:00.000Z",
      valid_until: "2026-10-02T10:00:00.000Z",
      recorded_at: "2026-10-02T10:10:00.000Z",
    });
    const shuffled = asOfValidTime([a, b], "2026-10-02T09:30:00.000Z");
    const ordered = asOfValidTime([b, a], "2026-10-02T09:30:00.000Z");
    expect(ids(shuffled.applicable)).toEqual(ids(ordered.applicable));
    expect(ids(shuffled.applicable)).toEqual(["b"]);
    // Deterministic ordering: oldest record time first, ties by id.
    expect(ids(shuffled.unknownValidity)).toEqual([]);
  });

  it("uses half-open intervals: valid_from applies, valid_until does not", () => {
    const interval = knownRecord({
      id: "i1",
      valid_from: "2026-10-02T10:00:00.000Z",
      valid_until: "2026-10-02T11:00:00.000Z",
    });
    expect(ids(asOfValidTime([interval], "2026-10-02T10:00:00.000Z").applicable)).toEqual(["i1"]);
    expect(ids(asOfValidTime([interval], "2026-10-02T10:59:59.999Z").applicable)).toEqual(["i1"]);
    expect(asOfValidTime([interval], "2026-10-02T11:00:00.000Z").applicable).toEqual([]);
  });

  it("flags unknown-validity records instead of assuming 'now'", () => {
    const unknown = unknownRecord({ id: "u1" });
    const legacy = unknownRecord({ id: "u2", valid_time_known: null });
    const view = asOfValidTime([unknown, legacy], "2026-10-02T10:30:00.000Z");
    expect(view.applicable).toEqual([]);
    expect(ids(view.unknownValidity)).toEqual(["u1", "u2"]);
    expect(biTemporalValidity(unknown).validity).toBe("unknown");
    expect(biTemporalValidity(legacy).validity).toBe("unknown");
  });

  it("represents future-dated facts: learned before the fact becomes true", () => {
    // A scheduled fact the system recorded at 10:00 but that is only valid
    // from 18:00 is well-formed — valid time may lie ahead of record time.
    // ("Never backdated" constrains record TIME rewrites, not future facts.)
    const scheduled = knownRecord({
      id: "scheduled",
      valid_from: "2026-10-02T18:00:00.000Z",
      recorded_at: "2026-10-02T10:00:00.000Z",
    });
    expect(isLateArrival(scheduled)).toBe(false);
    expect(ids(asOfValidTime([scheduled], "2026-10-02T10:30:00.000Z").applicable)).toEqual([]);
    expect(ids(asOfValidTime([scheduled], "2026-10-02T18:30:00.000Z").applicable)).toEqual([
      "scheduled",
    ]);
  });

  it("rejects records without record time and malformed as-of instants", () => {
    const noRecordTime = knownRecord({ id: "x", recorded_at: null });
    expect(() => asOfValidTime([noRecordTime], "2026-10-02T10:30:00.000Z")).toThrow(/recorded_at/);
    expect(() =>
      asOfValidTime([knownRecord({ id: "y" })], "not-a-time"),
    ).toThrow(/ISO-8601/);
  });
});

describe("bi-temporal corrections — append-only supersession", () => {
  it("retires the corrected record only over the superseding record's overlap", () => {
    const original = knownRecord({
      id: "original",
      valid_from: "2026-10-02T10:00:00.000Z",
      recorded_at: "2026-10-02T10:05:00.000Z",
    });
    // Correction recorded later, claiming the SAME open-ended interval.
    const correction = knownRecord({
      id: "correction",
      valid_from: "2026-10-02T10:00:00.000Z",
      recorded_at: "2026-10-02T12:00:00.000Z",
      supersedes: "original",
    });

    // Full knowledge: the correction speaks for reality at 10:30.
    const full = asOfValidTime([original, correction], "2026-10-02T10:30:00.000Z");
    expect(ids(full.applicable)).toEqual(["correction"]);
    expect(ids(full.supersededAtAsOf)).toEqual(["original"]);

    // A correction recorded later never retroactively rewrites the past.
    const past = asOfValidTime([original, correction], "2026-10-02T10:30:00.000Z", {
      recordedAsOf: "2026-10-02T11:00:00.000Z",
    });
    expect(ids(past.applicable)).toEqual(["original"]);
    expect(ids(past.supersededAtAsOf)).toEqual([]);
  });

  it("keeps the earlier history intact when the correction starts later", () => {
    const original = knownRecord({
      id: "original",
      valid_from: "2026-10-02T10:00:00.000Z",
      recorded_at: "2026-10-02T10:05:00.000Z",
    });
    const correction = knownRecord({
      id: "correction",
      valid_from: "2026-10-02T15:00:00.000Z",
      recorded_at: "2026-10-02T16:00:00.000Z",
      supersedes: "original",
    });
    // At 10:30 the correction does not overlap: the original record was true.
    expect(ids(asOfValidTime([original, correction], "2026-10-02T10:30:00.000Z").applicable)).toEqual([
      "original",
    ]);
    // At 15:30 the correction overlaps and wins; the original is retired there.
    const later = asOfValidTime([original, correction], "2026-10-02T15:30:00.000Z");
    expect(ids(later.applicable)).toEqual(["correction"]);
    expect(ids(later.supersededAtAsOf)).toEqual(["original"]);
  });

  it("resolves deep supersession chains and fails closed on broken ones", () => {
    const a = knownRecord({ id: "a", recorded_at: "2026-10-02T10:05:00.000Z" });
    const b = knownRecord({ id: "b", recorded_at: "2026-10-02T11:00:00.000Z", supersedes: "a" });
    const c = knownRecord({ id: "c", recorded_at: "2026-10-02T12:00:00.000Z", supersedes: "b" });
    const resolved = resolveSupersession([a, b, c]);
    expect(ids(resolved.live)).toEqual(["c"]);
    expect(ids(resolved.superseded).sort()).toEqual(["a", "b"]);

    // Self-supersession, dangling pointer, cycle, duplicate id.
    expect(() => resolveSupersession([knownRecord({ id: "s", supersedes: "s" })])).toThrow(
      /supersedes itself/,
    );
    expect(() => resolveSupersession([knownRecord({ id: "d", supersedes: "ghost" })])).toThrow(
      /outside the record set/,
    );
    expect(() =>
      resolveSupersession([
        knownRecord({ id: "c1", supersedes: "c2" }),
        knownRecord({ id: "c2", supersedes: "c1" }),
      ]),
    ).toThrow(/cycle/);
    expect(() =>
      resolveSupersession([knownRecord({ id: "dup" }), knownRecord({ id: "dup" })]),
    ).toThrow(/duplicate id/);
  });

  it("rejects cross-tenant supersession pointers", () => {
    const tenantOne = knownRecord({ id: "t1", tenant_id: "tenant-1" });
    const tenantTwo = knownRecord({ id: "t2", tenant_id: "tenant-2", supersedes: "t1" });
    expect(() => resolveSupersession([tenantOne, tenantTwo])).toThrow(/cross-tenant/);
    // Null-tenant rows are a different (scope-less) tenant, not a wildcard.
    expect(() =>
      resolveSupersession([knownRecord({ id: "n1", tenant_id: null }), knownRecord({ id: "n2", tenant_id: null, supersedes: "n1" })]),
    ).not.toThrow();
  });

  it("classifies late arrivals against a tolerance", () => {
    const late = knownRecord({
      id: "late",
      valid_from: "2026-10-02T10:00:00.000Z",
      recorded_at: "2026-10-02T12:00:00.000Z",
    });
    expect(isLateArrival(late)).toBe(true);
    expect(isLateArrival(late, 3 * 60 * 60 * 1000)).toBe(false);
    expect(isLateArrival(unknownRecord({ id: "u" }))).toBe(false);
  });
});

describe("bi-temporal as-of-RECORD-time reconstruction", () => {
  it("partitions the timeline by record time and never leaks future records", () => {
    const first = knownRecord({ id: "first", recorded_at: "2026-10-02T10:00:00.000Z" });
    const second = knownRecord({ id: "second", recorded_at: "2026-10-02T11:00:00.000Z" });
    const future = knownRecord({ id: "future", recorded_at: "2026-10-02T18:00:00.000Z" });
    const view = asOfRecordTime([future, second, first], "2026-10-02T11:00:00.000Z");
    expect(ids(view.known)).toEqual(["first", "second"]);
    expect(ids(view.notYetKnown)).toEqual(["future"]);
    // Inclusive at the boundary; input order is irrelevant (chronological out).
    const boundary = asOfRecordTime([first], "2026-10-02T10:00:00.000Z");
    expect(ids(boundary.known)).toEqual(["first"]);
  });

  it("never backdates record time at the write path", () => {
    const NOW = "2026-10-02T20:00:00.000Z";
    const event = eventDraft(
      {
        eventType: "reading.taken",
        aggregateType: "device",
        aggregateId: "device-1",
        tenantId: "tenant-1",
        occurredAt: "2026-10-02T10:00:00.000Z",
        biTemporal: { validFrom: "2026-10-02T10:00:00.000Z" },
      },
      NOW,
    );
    // occurred_at (valid time) may be in the past; recorded_at never is.
    expect(event.occurred_at).toBe("2026-10-02T10:00:00.000Z");
    expect(event.recorded_at).toBe(NOW);
    expect(event.valid_from).toBe("2026-10-02T10:00:00.000Z");
    expect(event.valid_time_known).toBe(true);
  });
});

describe("bi-temporal tenant isolation of as-of views", () => {
  it("excludes out-of-scope and scope-less records when a tenant scope is given", () => {
    const tenantOne = knownRecord({ id: "t1", tenant_id: "tenant-1" });
    const tenantTwo = knownRecord({
      id: "t2",
      tenant_id: "tenant-2",
      valid_from: "2026-10-02T09:00:00.000Z",
    });
    const scopeLess = knownRecord({ id: "n", tenant_id: null });
    const scoped = asOfValidTime([tenantOne, tenantTwo, scopeLess], "2026-10-02T10:30:00.000Z", {
      tenantId: "tenant-1",
    });
    expect(ids(scoped.applicable)).toEqual(["t1"]);

    // Every bucket is scoped, not just `applicable`.
    const unknownOther = unknownRecord({ id: "u2", tenant_id: "tenant-2" });
    const unknownScoped = asOfValidTime(
      [unknownRecord({ id: "u1" }), unknownOther],
      "2026-10-02T10:30:00.000Z",
      { tenantId: "tenant-1" },
    );
    expect(ids(unknownScoped.unknownValidity)).toEqual(["u1"]);

    // Without a scope the caller gets the full mixed set (service-role view).
    const unscoped = asOfValidTime([tenantOne, tenantTwo, scopeLess], "2026-10-02T10:30:00.000Z");
    expect(ids(unscoped.applicable).sort()).toEqual(["n", "t1", "t2"]);
  });
});

describe("bi-temporal ↔ envelope compatibility (V1CAP-002)", () => {
  it("keeps stamped bi-temporal kernel records passing the envelope gate", () => {
    const entity = entityDraft(
      {
        entityType: "device",
        tenantId: "tenant-1",
        biTemporal: { validFrom: "2026-10-02T10:00:00.000Z", supersedes: "entity-0" },
        envelope: { ...baseEnvelope({ objectType: "core.entity" }), causationId: "cause-1" },
      },
      "2026-10-02T20:00:00.000Z",
    );
    // cg_entity maps valid_until onto its substrate valid_to column.
    expect(entity.valid_from).toBe("2026-10-02T10:00:00.000Z");
    expect(entity.valid_to).toBeNull();
    expect(entity.valid_time_known).toBe(true);
    expect(entity.supersedes).toBe("entity-0");
    expect(() =>
      validateKernelRowEnvelope({ id: "entity-1", ...entity }, KNOWN_OBJECT_TYPES),
    ).not.toThrow();

    const event = eventDraft(
      {
        eventType: "reading.taken",
        aggregateType: "device",
        aggregateId: "device-1",
        tenantId: "tenant-1",
        biTemporal: { validTimeKnown: false },
        envelope: baseEnvelope(),
      },
      "2026-10-02T20:00:00.000Z",
    );
    expect(event.valid_time_known).toBe(false);
    expect(event.valid_from).toBeNull();
    expect(() =>
      validateKernelRowEnvelope({ id: "event-1", ...event }, KNOWN_OBJECT_TYPES),
    ).not.toThrow();

    const observation = observationDraft(
      {
        subjectEntityId: "entity-1",
        kind: "observed",
        tenantId: "tenant-1",
        biTemporal: {
          validFrom: "2026-10-02T10:00:00.000Z",
          validUntil: "2026-10-02T12:00:00.000Z",
        },
        envelope: { ...baseEnvelope({ objectType: "core.observation" }), causationId: "cause-2" },
      },
      "2026-10-02T20:00:00.000Z",
    );
    expect(observation.valid_until).toBe("2026-10-02T12:00:00.000Z");
    expect(() =>
      validateKernelRowEnvelope({ id: "obs-1", ...observation }, KNOWN_OBJECT_TYPES),
    ).not.toThrow();
  });

  it("rejects a bi-temporal stamp combined with the legacy entity validity inputs", () => {
    expect(() =>
      entityDraft(
        {
          entityType: "device",
          validFrom: "2026-10-02T10:00:00.000Z",
          biTemporal: { validFrom: "2026-10-02T10:00:00.000Z" },
        },
        "2026-10-02T20:00:00.000Z",
      ),
    ).toThrow(/declared once/);
  });

  it("keeps legacy drafts untouched — no half-stamped bi-temporal rows", () => {
    const draft = entityDraft({ entityType: "device", tenantId: "tenant-1" }, "2026-10-02T20:00:00.000Z");
    expect("valid_time_known" in draft).toBe(false);
    expect("supersedes" in draft).toBe(false);
    expect(draft.recorded_at).toBe("2026-10-02T20:00:00.000Z");
  });
});

describe("bi-temporal migration ↔ contract coherence", () => {
  it("is authored-not-applied in both migration and rollback", () => {
    expect(MIGRATION).toMatch(/AUTHORED, NOT APPLIED/);
    expect(ROLLBACK).toMatch(/AUTHORED, NOT APPLIED/);
  });

  it("authors the canonical valid_until pair on cg_event and cg_observation", () => {
    for (const table of ["cg_event", "cg_observation"]) {
      for (const column of KERNEL_BITEMPORAL_COLUMNS) {
        expect(
          MIGRATION,
          `${table}.${column} must be authored additively`,
        ).toMatch(
          new RegExp(`ALTER TABLE public\\.${table}[^;]*ADD COLUMN IF NOT EXISTS ${column}\\b`),
        );
        expect(ROLLBACK, `${table}.${column} must be dropped in rollback`).toContain(
          `DROP COLUMN IF EXISTS ${column}`,
        );
      }
    }
  });

  it("adds only the flag and pointer to cg_entity (substrate owns its validity pair)", () => {
    // [^;]* keeps the assertion inside the cg_entity ALTER statement — a lazy
    // [\s\S]*? could reach into a later table's columns.
    expect(MIGRATION).toMatch(
      /ALTER TABLE public\.cg_entity[^;]*ADD COLUMN IF NOT EXISTS valid_time_known\b/,
    );
    expect(MIGRATION).toMatch(
      /ALTER TABLE public\.cg_entity[^;]*ADD COLUMN IF NOT EXISTS supersedes\b/,
    );
    expect(MIGRATION).not.toMatch(
      /ALTER TABLE public\.cg_entity[^;]*ADD COLUMN IF NOT EXISTS valid_from\b/,
    );
    expect(MIGRATION).not.toMatch(
      /ALTER TABLE public\.cg_entity[^;]*ADD COLUMN IF NOT EXISTS valid_until\b/,
    );
  });

  it("enforces explicit-validity and half-open-interval invariants in SQL", () => {
    expect(MIGRATION).toContain("cg_event_bitemporal_validity");
    expect(MIGRATION).toContain("cg_observation_bitemporal_validity");
    expect(MIGRATION).toContain("cg_entity_bitemporal_validity");
    expect(MIGRATION).toContain("valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from");
    expect(MIGRATION).toContain("valid_time_known IS FALSE AND valid_from IS NULL");
    expect(MIGRATION).toContain("supersedes IS NULL OR supersedes <> id");
  });

  it("makes record time immutable at the database boundary", () => {
    expect(MIGRATION).toContain("cg_guard_record_time_immutable");
    expect(MIGRATION).toContain("cg_entity_record_time_immutable");
    expect(MIGRATION).toContain("cg_event_record_time_immutable");
    expect(MIGRATION).toContain("cg_observation_record_time_immutable");
    expect(MIGRATION).toMatch(/record time is never backdated|record_time is immutable/i);
    for (const trigger of [
      "cg_entity_record_time_immutable",
      "cg_event_record_time_immutable",
      "cg_observation_record_time_immutable",
    ]) {
      expect(ROLLBACK).toContain(`DROP TRIGGER IF EXISTS ${trigger}`);
    }
    expect(ROLLBACK).toContain("DROP FUNCTION IF EXISTS public.cg_guard_record_time_immutable()");
  });

  it("keeps the mission scope: cg_relationship is not altered, security posture untouched", () => {
    expect(MIGRATION).not.toMatch(/ALTER TABLE public\.cg_relationship/);
    expect(MIGRATION).not.toMatch(/GRANT /i);
    expect(MIGRATION).toMatch(/RLS stays enabled/);
  });
});
