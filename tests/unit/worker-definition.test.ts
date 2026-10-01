/**
 * MISSION-R-40 / J-027 (V1CAP-048) — persistent governed worker definition
 * substrate (CTO RULING-3).
 *
 * Proves, at unit level, that:
 *  1. the persistent definition shape is envelope-bearing (V1CAP-002) and
 *     survives a persistence round-trip (row -> definition) unchanged;
 *  2. capability-set enforcement is deny-by-default: a fresh worker with an
 *     empty declaration set has zero authority, and a delegation claiming an
 *     undeclared capability is denied;
 *  3. authority-bound enforcement denies risk-class and resource-scope
 *     escalation (denied, never clamped);
 *  4. lifecycle denial: suspended/archived/deleted workers cannot claim
 *     ephemeral runtimes, and the delegating actor must resolve through the
 *     SAME identity-actor primitives as human identities;
 *  5. escalation is structurally impossible: the claim carries exactly the
 *     delegated ∩ declared set, the ephemeral lease derived from it cannot
 *     exceed the definition, and a re-claim after process termination cannot
 *     widen authority;
 *  6. the migration and rollback are authored-not-applied with the
 *     deny-by-default RLS posture (enabled, zero policies, no grants to
 *     anon/authenticated) as structural checks on the SQL files.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { issueLease, isLeaseTerminal, transition } from "@/lib/agent-runtime/ephemeral-lifecycle";
import { KERNEL_ENVELOPE_COLUMNS } from "@/lib/kernel/reality";
import {
  WORKER_DEFINITION_LIFECYCLE_STATES,
  WORKER_DEFINITION_OBJECT_TYPE,
  claimWorkerRuntime,
  defineWorkerDefinition,
  readWorkerDefinitionRow,
  recordDelegation,
  resolveWorkerActor,
  workerDefinitionRow,
  type WorkerCapabilityDeclaration,
  type WorkerDefinition,
  type WorkerDefinitionRow,
} from "@/lib/workforce/worker-definition";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATION = readFileSync(
  join(ROOT, "database/supabase/migrations/20261002000002_coregrid_v1_worker_definitions.sql"),
  "utf8",
);
const ROLLBACK = readFileSync(
  join(ROOT, "database/supabase/rollbacks/20261002000002_coregrid_v1_worker_definitions.sql"),
  "utf8",
);

const TENANT = "tenant-alpha";
const IDENTITY_REF = "01970000-0000-7000-8000-000000000001";

function capability(id: string, description: string): WorkerCapabilityDeclaration {
  return { capabilityId: id, description };
}

function definition(overrides?: Partial<WorkerDefinition>): WorkerDefinition {
  const base = defineWorkerDefinition({
    id: "worker:alpha:field-agent",
    tenantScope: TENANT,
    identityRef: IDENTITY_REF,
    classification: "ai",
    capabilities: [
      capability("cap:dispatch", "Dispatch a scheduled field visit"),
      capability("cap:read-roster", "Read the operational roster"),
    ],
    authorityBounds: { maxRiskClass: "medium", resourceScopes: ["scope:field-a", "scope:field-b"] },
    lifecycle: "active",
    ...overrides,
  });
  if (!base.ok) throw new Error(`fixture definition rejected: ${base.errors.join("; ")}`);
  return base.definition;
}

function delegatingActor(overrides?: Record<string, unknown>) {
  return {
    userId: "01970000-0000-7000-8000-0000000000aa",
    role: "admin",
    schoolId: TENANT,
    isActive: true,
    lifecycle: "active" as const,
    sessionStatus: "active" as const,
    ...overrides,
  };
}

function envelopeInput(overrides?: Record<string, unknown>) {
  return {
    schemaVersion: "1.0",
    status: "active" as const,
    createdBy: "01970000-0000-7000-8000-0000000000aa",
    updatedBy: "01970000-0000-7000-8000-0000000000aa",
    provenance: { source: "workforce:governance", originTenantId: TENANT, verified: true },
    policyContext: { purpose: "field-operations" },
    traceId: "trace:worker-definition-1",
    correlationId: "corr:worker-definition-1",
    declaredOrigin: "mission:MISSION-R-40",
    ...overrides,
  };
}

const NOW_MS = 1_760_000_000_000;

function claim(definitionOverride?: WorkerDefinition, claimOverrides?: Record<string, unknown>) {
  return claimWorkerRuntime({
    runtimeInstanceId: "runtime:instance-1",
    definition: definitionOverride ?? definition(),
    delegatingActor: delegatingActor(),
    delegationRef: "delegation:d-001",
    delegatedCapabilities: ["cap:dispatch"],
    claimedRiskClass: "low",
    claimedResourceScopes: ["scope:field-a"],
    timeLimitMs: 60_000,
    actionLimit: 10,
    nowMs: NOW_MS,
    ...claimOverrides,
  });
}

describe("persistent worker definition shape (RULING-3 persistent half)", () => {
  it("defines a worker definition aligned with the identity lifecycle model", () => {
    const result = defineWorkerDefinition({
      id: "worker:alpha:field-agent",
      tenantScope: TENANT,
      identityRef: IDENTITY_REF,
      classification: "ai",
      capabilities: [capability("cap:dispatch", "Dispatch a scheduled field visit")],
      authorityBounds: { maxRiskClass: "medium", resourceScopes: ["scope:field-a"] },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.definition.lifecycle).toBe("provisioned");
      expect(result.definition.delegationHistoryRefs).toEqual([]);
    }
    // Aligned with, not parallel to, the identity lifecycle model: every
    // worker lifecycle state is an identity lifecycle state.
    expect(
      WORKER_DEFINITION_LIFECYCLE_STATES.every((state) =>
        [
          "proposed",
          "review",
          "provisioned",
          "active",
          "suspended",
          "deleted",
          "archived",
        ].includes(state),
      ),
    ).toBe(true);
  });

  it("fails closed on malformed definitions", () => {
    const bad = defineWorkerDefinition({
      id: "  ",
      tenantScope: TENANT,
      identityRef: IDENTITY_REF,
      classification: "robot" as never,
      capabilities: [capability("", "no id")],
      authorityBounds: { maxRiskClass: "medium", resourceScopes: [""] },
      lifecycle: "deployed" as never,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("stamps an envelope-bearing persistent row with the canonical object type", () => {
    const row = workerDefinitionRow(definition(), envelopeInput());
    expect(row.object_type).toBe(WORKER_DEFINITION_OBJECT_TYPE);
    expect(row.tenant_id).toBe(TENANT);
    expect(row.identity_ref).toBe(IDENTITY_REF);
    for (const column of KERNEL_ENVELOPE_COLUMNS) {
      expect(row).toHaveProperty(column);
    }
    expect(row.trace_id).toBe("trace:worker-definition-1");
    expect(row.schema_version).toBe("1.0");
  });

  it("round-trips row -> definition unchanged (persistence shape)", () => {
    const row: WorkerDefinitionRow = workerDefinitionRow(definition(), envelopeInput());
    const reread = readWorkerDefinitionRow(row as unknown as Record<string, unknown>);
    expect(reread).toEqual(definition());
  });

  it("rejects anonymous (envelope-absent) persistent rows", () => {
    const row = workerDefinitionRow(definition(), envelopeInput());
    const anonymous = { ...row } as Record<string, unknown>;
    for (const column of KERNEL_ENVELOPE_COLUMNS) {
      delete anonymous[column];
    }
    expect(() => readWorkerDefinitionRow(anonymous)).toThrow(/envelope/);
  });

  it("rejects a persistent row carrying a foreign object type", () => {
    expect(() =>
      workerDefinitionRow(definition(), envelopeInput({ objectType: "core.entity" })),
    ).toThrow(/worker_definition/);
  });

  it("appends delegation history refs without mutating the original definition", () => {
    const before = definition();
    const recorded = recordDelegation(before, "delegation:d-001");
    expect(recorded.ok).toBe(true);
    if (recorded.ok) {
      expect(recorded.definition.delegationHistoryRefs).toEqual(["delegation:d-001"]);
    }
    expect(before.delegationHistoryRefs).toEqual([]);
  });
});

describe("capability-set enforcement (deny-by-default)", () => {
  it("denies a delegation claiming an undeclared capability", () => {
    const result = claim(definition(), { delegatedCapabilities: ["cap:undeclared"] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/capability_escalation_denied:cap:undeclared/);
    }
  });

  it("carries exactly the delegated ∩ declared set — nothing implicit", () => {
    const result = claim();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claim.effectiveCapabilities).toEqual(["cap:dispatch"]);
      expect(result.claim.agentDefinition.capabilities).toEqual(["cap:dispatch"]);
      expect(result.claim.agentDefinition.permissions).toEqual([
        { kind: "capability", capabilityId: "cap:dispatch" },
      ]);
    }
  });

  it("gives a fresh worker with zero declarations zero authority (untrusted default)", () => {
    const fresh = definition({
      capabilities: [],
    });
    const everyAction = claim(fresh, { delegatedCapabilities: [] });
    expect(everyAction.ok).toBe(true);
    if (everyAction.ok) {
      expect(everyAction.claim.effectiveCapabilities).toEqual([]);
      expect(everyAction.claim.agentDefinition.permissions).toEqual([]);
      expect(everyAction.claim.agentDefinition.capabilities).toEqual([]);
    }
    for (const attempted of [["cap:dispatch"], ["cap:read-roster"], ["cap:anything"]]) {
      const result = claim(fresh, { delegatedCapabilities: attempted });
      expect(result.ok).toBe(false);
    }
  });
});

describe("authority-bound enforcement", () => {
  it("denies risk-class escalation above the definition ceiling", () => {
    const result = claim(definition(), { claimedRiskClass: "high" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/risk_class_escalation_denied:high_above_medium/);
    }
  });

  it("denies critical risk class even against a high ceiling (no clamp)", () => {
    const bounded = definition({
      authorityBounds: { maxRiskClass: "high", resourceScopes: ["scope:field-a"] },
    });
    const result = claim(bounded, { claimedRiskClass: "critical" });
    expect(result.ok).toBe(false);
  });

  it("accepts a delegation at or below the ceiling", () => {
    const result = claim(definition(), { claimedRiskClass: "medium" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claim.effectiveMaxRiskClass).toBe("medium");
    }
  });

  it("denies resource-scope escalation outside the authority bounds", () => {
    const result = claim(definition(), {
      claimedResourceScopes: ["scope:field-a", "scope:finance"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/resource_scope_escalation_denied:scope:finance/);
    }
  });
});

describe("lifecycle denial (suspended/revoked workers cannot claim runtimes)", () => {
  it("denies a suspended worker", () => {
    const result = claim(definition({ lifecycle: "suspended" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("worker_definition_lifecycle_unusable:suspended");
    }
  });

  it("denies archived and deleted workers (revoked authority never resurrects)", () => {
    for (const lifecycle of ["archived", "deleted"] as const) {
      const result = claim(definition({ lifecycle }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe(`worker_definition_lifecycle_unusable:${lifecycle}`);
      }
    }
  });

  it("denies when the delegating actor cannot resolve through the identity-actor primitive", () => {
    const unresolvable = resolveWorkerActor(definition(), delegatingActor({ isActive: false }));
    expect(unresolvable.ok).toBe(false);
    if (!unresolvable.ok) {
      expect(unresolvable.reason).toMatch(/delegating_actor_denied:/);
    }
    const suspendedPrincipal = resolveWorkerActor(
      definition(),
      delegatingActor({ lifecycle: "suspended" }),
    );
    expect(suspendedPrincipal.ok).toBe(false);
    const expiredSession = resolveWorkerActor(
      definition(),
      delegatingActor({ sessionStatus: "expired" }),
    );
    expect(expiredSession.ok).toBe(false);
  });

  it("denies a cross-tenant claim (multi-tenancy law)", () => {
    const result = claim(definition(), {
      delegatingActor: delegatingActor({ schoolId: "tenant-beta" }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/tenant_scope_mismatch/);
    }
  });

  it("denies a claim with no delegation record reference", () => {
    const result = claim(definition(), { delegationRef: " " });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("delegation_ref_required");
    }
  });
});

describe("escalation impossibility across process termination (G-014)", () => {
  it("binds the ephemeral lease to exactly the claimed authority", () => {
    const result = claim();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lease = issueLease(result.claim.agentDefinition, NOW_MS);
    expect(lease.definitionId).toBe(result.claim.definitionId);
    expect(lease.tenantRef).toBe(TENANT);
    // Cross-tenant mission binding is rejected by the ephemeral machine too.
    const triggered = transition(lease, { type: "TRIGGER", atMs: NOW_MS + 1 });
    expect(triggered.ok).toBe(true);
    const crossTenant = transition(triggered.lease, {
      type: "MISSION_BIND",
      atMs: NOW_MS + 2,
      missionId: "mission:m-1",
      missionTenantRef: "tenant-beta",
    });
    expect(crossTenant.ok).toBe(false);
    const bound = transition(triggered.lease, {
      type: "MISSION_BIND",
      atMs: NOW_MS + 2,
      missionId: "mission:m-1",
      missionTenantRef: TENANT,
    });
    expect(bound.ok).toBe(true);
  });

  it("yields identical authority on re-claim after termination, and denies a widened re-claim", () => {
    const persisted = definition();
    const first = claim(persisted, { runtimeInstanceId: "runtime:pid-1" });
    expect(first.ok).toBe(true);

    // The worker process dies: the ephemeral lease is terminated. The
    // persistent definition survives untouched.
    if (first.ok) {
      const lease = issueLease(first.claim.agentDefinition, NOW_MS);
      const triggered = transition(lease, { type: "TRIGGER", atMs: NOW_MS + 5 });
      expect(triggered.ok).toBe(true);
      const terminated = transition(triggered.lease, {
        type: "TERMINATE",
        atMs: NOW_MS + 6,
        reason: "lease_expired",
      });
      expect(isLeaseTerminal(terminated.lease)).toBe(true);
    }

    // A new runtime instance re-claims; authority is re-derived from the
    // persistent definition alone — identical for an identical delegation.
    const second = claim(persisted, { runtimeInstanceId: "runtime:pid-2" });
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.claim.effectiveCapabilities).toEqual(first.claim.effectiveCapabilities);
      expect(second.claim.effectiveMaxRiskClass).toEqual(first.claim.effectiveMaxRiskClass);
      expect(second.claim.effectiveResourceScopes).toEqual(first.claim.effectiveResourceScopes);
      expect(second.claim.agentDefinition).toEqual({
        ...first.claim.agentDefinition,
      });
    }

    // No API path widens authority on restart: a wider delegation is denied.
    const widened = claim(persisted, {
      runtimeInstanceId: "runtime:pid-2",
      delegatedCapabilities: ["cap:dispatch", "cap:read-roster", "cap:undeclared"],
      claimedResourceScopes: ["scope:field-a", "scope:field-b", "scope:finance"],
      claimedRiskClass: "critical",
    });
    expect(widened.ok).toBe(false);
    if (!widened.ok) {
      expect(widened.reason).toMatch(/capability_escalation_denied/);
    }
  });
});

describe("worker definitions <-> migration coherence (deny-by-default RLS posture)", () => {
  it("is authored-not-applied in both migration and rollback", () => {
    expect(MIGRATION).toMatch(/AUTHORED, NOT APPLIED/);
    expect(ROLLBACK).toMatch(/AUTHORED, NOT APPLIED/);
  });

  it("enables RLS on every worker substrate table", () => {
    for (const table of ["cg_worker_definition", "cg_worker_capability", "cg_worker_delegation"]) {
      expect(MIGRATION).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
    }
  });

  it("revokes every anon/authenticated privilege and authors zero policies", () => {
    for (const table of ["cg_worker_definition", "cg_worker_capability", "cg_worker_delegation"]) {
      expect(MIGRATION).toContain(`REVOKE ALL ON public.${table} FROM anon, authenticated;`);
    }
    expect(MIGRATION).not.toMatch(/GRANT /i);
    expect(MIGRATION).not.toMatch(/CREATE POLICY/i);
  });

  it("authors the persistent tables, envelope constraints and rollback", () => {
    expect(MIGRATION).toContain("CREATE TABLE IF NOT EXISTS public.cg_worker_definition");
    expect(MIGRATION).toContain("CREATE TABLE IF NOT EXISTS public.cg_worker_capability");
    expect(MIGRATION).toContain("CREATE TABLE IF NOT EXISTS public.cg_worker_delegation");
    expect(MIGRATION).toContain(
      "identity_id             uuid NOT NULL REFERENCES public.cg_identity (id)",
    );
    expect(MIGRATION).toContain("cg_worker_definition_envelope_atomic");
    expect(MIGRATION).toContain("cg_worker_definition_envelope_causation_root");
    expect(MIGRATION).toContain("object_type = 'worker_definition'");
    expect(ROLLBACK).toContain("DROP TABLE IF EXISTS public.cg_worker_delegation;");
    expect(ROLLBACK).toContain("DROP TABLE IF EXISTS public.cg_worker_capability;");
    expect(ROLLBACK).toContain("DROP TABLE IF EXISTS public.cg_worker_definition;");
  });
});
