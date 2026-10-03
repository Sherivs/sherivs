/**
 * MISSION V1-004 — DB-backed mission execution adapter (cg_* persistence).
 *
 * Proves, at unit level (offline, mocked Supabase client — no real database):
 *  1. recordIntent upserts cg_mission_intent (tenant-scoped, idempotent) and
 *     replays an already-declared intent without a second write;
 *  2. assignExecution persists the admitted cg_execution_record +
 *     append-only cg_execution_history row and REPLAYS a duplicate idempotency
 *     key with no new external effect (AGENTS §10);
 *  3. recordEvidence persists §12 provenance (who/when/source) into
 *     cg_foundation_evidence;
 *  4. verifyExecution enforces executor ≠ verifier on the DB path and
 *     persists the independent decision into cg_verification_result
 *     (replay-protected);
 *  5. cross-tenant reads fail closed (unknown == foreign, one signal);
 *  6. the KNOWN lease-substrate gap is FAIL-CLOSED: every lease operation
 *     returns the typed lease_substrate_missing result and writes NOTHING;
 *  7. untrusted rows are Zod-validated: a malformed cg_execution_record row
 *     fails closed instead of entering contract state.
 */

import { describe, expect, it } from "vitest";
import {
  createDbMissionExecutionPorts,
  MISSION_LEASE_SUBSTRATE_GAP,
  type MissionDbClient,
} from "@/lib/missions/mission-execution-db.server";
import type { MissionActorContext } from "@/lib/missions/mission-authorization";
import type { MissionIntentInput } from "@/lib/missions/mission-execution";

/* ─────────────────────────────────────────────────────────────
 * Fixtures
 * ────────────────────────────────────────────────────────────*/

const TENANT_A = "tenant-alpha";
const TENANT_B = "tenant-beta";
const T0 = "2026-10-01T12:00:00.000Z";
const EXECUTION_ID = "exec-1";
const MISSION_ID = "MISSION-V1-004-GENERAL";
const VERSION = "1.0";

function owner(): MissionActorContext {
  return {
    actorId: "owner-1",
    tenantId: TENANT_A,
    identityKind: "human",
    lifecycle: "active",
    role: "mission_owner",
  };
}

function operator(): MissionActorContext {
  return {
    actorId: "operator-1",
    tenantId: TENANT_A,
    identityKind: "human",
    lifecycle: "active",
    role: "mission_operator",
  };
}

function verifierActor(): MissionActorContext {
  return {
    actorId: "verifier-1",
    tenantId: TENANT_A,
    identityKind: "human",
    lifecycle: "active",
    role: "mission_verifier",
  };
}

function intentInput(overrides?: Partial<MissionIntentInput>): MissionIntentInput {
  return {
    tenantId: TENANT_A,
    missionId: MISSION_ID,
    version: VERSION,
    purpose: "general-mission-execution-probe",
    authorityRef: "CONTROL-PLANE-06",
    contextRef: "context-1",
    ownerRef: "MISSIONS.md",
    nonScope: ["deploy"],
    authorizedActions: ["record-observation"],
    expiresAt: null,
    ...overrides,
  };
}

function assignmentInput(executionId: string = EXECUTION_ID, idempotencyKey = "idem-key-0000001") {
  return {
    tenantId: TENANT_A,
    missionId: MISSION_ID,
    version: VERSION,
    executionId,
    idempotencyKey,
    action: "record-observation",
    realityRef: "cg_entity:11111111-1111-4111-8111-111111111111",
    now: T0,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Structural fake Supabase client (stateful; no network, no DB)
 * ────────────────────────────────────────────────────────────*/

type Row = Record<string, unknown>;

interface FakeDb {
  client: MissionDbClient;
  tables: Map<string, Row[]>;
  writes: Array<{ table: string; op: "insert" | "upsert"; row: Row }>;
}

function fakeSupabaseDb(
  initial: Record<string, Row[]> = {},
  options?: { insertError?: Record<string, string> },
): FakeDb {
  const tables = new Map<string, Row[]>(Object.entries(initial).map(([t, rows]) => [t, [...rows]]));
  const writes: FakeDb["writes"] = [];
  const insertError = options?.insertError ?? {};

  const client = {
    from(table: string) {
      const rowsFor = (): Row[] => tables.get(table) ?? [];
      const makeQuery = (filters: Array<[string, string]>) => {
        const apply = (): Row[] =>
          rowsFor().filter((row) => filters.every(([column, value]) => row[column] === value));
        return {
          eq(column: string, value: string) {
            return makeQuery([...filters, [column, value]]);
          },
          maybeSingle: async () => {
            const found = apply();
            return { data: found[0] ?? null, error: null };
          },
          then(
            onFulfilled?: (value: { data: Row[]; error: null }) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) {
            return Promise.resolve({ data: apply(), error: null }).then(onFulfilled, onRejected);
          },
        };
      };
      return {
        select() {
          return makeQuery([]);
        },
        insert(row: Row) {
          writes.push({ table, op: "insert", row });
          const message = insertError[table];
          if (message) {
            return Promise.resolve({ data: null, error: { message } });
          }
          (tables.get(table) ?? tables.set(table, []).get(table)!).push(row);
          return Promise.resolve({ data: row, error: null });
        },
        upsert(row: Row) {
          writes.push({ table, op: "upsert", row });
          const rows = tables.get(table) ?? tables.set(table, []).get(table)!;
          rows.push(row);
          return Promise.resolve({ data: row, error: null });
        },
      };
    },
  };

  return { client: client as unknown as MissionDbClient, tables, writes };
}

const MISSION_ROW: Row = {
  mission_id: MISSION_ID,
  version: VERSION,
  tenant_id: TENANT_A,
  purpose: "general-mission-execution-probe",
  authority_ref: "CONTROL-PLANE-06",
  context_ref: "context-1",
  owner_ref: "MISSIONS.md",
  non_scope: ["deploy"],
  authorized_actions: ["record-observation"],
  lifecycle: "authorized",
  expires_at: null,
};

function expectOk<T>(result: { ok: boolean; value?: T; code?: string; reason?: string }): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.code}: ${result.reason}`);
  return result.value as T;
}

function expectDeny(result: { ok: boolean; code?: string; reason?: string }, code: string): string {
  if (result.ok) throw new Error(`expected denial ${code}, got ok`);
  if (result.code !== code) {
    throw new Error(`expected denial ${code}, got ${result.code}: ${result.reason}`);
  }
  return result.reason ?? "";
}

function ports(db: FakeDb) {
  return createDbMissionExecutionPorts(db.client);
}

/* ─────────────────────────────────────────────────────────────
 * 1. recordIntent → cg_mission_intent
 * ────────────────────────────────────────────────────────────*/

describe("db mission adapter — recordIntent", () => {
  it("upserts the intent row with tenant scope and authorized lifecycle", async () => {
    const db = fakeSupabaseDb();
    const { records } = ports(db);
    const result = expectOk(
      await records.recordIntent({ actor: owner(), intent: intentInput(), now: T0 }),
    );
    expect(result.replayed).toBe(false);
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0].table).toBe("cg_mission_intent");
    const row = db.writes[0].row;
    expect(row.tenant_id).toBe(TENANT_A);
    expect(row.mission_id).toBe(MISSION_ID);
    expect(row.lifecycle).toBe("authorized");
    expect(row.authority_ref).toBe("CONTROL-PLANE-06");
    expect(row.authorized_actions).toEqual(["record-observation"]);
  });

  it("replays an already-declared intent without a second write", async () => {
    const db = fakeSupabaseDb({ cg_mission_intent: [MISSION_ROW] });
    const { records } = ports(db);
    const result = expectOk(
      await records.recordIntent({ actor: owner(), intent: intentInput(), now: T0 }),
    );
    expect(result.replayed).toBe(true);
    expect(db.writes).toHaveLength(0);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. assignExecution → cg_execution_record (+ history)
 * ────────────────────────────────────────────────────────────*/

describe("db mission adapter — assignExecution", () => {
  it("persists the admitted execution and its append-only history row", async () => {
    const db = fakeSupabaseDb({ cg_mission_intent: [MISSION_ROW] });
    const { records } = ports(db);
    const result = expectOk(
      await records.assignExecution({ actor: operator(), assignment: assignmentInput() }),
    );
    expect(result.replayed).toBe(false);
    expect(result.execution.stage).toBe("assigned");
    expect(result.execution.tenantId).toBe(TENANT_A);

    const executionWrites = db.writes.filter((w) => w.table === "cg_execution_record");
    const historyWrites = db.writes.filter((w) => w.table === "cg_execution_history");
    expect(executionWrites).toHaveLength(1);
    expect(historyWrites).toHaveLength(1);
    expect(executionWrites[0].row.status).toBe("admitted");
    expect(executionWrites[0].row.external_effect).toBe("recorded_intent");
    expect(executionWrites[0].row.idempotency_key).toBe("idem-key-0000001");
    expect(historyWrites[0].row.status).toBe("admitted");
  });

  it("replays a duplicate idempotency key without a new record (exactly-once)", async () => {
    const db = fakeSupabaseDb({
      cg_mission_intent: [MISSION_ROW],
      cg_execution_record: [
        {
          ...(assignmentInput().executionId && {}),
          id: EXECUTION_ID,
          idempotency_key: "idem-key-0000001",
          mission_id: MISSION_ID,
          mission_version: VERSION,
          tenant_id: TENANT_A,
          actor_id: "operator-1",
          action: "record-observation",
          reality_ref: "cg_entity:11111111-1111-4111-8111-111111111111",
          requested_at: T0,
          attempt_id: `${EXECUTION_ID}:1`,
          started_at: T0,
          status: "admitted",
          reason: null,
          external_effect: "recorded_intent",
        },
      ],
    });
    const { records } = ports(db);
    const result = expectOk(
      await records.assignExecution({ actor: operator(), assignment: assignmentInput() }),
    );
    expect(result.replayed).toBe(true);
    expect(db.writes).toHaveLength(0);
  });

  it("fails closed when the mission intent is not declared in the tenant", async () => {
    const db = fakeSupabaseDb();
    const { records } = ports(db);
    expectDeny(
      await records.assignExecution({ actor: operator(), assignment: assignmentInput() }),
      "mission_not_found",
    );
    expect(db.writes).toHaveLength(0);
  });

  it("persists an out-of-scope denial (fail closed, external effect none)", async () => {
    const db = fakeSupabaseDb({ cg_mission_intent: [MISSION_ROW] });
    const { records } = ports(db);
    const result = expectOk(
      await records.assignExecution({
        actor: operator(),
        assignment: {
          ...assignmentInput("exec-oos", "idem-key-0000002"),
          action: "deploy",
        },
      }),
    );
    expect(result.execution.stage).toBe("denied");
    expect(result.execution.denyReason).toBe("out_of_scope");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. recordEvidence → cg_foundation_evidence (§12)
 * ────────────────────────────────────────────────────────────*/

describe("db mission adapter — recordEvidence", () => {
  it("persists who/when/source provenance and an integrity binding", async () => {
    const db = fakeSupabaseDb();
    const { records } = ports(db);
    const persisted = expectOk(
      await records.recordEvidence({
        tenantId: TENANT_A,
        executionId: EXECUTION_ID,
        evidence: [
          { evidenceKind: "observation", sourceRef: "cg_entity:1111", lineage: ["cg_entity:1111"] },
        ],
        workerId: "worker-1",
        now: T0,
      }),
    );
    expect(persisted).toHaveLength(1);
    expect(db.writes).toHaveLength(1);
    const row = db.writes[0].row;
    expect(db.writes[0].table).toBe("cg_foundation_evidence");
    expect(row.actor_id).toBe("worker-1");
    expect(row.tenant_id).toBe(TENANT_A);
    expect(row.observed_at).toBe(T0);
    expect(row.recorded_at).toBe(T0);
    expect(String(row.provenance)).toContain("worker:worker-1");
    expect(String(row.provenance)).toContain(`execution:${EXECUTION_ID}`);
    expect(String(row.provenance)).toContain("source:cg_entity:1111");
    expect(String(row.integrity)).toHaveLength(64);
    expect(row.lifecycle).toBe("active");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. verifyExecution → cg_verification_result (executor ≠ verifier)
 * ────────────────────────────────────────────────────────────*/

describe("db mission adapter — verifyExecution", () => {
  async function seeded(db: FakeDb) {
    const { records } = ports(db);
    await records.assignExecution({ actor: operator(), assignment: assignmentInput() });
    return records;
  }

  it("fails the verification when the executor of record tries to verify", async () => {
    const db = fakeSupabaseDb({
      cg_mission_intent: [MISSION_ROW],
      cg_foundation_evidence: [
        {
          evidence_id: `${EXECUTION_ID}:evidence:observation`,
          producer: "mission-execution",
          actor_id: "operator-1",
          tenant_id: TENANT_A,
          observed_at: T0,
          recorded_at: T0,
          provenance: `worker:operator-1|execution:${EXECUTION_ID}|source:cg_entity:1111`,
          integrity: "a".repeat(64),
          lifecycle: "active",
          lineage: [],
        },
      ],
    });
    const records = await seeded(db);
    // The executor of record (actor_id on cg_execution_record is operator-1)
    // holds a delegated verify grant, so authorization passes and the denial
    // path exercised is the INDEPENDENCE check — never a verified state.
    const executorWithVerifyGrant: MissionActorContext = {
      ...operator(),
      extraPermissions: [{ resource: "mission", action: "verify", scope: null }],
    };
    const result = expectOk(
      await records.verifyExecution(executorWithVerifyGrant, {
        tenantId: TENANT_A,
        executionId: EXECUTION_ID,
        criteriaMet: true,
        now: T0,
      }),
    );
    // The executor of record (actor_id on cg_execution_record) is operator-1;
    // its own verification is an independence failure, never a verified state.
    expect(result.verification.decision).toBe("failed");
    expect(result.verification.reason).toBe("verification_independence_failed");
    expect(result.execution.verificationDecision).toBe("failed");
    expect(db.writes.some((w) => w.table === "cg_verification_result")).toBe(true);
    const verificationRow = db.writes.find((w) => w.table === "cg_verification_result")!.row;
    expect(verificationRow.decision).toBe("failed");
  });

  it("verifies independently and replays the recorded decision afterwards", async () => {
    const db = fakeSupabaseDb({
      cg_mission_intent: [MISSION_ROW],
      cg_foundation_evidence: [
        {
          evidence_id: `${EXECUTION_ID}:evidence:observation`,
          producer: "mission-execution",
          actor_id: "worker-1",
          tenant_id: TENANT_A,
          observed_at: T0,
          recorded_at: T0,
          provenance: `worker:worker-1|execution:${EXECUTION_ID}|source:cg_entity:1111`,
          integrity: "b".repeat(64),
          lifecycle: "active",
          lineage: [],
        },
      ],
    });
    const records = await seeded(db);
    const verified = expectOk(
      await records.verifyExecution(verifierActor(), {
        tenantId: TENANT_A,
        executionId: EXECUTION_ID,
        criteriaMet: true,
        now: T0,
      }),
    );
    expect(verified.verification.decision).toBe("verified");
    expect(verified.verification.evidenceIds).toEqual([`${EXECUTION_ID}:evidence:observation`]);
    expect(verified.replayed).toBe(false);

    // Replay: the persisted decision stands; no second verification write.
    const replayed = expectOk(
      await records.verifyExecution(verifierActor(), {
        tenantId: TENANT_A,
        executionId: EXECUTION_ID,
        criteriaMet: false,
        now: T0,
      }),
    );
    expect(replayed.replayed).toBe(true);
    expect(replayed.verification.decision).toBe("verified");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. Cross-tenant reads fail closed
 * ────────────────────────────────────────────────────────────*/

describe("db mission adapter — cross-tenant denial", () => {
  it("returns null for another tenant's execution (unknown == foreign)", async () => {
    const db = fakeSupabaseDb({
      cg_mission_intent: [MISSION_ROW],
      cg_execution_record: [
        {
          id: EXECUTION_ID,
          idempotency_key: "idem-key-0000001",
          mission_id: MISSION_ID,
          mission_version: VERSION,
          tenant_id: TENANT_A,
          actor_id: "operator-1",
          action: "record-observation",
          reality_ref: "cg_entity:11111111-1111-4111-8111-111111111111",
          requested_at: T0,
          attempt_id: `${EXECUTION_ID}:1`,
          started_at: T0,
          status: "admitted",
          reason: null,
          external_effect: "recorded_intent",
        },
      ],
    });
    const { records } = ports(db);
    expect(await records.getExecution(TENANT_B, EXECUTION_ID)).toBeNull();
    expect(await records.getExecution(TENANT_A, EXECUTION_ID)).not.toBeNull();
  });
});

/* ─────────────────────────────────────────────────────────────
 * 6. The lease-substrate gap is fail-closed (no writes, ever)
 * ────────────────────────────────────────────────────────────*/

describe("db mission adapter — lease substrate gap (fail-closed)", () => {
  it("fails every lease operation with the typed gap and writes nothing", async () => {
    const db = fakeSupabaseDb();
    const adapter = createDbMissionExecutionPorts(db.client);

    const gap = adapter.leaseOperation();
    expect(gap.ok).toBe(false);
    expect(gap.code).toBe("lease_substrate_missing");
    expect(gap.reason).toBe(MISSION_LEASE_SUBSTRATE_GAP);
    expect(adapter.leaseGap).toBe(MISSION_LEASE_SUBSTRATE_GAP);
    expect(db.writes).toHaveLength(0);
    expect(gap.reason).toContain("no lease-owner, heartbeat or lease-expiry columns");
    expect(gap.reason).toContain("follow-up migration");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 7. Untrusted reads (Zod, fail closed)
 * ────────────────────────────────────────────────────────────*/

describe("db mission adapter — untrusted row validation", () => {
  it("fails closed on a malformed cg_execution_record row", async () => {
    const db = fakeSupabaseDb({
      cg_mission_intent: [MISSION_ROW],
      cg_execution_record: [
        {
          // status outside the migration's CHECK vocabulary — never trusted.
          id: EXECUTION_ID,
          tenant_id: TENANT_A,
          status: "somehow-verified",
        },
      ],
    });
    const { records } = ports(db);
    await expect(records.getExecution(TENANT_A, EXECUTION_ID)).rejects.toThrow(
      /mission execution load failed|row validation/i,
    );
  });
});
