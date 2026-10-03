/**
 * CoreGrid — H3-029 memory-retrieval authorization tests (mission C-029 /
 * L-T-015, Memory Retrieval Defender).
 *
 * Adversarial proof that memory retrieval is authorization-gated with NO
 * bypass path, across every retrieval surface of the memory domain:
 *
 * - `frontend/src/lib/memory/memory-store.ts` — the durable memory tier
 *   (`retrieveMemory`, `retrieveMemoryThroughWorkerSession`,
 *   `openWorkerMemorySession`, `terminateWorkerMemorySession`);
 * - `frontend/src/lib/context/memory-scope-enforcement.ts` — the
 *   session/mission/long-term scope gate (H3-018's module, imported
 *   read-only);
 * - `frontend/src/lib/agent-memory.ts` — the phase-07 consumer-side memory
 *   interface (`readMemory`).
 *
 * Proven invariants (Constitution §15/§16/§31, AGENTS §5/§6/§8):
 *   1. UNAUTHENTICATED retrieval is denied before any record is evaluated.
 *   2. CROSS-TENANT retrieval is denied at every layer (precondition,
 *      defense-in-depth record gate, session binding, scope gate, consumer
 *      filter).
 *   3. REVOKED / EXPIRED principals and sessions are denied (lifecycle
 *      fail-closed, session termination, scope expiry, staleness, validity
 *      expiry, missing permission, classification ceiling).
 *   4. SCOPE EXPANSION is unreachable through retrieval paths: retrieval
 *      never widens a scope, denied attempts mutate nothing, session
 *      bindings are frozen and narrower than the underlying scope, and the
 *      only widening path is an explicit, audited, typed act.
 *   5. Retrieval results NEVER LEAK beyond the authorized scope: returned
 *      records are exactly the authorized set, every withheld record is a
 *      first-class audited exclusion, exclusions carry no record content,
 *      textual overlap with the purpose cannot rescue an unauthorized
 *      record, and every outcome (granted, partial, denied) is audited.
 *
 * Pure offline suite: no network, no database, no secrets, no wall-clock —
 * time is always injected.
 */
import { describe, expect, it } from "vitest";
import {
  createMemoryTierStore,
  declareMemoryScope,
  openWorkerMemorySession,
  retrieveMemory,
  retrieveMemoryThroughWorkerSession,
  terminateWorkerMemorySession,
  writeMemoryRecord,
  type MemoryRetrievalRequest,
  type MemoryRetrievalResult,
  type MemoryScopeDeclaration,
  type MemoryTierStore,
  type MemoryWriteRequest,
  type WorkerMemoryRetrievalResult,
  type WorkerMemoryScopeInput,
  type WorkerMemorySession,
} from "@/lib/memory/memory-store";
import { defineWorkerDefinition, type WorkerDefinition } from "@/lib/workforce/worker-definition";
import {
  applyMemoryScopeExpansion,
  declareMemoryScope as declareScopeGateScope,
  emptyMemoryScopeRegistry,
  enforceMemoryScopeAccess,
  type MemoryScopeAccessRequest,
  type MemoryScopeAccessVerdict,
  type MemoryScopeDeclaration as ScopeGateMemoryScopeDeclaration,
} from "@/lib/context/memory-scope-enforcement";
import { readMemory, type MemoryEntry } from "@/lib/agent-memory";
import { agentId } from "@/lib/agent-core";
import { tenantId } from "@/lib/tenant-core";
import type { KernelObjectEnvelopeInput } from "@/lib/kernel/reality";

const TENANT_A = "tenant-alpha";
const TENANT_B = "tenant-beta";
const IDENTITY_A = "01970000-0000-7000-8000-0000000000a1";
const IDENTITY_B = "01970000-0000-7000-8000-0000000000b1";
const IDENTITY_C = "01970000-0000-7000-8000-0000000000c1";
const SCOPE_A = "scope:alpha:field-ops";
const SCOPE_B = "scope:beta:field-ops";
const MISSION = "mission:H3-029";
const NOW = "2026-10-01T12:00:00Z";
const FRESH = "2026-10-01T11:00:00Z";
const HOUR_OLD = "2026-10-01T09:30:00Z";

/* ─────────────────────────────────────────────────────────────
 * Fixtures — durable memory tier (memory-store.ts)
 * ────────────────────────────────────────────────────────────*/

function tierScopeA(): MemoryScopeDeclaration {
  return {
    scopeId: SCOPE_A,
    tenantId: TENANT_A,
    missionRef: MISSION,
    actorScope: [IDENTITY_A],
    domains: ["field-ops", "roster"],
    maxSensitivity: "internal",
  };
}

function tierScopeB(): MemoryScopeDeclaration {
  return {
    scopeId: SCOPE_B,
    tenantId: TENANT_B,
    missionRef: null,
    actorScope: [IDENTITY_B],
    domains: ["field-ops"],
    maxSensitivity: "internal",
  };
}

function tierStoreWithScopes(): MemoryTierStore {
  const a = declareMemoryScope(createMemoryTierStore(), tierScopeA());
  if (!a.ok) throw new Error(`fixture broken: ${a.error}`);
  const b = declareMemoryScope(a.store, tierScopeB());
  if (!b.ok) throw new Error(`fixture broken: ${b.error}`);
  return b.store;
}

function workerDefinition(
  overrides?: Partial<Pick<WorkerDefinition, "lifecycle" | "identityRef" | "tenantScope">>,
): WorkerDefinition {
  const result = defineWorkerDefinition({
    id: "worker:field-agent:alpha",
    tenantScope: overrides?.tenantScope ?? TENANT_A,
    identityRef: overrides?.identityRef ?? IDENTITY_A,
    classification: "ai",
    capabilities: [
      { capabilityId: "memory:field-notes", description: "Field-note memory stewardship" },
    ],
    authorityBounds: { maxRiskClass: "medium", resourceScopes: ["memory:field-notes"] },
    lifecycle: overrides?.lifecycle ?? "active",
  });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.definition;
}

function bindingScope(overrides?: Partial<WorkerMemoryScopeInput>): WorkerMemoryScopeInput {
  return {
    scopeId: SCOPE_A,
    writableTierClasses: ["practical"],
    readableTierClasses: ["practical"],
    namespaces: ["field-ops"],
    subjects: ["subject:scholar:001"],
    maxSensitivity: "internal",
    ...overrides,
  };
}

function openSession(
  store: MemoryTierStore = tierStoreWithScopes(),
  overrides?: {
    sessionId?: string;
    workerDefinition?: WorkerDefinition;
    scope?: WorkerMemoryScopeInput;
  },
): { store: MemoryTierStore; session: WorkerMemorySession } {
  const result = openWorkerMemorySession(store, {
    sessionId: overrides?.sessionId ?? "session:field-agent:alpha:001",
    workerDefinition: overrides?.workerDefinition ?? workerDefinition(),
    scope: overrides?.scope ?? bindingScope(),
    openedAt: NOW,
  });
  if (!result.ok) throw new Error(result.error);
  return result;
}

function envelopeInput(overrides?: Partial<KernelObjectEnvelopeInput>): KernelObjectEnvelopeInput {
  return {
    objectType: "memory_record",
    schemaVersion: "1.0",
    status: "active",
    createdBy: IDENTITY_A,
    updatedBy: IDENTITY_A,
    provenance: { source: "workforce:field-agent", originTenantId: TENANT_A, verified: false },
    policyContext: { purpose: "field-operations" },
    traceId: "trace:h3-029-1",
    correlationId: "corr:h3-029-1",
    declaredOrigin: MISSION,
    ...overrides,
  };
}

function writeRequest(overrides?: Partial<MemoryWriteRequest>): MemoryWriteRequest {
  return {
    recordId: "mem:alpha:001",
    scopeId: SCOPE_A,
    identityRef: IDENTITY_A,
    tenantId: TENANT_A,
    missionRef: MISSION,
    memoryClass: "practical",
    domain: "field-ops",
    subjectRef: null,
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

/** Raw tier write used to seed records with precise gate-relevant shapes. */
function seedRecord(
  store: MemoryTierStore,
  overrides?: Partial<MemoryWriteRequest>,
): MemoryTierStore {
  const result = writeMemoryRecord(store, writeRequest(overrides));
  if (!result.ok) throw new Error(`seed record rejected: ${result.error}`);
  return result.store;
}

function retrievalRequest(
  overrides?: Partial<MemoryRetrievalRequest>,
): MemoryRetrievalRequest {
  return {
    identityRef: IDENTITY_A,
    tenantId: TENANT_A,
    scopeId: SCOPE_A,
    permissions: [],
    purpose: "field-operations recall",
    ...overrides,
  };
}

function retrievalConfig(now: string = NOW): { now: string } {
  return { now };
}

type TierRetrievalResult = MemoryRetrievalResult | WorkerMemoryRetrievalResult;

/** Narrows a tier retrieval to the denied variant, asserting denial on the way. */
function expectTierDenied<T extends TierRetrievalResult>(result: T): Extract<T, { ok: false }> {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected a denial");
  return result as Extract<T, { ok: false }>;
}

function expectTierGranted<T extends TierRetrievalResult>(result: T): Extract<T, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected a grant");
  return result as Extract<T, { ok: true }>;
}

/**
 * Accepts any terminal retrieval (a retrieval that evaluated records and
 * produced an access record). A retrieval that returns zero records is
 * `ok:false` with outcome "partial" by contract — still a fully gated,
 * fully audited evaluation.
 */
function expectTierEvaluated<T extends TierRetrievalResult>(result: T): T {
  return result;
}

/** A separate tenant-A scope (wider ceiling, wider domains) used ONLY to seed out-of-scope records. */
const SEED_SCOPE_ID = "scope:alpha:seeding";

function ensureSeedingScope(store: MemoryTierStore): MemoryTierStore {
  if (store.scopes.some((s) => s.scopeId === SEED_SCOPE_ID)) return store;
  const result = declareMemoryScope(store, {
    scopeId: SEED_SCOPE_ID,
    tenantId: TENANT_A,
    missionRef: MISSION,
    actorScope: [IDENTITY_A],
    domains: ["field-ops", "roster", "finance"],
    maxSensitivity: "restricted",
  });
  if (!result.ok) throw new Error(`fixture broken: ${result.error}`);
  return result.store;
}

/**
 * Seeds a record that is OUTSIDE the retrieval scope under test (SCOPE_A):
 * written through the seeding scope, then withheld by SCOPE_A's gates —
 * proving the retrieval gates fire on records the write path legitimately
 * produced under a wider declared scope.
 */
function seedWideRecord(
  store: MemoryTierStore,
  overrides?: Partial<MemoryWriteRequest>,
): MemoryTierStore {
  const withScope = ensureSeedingScope(store);
  const result = writeMemoryRecord(withScope, writeRequest({ scopeId: SEED_SCOPE_ID, ...overrides }));
  if (!result.ok) throw new Error(`seed wide record rejected: ${result.error}`);
  return result.store;
}

/* ─────────────────────────────────────────────────────────────
 * Fixtures — scope gate (memory-scope-enforcement.ts, read-only)
 * ────────────────────────────────────────────────────────────*/

function scopeGateDeclaration(
  overrides?: Partial<ScopeGateMemoryScopeDeclaration>,
): ScopeGateMemoryScopeDeclaration {
  return {
    scopeKey: "session-scope-alpha",
    tenantRef: TENANT_A,
    tier: "session",
    principals: [IDENTITY_A],
    domains: ["field_ops"],
    maxSensitivity: "internal",
    actions: ["read", "write"],
    missionRef: null,
    sessionBinding: { sessionRef: "session-1", expiresAt: "2026-10-01T18:00:00.000Z" },
    provenance: {
      declaredBy: "role:memory-scope-governor",
      authorityRef: "H3 mission C-029 fixture provenance",
      declaredAt: "2026-10-01T06:00:00.000Z",
    },
    ...overrides,
  };
}

function scopeGateRegistry(overrides?: Partial<ScopeGateMemoryScopeDeclaration>) {
  const result = declareScopeGateScope(emptyMemoryScopeRegistry(), scopeGateDeclaration(overrides));
  if (!result.ok) throw new Error(`fixture broken: ${result.error}`);
  return result.registry;
}

function scopeGateAccess(overrides?: Partial<MemoryScopeAccessRequest>): MemoryScopeAccessRequest {
  return {
    scopeKey: "session-scope-alpha",
    tenantRef: TENANT_A,
    principalRef: IDENTITY_A,
    action: "read",
    domain: "field_ops",
    sensitivity: "internal",
    purpose: "bounded recall under a declared scope",
    ...overrides,
  };
}

function expectGateDenied(verdict: MemoryScopeAccessVerdict): { reason: string; detail: string } {
  expect(verdict.verdict).toBe("denied");
  if (verdict.verdict !== "denied") throw new Error("expected a denial verdict");
  return { reason: verdict.reason, detail: verdict.detail };
}

/* ─────────────────────────────────────────────────────────────
 * Fixtures — phase-07 consumer surface (agent-memory.ts, read-only)
 * ────────────────────────────────────────────────────────────*/

function consumerEntry(
  overrides?: Partial<Omit<MemoryEntry, "id">> & { id?: string },
): MemoryEntry {
  return {
    id: (overrides?.id ?? "mem-entry-001") as MemoryEntry["id"],
    tenantId: overrides?.tenantId ?? tenantId(TENANT_A),
    agentId: overrides?.agentId ?? agentId(IDENTITY_A),
    category: overrides?.category ?? "working",
    content: overrides?.content ?? "shift handover notes",
    provenance: overrides?.provenance ?? { kind: "authoritative", source: "user" },
    dataClassification: overrides?.dataClassification ?? "TENANT_INTERNAL",
    createdAt: overrides?.createdAt ?? NOW,
    expiresAt: overrides?.expiresAt ?? null,
  };
}

/* ═════════════════════════════════════════════════════════════
 * 1. UNAUTHENTICATED RETRIEVAL — denied before any record is evaluated
 * ═════════════════════════════════════════════════════════════*/

describe("unauthenticated retrieval is denied (fail-closed, J-017)", () => {
  it("denies a retrieval with an empty identity — zero records, audited", () => {
    const store = seedRecord(tierStoreWithScopes());
    const result = expectTierDenied(
      retrieveMemory(store, retrievalRequest({ identityRef: "" }), retrievalConfig()),
    );
    expect(result.outcome).toBe("denied");
    expect(result.records).toHaveLength(0);
    expect(result.accessRecord.outcome).toBe("denied");
    expect(result.accessRecord.denialReason).toContain("no identity");
    expect(result.accessRecord.returnedRecordIds).toHaveLength(0);
    expect(result.store.accessLog).toHaveLength(1);
  });

  it("denies a whitespace-only identity (not a name — not an identity)", () => {
    const result = expectTierDenied(
      retrieveMemory(tierStoreWithScopes(), retrievalRequest({ identityRef: "   " }), retrievalConfig()),
    );
    expect(result.outcome).toBe("denied");
    expect(result.records).toHaveLength(0);
  });

  it("denies a retrieval with no tenant context", () => {
    const result = expectTierDenied(
      retrieveMemory(tierStoreWithScopes(), retrievalRequest({ tenantId: "" }), retrievalConfig()),
    );
    expect(result.accessRecord.denialReason).toContain("no tenant");
    expect(result.records).toHaveLength(0);
  });

  it("denies a retrieval with no declared scope", () => {
    const result = expectTierDenied(
      retrieveMemory(tierStoreWithScopes(), retrievalRequest({ scopeId: "" }), retrievalConfig()),
    );
    expect(result.accessRecord.denialReason).toContain("no declared scope");
    expect(result.records).toHaveLength(0);
  });

  it("denies an UNDECLARED scope — and the failed attempt creates nothing", () => {
    const store = tierStoreWithScopes();
    const result = expectTierDenied(
      retrieveMemory(store, retrievalRequest({ scopeId: "scope:ghost" }), retrievalConfig()),
    );
    expect(result.accessRecord.denialReason).toContain("not declared");
    expect(result.store.scopes).toHaveLength(2);
    expect(result.store.records).toHaveLength(0);
  });

  it("denies an identity that is not in the declared scope's actorScope", () => {
    const store = seedRecord(tierStoreWithScopes());
    const result = expectTierDenied(
      retrieveMemory(store, retrievalRequest({ identityRef: IDENTITY_C }), retrievalConfig()),
    );
    expect(result.accessRecord.denialReason).toContain("outside the declared scope's actorScope");
    expect(result.records).toHaveLength(0);
  });

  it("scope gate: an empty principal is denied — an unauthenticated principal grants nothing", () => {
    const verdict = expectGateDenied(
      enforceMemoryScopeAccess(scopeGateRegistry(), scopeGateAccess({ principalRef: "" }), {
        now: NOW,
      }),
    );
    expect(verdict.reason).toBe("principal_not_in_scope");
  });

  it("consumer surface: readMemory returns nothing for an empty agent id even when same-tenant entries exist", () => {
    const entries = [consumerEntry()];
    const result = readMemory(
      {
        tenantId: tenantId(TENANT_A),
        agentId: agentId(""),
        category: "working",
        purpose: "unauthenticated recall attempt",
        dataClassification: "TENANT_INTERNAL",
      },
      entries,
      ["working"],
      "TENANT_INTERNAL",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected an empty (not denied) consumer result");
    expect(result.entries).toHaveLength(0);
  });
});

/* ═════════════════════════════════════════════════════════════
 * 2. CROSS-TENANT RETRIEVAL — denied at every layer
 * ═════════════════════════════════════════════════════════════*/

describe("cross-tenant retrieval is denied end-to-end", () => {
  it("denies a retrieval whose tenant does not match the declared scope's tenant", () => {
    const store = seedRecord(tierStoreWithScopes());
    const result = expectTierDenied(
      retrieveMemory(store, retrievalRequest({ tenantId: TENANT_B }), retrievalConfig()),
    );
    expect(result.accessRecord.denialReason).toContain(`bound to tenant "${TENANT_A}"`);
    expect(result.records).toHaveLength(0);
  });

  it("defense-in-depth: a foreign-tenant record is never returned and is audited as a tenant_mismatch exclusion", () => {
    let store = tierStoreWithScopes();
    store = seedRecord(store); // authorized tenant-A record
    store = seedRecord(store, {
      recordId: "mem:beta:001",
      scopeId: SCOPE_B,
      tenantId: TENANT_B,
      identityRef: IDENTITY_B,
      missionRef: null,
      envelope: envelopeInput({
        createdBy: IDENTITY_B,
        updatedBy: IDENTITY_B,
        provenance: { source: "workforce:field-agent", originTenantId: TENANT_B, verified: false },
      }),
    });
    const result = expectTierGranted(
      retrieveMemory(store, retrievalRequest(), retrievalConfig()),
    );
    expect(result.records.map((r) => r.id)).toEqual(["mem:alpha:001"]);
    const mismatch = result.exclusions.find((e) => e.recordId === "mem:beta:001");
    expect(mismatch?.reason).toBe("tenant_mismatch");
    expect(mismatch?.tenantId).toBe(TENANT_B);
  });

  it("worker session: a retrieval declaring another tenant than the binding is denied and audited", () => {
    const opened = openSession();
    const result = retrieveMemoryThroughWorkerSession(
      opened.store,
      opened.session,
      retrievalRequest({ tenantId: TENANT_B }),
      retrievalConfig(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a denial");
    expect(result.denialReason).toContain("cross-tenant denied");
    expect(result.records).toHaveLength(0);
    const audit = result.store.sessionAuditLog.at(-1);
    expect(audit?.allowed).toBe(false);
    expect(audit?.operation).toBe("retrieve");
  });

  it("worker session: a session cannot even OPEN across tenants (definition tenant vs scope tenant)", () => {
    const store = tierStoreWithScopes();
    const result = openWorkerMemorySession(store, {
      sessionId: "session:cross-tenant-attempt",
      workerDefinition: workerDefinition({ tenantScope: TENANT_B, identityRef: IDENTITY_B }),
      scope: bindingScope({ scopeId: SCOPE_A }),
      openedAt: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a denial");
    expect(result.error).toContain("cross-tenant denied");
    const audit = result.store.sessionAuditLog.at(-1);
    expect(audit?.allowed).toBe(false);
  });

  it("scope gate: a tenant mismatch is denied with the cross_tenant reason", () => {
    const verdict = expectGateDenied(
      enforceMemoryScopeAccess(scopeGateRegistry(), scopeGateAccess({ tenantRef: TENANT_B }), {
        now: NOW,
      }),
    );
    expect(verdict.reason).toBe("cross_tenant");
  });

  it("consumer surface: readMemory filters out every entry of another tenant", () => {
    const entries = [
      consumerEntry({ id: "mem-entry-a", tenantId: tenantId(TENANT_A) }),
      consumerEntry({
        id: "mem-entry-b",
        tenantId: tenantId(TENANT_B),
        agentId: agentId(IDENTITY_A),
        content: "tenant-beta secret handover",
      }),
    ];
    const result = readMemory(
      {
        tenantId: tenantId(TENANT_A),
        agentId: agentId(IDENTITY_A),
        category: "working",
        purpose: "legitimate recall",
        dataClassification: "TENANT_INTERNAL",
      },
      entries,
      ["working"],
      "TENANT_INTERNAL",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a grant");
    expect(result.entries.map((e) => e.id)).toEqual(["mem-entry-a"]);
    expect(result.entries.some((e) => e.content.includes("tenant-beta"))).toBe(false);
  });
});

/* ═════════════════════════════════════════════════════════════
 * 3. REVOKED / EXPIRED PRINCIPALS AND SESSIONS — denied
 * ═════════════════════════════════════════════════════════════*/

describe("revoked, suspended, and expired principals are denied", () => {
  it("denies opening a memory session for a SUSPENDED worker definition (revoked principal)", () => {
    const result = openWorkerMemorySession(tierStoreWithScopes(), {
      sessionId: "session:suspended-worker",
      workerDefinition: workerDefinition({ lifecycle: "suspended" }),
      scope: bindingScope(),
      openedAt: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a denial");
    expect(result.error).toContain("unusable");
    const audit = result.store.sessionAuditLog.at(-1);
    expect(audit?.allowed).toBe(false);
  });

  it("denies retrieval through a TERMINATED session — live handles are invalidated permanently", () => {
    const opened = openSession();
    const store = seedRecord(opened.store);
    const terminated = terminateWorkerMemorySession(store, opened.session.sessionId, {
      terminatedAt: NOW,
      reason: "worker lifecycle end",
    });
    if (!terminated.ok) throw new Error(terminated.error);
    const result = retrieveMemoryThroughWorkerSession(
      terminated.store,
      { sessionId: opened.session.sessionId },
      retrievalRequest(),
      retrievalConfig(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a denial");
    expect(result.denialReason).toContain("terminated");
    expect(result.records).toHaveLength(0);
    const audit = result.store.sessionAuditLog.at(-1);
    expect(audit?.allowed).toBe(false);
  });

  it("scope gate: an EXPIRED session-tier scope denies retrieval with scope_expired", () => {
    const verdict = expectGateDenied(
      enforceMemoryScopeAccess(scopeGateRegistry(), scopeGateAccess({ action: "read" }), {
        now: "2026-10-01T19:00:00.000Z",
      }),
    );
    expect(verdict.reason).toBe("scope_expired");
  });

  it("a stale record is excluded from retrieval (freshness gate), never returned", () => {
    const store = seedRecord(tierStoreWithScopes(), { freshnessAt: HOUR_OLD });
    const result = expectTierEvaluated(
      retrieveMemory(store, retrievalRequest({ maxAgeSeconds: 600 }), retrievalConfig()),
    );
    expect(result.records).toHaveLength(0);
    expect(result.exclusions[0]?.reason).toBe("stale");
  });

  it("a record whose validity has EXPIRED is excluded (bi-temporal gate)", () => {
    const store = seedRecord(tierStoreWithScopes(), {
      biTemporal: { validFrom: "2026-09-01T00:00:00Z", validUntil: "2026-09-15T00:00:00Z" },
    });
    const result = expectTierEvaluated(
      retrieveMemory(store, retrievalRequest(), retrievalConfig()),
    );
    expect(result.records).toHaveLength(0);
    expect(result.exclusions[0]?.reason).toBe("validity_expired");
  });

  it("a record whose required permission the principal lacks is excluded (permission gate)", () => {
    const store = seedRecord(tierStoreWithScopes(), {
      requiredPermission: "memory:confidential-roster:read",
    });
    const denied = expectTierEvaluated(
      retrieveMemory(store, retrievalRequest({ permissions: [] }), retrievalConfig()),
    );
    expect(denied.records).toHaveLength(0);
    expect(denied.exclusions[0]?.reason).toBe("permission_denied");
    expect(denied.exclusions[0]?.requiredPermission).toBe("memory:confidential-roster:read");

    const allowed = expectTierGranted(
      retrieveMemory(
        store,
        retrievalRequest({ permissions: ["memory:confidential-roster:read"] }),
        retrievalConfig(),
      ),
    );
    expect(allowed.records.map((r) => r.id)).toEqual(["mem:alpha:001"]);
  });

  it("consumer surface: readMemory denies a request above the agent's classification ceiling", () => {
    const result = readMemory(
      {
        tenantId: tenantId(TENANT_A),
        agentId: agentId(IDENTITY_A),
        category: "working",
        purpose: "escalated recall attempt",
        dataClassification: "RESTRICTED",
      },
      [consumerEntry({ dataClassification: "TENANT_INTERNAL" })],
      ["working"],
      "TENANT_INTERNAL",
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a denial");
    expect(result.error).toContain("exceeds agent data classification");
  });

  it("consumer surface: readMemory denies a category the agent is not permitted to access", () => {
    const result = readMemory(
      {
        tenantId: tenantId(TENANT_A),
        agentId: agentId(IDENTITY_A),
        category: "procedural",
        purpose: "unauthorized category attempt",
        dataClassification: "TENANT_INTERNAL",
      },
      [consumerEntry()],
      ["working"],
      "TENANT_INTERNAL",
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a denial");
    expect(result.error).toContain("not permitted");
  });
});

/* ═════════════════════════════════════════════════════════════
 * 4. SCOPE EXPANSION — unreachable through retrieval paths
 * ═════════════════════════════════════════════════════════════*/

describe("scope expansion is unreachable through retrieval paths", () => {
  it("a GRANTED retrieval mutates no scope and no record — only the access log grows", () => {
    const store = seedRecord(tierStoreWithScopes());
    const scopesBefore = store.scopes;
    const recordsBefore = store.records;
    const result = expectTierGranted(
      retrieveMemory(store, retrievalRequest(), retrievalConfig()),
    );
    expect(result.store.scopes).toEqual(scopesBefore);
    expect(result.store.records).toEqual(recordsBefore);
    expect(result.store.accessLog).toHaveLength(store.accessLog.length + 1);
  });

  it("a DENIED retrieval mutates nothing but the audit log", () => {
    const store = seedRecord(tierStoreWithScopes());
    const snapshot = structuredClone(store);
    const result = expectTierDenied(
      retrieveMemory(store, retrievalRequest({ identityRef: IDENTITY_C }), retrievalConfig()),
    );
    expect(result.outcome).toBe("denied");
    expect(store).toEqual(snapshot);
  });

  it("retrieval is pure: the INPUT store is never mutated (no side-effect channel)", () => {
    const store = seedRecord(tierStoreWithScopes());
    const snapshot = structuredClone(store);
    retrieveMemory(store, retrievalRequest(), retrievalConfig());
    expect(store).toEqual(snapshot);
  });

  it("a denied retrieval leaves the scope gate's revision and expansion ledger untouched", () => {
    const registry = scopeGateRegistry();
    const before = registry.entries[0];
    expectGateDenied(
      enforceMemoryScopeAccess(
        registry,
        scopeGateAccess({ domain: "finance_ledger" }),
        { now: NOW },
      ),
    );
    const after = registry.entries[0];
    expect(after).toBe(before);
    expect(after.revision).toBe(1);
    expect(after.expansionLedger).toHaveLength(0);
  });

  it("a domain denied by retrieval stays uncovered — widening exists ONLY as an explicit, audited act", () => {
    const registry = scopeGateRegistry();
    expectGateDenied(
      enforceMemoryScopeAccess(registry, scopeGateAccess({ domain: "finance_ledger" }), { now: NOW }),
    );
    const entryBefore = registry.entries[0];
    expect(entryBefore.declaration.domains).not.toContain("finance_ledger");

    const act = applyMemoryScopeExpansion(registry, {
      kind: "add_domains",
      scopeKey: "session-scope-alpha",
      domains: ["finance_ledger"],
      reason: "explicitly authorized widening for a new governed purpose",
      declaredBy: "role:memory-scope-governor",
      authorityRef: "H3 mission C-029 explicit expansion authorization",
      decidedAt: NOW,
    });
    expect(act.ok).toBe(true);
    if (!act.ok) throw new Error("expected the explicit act to apply");
    expect(act.entry.revision).toBe(2);
    expect(act.expansionRecord.act.kind).toBe("add_domains");
    expect(
      enforceMemoryScopeAccess(act.registry, scopeGateAccess({ domain: "finance_ledger" }), {
        now: NOW,
      }).verdict,
    ).toBe("allowed");
  });

  it("a session cannot read beyond its declared NAMESPACES even though the underlying scope covers more", () => {
    const opened = openSession();
    let store = seedRecord(opened.store); // domain "field-ops" — inside the binding
    store = seedRecord(store, {
      recordId: "mem:alpha:roster-001",
      domain: "roster", // inside SCOPE_A domains, OUTSIDE the binding namespaces
      content: "roster coverage note",
    });
    const result = expectTierGranted(
      retrieveMemoryThroughWorkerSession(
        store,
        opened.session,
        retrievalRequest({ purpose: "attempt to draw on the whole underlying scope" }),
        retrievalConfig(),
      ),
    );
    expect(result.records.map((r) => r.id)).toEqual(["mem:alpha:001"]);
    const excluded = result.exclusions.find((e) => e.recordId === "mem:alpha:roster-001");
    expect(excluded?.reason).toBe("outside_binding_namespace");
  });

  it("a session cannot read TIERS outside its readable set — the binding gate runs first", () => {
    const opened = openSession();
    const store = seedRecord(opened.store, {
      recordId: "mem:alpha:org-001",
      memoryClass: "organizational",
      content: "organizational knowledge note",
    });
    const result = expectTierEvaluated(
      retrieveMemoryThroughWorkerSession(store, opened.session, retrievalRequest(), retrievalConfig()),
    );
    expect(result.records).toHaveLength(0);
    expect(result.exclusions[0]?.reason).toBe("binding_tier_not_readable");
  });

  it("a session cannot redirect retrieval to a DIFFERENT declared scope (scope mismatch denied)", () => {
    const opened = openSession();
    const result = retrieveMemoryThroughWorkerSession(
      opened.store,
      opened.session,
      retrievalRequest({ scopeId: SCOPE_B }),
      retrievalConfig(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a denial");
    expect(result.denialReason).toContain("does not match the session binding's declared scope");
    expect(result.records).toHaveLength(0);
  });

  it("an unregistered (forged) session handle has no authority — the registry is the only source of truth", () => {
    const opened = openSession();
    const result = retrieveMemoryThroughWorkerSession(
      opened.store,
      { sessionId: "session:forged-handle" },
      retrievalRequest(),
      retrievalConfig(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a denial");
    expect(result.denialReason).toContain("not registered");
    expect(result.records).toHaveLength(0);
  });

  it("a session binding is FROZEN — a tampered copy cannot widen its own scope", () => {
    const opened = openSession();
    const binding = opened.session.binding;
    expect(Object.isFrozen(binding)).toBe(true);
    expect(Object.isFrozen(binding.namespaces)).toBe(true);
    expect(() => {
      const widened = binding as unknown as { namespaces: string[] };
      widened.namespaces.push("roster");
    }).toThrow();
    expect(binding.namespaces).toEqual(["field-ops"]);
  });
});

/* ═════════════════════════════════════════════════════════════
 * 5. NO LEAKAGE — results never exceed the authorized scope
 * ═════════════════════════════════════════════════════════════*/

describe("retrieval results never leak beyond the authorized scope", () => {
  it("returns EXACTLY the authorized set; every withheld record is a typed, audited exclusion", () => {
    let store = tierStoreWithScopes();
    store = seedRecord(store, { recordId: "mem:alpha:authorized" }); // field-ops / internal / no perm
    store = seedWideRecord(store, {
      recordId: "mem:alpha:restricted",
      sensitivity: "restricted",
      content: "restricted-sensitivity note",
    });
    store = seedWideRecord(store, {
      recordId: "mem:alpha:other-domain",
      domain: "finance",
      content: "finance note",
    });
    store = seedRecord(store, {
      recordId: "mem:beta:foreign",
      scopeId: SCOPE_B,
      tenantId: TENANT_B,
      identityRef: IDENTITY_B,
      missionRef: null,
      envelope: envelopeInput({
        createdBy: IDENTITY_B,
        updatedBy: IDENTITY_B,
        provenance: { source: "workforce:field-agent", originTenantId: TENANT_B, verified: false },
      }),
    });
    const result = expectTierGranted(
      retrieveMemory(store, retrievalRequest(), retrievalConfig()),
    );
    expect(result.outcome).toBe("partial");
    expect(result.records.map((r) => r.id)).toEqual(["mem:alpha:authorized"]);
    const reasonsById = new Map(result.exclusions.map((e) => [e.recordId, e.reason]));
    expect(reasonsById.get("mem:alpha:restricted")).toBe("exceeds_declared_sensitivity");
    expect(reasonsById.get("mem:alpha:other-domain")).toBe("outside_declared_scope");
    expect(reasonsById.get("mem:beta:foreign")).toBe("tenant_mismatch");
    for (const record of result.records) {
      expect(record.tenantId).toBe(TENANT_A);
      expect(tierScopeA().domains.includes(record.domain)).toBe(true);
    }
  });

  it("the item budget EXCLUDES surplus records rather than returning them (item_budget, not silent truncation)", () => {
    let store = tierStoreWithScopes();
    store = seedRecord(store, { recordId: "mem:alpha:one" });
    store = seedRecord(store, { recordId: "mem:alpha:two" });
    const result = expectTierGranted(
      retrieveMemory(store, retrievalRequest({ maxResults: 1 }), retrievalConfig()),
    );
    expect(result.records.map((r) => r.id)).toEqual(["mem:alpha:one"]);
    expect(result.exclusions.find((e) => e.recordId === "mem:alpha:two")?.reason).toBe("item_budget");
  });

  it("TEXTUAL OVERLAP cannot rescue an unauthorized record — there is no similarity path to a grant (G-015)", () => {
    const store = seedWideRecord(tierStoreWithScopes(), {
      recordId: "mem:alpha:overlap",
      domain: "finance",
      content: "field-operations recall",
    });
    const result = expectTierEvaluated(
      retrieveMemory(
        store,
        retrievalRequest({ purpose: "field-operations recall" }),
        retrievalConfig(),
      ),
    );
    expect(result.records).toHaveLength(0);
    expect(result.exclusions[0]?.reason).toBe("outside_declared_scope");
    expect(result.accessRecord.denialReason).toContain("No authorized record survived");
  });

  it("the access record is complete: returnedRecordIds match the returned records and every withheld record has an exclusion", () => {
    let store = tierStoreWithScopes();
    store = seedRecord(store, { recordId: "mem:alpha:kept" });
    store = seedWideRecord(store, { recordId: "mem:alpha:dropped", domain: "finance" });
    const result = expectTierGranted(
      retrieveMemory(store, retrievalRequest(), retrievalConfig()),
    );
    expect(result.accessRecord.returnedRecordIds).toEqual(result.records.map((r) => r.id));
    const coveredIds = new Set([
      ...result.accessRecord.returnedRecordIds,
      ...result.accessRecord.exclusions.map((e) => e.recordId),
    ]);
    for (const record of store.records) {
      expect(coveredIds.has(record.id)).toBe(true);
    }
    expect(result.accessRecord.purpose).toBe("field-operations recall");
    expect(result.accessRecord.scopeId).toBe(SCOPE_A);
    expect(result.accessRecord.recordedAt).toBe(NOW);
  });

  it("a denied retrieval returns zero records but ALWAYS appends its audit record (nothing denied silently)", () => {
    const store = tierStoreWithScopes();
    const before = store.accessLog.length;
    const result = expectTierDenied(
      retrieveMemory(store, retrievalRequest({ scopeId: "scope:ghost" }), retrievalConfig()),
    );
    expect(result.records).toHaveLength(0);
    expect(result.store.accessLog).toHaveLength(before + 1);
    expect(result.store.accessLog.at(-1)?.outcome).toBe("denied");
  });

  it("exclusion records carry reasons and metadata — never the withheld record's CONTENT", () => {
    let store = tierStoreWithScopes();
    store = seedWideRecord(store, { recordId: "mem:alpha:dropped", domain: "finance", content: "finance note" });
    const result = expectTierEvaluated(
      retrieveMemory(store, retrievalRequest(), retrievalConfig()),
    );
    expect(result.exclusions.length).toBeGreaterThan(0);
    for (const exclusion of result.exclusions) {
      expect(Object.keys(exclusion)).not.toContain("content");
      expect(JSON.stringify(exclusion)).not.toContain("finance note");
    }
  });

  it("the worker-session path preserves the leak-freedom contract: results ⊆ binding, all withheld records audited", () => {
    const opened = openSession();
    let store = seedRecord(opened.store, { recordId: "mem:alpha:in-binding" });
    store = seedRecord(store, {
      recordId: "mem:alpha:out-of-binding",
      domain: "roster",
    });
    const result = expectTierGranted(
      retrieveMemoryThroughWorkerSession(store, opened.session, retrievalRequest(), retrievalConfig()),
    );
    expect(result.records.map((r) => r.id)).toEqual(["mem:alpha:in-binding"]);
    for (const record of result.records) {
      expect(opened.session.binding.namespaces.includes(record.domain)).toBe(true);
      expect(opened.session.binding.readableTierClasses.includes(record.memoryClass)).toBe(true);
      expect(record.tenantId).toBe(opened.session.binding.tenantId);
    }
    expect(
      result.accessRecord.exclusions.find((e) => e.recordId === "mem:alpha:out-of-binding")?.reason,
    ).toBe("outside_binding_namespace");
    const audit = result.store.sessionAuditLog.at(-1);
    expect(audit?.allowed).toBe(true);
    expect(audit?.operation).toBe("retrieve");
  });
});