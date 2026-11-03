/**
 * MISSION-R-36 / J-016 + J-017 (V1CAP-034/035/036) — durable
 * practical/organizational memory tier with authorization-gated retrieval.
 *
 * Proves, at unit level, that:
 *  1. class discipline holds: only practical/organizational memory classes
 *     exist (the civilization tier is V2 and unrepresentable here, V2CAP-020);
 *  2. retrieval is fail-closed on the J-017 axis: no identity, no tenant, or
 *     no declared scope denies retrieval before any record is evaluated, and
 *     every denial still appends an auditable access record;
 *  3. access records are complete (identity, tenant, scope, purpose,
 *     returned ids, exclusions, denial reason, audit instant);
 *  4. writes are scope-bounded (no silent memory expansion, J-017/E-027):
 *     exceeding the declared scope on any axis is rejected, never clamped;
 *  5. records are envelope-bearing (V1CAP-002) and bi-temporally explicit
 *     (V1CAP-004), with cross-tenant supersession rejected;
 *  6. cross-tenant isolation holds at the store layer, with a
 *     defense-in-depth exclusion for foreign-tenant candidates;
 *  7. exclusions are first-class records (the memory twin of
 *     context-assembly's drop ledger) and there is no vector-only retrieval
 *     path (G-015);
 *  8. the repository migration and rollback preserve their deny-by-default
 *     RLS posture (enabled, zero policies, no client grants) as structural
 *     checks on the SQL files; production state is reconciled in ADR-021.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MEMORY_TIER_CLASSES,
  declareMemoryScope,
  createMemoryTierStore,
  retrieveMemory,
  writeMemoryRecord,
  type MemoryWriteRequest,
} from "@/lib/memory/memory-store";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATION = readFileSync(
  join(ROOT, "database/supabase/migrations/20261002000004_coregrid_v1_memory_tier.sql"),
  "utf8",
);
const ROLLBACK = readFileSync(
  join(ROOT, "database/supabase/rollbacks/20261002000004_coregrid_v1_memory_tier.sql"),
  "utf8",
);

const TENANT_A = "tenant-alpha";
const TENANT_B = "tenant-beta";
const ACTOR_A = "01970000-0000-7000-8000-0000000000a1";
const ACTOR_B = "01970000-0000-7000-8000-0000000000b1";
const SCOPE_A = "scope:alpha:field-ops";
const SCOPE_B = "scope:beta:field-ops";
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

function envelopeInput(overrides?: Record<string, unknown>) {
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
    ...overrides,
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

/** A store with scope A (tenant A) and scope B (tenant B) declared. */
function storeWithScopes() {
  const base = createMemoryTierStore();
  const withA = declareMemoryScope(base, scopeA());
  if (!withA.ok) throw new Error(withA.error);
  const withB = declareMemoryScope(withA.store, {
    scopeId: SCOPE_B,
    tenantId: TENANT_B,
    missionRef: null,
    actorScope: [ACTOR_B],
    domains: ["field-ops"],
    maxSensitivity: "internal",
  });
  if (!withB.ok) throw new Error(withB.error);
  return withB.store;
}

function storeWithRecord(overrides?: Partial<MemoryWriteRequest>) {
  const base = storeWithScopes();
  const result = writeMemoryRecord(base, writeRequest(overrides));
  if (!result.ok) throw new Error(`fixture record rejected: ${result.error}`);
  return { store: result.store, record: result.record };
}

function retrieval(overrides?: Record<string, unknown>) {
  return {
    identityRef: ACTOR_A,
    tenantId: TENANT_A,
    scopeId: SCOPE_A,
    permissions: [] as readonly string[],
    purpose: "field-operations",
    ...overrides,
  };
}

/* ─────────────────────────────────────────────────────────────
 * 1. Class discipline (V1CAP-034)
 * ────────────────────────────────────────────────────────────*/

describe("memory class discipline (V1CAP-034)", () => {
  it("registers exactly the practical and organizational classes", () => {
    expect([...MEMORY_TIER_CLASSES].sort()).toEqual(["organizational", "practical"]);
  });

  it("accepts both classes through the same scope-bounded write path", () => {
    const base = storeWithScopes();
    for (const memoryClass of MEMORY_TIER_CLASSES) {
      const result = writeMemoryRecord(
        base,
        writeRequest({ recordId: `mem:${memoryClass}:001`, memoryClass }),
      );
      expect(result.ok).toBe(true);
    }
  });

  it("rejects a memory class outside the V1 tier split", () => {
    const result = writeMemoryRecord(
      storeWithScopes(),
      writeRequest({ memoryClass: "civilization" as "practical" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not a registered V1 memory tier class");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Authorization-gated retrieval — fail-closed (J-017)
 * ────────────────────────────────────────────────────────────*/

describe("authorization-gated retrieval (J-017 / G-015)", () => {
  it("denies retrieval with no identity, before any record is evaluated", () => {
    const { store } = storeWithRecord();
    const result = retrieveMemory(store, retrieval({ identityRef: "" }), { now: NOW });
    expect(result.ok).toBe(false);
    expect(result.records).toEqual([]);
    expect(result.accessRecord.outcome).toBe("denied");
    expect(result.accessRecord.denialReason).toContain("no identity");
  });

  it("denies retrieval with no tenant, before any record is evaluated", () => {
    const { store } = storeWithRecord();
    const result = retrieveMemory(store, retrieval({ tenantId: "" }), { now: NOW });
    expect(result.ok).toBe(false);
    expect(result.records).toEqual([]);
    expect(result.accessRecord.denialReason).toContain("no tenant");
  });

  it("denies retrieval with no declared scope, before any record is evaluated", () => {
    const { store } = storeWithRecord();
    const result = retrieveMemory(store, retrieval({ scopeId: "" }), { now: NOW });
    expect(result.ok).toBe(false);
    expect(result.records).toEqual([]);
    expect(result.accessRecord.denialReason).toContain("no declared scope");
  });

  it("denies retrieval naming an undeclared scope", () => {
    const { store } = storeWithRecord();
    const result = retrieveMemory(store, retrieval({ scopeId: "scope:undeclared" }), { now: NOW });
    expect(result.ok).toBe(false);
    expect(result.accessRecord.denialReason).toContain("not declared");
  });

  it("denies retrieval using a scope declared under a DIFFERENT tenant", () => {
    const { store } = storeWithRecord();
    const result = retrieveMemory(store, retrieval({ scopeId: SCOPE_B }), { now: NOW });
    expect(result.ok).toBe(false);
    expect(result.records).toEqual([]);
    expect(result.accessRecord.denialReason).toContain('bound to tenant "tenant-beta"');
  });

  it("denies retrieval when the caller's mission does not match the declared scope", () => {
    const { store } = storeWithRecord();
    const result = retrieveMemory(store, retrieval({ missionRef: "mission:OTHER" }), { now: NOW });
    expect(result.ok).toBe(false);
    expect(result.records).toEqual([]);
    expect(result.accessRecord.denialReason).toContain("bound to mission");
  });

  it("excludes records assigned to a different scope in the same tenant", () => {
    const base = storeWithScopes();
    const otherScope = declareMemoryScope(base, {
      scopeId: "scope:alpha:other",
      tenantId: TENANT_A,
      missionRef: "mission:MISSION-R-36",
      actorScope: [ACTOR_A],
      domains: ["field-ops"],
      maxSensitivity: "internal",
    });
    if (!otherScope.ok) throw new Error(otherScope.error);
    const inScope = writeMemoryRecord(otherScope.store, writeRequest());
    if (!inScope.ok) throw new Error(inScope.error);
    const crossScope = writeMemoryRecord(
      inScope.store,
      writeRequest({ recordId: "mem:alpha:other", scopeId: "scope:alpha:other" }),
    );
    if (!crossScope.ok) throw new Error(crossScope.error);

    const result = retrieveMemory(crossScope.store, retrieval(), { now: NOW });

    expect(result.records.map((record) => record.id)).toEqual(["mem:alpha:001"]);
    expect(result.accessRecord.exclusions).toEqual([
      expect.objectContaining({
        recordId: "mem:alpha:other",
        reason: "outside_declared_scope",
      }),
    ]);
  });

  it("denies an identity outside the declared scope's actorScope", () => {
    const { store } = storeWithRecord();
    const result = retrieveMemory(store, retrieval({ identityRef: ACTOR_B }), { now: NOW });
    expect(result.ok).toBe(false);
    expect(result.records).toEqual([]);
    expect(result.accessRecord.denialReason).toContain("outside the declared scope's actorScope");
  });

  it("returns an authorized in-scope record", () => {
    const { store, record } = storeWithRecord();
    const result = retrieveMemory(store, retrieval(), { now: NOW });
    expect(result.ok).toBe(true);
    expect(result.records.map((r) => r.id)).toEqual([record.id]);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Access-record completeness (audit)
 * ────────────────────────────────────────────────────────────*/

describe("auditable access records", () => {
  it("records identity, tenant, scope, purpose, outcome and audit instant on a grant", () => {
    const { store, record } = storeWithRecord();
    const result = retrieveMemory(store, retrieval({ purpose: "morning briefing" }), { now: NOW });
    expect(result.accessRecord).toMatchObject({
      id: "mem-access-000001",
      tenantId: TENANT_A,
      identityRef: ACTOR_A,
      scopeId: SCOPE_A,
      purpose: "morning briefing",
      outcome: "granted",
      returnedRecordIds: [record.id],
      exclusions: [],
      denialReason: null,
      recordedAt: NOW,
    });
    expect(result.store.accessLog).toHaveLength(1);
  });

  it("appends an access record for a DENIED retrieval too — denials leave evidence", () => {
    const { store } = storeWithRecord();
    const denied = retrieveMemory(store, retrieval({ identityRef: "" }), { now: NOW });
    expect(denied.accessRecord.outcome).toBe("denied");
    expect(denied.accessRecord.identityRef).toBeNull();
    expect(denied.store.accessLog).toHaveLength(1);

    const deniedAgain = retrieveMemory(denied.store, retrieval({ tenantId: "" }), { now: NOW });
    expect(deniedAgain.accessRecord.id).toBe("mem-access-000002");
    expect(deniedAgain.store.accessLog).toHaveLength(2);
  });

  it("marks a retrieval with both returns and exclusions as partial", () => {
    const base = storeWithRecord().store;
    const second = writeMemoryRecord(
      base,
      writeRequest({
        recordId: "mem:alpha:002",
        domain: "roster",
        requiredPermission: "memory:restricted-read",
      }),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("fixture record rejected");
    const result = retrieveMemory(second.store, retrieval(), { now: NOW });
    expect(result.outcome).toBe("partial");
    expect(result.records.map((r) => r.id)).toEqual(["mem:alpha:001"]);
    expect(result.accessRecord.exclusions.map((e) => e.recordId)).toEqual(["mem:alpha:002"]);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. Scope-bound writes — no silent memory expansion (J-017/E-027)
 * ────────────────────────────────────────────────────────────*/

describe("scope-bound writes (no silent memory expansion)", () => {
  it("rejects a write through an undeclared scope", () => {
    const result = writeMemoryRecord(storeWithScopes(), writeRequest({ scopeId: "scope:ghost" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("no silent scope expansion");
  });

  it("rejects a write whose actor is outside the scope's actorScope", () => {
    const result = writeMemoryRecord(storeWithScopes(), writeRequest({ identityRef: ACTOR_B }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("outside the declared scope's actorScope");
  });

  it("rejects a cross-tenant write through a declared scope", () => {
    const result = writeMemoryRecord(storeWithScopes(), writeRequest({ tenantId: TENANT_B }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("cross-tenant");
  });

  it("rejects a write whose mission does not match the scope's mission", () => {
    const result = writeMemoryRecord(
      storeWithScopes(),
      writeRequest({ missionRef: "mission:OTHER" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("no silent scope expansion");
  });

  it("rejects a write whose domain is outside the scope's domains", () => {
    const result = writeMemoryRecord(storeWithScopes(), writeRequest({ domain: "payroll" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("outside the declared scope's domains");
  });

  it("rejects a write whose sensitivity exceeds the scope ceiling (never clamped)", () => {
    const result = writeMemoryRecord(
      storeWithScopes(),
      writeRequest({ sensitivity: "restricted" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("exceeds the declared scope ceiling");
    // Rejected, NOT clamped: no record was stored at the ceiling.
    expect(storeWithScopes().records).toHaveLength(0);
  });

  it("rejects a duplicate record id", () => {
    const { store } = storeWithRecord();
    const result = writeMemoryRecord(store, writeRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("already exists");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. Envelope + bi-temporal compatibility (V1CAP-002 / V1CAP-004)
 * ────────────────────────────────────────────────────────────*/

describe("envelope and bi-temporal record shape", () => {
  it("stores a fully stamped envelope and explicit bi-temporal validity", () => {
    const { record } = storeWithRecord();
    expect(record.envelope.object_type).toBe("memory_record");
    expect(record.envelope.provenance.source).toBe("workforce:field-agent");
    expect(record.envelope.provenance.originTenantId).toBe(TENANT_A);
    expect(record.biTemporal).toMatchObject({
      valid_from: NOW,
      valid_until: null,
      valid_time_known: true,
      supersedes: null,
    });
    expect(record.recordedAt).toBe(NOW);
  });

  it("rejects an unstamped (anonymous) memory record", () => {
    const envelope = envelopeInput();
    const result = writeMemoryRecord(
      storeWithScopes(),
      writeRequest({
        envelope: { ...envelope, traceId: "" },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("envelope rejected");
  });

  it("rejects an envelope whose object_type is not the memory substrate's type", () => {
    const result = writeMemoryRecord(
      storeWithScopes(),
      writeRequest({ envelope: envelopeInput({ objectType: "core.event" }) }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('must be "memory_record"');
  });

  it("rejects a cross-tenant envelope provenance", () => {
    const result = writeMemoryRecord(
      storeWithScopes(),
      writeRequest({
        envelope: envelopeInput({
          provenance: { source: "external", originTenantId: TENANT_B },
        }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("cross-tenant");
  });

  it("rejects non-explicit bi-temporal validity (never silently assumed)", () => {
    const result = writeMemoryRecord(storeWithScopes(), writeRequest({ biTemporal: {} }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("valid time must be explicit");
  });

  it("represents unknown validity explicitly (flagged, never assumed)", () => {
    const result = writeMemoryRecord(
      storeWithScopes(),
      writeRequest({ recordId: "mem:alpha:unknown", biTemporal: { validTimeKnown: false } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.record.biTemporal.valid_time_known).toBe(false);
  });

  it("supports append-only supersession within the same tenant", () => {
    const { store } = storeWithRecord();
    const corrected = writeMemoryRecord(
      store,
      writeRequest({
        recordId: "mem:alpha:002",
        content: "Route B is closed until Monday",
        biTemporal: { validFrom: NOW, supersedes: "mem:alpha:001" },
      }),
    );
    expect(corrected.ok).toBe(true);
    // The superseded record is withheld from retrieval, with an exclusion.
    const result = retrieveMemory(corrected.ok ? corrected.store : store, retrieval(), {
      now: NOW,
    });
    expect(result.records.map((r) => r.id)).toEqual(["mem:alpha:002"]);
    expect(result.exclusions[0]).toMatchObject({
      recordId: "mem:alpha:001",
      reason: "superseded",
    });
  });

  it("rejects a cross-tenant supersession pointer", () => {
    const beta = writeMemoryRecord(
      storeWithScopes(),
      writeRequest({
        recordId: "mem:beta:001",
        scopeId: SCOPE_B,
        identityRef: ACTOR_B,
        tenantId: TENANT_B,
        missionRef: null,
        envelope: envelopeInput({ provenance: { source: "beta", originTenantId: TENANT_B } }),
      }),
    );
    expect(beta.ok).toBe(true);
    if (!beta.ok) return;
    const result = writeMemoryRecord(
      beta.store,
      writeRequest({ biTemporal: { validFrom: NOW, supersedes: "mem:beta:001" } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("cross-tenant");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 6. Cross-tenant isolation
 * ────────────────────────────────────────────────────────────*/

describe("cross-tenant isolation", () => {
  it("never returns another tenant's record", () => {
    const base = storeWithScopes();
    const alpha = writeMemoryRecord(base, writeRequest({ recordId: "mem:alpha:secret" }));
    expect(alpha.ok).toBe(true);
    if (!alpha.ok) return;
    const beta = writeMemoryRecord(
      alpha.store,
      writeRequest({
        recordId: "mem:beta:secret",
        scopeId: SCOPE_B,
        identityRef: ACTOR_B,
        tenantId: TENANT_B,
        missionRef: null,
        envelope: envelopeInput({ provenance: { source: "beta", originTenantId: TENANT_B } }),
      }),
    );
    expect(beta.ok).toBe(true);
    if (!beta.ok) return;

    const alphaView = retrieveMemory(beta.store, retrieval(), { now: NOW });
    expect(alphaView.records.map((r) => r.id)).toEqual(["mem:alpha:secret"]);

    const betaView = retrieveMemory(
      beta.store,
      retrieval({ identityRef: ACTOR_B, tenantId: TENANT_B, scopeId: SCOPE_B }),
      { now: NOW },
    );
    expect(betaView.records.map((r) => r.id)).toEqual(["mem:beta:secret"]);
    expect(alphaView.records.some((r) => r.tenantId === TENANT_B)).toBe(false);
    expect(betaView.records.some((r) => r.tenantId === TENANT_A)).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 7. Exclusion ledger + non-vector-only retrieval (G-015)
 * ────────────────────────────────────────────────────────────*/

describe("exclusion ledger (nothing withheld silently)", () => {
  it("records permission-withheld in-scope records as first-class exclusions", () => {
    const base = storeWithRecord().store;
    const guarded = writeMemoryRecord(
      base,
      writeRequest({
        recordId: "mem:alpha:guarded",
        requiredPermission: "memory:restricted-read",
      }),
    );
    expect(guarded.ok).toBe(true);
    const result = retrieveMemory(guarded.ok ? guarded.store : base, retrieval(), { now: NOW });
    expect(result.exclusions[0]).toMatchObject({
      recordId: "mem:alpha:guarded",
      reason: "permission_denied",
      requiredPermission: "memory:restricted-read",
      recordedAt: NOW,
    });
  });

  it("records stale and validity-expired records as exclusions, never returns them", () => {
    const base = storeWithScopes();
    // Open-ended validity but stale freshness -> excluded as stale.
    const stale = writeMemoryRecord(
      base,
      writeRequest({
        recordId: "mem:alpha:stale",
        freshnessAt: "2026-09-01T00:00:00Z",
        biTemporal: { validFrom: "2026-09-01T00:00:00Z" },
      }),
    );
    expect(stale.ok).toBe(true);
    // Fresh freshness but validity ended before `now` -> excluded as expired.
    const expired = writeMemoryRecord(
      stale.ok ? stale.store : base,
      writeRequest({
        recordId: "mem:alpha:expired",
        freshnessAt: FRESH,
        biTemporal: { validFrom: "2026-09-01T00:00:00Z", validUntil: "2026-09-02T00:00:00Z" },
      }),
    );
    expect(expired.ok).toBe(true);
    const result = retrieveMemory(
      expired.ok ? expired.store : base,
      retrieval({ maxAgeSeconds: 3600 }),
      { now: NOW },
    );
    expect(result.records).toEqual([]);
    expect(result.exclusions.map((e) => e.reason).sort()).toEqual(["stale", "validity_expired"]);
  });

  it("budgets: in-scope authorized records beyond maxResults are excluded, not dropped", () => {
    const base = storeWithRecord().store;
    const second = writeMemoryRecord(base, writeRequest({ recordId: "mem:alpha:002" }));
    expect(second.ok).toBe(true);
    const result = retrieveMemory(second.ok ? second.store : base, retrieval({ maxResults: 1 }), {
      now: NOW,
    });
    expect(result.records).toHaveLength(1);
    expect(result.exclusions[0]).toMatchObject({ reason: "item_budget" });
    expect(result.outcome).toBe("partial");
  });

  it("is non-vector-only: purpose-text overlap never bypasses authorization (G-015)", () => {
    // The guarded record's content matches the retrieval purpose exactly, but
    // the retrieval request carries NO similarity/embedding surface and the
    // caller lacks the record's required permission: withheld, recorded.
    const base = storeWithRecord({
      recordId: "mem:alpha:similar",
      content: "field-operations route briefing",
      requiredPermission: "memory:restricted-read",
    }).store;
    const result = retrieveMemory(base, retrieval({ purpose: "field-operations route briefing" }), {
      now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.records).toEqual([]);
    expect(result.exclusions[0]?.reason).toBe("permission_denied");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 8. Repository migration + rollback structure
 * ────────────────────────────────────────────────────────────*/

describe("memory tier repository migration posture", () => {
  it("authors all three cg_memory tables with deny-by-default RLS", () => {
    for (const table of ["cg_memory_scope", "cg_memory_record", "cg_memory_access_log"]) {
      expect(MIGRATION).toContain(`CREATE TABLE IF NOT EXISTS public.${table} (`);
      expect(MIGRATION).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(MIGRATION).toContain(`REVOKE ALL ON public.${table} FROM anon, authenticated;`);
    }
  });

  it("authors ZERO RLS policies (no grant path exists yet)", () => {
    expect(MIGRATION).not.toContain("CREATE POLICY");
  });

  it("pins the record object_type and the envelope atomicity", () => {
    expect(MIGRATION).toContain(
      "cg_memory_record_object_type CHECK (object_type = 'memory_record')",
    );
    expect(MIGRATION).toContain("cg_memory_record_envelope_atomic");
    expect(MIGRATION).toContain("cg_memory_record_envelope_causation_root");
    expect(MIGRATION).toContain("created_by          text NOT NULL");
  });

  it("authors the bi-temporal and same-tenant integrity constraints", () => {
    expect(MIGRATION).toContain("cg_memory_record_bitemporal");
    expect(MIGRATION).toContain("cg_memory_record_scope_fk");
    expect(MIGRATION).toContain("cg_memory_record_supersedes_fk");
    expect(MIGRATION).toContain(
      "memory_class        text NOT NULL CHECK (memory_class IN ('practical','organizational'))",
    );
    expect(MIGRATION).toContain(
      "sensitivity         text NOT NULL CHECK (sensitivity IN ('public','internal','restricted'))",
    );
  });

  it("authored NO embedding/vector/similarity column (G-015)", () => {
    // Prose in the header comments discusses the law; the pin is on the
    // authored DDL: strip comment lines AND dollar-quoted COMMENT prose
    // (the Management-API transport requires dollar-quoted comment strings,
    // which the line filters below cannot recognise), then assert no column
    // carries a vector/embedding/similarity type or name.
    const ddl = MIGRATION.replace(/\$comment\$[\s\S]*?\$comment\$/g, "")
      .split("\n")
      .filter(
        (line) =>
          !line.trim().startsWith("--") &&
          !line.trim().toUpperCase().startsWith("COMMENT") &&
          !line.trim().startsWith("'"),
      )
      .join("\n")
      .toLowerCase();
    expect(ddl).not.toContain("embedding");
    expect(ddl).not.toContain("vector");
    expect(ddl).not.toContain("similarity");
  });

  it("authors the append-only access audit with denial recording", () => {
    expect(MIGRATION).toContain(
      "outcome              text NOT NULL CHECK (outcome IN ('granted','partial','denied'))",
    );
    expect(MIGRATION).toContain("exclusions           jsonb NOT NULL DEFAULT '[]'::jsonb");
    expect(ROLLBACK).toContain("DROP TABLE IF EXISTS public.cg_memory_access_log;");
  });

  it("drops the record table before the scope table in the rollback (FK order)", () => {
    const recordDrop = ROLLBACK.indexOf("DROP TABLE IF EXISTS public.cg_memory_record;");
    const scopeDrop = ROLLBACK.indexOf("DROP TABLE IF EXISTS public.cg_memory_scope;");
    expect(recordDrop).toBeGreaterThan(-1);
    expect(scopeDrop).toBeGreaterThan(recordDrop);
  });
});
