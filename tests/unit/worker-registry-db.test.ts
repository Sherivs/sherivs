/**
 * MISSION V1-003 — DB-backed governed worker registry.
 *
 * Proves, at unit level (offline, mocked Supabase client — no real database):
 *  1. registerWorker persists an envelope-stamped `cg_worker_definition` row
 *     plus its `cg_worker_capability` claims; replay is idempotent (§10);
 *  2. grantDelegation writes the LIVE delegation-grant row ('active') AND the
 *     append-only `cg_worker_delegation` history row AND mirrors the
 *     delegation ref onto the definition;
 *  3. revokeDelegation stamps who/when/why and is idempotent;
 *  4. resolveWorkerAuthority maps active grants onto the neutral RBAC
 *     contribution (tenant-embedded extraPermissions) — revocation takes
 *     effect at the NEXT check (zero effective authority, observable denial);
 *  5. quarantineWorker records the ledger row and suspends the definition —
 *     the freeze is persistent and immediate (no longer leased to);
 *  6. the worker lease gate denies, with ZERO writes, every un-usable
 *     posture: unregistered, suspended, quarantined, fully revoked;
 *  7. an unstamped (anonymous-object, J-001) definition row never enters
 *     authority resolution (fail closed).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createWorkerRegistryDb,
  type WorkerRegistryDbClient,
} from "@/lib/workforce/worker-registry-db.server";

/* ─────────────────────────────────────────────────────────────
 * Fixtures
 * ────────────────────────────────────────────────────────────*/

const TENANT_A = "10000000-0000-4000-8000-000000000001";
const TENANT_B = "20000000-0000-4000-8000-000000000002";
const T0 = "2026-10-01T12:00:00.000Z";
const T1 = "2026-10-02T12:00:00.000Z";
const MISSION_ID = "MISSION-V1-003-HOST";
const EXPIRY_MIGRATION = fileURLToPath(
  new URL(
    "../../database/supabase/migrations/20261103141000_coregrid_v1_worker_delegation_expiry.sql",
    import.meta.url,
  ),
);

function registrationInput(definitionId = "worker-1", tenantId = TENANT_A) {
  return {
    tenantId,
    definitionId,
    identityRef: "11111111-1111-4111-8111-111111111111",
    classification: "ai" as const,
    capabilities: [
      { capabilityId: `mission:execute:${MISSION_ID}`, description: "execute the mission" },
      { capabilityId: `mission:create:${MISSION_ID}`, description: "create the mission" },
    ],
    maxRiskClass: "medium" as const,
    resourceScopes: ["mission"],
    createdBy: "registrar-1",
    traceId: "trace-registry-1",
    correlationId: "correlation-registry-1",
  };
}

function delegationInput() {
  return {
    tenantId: TENANT_A,
    definitionId: "worker-1",
    grantId: "grant-1",
    delegationRef: "RULING-3:delegation:0001",
    delegatedCapabilities: [`mission:execute:${MISSION_ID}`],
    maxGrantedRiskClass: "low" as const,
    grantedBy: "owner-1",
    grantedAt: T0,
    expiresAt: T1,
    correlationId: "correlation-registry-grant",
  };
}

function expectInvalid(result: { ok: boolean; reason?: string }, fragment: string): string {
  if (result.ok) throw new Error(`expected invalid (${fragment}), got ok`);
  if (!result.reason?.includes(fragment)) {
    throw new Error(`expected reason containing "${fragment}", got: ${result.reason}`);
  }
  return result.reason;
}

function assertOk<T extends { ok: boolean; reason?: string }>(
  result: T,
): asserts result is T & { ok: true } {
  if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
}

/* ─────────────────────────────────────────────────────────────
 * Structural fake Supabase client (stateful; no network, no DB)
 * ────────────────────────────────────────────────────────────*/

type Row = Record<string, unknown>;

interface FakeDb {
  client: WorkerRegistryDbClient;
  tables: Map<string, Row[]>;
  writes: Array<{ table: string; op: "insert" | "upsert" | "update"; row: Row }>;
}

function fakeSupabaseDb(): FakeDb {
  const tables = new Map<string, Row[]>();
  const writes: FakeDb["writes"] = [];

  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === "cg_worker_grant_delegation") {
        const grant: Row = {
          id: args.p_grant_id,
          tenant_id: args.p_tenant_id,
          definition_id: args.p_definition_id,
          delegation_ref: args.p_delegation_ref,
          delegated_capabilities: args.p_delegated_capabilities,
          max_granted_risk_class: args.p_max_granted_risk_class,
          state: "active",
          granted_by: args.p_granted_by,
          granted_at: args.p_granted_at,
          expires_at: args.p_expires_at,
        };
        writes.push({ table: "cg_worker_delegation_grant", op: "insert", row: grant });
        (
          tables.get("cg_worker_delegation_grant") ??
          tables.set("cg_worker_delegation_grant", []).get("cg_worker_delegation_grant")!
        ).push(grant);
        const history: Row = {
          id: args.p_grant_id,
          tenant_id: args.p_tenant_id,
          definition_id: args.p_definition_id,
          delegation_ref: args.p_delegation_ref,
          delegated_capabilities: args.p_delegated_capabilities,
          max_granted_risk_class: args.p_max_granted_risk_class,
          recorded_by: args.p_granted_by,
          recorded_at: args.p_granted_at,
          expires_at: args.p_expires_at,
        };
        writes.push({ table: "cg_worker_delegation", op: "insert", row: history });
        (
          tables.get("cg_worker_delegation") ??
          tables.set("cg_worker_delegation", []).get("cg_worker_delegation")!
        ).push(history);
        const definition = tables.get("cg_worker_definition")?.[0];
        if (definition !== undefined) {
          const refs = definition.delegation_history_refs as string[];
          const patch = {
            delegation_history_refs: refs.includes(String(args.p_delegation_ref))
              ? refs
              : [...refs, args.p_delegation_ref],
          };
          writes.push({ table: "cg_worker_definition", op: "update", row: patch });
          Object.assign(definition, patch);
        }
        const lifecycleEvidence = {
          transition: "grant",
          at: args.p_granted_at,
          actorId: args.p_granted_by,
          workerId: args.p_definition_id,
          grantId: args.p_grant_id,
          correlationId: args.p_correlation_id,
        };
        const audit = {
          action: "workforce.worker.grant",
          new_value: {
            correlation_id: args.p_correlation_id,
            details: {
              worker_id: args.p_definition_id,
              grant_id: args.p_grant_id,
              delegation_ref: args.p_delegation_ref,
              expires_at: args.p_expires_at,
              lifecycle_evidence: lifecycleEvidence,
            },
          },
        };
        writes.push({ table: "audit_logs", op: "insert", row: audit });
        (tables.get("audit_logs") ?? tables.set("audit_logs", []).get("audit_logs")!).push(audit);
        return { data: true, error: null };
      }

      if (name === "cg_worker_revoke_delegation") {
        const grant = tables
          .get("cg_worker_delegation_grant")
          ?.find((row) => row.id === args.p_grant_id && row.tenant_id === args.p_tenant_id);
        if (grant === undefined || grant.definition_id !== args.p_definition_id) {
          return { data: null, error: { message: "grant ownership mismatch" } };
        }
        const changed = grant.state !== "revoked";
        if (changed) {
          const patch = {
            state: "revoked",
            revoked_by: args.p_revoked_by,
            revoked_at: args.p_now,
            revoked_reason: args.p_reason,
          };
          Object.assign(grant, patch);
          writes.push({ table: "cg_worker_delegation_grant", op: "update", row: patch });
        }
        const lifecycleEvidence = {
          transition: "revoke",
          at: args.p_now,
          actorId: args.p_revoked_by,
          workerId: args.p_definition_id,
          grantId: args.p_grant_id,
          correlationId: args.p_correlation_id,
        };
        const audit = {
          action: "workforce.worker.revoke",
          new_value: {
            correlation_id: args.p_correlation_id,
            details: {
              worker_id: args.p_definition_id,
              grant_id: args.p_grant_id,
              reason: args.p_reason,
              lifecycle_evidence: lifecycleEvidence,
            },
          },
        };
        writes.push({ table: "audit_logs", op: "insert", row: audit });
        (tables.get("audit_logs") ?? tables.set("audit_logs", []).get("audit_logs")!).push(audit);
        return { data: changed, error: null };
      }
      return { data: null, error: { message: `unexpected RPC: ${name}` } };
    },
    from(table: string) {
      const rowsFor = (): Row[] => tables.get(table) ?? [];
      const makeQuery = (filters: Array<[string, string]>) => ({
        eq(column: string, value: string) {
          return makeQuery([...filters, [column, value]]);
        },
        maybeSingle: async () => {
          const found = rowsFor().filter((row) => filters.every(([c, v]) => row[c] === v));
          return { data: found[0] ?? null, error: null };
        },
        then(
          onFulfilled?: (value: { data: Row[]; error: null }) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          const found = rowsFor().filter((row) => filters.every(([c, v]) => row[c] === v));
          return Promise.resolve({ data: found, error: null }).then(onFulfilled, onRejected);
        },
      });
      return {
        select() {
          return makeQuery([]);
        },
        insert(row: Row) {
          writes.push({ table, op: "insert", row });
          (tables.get(table) ?? tables.set(table, []).get(table)!).push({ ...row });
          return Promise.resolve({ data: row, error: null });
        },
        upsert(row: Row) {
          writes.push({ table, op: "upsert", row });
          (tables.get(table) ?? tables.set(table, []).get(table)!).push({ ...row });
          return Promise.resolve({ data: row, error: null });
        },
        update(patch: Row) {
          const makeUpdate = (filters: Array<[string, string]>) => ({
            eq(column: string, value: string) {
              return makeUpdate([...filters, [column, value]]);
            },
            then(
              onFulfilled?: (value: { data: Row[]; error: null }) => unknown,
              onRejected?: (reason: unknown) => unknown,
            ) {
              writes.push({ table, op: "update", row: patch });
              for (const row of rowsFor()) {
                if (filters.every(([c, v]) => row[c] === v)) {
                  Object.assign(row, patch);
                }
              }
              return Promise.resolve({ data: rowsFor(), error: null }).then(
                onFulfilled,
                onRejected,
              );
            },
          });
          return makeUpdate([]);
        },
      };
    },
  };

  return { client: client as unknown as WorkerRegistryDbClient, tables, writes };
}

async function registeredDb() {
  const db = fakeSupabaseDb();
  const registry = createWorkerRegistryDb(db.client);
  const registered = await registry.registerWorker(registrationInput());
  assertOk(registered);
  return { db, registry };
}

/* ─────────────────────────────────────────────────────────────
 * 1–3. registration, delegation grant, revocation
 * ────────────────────────────────────────────────────────────*/

describe("worker registry db — registerWorker (§28 persistent identity)", () => {
  it("adds expiry only to existing delegation tables without widening RLS", () => {
    const migration = readFileSync(EXPIRY_MIGRATION, "utf8");
    expect(migration).toMatch(/ALTER TABLE public\.cg_worker_delegation\b/i);
    expect(migration).toMatch(/ALTER TABLE public\.cg_worker_delegation_grant\b/i);
    expect(migration.match(/p_tenant_id !~\* '[^']+'/gi)).toHaveLength(2);
    expect(migration.match(/v_audit_tenant := p_tenant_id::uuid;/gi)).toHaveLength(2);
    expect(migration).not.toMatch(/CREATE\s+TABLE/i);
    expect(migration).not.toMatch(/^\s*CREATE\s+POLICY\b/im);
    expect(migration).not.toMatch(/\bTO\s+(?:PUBLIC|anon|authenticated)\b/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*?\bTO service_role;/i);
  });

  it("persists an envelope-stamped definition plus capability claim rows", async () => {
    const db = fakeSupabaseDb();
    const registry = createWorkerRegistryDb(db.client);
    const result = await registry.registerWorker(registrationInput());
    assertOk(result);
    expect(result.definitionId).toBe("worker-1");
    expect(result.replayed).toBe(false);

    const definitions = db.tables.get("cg_worker_definition")!;
    expect(definitions).toHaveLength(1);
    const definition = definitions[0]!;
    expect(definition.tenant_id).toBe(TENANT_A);
    expect(definition.lifecycle_state).toBe("provisioned");
    expect(definition.max_risk_class).toBe("medium");
    // Kernel envelope (V1CAP-002): the row is stamped, never anonymous.
    expect(definition.object_type).toBe("worker_definition");
    expect(definition.schema_version).toBe("1.0");
    expect(definition.provenance).toBeTruthy();

    const capabilities = db.tables.get("cg_worker_capability")!;
    expect(capabilities.map((c) => c.capability_id)).toEqual([
      `mission:execute:${MISSION_ID}`,
      `mission:create:${MISSION_ID}`,
    ]);
  });

  it("rejects an invalid registration with zero writes", async () => {
    const db = fakeSupabaseDb();
    const registry = createWorkerRegistryDb(db.client);
    const duplicate = await registry.registerWorker({
      ...registrationInput("worker-dup"),
      capabilities: [
        { capabilityId: "mission:execute:x", description: "a" },
        { capabilityId: "mission:execute:x", description: "b" },
      ],
    });
    expectInvalid(duplicate, "duplicate");
    expect(db.writes).toHaveLength(0);
  });

  it("replays an existing registration idempotently (canonical truth, §10)", async () => {
    const { db, registry } = await registeredDb();
    expect(db.writes).toHaveLength(3); // 1 definition + 2 capabilities
    const replay = await registry.registerWorker(registrationInput());
    assertOk(replay);
    expect(replay.replayed).toBe(true);
    expect(db.tables.get("cg_worker_definition")).toHaveLength(1);
    expect(db.writes).toHaveLength(3); // zero new writes on replay
  });
});

describe("worker registry db — grantDelegation / revokeDelegation", () => {
  it("writes the live grant, the append-only history row, and mirrors the ref", async () => {
    const { db, registry } = await registeredDb();
    const result = await registry.grantDelegation(delegationInput());
    assertOk(result);
    expect(result.grantId).toBe("grant-1");
    expect(result.replayed).toBe(false);

    const grants = db.tables.get("cg_worker_delegation_grant")!;
    expect(grants).toHaveLength(1);
    expect(grants[0]!.state).toBe("active");
    expect(grants[0]!.max_granted_risk_class).toBe("low");

    const history = db.tables.get("cg_worker_delegation")!;
    expect(history).toHaveLength(1);
    expect(history[0]!.recorded_by).toBe("owner-1");
    const grantAudit = db.writes.find((write) => write.table === "audit_logs");
    expect(grantAudit?.row.new_value).toMatchObject({
      correlation_id: "correlation-registry-grant",
      details: {
        worker_id: "worker-1",
        grant_id: "grant-1",
        expires_at: T1,
        lifecycle_evidence: {
          transition: "grant",
          at: T0,
          actorId: "owner-1",
          workerId: "worker-1",
          grantId: "grant-1",
          correlationId: "correlation-registry-grant",
        },
      },
    });

    const definition = db.tables.get("cg_worker_definition")![0]!;
    expect(definition.delegation_history_refs).toEqual(["RULING-3:delegation:0001"]);
  });

  it("refuses a grant for an unregistered worker (zero writes)", async () => {
    const db = fakeSupabaseDb();
    const registry = createWorkerRegistryDb(db.client);
    const denied = await registry.grantDelegation(delegationInput());
    expectInvalid(denied, "not registered in tenant");
    expect(db.writes).toHaveLength(0);
  });

  it("stamps who/when/why on revocation and replays idempotently", async () => {
    const { db, registry } = await registeredDb();
    await registry.grantDelegation(delegationInput());
    const revoked = await registry.revokeDelegation({
      tenantId: TENANT_A,
      definitionId: "worker-1",
      grantId: "grant-1",
      revokedBy: "owner-1",
      reason: "operator-directed revocation",
      now: T0,
      correlationId: "correlation-registry-revoke",
    });
    assertOk(revoked);
    expect(revoked.replayed).toBe(false);
    const grant = db.tables.get("cg_worker_delegation_grant")![0]!;
    expect(grant.state).toBe("revoked");
    expect(grant.revoked_by).toBe("owner-1");
    expect(grant.revoked_at).toBe(T0);
    expect(grant.revoked_reason).toBe("operator-directed revocation");
    const revokeAudit = db.writes.find(
      (write) => write.table === "audit_logs" && write.row.action === "workforce.worker.revoke",
    );
    expect(revokeAudit?.row.new_value).toMatchObject({
      correlation_id: "correlation-registry-revoke",
      details: {
        worker_id: "worker-1",
        grant_id: "grant-1",
        lifecycle_evidence: {
          transition: "revoke",
          at: T0,
          actorId: "owner-1",
          workerId: "worker-1",
          grantId: "grant-1",
          correlationId: "correlation-registry-revoke",
        },
      },
    });

    const replay = await registry.revokeDelegation({
      tenantId: TENANT_A,
      definitionId: "worker-1",
      grantId: "grant-1",
      revokedBy: "owner-1",
      reason: "operator-directed revocation",
      now: T0,
      correlationId: "correlation-registry-revoke",
    });
    assertOk(replay);
    expect(replay.replayed).toBe(true);
  });

  it("refuses to revoke a grant that belongs to another worker", async () => {
    const { registry } = await registeredDb();
    await registry.grantDelegation(delegationInput());
    const denied = await registry.revokeDelegation({
      tenantId: TENANT_A,
      definitionId: "worker-OTHER",
      grantId: "grant-1",
      revokedBy: "owner-1",
      reason: "wrong owner",
      now: T0,
      correlationId: "correlation-registry-revoke",
    });
    expectInvalid(denied, "does not belong to worker");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. authority resolution (neutral RBAC contribution)
 * ────────────────────────────────────────────────────────────*/

describe("worker registry db — resolveWorkerAuthority", () => {
  it("resolves the governed worker's actor with tenant-embedded extraPermissions", async () => {
    const { db, registry } = await registeredDb();
    await registry.grantDelegation(delegationInput());
    const grantRow = db.tables.get("cg_worker_delegation_grant")![0]!;
    grantRow.granted_at = "2026-10-01T14:00:00+02:00";
    grantRow.expires_at = "2026-10-02T14:00:00+02:00";
    const resolved = await registry.resolveWorkerAuthority({
      tenantId: TENANT_A,
      definitionId: "worker-1",
      missionId: MISSION_ID,
      now: T0,
    });
    assertOk(resolved);
    expect(resolved.actor.actorId).toBe("worker-1");
    expect(resolved.actor.isAgent).toBe(true);
    expect(resolved.actor.extraPermissions).toEqual([
      { resource: "mission", action: "execute", scope: `${TENANT_A}:mission:${MISSION_ID}` },
    ]);
  });

  it("denies cross-tenant resolution with the worker's tenant scope mismatch", async () => {
    const { registry } = await registeredDb();
    await registry.grantDelegation(delegationInput());
    const denied = await registry.resolveWorkerAuthority({
      tenantId: TENANT_B,
      definitionId: "worker-1",
      missionId: MISSION_ID,
      now: T0,
    });
    expectInvalid(denied, "not registered in tenant");
  });

  it("denies expired and wrong-mission grants before activation", async () => {
    const expired = await registeredDb();
    const expiredGrant = {
      ...delegationInput(),
      expiresAt: "2026-10-01T12:00:01.000Z",
    };
    await expired.registry.grantDelegation(expiredGrant);
    const expiredResult = await expired.registry.resolveWorkerAuthority({
      tenantId: TENANT_A,
      definitionId: "worker-1",
      missionId: MISSION_ID,
      now: "2026-10-01T12:00:01.000Z",
    });
    expectInvalid(expiredResult, "worker_not_delegated");

    const wrongMission = await registeredDb();
    await wrongMission.registry.grantDelegation(delegationInput());
    const wrongScopeResult = await wrongMission.registry.resolveWorkerAuthority({
      tenantId: TENANT_A,
      definitionId: "worker-1",
      missionId: "MISSION-OTHER",
      now: T0,
    });
    expectInvalid(wrongScopeResult, "worker_not_delegated");

    const notYetGranted = await registeredDb();
    await notYetGranted.registry.grantDelegation({
      ...delegationInput(),
      grantedAt: T1,
      expiresAt: "2026-10-03T12:00:00.000Z",
    });
    const notYetEffective = await notYetGranted.registry.resolveWorkerAuthority({
      tenantId: TENANT_A,
      definitionId: "worker-1",
      missionId: MISSION_ID,
      now: T0,
    });
    expectInvalid(notYetEffective, "worker_not_delegated");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5–6. quarantine + the read-time worker lease gate
 * ────────────────────────────────────────────────────────────*/

describe("worker registry db — quarantineWorker + workerLeaseGate", () => {
  it("records the quarantine ledger row and suspends the definition", async () => {
    const { db, registry } = await registeredDb();
    await registry.grantDelegation(delegationInput());
    const quarantined = await registry.quarantineWorker({
      tenantId: TENANT_A,
      definitionId: "worker-1",
      reason: "failure_count_2_reached_threshold_2",
      failureCount: 2,
      threshold: 2,
      quarantinedBy: "worker-host",
      now: T0,
    });
    assertOk(quarantined);

    const ledger = db.tables.get("cg_worker_quarantine")!;
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.state).toBe("quarantined");
    expect(ledger[0]!.failure_count).toBe(2);
    expect(db.tables.get("cg_worker_definition")![0]!.lifecycle_state).toBe("suspended");

    // The freeze is immediate: authority no longer resolves (the registry
    // checks the quarantine ledger first) and the lease gate denies on the
    // suspended lifecycle.
    const authority = await registry.resolveWorkerAuthority({
      tenantId: TENANT_A,
      definitionId: "worker-1",
      missionId: MISSION_ID,
      now: T0,
    });
    expectInvalid(authority, "worker_quarantined");
    const gate = await registry.workerLeaseGate()({
      tenantId: TENANT_A,
      workerId: "worker-1",
      missionId: MISSION_ID,
      now: T0,
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toContain("worker_quarantined");
  });

  it("allows the gate for a registered, delegated, unquarantined worker", async () => {
    const { registry } = await registeredDb();
    await registry.grantDelegation(delegationInput());
    const gate = await registry.workerLeaseGate()({
      tenantId: TENANT_A,
      workerId: "worker-1",
      missionId: MISSION_ID,
      now: T0,
    });
    expect(gate.ok).toBe(true);
  });

  it("denies lease admission when a grant exceeds the worker's declared capabilities", async () => {
    const { registry } = await registeredDb();
    await registry.grantDelegation({
      ...delegationInput(),
      delegatedCapabilities: [`mission:execute:${MISSION_ID}`, "mission:execute:MISSION-OTHER"],
    });
    const gate = await registry.workerLeaseGate()({
      tenantId: TENANT_A,
      workerId: "worker-1",
      missionId: MISSION_ID,
      now: T0,
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toContain("capability_escalation_denied");
  });

  it("denies the gate for every un-usable posture with zero gate-time writes", async () => {
    const { db, registry } = await registeredDb();
    await registry.grantDelegation(delegationInput());
    const gate = registry.workerLeaseGate();

    const unregistered = await gate({
      tenantId: TENANT_A,
      workerId: "worker-ghost",
      missionId: MISSION_ID,
      now: T0,
    });
    expect(unregistered.ok).toBe(false);
    if (!unregistered.ok) {
      expect(unregistered.reason).toContain("worker definition worker-ghost is not registered");
    }

    await registry.revokeDelegation({
      tenantId: TENANT_A,
      definitionId: "worker-1",
      grantId: "grant-1",
      revokedBy: "owner-1",
      reason: "all authority withdrawn",
      now: T0,
      correlationId: "correlation-registry-revoke",
    });
    const fullyRevoked = await gate({
      tenantId: TENANT_A,
      workerId: "worker-1",
      missionId: MISSION_ID,
      now: T0,
    });
    expect(fullyRevoked.ok).toBe(false);
    if (!fullyRevoked.ok) {
      expect(fullyRevoked.reason).toContain("worker_not_delegated");
    }

    // The gate itself is READ-TIME: no writes beyond registration, grant,
    // revocation and their append-only audit entries,
    // and never a lease write.
    expect(db.writes).toHaveLength(9);
    expect(db.writes.filter((w) => w.op === "update")).toHaveLength(2);
    expect(db.writes.filter((w) => w.table === "audit_logs")).toHaveLength(2);
    expect(db.writes.some((w) => w.table === "cg_mission_lease")).toBe(false);
  });

  it("keeps revocation effective at the NEXT authority check (zero effective authority)", async () => {
    const { registry } = await registeredDb();
    await registry.grantDelegation(delegationInput());
    const before = await registry.resolveWorkerAuthority({
      tenantId: TENANT_A,
      definitionId: "worker-1",
      missionId: MISSION_ID,
      now: T0,
    });
    assertOk(before);
    expect(before.actor.extraPermissions).toHaveLength(1);

    await registry.revokeDelegation({
      tenantId: TENANT_A,
      definitionId: "worker-1",
      grantId: "grant-1",
      revokedBy: "owner-1",
      reason: "revoked mid-mission",
      now: T0,
      correlationId: "correlation-registry-revoke",
    });

    const after = await registry.resolveWorkerAuthority({
      tenantId: TENANT_A,
      definitionId: "worker-1",
      missionId: MISSION_ID,
      now: T0,
    });
    expectInvalid(after, "worker_not_delegated");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 7. untrusted rows fail closed (J-001 anonymous-object gate)
 * ────────────────────────────────────────────────────────────*/

describe("worker registry db — untrusted definition rows", () => {
  it("refuses to resolve authority from an unstamped definition row", async () => {
    const db = fakeSupabaseDb();
    const registry = createWorkerRegistryDb(db.client);
    await registry.registerWorker(registrationInput());
    // Simulate a tampered/partial row: strip the kernel envelope.
    const definition = db.tables.get("cg_worker_definition")![0]!;
    delete definition.object_type;
    delete definition.provenance;

    await expect(
      registry.resolveWorkerAuthority({
        tenantId: TENANT_A,
        definitionId: "worker-1",
        missionId: MISSION_ID,
        now: T0,
      }),
    ).rejects.toThrow(/kernel|envelope|persistent kernel object/i);
  });
});
