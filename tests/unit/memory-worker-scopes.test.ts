/**
 * MISSION-R-42 / J-007 (V1CAP-016, wave 3) — worker memory scopes & the
 * memory governance boundary.
 *
 * Proves, at unit level, that:
 *  1. worker memory sessions are bounded by the DECLARED memory scope
 *     (AGENTS §5 — memory scope is a declared identity field): tier
 *     read/write sets, namespaces, subjects, mission, sensitivity ceiling,
 *     tenant — all resolved against the governed worker definition;
 *  2. out-of-scope WRITES are REJECTED (never silently dropped or coerced)
 *     and every rejection is auditable;
 *  3. out-of-scope READS return nothing while first-class audit exclusion
 *     records are produced (nothing withheld silently);
 *  4. scope escalation is structurally impossible: a session cannot widen
 *     its own scope (frozen binding, registry-resolved authority, no
 *     widening API) — widening requires a new governed worker-definition
 *     revision with a re-declared scope;
 *  5. session termination (worker lifecycle end) invalidates the session's
 *     live handles — permanently, with no resurrection;
 *  6. cross-tenant non-access is preserved end-to-end through sessions;
 *  7. the runtime opens worker memory sessions ONLY through the scoped
 *     runtime constructor (`openRuntimeMemorySession`), which derives
 *     identity/tenant/definition from the worker definition;
 *  8. existing tier discipline and the canonical envelope still hold through
 *     the session surface (compatibility, additive-only).
 */

import { describe, expect, it } from "vitest";
import {
  declareMemoryScope,
  createMemoryTierStore,
  openWorkerMemorySession,
  retrieveMemory,
  retrieveMemoryThroughWorkerSession,
  terminateWorkerMemorySession,
  writeMemoryRecord,
  writeMemoryThroughWorkerSession,
  type MemoryTierClass,
  type MemoryTierStore,
  type MemoryWriteRequest,
  type WorkerMemoryScopeInput,
  type WorkerMemorySession,
} from "@/lib/memory/memory-store";
import { defineWorkerDefinition, type WorkerDefinition } from "@/lib/workforce/worker-definition";
import {
  openRuntimeMemorySession,
  terminateRuntimeMemorySession,
} from "@/lib/agent-runtime/ephemeral-lifecycle";

const TENANT_A = "tenant-alpha";
const TENANT_B = "tenant-beta";
const WORKER_A = "01970000-0000-7000-8000-0000000000a1";
const WORKER_B = "01970000-0000-7000-8000-0000000000b1";
const SCOPE_A = "scope:alpha:field-ops";
const SCOPE_B = "scope:beta:field-ops";
const MISSION = "mission:MISSION-R-42";
const NOW = "2026-10-01T12:00:00Z";
const FRESH = "2026-10-01T11:00:00Z";

/* ─────────────────────────────────────────────────────────────
 * Fixtures
 * ────────────────────────────────────────────────────────────*/

function workerDefinition(overrides?: { lifecycle?: "active" | "suspended"; id?: string }) {
  const result = defineWorkerDefinition({
    id: overrides?.id ?? "worker:field-agent:alpha",
    tenantScope: TENANT_A,
    identityRef: WORKER_A,
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

function declaredScopeA() {
  return {
    scopeId: SCOPE_A,
    tenantId: TENANT_A,
    missionRef: MISSION,
    actorScope: [WORKER_A],
    domains: ["field-ops", "roster"],
    maxSensitivity: "internal" as const,
  };
}

function declaredScopeB() {
  return {
    scopeId: SCOPE_B,
    tenantId: TENANT_B,
    missionRef: null,
    actorScope: [WORKER_B],
    domains: ["field-ops"],
    maxSensitivity: "internal" as const,
  };
}

function storeWithScopes() {
  let store = createMemoryTierStore();
  const a = declareMemoryScope(store, declaredScopeA());
  if (!a.ok) throw new Error(a.error);
  store = a.store;
  const b = declareMemoryScope(store, declaredScopeB());
  if (!b.ok) throw new Error(b.error);
  return b.store;
}

function bindingScope(overrides?: Partial<WorkerMemoryScopeInput>): WorkerMemoryScopeInput {
  return {
    scopeId: SCOPE_A,
    writableTierClasses: ["practical"] as readonly MemoryTierClass[],
    readableTierClasses: ["practical"] as readonly MemoryTierClass[],
    namespaces: ["field-ops"],
    subjects: ["subject:scholar:001"],
    maxSensitivity: "internal" as const,
    ...overrides,
  };
}

function openSession(
  store: MemoryTierStore = storeWithScopes(),
  scope: WorkerMemoryScopeInput = bindingScope(),
  overrides?: { sessionId?: string; workerDefinition?: WorkerDefinition },
) {
  const result = openWorkerMemorySession(store, {
    sessionId: overrides?.sessionId ?? "session:field-agent:alpha:001",
    workerDefinition: overrides?.workerDefinition ?? workerDefinition(),
    scope,
    openedAt: NOW,
  });
  if (!result.ok) throw new Error(result.error);
  return result;
}

function envelopeInput(overrides?: Record<string, unknown>) {
  return {
    objectType: "memory_record",
    schemaVersion: "1.0",
    status: "active" as const,
    createdBy: WORKER_A,
    updatedBy: WORKER_A,
    provenance: { source: "workforce:field-agent", originTenantId: TENANT_A, verified: false },
    policyContext: { purpose: "field-operations" },
    traceId: "trace:worker-memory-1",
    correlationId: "corr:worker-memory-1",
    declaredOrigin: MISSION,
    ...overrides,
  };
}

function sessionWrite(overrides?: Partial<MemoryWriteRequest>): MemoryWriteRequest {
  return {
    recordId: "mem:alpha:ws-001",
    scopeId: SCOPE_A,
    identityRef: WORKER_A,
    tenantId: TENANT_A,
    missionRef: MISSION,
    memoryClass: "practical",
    domain: "field-ops",
    subjectRef: "subject:scholar:001",
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

function sessionRetrieval(overrides?: Record<string, unknown>) {
  return {
    identityRef: WORKER_A,
    tenantId: TENANT_A,
    scopeId: SCOPE_A,
    permissions: [] as readonly string[],
    purpose: "field-operations",
    ...overrides,
  };
}

/** Raw tier write used to seed records a session did not write. */
function seedRecord(
  store: ReturnType<typeof createMemoryTierStore>,
  overrides?: Partial<MemoryWriteRequest>,
) {
  const result = writeMemoryRecord(store, sessionWrite(overrides));
  if (!result.ok) throw new Error(`seed record rejected: ${result.error}`);
  return result;
}

/* ─────────────────────────────────────────────────────────────
 * 1. Session opening — binding resolved from the governed definition
 * ────────────────────────────────────────────────────────────*/

describe("worker memory session opening (declared scope, AGENTS §5)", () => {
  it("opens a session whose binding is derived from the worker definition and the declared scope", () => {
    const opened = openSession();
    const definition = workerDefinition();
    expect(opened.session.state).toBe("open");
    expect(opened.session.binding).toMatchObject({
      workerDefinitionId: definition.id,
      identityRef: definition.identityRef,
      tenantId: definition.tenantScope,
      scopeId: SCOPE_A,
      missionRef: MISSION,
      maxSensitivity: "internal",
    });
    expect(Object.isFrozen(opened.session)).toBe(true);
    expect(Object.isFrozen(opened.session.binding)).toBe(true);
    // The open decision is auditable: who, under which declared scope, when.
    expect(opened.store.sessionAuditLog[0]).toMatchObject({
      sessionId: "session:field-agent:alpha:001",
      workerDefinitionId: definition.id,
      identityRef: WORKER_A,
      tenantId: TENANT_A,
      scopeId: SCOPE_A,
      operation: "open",
      allowed: true,
      reason: null,
      recordedAt: NOW,
    });
  });

  it("refuses a session for a worker whose definition lifecycle is unusable", () => {
    const store = storeWithScopes();
    const result = openWorkerMemorySession(store, {
      sessionId: "session:suspended:001",
      workerDefinition: workerDefinition({ lifecycle: "suspended" }),
      scope: bindingScope(),
      openedAt: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("unusable");
    expect(result.store.sessionAuditLog[0]).toMatchObject({
      operation: "open",
      allowed: false,
    });
    expect(result.store.workerSessions).toHaveLength(0);
  });

  it("refuses a session naming an undeclared underlying scope (audited denial)", () => {
    const result = openWorkerMemorySession(storeWithScopes(), {
      sessionId: "session:ghost:001",
      workerDefinition: workerDefinition(),
      scope: bindingScope({ scopeId: "scope:ghost" }),
      openedAt: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not declared");
    expect(result.store.sessionAuditLog[0]?.allowed).toBe(false);
  });

  it("refuses a session whose underlying scope is bound to a DIFFERENT tenant (cross-tenant)", () => {
    const result = openWorkerMemorySession(storeWithScopes(), {
      sessionId: "session:cross:001",
      workerDefinition: workerDefinition(),
      scope: bindingScope({ scopeId: SCOPE_B }),
      openedAt: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("cross-tenant");
  });

  it("refuses a session whose namespaces escape the underlying scope's domains (escalation denied)", () => {
    const result = openWorkerMemorySession(storeWithScopes(), {
      sessionId: "session:escalate:ns",
      workerDefinition: workerDefinition(),
      scope: bindingScope({ namespaces: ["field-ops", "payroll"] }),
      openedAt: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("scope escalation denied");
    expect(result.store.workerSessions).toHaveLength(0);
  });

  it("refuses a session whose sensitivity ceiling exceeds the underlying scope's ceiling", () => {
    const result = openWorkerMemorySession(storeWithScopes(), {
      sessionId: "session:escalate:ceil",
      workerDefinition: workerDefinition(),
      scope: bindingScope({ maxSensitivity: "restricted" }),
      openedAt: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("scope escalation denied");
  });

  it("refuses a duplicate session id", () => {
    const first = openSession();
    const result = openWorkerMemorySession(first.store, {
      sessionId: "session:field-agent:alpha:001",
      workerDefinition: workerDefinition(),
      scope: bindingScope(),
      openedAt: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("already registered");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Scope-bounded writes — rejected, never dropped or coerced
 * ────────────────────────────────────────────────────────────*/

describe("scope-bounded writes through a worker session", () => {
  it("accepts an in-scope write and audits the decision with the record id", () => {
    const opened = openSession();
    const result = writeMemoryThroughWorkerSession(opened.store, opened.session, sessionWrite());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.scopeId).toBe(SCOPE_A);
    expect(result.record.subjectRef).toBe("subject:scholar:001");
    const writeAudit = result.store.sessionAuditLog.at(-1);
    expect(writeAudit).toMatchObject({
      sessionId: opened.session.sessionId,
      operation: "write",
      allowed: true,
      recordId: result.record.id,
      reason: null,
    });
  });

  it("rejects a write in a tier the binding does not declare writable (never coerced)", () => {
    const opened = openSession();
    const result = writeMemoryThroughWorkerSession(
      opened.store,
      opened.session,
      sessionWrite({ memoryClass: "organizational" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not writable");
    expect(result.store.records).toHaveLength(0);
    expect(result.store.sessionAuditLog.at(-1)).toMatchObject({
      operation: "write",
      allowed: false,
      reason: expect.stringContaining("no silent scope expansion"),
    });
  });

  it("rejects a write in a namespace the binding does not declare — even inside the scope's domains", () => {
    const opened = openSession();
    const result = writeMemoryThroughWorkerSession(
      opened.store,
      opened.session,
      sessionWrite({ domain: "roster" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toContain("outside the session binding's declared namespaces");
    expect(result.store.records).toHaveLength(0);
  });

  it("rejects a write naming a subject outside the binding's subject scope", () => {
    const opened = openSession();
    const result = writeMemoryThroughWorkerSession(
      opened.store,
      opened.session,
      sessionWrite({ subjectRef: "subject:scholar:999" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toContain("not declared in the session binding's subject scope");
    expect(result.store.records).toHaveLength(0);
  });

  it("rejects a write whose identity is not the session's worker identity", () => {
    const opened = openSession();
    const result = writeMemoryThroughWorkerSession(
      opened.store,
      opened.session,
      sessionWrite({ identityRef: WORKER_B }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("worker identity");
  });

  it("rejects a cross-tenant write through the session", () => {
    const opened = openSession();
    const result = writeMemoryThroughWorkerSession(
      opened.store,
      opened.session,
      sessionWrite({ tenantId: TENANT_B }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("cross-tenant");
  });

  it("rejects a write whose mission does not match the binding's mission", () => {
    const opened = openSession();
    const result = writeMemoryThroughWorkerSession(
      opened.store,
      opened.session,
      sessionWrite({ missionRef: "mission:OTHER" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("no silent scope expansion");
  });

  it("rejects a write whose sensitivity exceeds the binding's ceiling (never clamped)", () => {
    const opened = openSession();
    const result = writeMemoryThroughWorkerSession(
      opened.store,
      opened.session,
      sessionWrite({ sensitivity: "restricted" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toContain("exceeds the session binding's declared ceiling");
    expect(result.store.records).toHaveLength(0);
  });

  it("grants nothing when the binding declares no writable tier or no namespace (deny-by-default)", () => {
    const emptyTiers = openSession(storeWithScopes(), bindingScope({ writableTierClasses: [] }));
    const tierResult = writeMemoryThroughWorkerSession(
      emptyTiers.store,
      emptyTiers.session,
      sessionWrite(),
    );
    expect(tierResult.ok).toBe(false);

    const emptyNamespaces = openSession(storeWithScopes(), bindingScope({ namespaces: [] }));
    const nsResult = writeMemoryThroughWorkerSession(
      emptyNamespaces.store,
      emptyNamespaces.session,
      sessionWrite(),
    );
    expect(nsResult.ok).toBe(false);
    if (!nsResult.ok) expect(nsResult.error).toContain("no silent scope expansion");
  });

  it("still enforces envelope stamping and explicit bi-temporal validity through the session", () => {
    const opened = openSession();
    const unstamped = writeMemoryThroughWorkerSession(
      opened.store,
      opened.session,
      sessionWrite({ envelope: envelopeInput({ traceId: "" }) }),
    );
    expect(unstamped.ok).toBe(false);
    if (!unstamped.ok) expect(unstamped.error).toContain("envelope rejected");

    const unknownValidity = writeMemoryThroughWorkerSession(
      opened.store,
      opened.session,
      sessionWrite({ biTemporal: {} }),
    );
    expect(unknownValidity.ok).toBe(false);
    if (!unknownValidity.ok) expect(unknownValidity.error).toContain("valid time must be explicit");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Scope-bounded reads — exclusions are first-class audit records
 * ────────────────────────────────────────────────────────────*/

describe("scope-bounded retrieval through a worker session", () => {
  it("returns only records inside the binding's namespaces and readable tiers, with audited exclusions for the rest", () => {
    const base = storeWithScopes();
    const sameTenantOtherScope = declareMemoryScope(base, {
      scopeId: "scope:alpha:other",
      tenantId: TENANT_A,
      missionRef: MISSION,
      actorScope: [WORKER_A],
      domains: ["field-ops"],
      maxSensitivity: "internal",
    });
    if (!sameTenantOtherScope.ok) throw new Error(sameTenantOtherScope.error);
    const crossScope = seedRecord(sameTenantOtherScope.store, {
      recordId: "mem:alpha:other-scope",
      scopeId: "scope:alpha:other",
    });
    const inBinding = seedRecord(crossScope.store, { recordId: "mem:alpha:in-binding" });
    const outsideNamespace = seedRecord(inBinding.store, {
      recordId: "mem:alpha:roster",
      domain: "roster",
    });
    const wrongTier = seedRecord(outsideNamespace.store, {
      recordId: "mem:alpha:org",
      memoryClass: "organizational",
    });
    const opened = openSession(wrongTier.store);

    const result = retrieveMemoryThroughWorkerSession(
      opened.store,
      opened.session,
      sessionRetrieval(),
      { now: NOW },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records.map((r) => r.id)).toEqual(["mem:alpha:in-binding"]);
    const exclusionReasons = Object.fromEntries(
      result.accessRecord.exclusions.map((e) => [e.recordId, e.reason]),
    );
    expect(exclusionReasons["mem:alpha:other-scope"]).toBe("outside_declared_scope");
    expect(exclusionReasons["mem:alpha:roster"]).toBe("outside_binding_namespace");
    expect(exclusionReasons["mem:alpha:org"]).toBe("binding_tier_not_readable");
    expect(result.accessRecord.outcome).toBe("partial");
    // The session-level scope decision is audited too.
    expect(result.store.sessionAuditLog.at(-1)).toMatchObject({
      sessionId: opened.session.sessionId,
      operation: "retrieve",
      allowed: true,
    });
  });

  it("grants nothing on reads when the binding declares no readable tier", () => {
    const seeded = seedRecord(storeWithScopes()).store;
    const opened = openSession(seeded, bindingScope({ readableTierClasses: [] }));
    const result = retrieveMemoryThroughWorkerSession(
      opened.store,
      opened.session,
      sessionRetrieval(),
      { now: NOW },
    );
    expect(result.ok).toBe(false);
    expect(result.records).toEqual([]);
    expect(result.exclusions.map((e) => e.reason)).toEqual(["binding_tier_not_readable"]);
    expect(result.accessRecord?.exclusions).toHaveLength(1);
  });

  it("denies a retrieval whose identity, tenant or scope does not match the binding (audited, no access record)", () => {
    const seeded = seedRecord(storeWithScopes()).store;
    const opened = openSession(seeded);

    const foreignIdentity = retrieveMemoryThroughWorkerSession(
      opened.store,
      opened.session,
      sessionRetrieval({ identityRef: WORKER_B }),
      { now: NOW },
    );
    expect(foreignIdentity.ok).toBe(false);
    if (!foreignIdentity.ok) {
      expect(foreignIdentity.accessRecord).toBeNull();
      expect(foreignIdentity.denialReason).toContain("worker identity");
    }

    const crossTenant = retrieveMemoryThroughWorkerSession(
      foreignIdentity.store,
      opened.session,
      sessionRetrieval({ tenantId: TENANT_B }),
      { now: NOW },
    );
    expect(crossTenant.ok).toBe(false);
    if (!crossTenant.ok) expect(crossTenant.denialReason).toContain("cross-tenant");

    const scopeMismatch = retrieveMemoryThroughWorkerSession(
      crossTenant.store,
      opened.session,
      sessionRetrieval({ scopeId: SCOPE_B }),
      { now: NOW },
    );
    expect(scopeMismatch.ok).toBe(false);
    if (!scopeMismatch.ok) expect(scopeMismatch.denialReason).toContain("declared scope");
    const denialAudits = scopeMismatch.store.sessionAuditLog.filter(
      (e) => e.operation === "retrieve" && !e.allowed,
    );
    expect(denialAudits).toHaveLength(3);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. No self-widening — escalation is structurally impossible
 * ────────────────────────────────────────────────────────────*/

describe("no self-widening (scope escalation structurally impossible)", () => {
  it("resolves the binding from the store registry: a tampered/widened handle has no authority", () => {
    const opened = openSession();
    // Simulate a compromised runtime widening its own handle (cast past the
    // readonly types). Authority is resolved from the store registry by
    // session id, so the widened handle gains nothing.
    const widenedHandle = {
      ...opened.session,
      binding: {
        ...opened.session.binding,
        namespaces: [...opened.session.binding.namespaces, "roster"],
        writableTierClasses: ["practical", "organizational"] as readonly MemoryTierClass[],
        maxSensitivity: "restricted" as const,
      },
    } as WorkerMemorySession;

    const write = writeMemoryThroughWorkerSession(
      opened.store,
      widenedHandle,
      sessionWrite({ domain: "roster" }),
    );
    expect(write.ok).toBe(false);
    if (!write.ok)
      expect(write.error).toContain("outside the session binding's declared namespaces");

    const tierWrite = writeMemoryThroughWorkerSession(
      write.store,
      widenedHandle,
      sessionWrite({ memoryClass: "organizational" }),
    );
    expect(tierWrite.ok).toBe(false);

    const sensitiveWrite = writeMemoryThroughWorkerSession(
      tierWrite.store,
      widenedHandle,
      sessionWrite({ sensitivity: "restricted" }),
    );
    expect(sensitiveWrite.ok).toBe(false);

    const retrieval = retrieveMemoryThroughWorkerSession(
      sensitiveWrite.store,
      widenedHandle,
      sessionRetrieval(),
      { now: NOW },
    );
    expect(retrieval.ok).toBe(false);
    if (!retrieval.ok) {
      expect(retrieval.records).toEqual([]);
    }
    expect(opened.store.records).toHaveLength(0);
  });

  it("denies the frozen binding from being widened in place", () => {
    const opened = openSession();
    expect(() => {
      (opened.session.binding.namespaces as string[]).push("roster");
    }).toThrow();
    expect(opened.session.binding.namespaces).toEqual(["field-ops"]);
  });

  it("requires a NEW governed scope declaration (worker-definition revision) to widen — not a session", () => {
    const opened = openSession();
    // A second session under the SAME binding cannot claim more: the open
    // gate re-checks every axis against the underlying declared scope.
    const escalate = openWorkerMemorySession(opened.store, {
      sessionId: "session:field-agent:alpha:002",
      workerDefinition: workerDefinition(),
      scope: bindingScope({ namespaces: ["field-ops", "payroll"] }),
      openedAt: NOW,
    });
    expect(escalate.ok).toBe(false);

    // Widening exists only as a NEW governed declaration + new session.
    const revision = declareMemoryScope(opened.store, {
      scopeId: "scope:alpha:field-ops-roster",
      tenantId: TENANT_A,
      missionRef: MISSION,
      actorScope: [WORKER_A],
      domains: ["field-ops", "roster"],
      maxSensitivity: "internal",
    });
    expect(revision.ok).toBe(true);
    if (!revision.ok) return;
    const widened = openWorkerMemorySession(revision.store, {
      sessionId: "session:field-agent:alpha:002",
      workerDefinition: workerDefinition(),
      scope: bindingScope({
        scopeId: "scope:alpha:field-ops-roster",
        namespaces: ["field-ops", "roster"],
      }),
      openedAt: NOW,
    });
    expect(widened.ok).toBe(true);
    if (!widened.ok) return;
    const write = writeMemoryThroughWorkerSession(
      widened.store,
      widened.session,
      sessionWrite({ recordId: "mem:alpha:roster", domain: "roster" }),
    );
    expect(write.ok).toBe(true);
  });

  it("property: every expansion attempt fails closed and leaves an audit record", () => {
    const opened = openSession();
    type Attempt = {
      name: string;
      run: () => { ok: boolean; store: MemoryTierStore; error?: string };
    };
    const attempts: Attempt[] = [
      {
        name: "tenant escalation",
        run: () =>
          writeMemoryThroughWorkerSession(
            opened.store,
            opened.session,
            sessionWrite({ tenantId: TENANT_B }),
          ),
      },
      {
        name: "identity escalation",
        run: () =>
          writeMemoryThroughWorkerSession(
            opened.store,
            opened.session,
            sessionWrite({ identityRef: WORKER_B }),
          ),
      },
      {
        name: "mission escalation",
        run: () =>
          writeMemoryThroughWorkerSession(
            opened.store,
            opened.session,
            sessionWrite({ missionRef: "mission:OTHER" }),
          ),
      },
      {
        name: "tier escalation",
        run: () =>
          writeMemoryThroughWorkerSession(
            opened.store,
            opened.session,
            sessionWrite({ memoryClass: "organizational" }),
          ),
      },
      {
        name: "namespace escalation",
        run: () =>
          writeMemoryThroughWorkerSession(
            opened.store,
            opened.session,
            sessionWrite({ domain: "roster" }),
          ),
      },
      {
        name: "subject escalation",
        run: () =>
          writeMemoryThroughWorkerSession(
            opened.store,
            opened.session,
            sessionWrite({ subjectRef: "subject:undeclared" }),
          ),
      },
      {
        name: "sensitivity escalation",
        run: () =>
          writeMemoryThroughWorkerSession(
            opened.store,
            opened.session,
            sessionWrite({ sensitivity: "restricted" }),
          ),
      },
      {
        name: "scope-open escalation",
        run: () =>
          openWorkerMemorySession(opened.store, {
            sessionId: "session:escalate:prop",
            workerDefinition: workerDefinition(),
            scope: bindingScope({ namespaces: ["payroll"] }),
            openedAt: NOW,
          }),
      },
    ];
    let store = opened.store;
    for (const attempt of attempts) {
      const result = attempt.run();
      expect(result.ok, `expansion attempt "${attempt.name}" must fail closed`).toBe(false);
      expect(
        result.store.sessionAuditLog.some((e) => !e.allowed),
        `expansion attempt "${attempt.name}" must leave a denial audit record`,
      ).toBe(true);
      store = result.store;
    }
    // Nothing was written across the whole escalation battery.
    expect(store.records).toHaveLength(0);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. Session termination (worker lifecycle end) — no resurrection
 * ────────────────────────────────────────────────────────────*/

describe("session invalidation on worker lifecycle end", () => {
  it("terminates the session and invalidates every live handle", () => {
    const opened = openSession();
    const written = writeMemoryThroughWorkerSession(opened.store, opened.session, sessionWrite());
    expect(written.ok).toBe(true);

    const terminated = terminateWorkerMemorySession(opened.store, opened.session.sessionId, {
      terminatedAt: NOW,
      reason: "worker_lifecycle_end:suspended",
    });
    expect(terminated.ok).toBe(true);
    if (!terminated.ok) return;
    expect(terminated.session.state).toBe("terminated");
    expect(terminated.session.terminationReason).toBe("worker_lifecycle_end:suspended");
    expect(terminated.store.sessionAuditLog.at(-1)).toMatchObject({
      operation: "terminate",
      allowed: true,
    });

    // The ORIGINAL handle is dead: writes and reads are denied, audited.
    const writeAfter = writeMemoryThroughWorkerSession(
      terminated.store,
      opened.session,
      sessionWrite({ recordId: "mem:alpha:post-termination" }),
    );
    expect(writeAfter.ok).toBe(false);
    if (!writeAfter.ok) expect(writeAfter.error).toContain("live handles invalidated");

    const retrieveAfter = retrieveMemoryThroughWorkerSession(
      writeAfter.store,
      opened.session,
      sessionRetrieval(),
      { now: NOW },
    );
    expect(retrieveAfter.ok).toBe(false);
    if (!retrieveAfter.ok) expect(retrieveAfter.denialReason).toContain("terminated");
    expect(retrieveAfter.records).toEqual([]);

    const denialAudits = retrieveAfter.store.sessionAuditLog.filter(
      (e) => e.operation === "write" && !e.allowed,
    );
    expect(denialAudits).toHaveLength(1);
    expect(denialAudits[0]).toMatchObject({
      sessionId: opened.session.sessionId,
      reason: expect.stringContaining("terminated"),
    });
  });

  it("never resurrects a terminated session", () => {
    const opened = openSession();
    const terminated = terminateWorkerMemorySession(opened.store, opened.session.sessionId, {
      terminatedAt: NOW,
      reason: "worker_lifecycle_end:archived",
    });
    expect(terminated.ok).toBe(true);
    if (!terminated.ok) return;
    const again = terminateWorkerMemorySession(terminated.store, opened.session.sessionId, {
      terminatedAt: NOW,
      reason: "worker_lifecycle_end:archived",
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toContain("no resurrection");
    const reopened = openWorkerMemorySession(again.store, {
      sessionId: opened.session.sessionId,
      workerDefinition: workerDefinition(),
      scope: bindingScope(),
      openedAt: NOW,
    });
    expect(reopened.ok).toBe(false);
    if (!reopened.ok) expect(reopened.error).toContain("already registered");
  });

  it("refuses to terminate a session that is not registered", () => {
    const result = terminateWorkerMemorySession(storeWithScopes(), "session:ghost", {
      terminatedAt: NOW,
      reason: "worker_lifecycle_end:suspended",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not registered");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 6. Cross-tenant non-access preserved through sessions
 * ────────────────────────────────────────────────────────────*/

describe("cross-tenant non-access through worker sessions", () => {
  it("a tenant-A worker session never returns tenant-B records", () => {
    const base = storeWithScopes();
    const alpha = seedRecord(base, { recordId: "mem:alpha:secret" });
    const beta = writeMemoryRecord(alpha.store, {
      ...sessionWrite({
        recordId: "mem:beta:secret",
        scopeId: SCOPE_B,
        identityRef: WORKER_B,
        tenantId: TENANT_B,
        missionRef: null,
        envelope: envelopeInput({ provenance: { source: "beta", originTenantId: TENANT_B } }),
      }),
    });
    expect(beta.ok).toBe(true);
    if (!beta.ok) return;
    const opened = openSession(beta.store);

    const result = retrieveMemoryThroughWorkerSession(
      opened.store,
      opened.session,
      sessionRetrieval(),
      { now: NOW },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records.map((r) => r.id)).toEqual(["mem:alpha:secret"]);
    expect(result.records.some((r) => r.tenantId === TENANT_B)).toBe(false);
    // Defense-in-depth: the foreign-tenant record is visible ONLY as an
    // audited exclusion, never as a record.
    expect(result.accessRecord.exclusions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recordId: "mem:beta:secret", reason: "tenant_mismatch" }),
      ]),
    );
  });

  it("a tenant-A worker cannot open a session that would draw on a tenant-B scope", () => {
    const result = openWorkerMemorySession(storeWithScopes(), {
      sessionId: "session:cross-tenant:001",
      workerDefinition: workerDefinition(),
      scope: bindingScope({ scopeId: SCOPE_B }),
      openedAt: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("cross-tenant");
  });

  it("a write through the session can never land in another tenant, even with a fabricated request", () => {
    const opened = openSession();
    const result = writeMemoryThroughWorkerSession(
      opened.store,
      opened.session,
      sessionWrite({
        tenantId: TENANT_B,
        envelope: envelopeInput({ provenance: { source: "beta", originTenantId: TENANT_B } }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("cross-tenant");
    expect(result.store.records).toHaveLength(0);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 7. Runtime wiring — sessions open ONLY through the scoped constructor
 * ────────────────────────────────────────────────────────────*/

describe("agent-runtime memory-session wiring (governance boundary)", () => {
  it("opens runtime worker memory sessions with identity/tenant/definition derived, never caller-supplied", () => {
    const definition = workerDefinition();
    const opened = openRuntimeMemorySession({
      store: storeWithScopes(),
      workerDefinition: definition,
      declaredScope: bindingScope(),
      sessionId: "session:runtime:alpha:001",
      now: NOW,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.session.binding).toMatchObject({
      workerDefinitionId: definition.id,
      identityRef: definition.identityRef,
      tenantId: definition.tenantScope,
      missionRef: MISSION,
    });
    expect(Object.isFrozen(opened.session.binding)).toBe(true);
  });

  it("refuses a runtime session for a worker whose lifecycle ended before open", () => {
    const opened = openRuntimeMemorySession({
      store: storeWithScopes(),
      workerDefinition: workerDefinition({ lifecycle: "suspended" }),
      declaredScope: bindingScope(),
      sessionId: "session:runtime:suspended",
      now: NOW,
    });
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.reason).toContain("unusable");
  });

  it("closes runtime sessions on worker lifecycle end; handles are dead afterwards", () => {
    const opened = openRuntimeMemorySession({
      store: storeWithScopes(),
      workerDefinition: workerDefinition(),
      declaredScope: bindingScope(),
      sessionId: "session:runtime:lifecycle-end",
      now: NOW,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const terminated = terminateRuntimeMemorySession({
      store: opened.store,
      sessionId: opened.session.sessionId,
      terminatedAt: NOW,
      reason: "worker_lifecycle_end:terminated",
    });
    expect(terminated.ok).toBe(true);
    if (!terminated.ok) return;

    const writeAfter = writeMemoryThroughWorkerSession(
      terminated.store,
      opened.session,
      sessionWrite(),
    );
    expect(writeAfter.ok).toBe(false);
    if (!writeAfter.ok) expect(writeAfter.error).toContain("live handles invalidated");
    const retrieveAfter = retrieveMemoryThroughWorkerSession(
      writeAfter.store,
      opened.session,
      sessionRetrieval(),
      { now: NOW },
    );
    expect(retrieveAfter.ok).toBe(false);
    if (!retrieveAfter.ok) expect(retrieveAfter.denialReason).toContain("terminated");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 8. Compatibility — existing tier discipline + envelope hold
 * ────────────────────────────────────────────────────────────*/

describe("compatibility with the existing tier contract (additive only)", () => {
  it("raw tier write + retrieval still work alongside registered sessions", () => {
    const opened = openSession();
    const raw = writeMemoryRecord(
      opened.store,
      sessionWrite({ recordId: "mem:alpha:raw", domain: "roster" }),
    );
    expect(raw.ok).toBe(true);
    if (!raw.ok) return;
    const retrieval = retrieveMemory(
      raw.store,
      {
        identityRef: WORKER_A,
        tenantId: TENANT_A,
        scopeId: SCOPE_A,
        permissions: [],
        purpose: "raw tier retrieval",
      },
      { now: NOW },
    );
    expect(retrieval.ok).toBe(true);
    if (!retrieval.ok) return;
    expect(retrieval.records.map((r) => r.id)).toEqual(["mem:alpha:raw"]);
  });

  it("session writes keep the full tier discipline: both tier classes when declared, envelope provenance pinned", () => {
    const opened = openSession(
      storeWithScopes(),
      bindingScope({ writableTierClasses: ["practical", "organizational"] }),
    );
    for (const memoryClass of ["practical", "organizational"] as const) {
      const result = writeMemoryThroughWorkerSession(
        opened.store,
        opened.session,
        sessionWrite({ recordId: `mem:alpha:${memoryClass}`, memoryClass }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.record.envelope.object_type).toBe("memory_record");
      expect(result.record.envelope.provenance.originTenantId).toBe(TENANT_A);
      expect(result.record.biTemporal.valid_time_known).toBe(true);
    }
  });

  it("session retrieval carries the full access-record audit surface (identity, scope, purpose, exclusions)", () => {
    const seeded = seedRecord(storeWithScopes()).store;
    const opened = openSession(seeded);
    const result = retrieveMemoryThroughWorkerSession(
      opened.store,
      opened.session,
      sessionRetrieval({ purpose: "morning briefing" }),
      { now: NOW },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accessRecord).toMatchObject({
      tenantId: TENANT_A,
      identityRef: WORKER_A,
      scopeId: SCOPE_A,
      purpose: "morning briefing",
      returnedRecordIds: ["mem:alpha:ws-001"],
      denialReason: null,
      recordedAt: NOW,
    });
  });

  it("unknown sessions are denied fail-closed and audited", () => {
    const ghost = {
      sessionId: "session:ghost:never-registered",
    } as unknown as WorkerMemorySession;
    const write = writeMemoryThroughWorkerSession(storeWithScopes(), ghost, sessionWrite());
    expect(write.ok).toBe(false);
    if (!write.ok) expect(write.error).toContain("not registered");
    const retrieve = retrieveMemoryThroughWorkerSession(write.store, ghost, sessionRetrieval(), {
      now: NOW,
    });
    expect(retrieve.ok).toBe(false);
    if (!retrieve.ok) expect(retrieve.denialReason).toContain("not registered");
  });
});
