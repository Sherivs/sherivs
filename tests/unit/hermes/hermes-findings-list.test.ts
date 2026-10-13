/**
 * CoreGrid — Hermes FINDINGS list (pure state + fake DB client).
 *
 * Proves honesty: findings are derived from REAL assess functions over
 * caller-supplied / DB-projected state; assigned+lease-null is NOT treated
 * as mission_stuck (lease-substrate gap); the adapter never calls
 * runHermesCycle. No live database, no resident process, no Phase 52.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MissionExecutionState } from "@/lib/missions/mission-execution";
import type { HermesWorkerPosture } from "@/lib/hermes/hermes-contract";
import { listHermesFindingsFromState } from "@/lib/hermes/hermes-findings-list";
import {
  createHermesFindingsListPort,
  type HermesFindingsListClient,
} from "@/lib/hermes/hermes-findings-list.server";

const TENANT = "tenant-alpha";
const OTHER_TENANT = "tenant-beta";
const T0 = "2026-10-01T12:00:00.000Z";
const NOW = "2026-10-01T12:05:00.000Z"; // 5 minutes later — past the 60s stale window

const PURE_SRC = join(process.cwd(), "frontend/src/lib/hermes/hermes-findings-list.ts");
const SERVER_SRC = join(process.cwd(), "frontend/src/lib/hermes/hermes-findings-list.server.ts");

function execution(
  partial: Partial<MissionExecutionState> & Pick<MissionExecutionState, "executionId" | "stage">,
): MissionExecutionState {
  return {
    tenantId: TENANT,
    missionId: `MISSION-${partial.executionId}`,
    missionVersion: "1.0",
    assignedBy: "operator-1",
    lastWorkerId: null,
    action: "record-observation",
    idempotencyKey: `idem-${partial.executionId}-0000001`,
    realityRef: "cg_entity:11111111-1111-4111-8111-111111111111",
    attempt: 0,
    failureCount: 0,
    retryScheduledAt: null,
    lease: null,
    evidenceIds: [],
    verificationDecision: null,
    denyReason: null,
    assignedAt: T0,
    updatedAt: T0,
    ...partial,
  };
}

function posture(
  partial: Partial<HermesWorkerPosture> & Pick<HermesWorkerPosture, "workerId">,
): HermesWorkerPosture {
  return {
    tenantId: TENANT,
    lifecycle: "active",
    quarantined: false,
    failureCount: 0,
    observedAt: NOW,
    ...partial,
  };
}

function list(input: {
  tenantId?: string;
  now?: string;
  executions?: readonly MissionExecutionState[];
  workerPostures?: readonly HermesWorkerPosture[];
  verificationRecords?: readonly { executionId: string; decision: string; reason: string }[];
}) {
  return listHermesFindingsFromState({
    tenantId: input.tenantId ?? TENANT,
    now: input.now ?? NOW,
    executions: input.executions ?? [],
    workerPostures: input.workerPostures ?? [],
    verificationRecords: input.verificationRecords ?? [],
  });
}

/* ─────────────────────────────────────────────────────────────
 * Structural fake Supabase client (no network, no DB)
 * ────────────────────────────────────────────────────────────*/

type Row = Record<string, unknown>;

interface TableSpec {
  rows?: Row[];
  selectError?: string;
}

function fakeSupabaseClient(specs: Record<string, TableSpec> = {}): HermesFindingsListClient {
  const specFor = (table: string): TableSpec => specs[table] ?? {};
  return {
    from(table: string) {
      const spec = specFor(table);
      const filters: Array<["eq" | "in", string, unknown]> = [];
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
        then(
          onFulfilled?: (value: { data: Row[]; error: { message: string } | null }) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          if (spec.selectError) {
            return Promise.resolve({
              data: [] as Row[],
              error: { message: spec.selectError },
            }).then(onFulfilled, onRejected);
          }
          let out = spec.rows ?? [];
          for (const [op, column, value] of filters) {
            out =
              op === "eq"
                ? out.filter((row) => row[column] === value)
                : out.filter((row) =>
                    Array.isArray(value) ? value.includes(row[column] as string) : false,
                  );
          }
          return Promise.resolve({ data: out, error: null }).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  };
}

function executionRow(overrides: Row = {}): Row {
  return {
    id: "exec-1",
    idempotency_key: "idem-exec-1-0000001",
    mission_id: "MISSION-exec-1",
    mission_version: "1.0",
    tenant_id: TENANT,
    actor_id: "operator-1",
    action: "record-observation",
    reality_ref: "cg_entity:11111111-1111-4111-8111-111111111111",
    requested_at: T0,
    attempt_id: "attempt-1",
    started_at: T0,
    status: "admitted",
    reason: null,
    external_effect: "none",
    ...overrides,
  };
}

function verificationRow(overrides: Row = {}): Row {
  return {
    verification_id: "exec-1:verification",
    execution_id: "exec-1",
    evidence_ids: [],
    decision: "failed",
    reason: "criteria not met",
    ...overrides,
  };
}

function workerRow(overrides: Row = {}): Row {
  return {
    id: "worker-1",
    tenant_id: TENANT,
    lifecycle_state: "active",
    ...overrides,
  };
}

function quarantineRow(overrides: Row = {}): Row {
  return {
    id: "worker-1:quarantine:t0",
    tenant_id: TENANT,
    definition_id: "worker-1",
    state: "quarantined",
    failure_count: 5,
    ...overrides,
  };
}

function leaseRow(overrides: Row = {}): Row {
  return {
    lease_id: "exec-1:lease:1",
    execution_id: "exec-1",
    tenant_id: TENANT,
    mission_id: "MISSION-exec-1",
    worker_id: "worker-1",
    acquired_at: T0,
    heartbeat_at: T0,
    expires_at: T0,
    attempt: 1,
    state: "active",
    outcome: null,
    completed_at: null,
    retry_not_before: null,
    ...overrides,
  };
}

function port(specs: Record<string, TableSpec> = {}) {
  return createHermesFindingsListPort(fakeSupabaseClient(specs));
}

/* ─────────────────────────────────────────────────────────────
 * Pure state
 * ────────────────────────────────────────────────────────────*/

describe("listHermesFindingsFromState — honesty over recorded state", () => {
  it("empty state → []", () => {
    expect(list({})).toEqual([]);
  });

  it("denied execution → finding kind mission_denied with evidenceRefs", () => {
    const findings = list({
      executions: [
        execution({
          executionId: "exec-denied",
          stage: "denied",
          denyReason: "action not authorized",
        }),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("mission_denied");
    expect(findings[0]?.findingId).toBe("mission_denied:exec-denied");
    expect(findings[0]?.subjectRef).toBe("exec-denied");
    expect(findings[0]?.tenantId).toBe(TENANT);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.evidenceRefs).toEqual(["cg_execution_record:exec-denied"]);
    expect(findings[0]?.summary).toContain("action not authorized");
    expect(findings[0]?.claim.source).toBe("mission_record_port");
    expect(findings[0]?.claim.sourceRef).toBe("cg_execution_record:exec-denied");
  });

  it("admitted assigned + lease null + old updatedAt → NOT mission_stuck (lease-gap honesty)", () => {
    const findings = list({
      executions: [
        execution({
          executionId: "exec-assigned",
          stage: "assigned",
          lease: null,
          updatedAt: T0,
        }),
      ],
    });
    expect(findings.filter((finding) => finding.kind === "mission_stuck")).toEqual([]);
    expect(findings).toEqual([]);
  });

  it("stale assigned + lease null + failed verification still emits mission_failed", () => {
    const findings = list({
      executions: [
        execution({
          executionId: "exec-stale-failed",
          stage: "assigned",
          lease: null,
          updatedAt: T0,
        }),
      ],
      verificationRecords: [
        {
          executionId: "exec-stale-failed",
          decision: "failed",
          reason: "criteria not met after admission",
        },
      ],
    });
    expect(findings.filter((finding) => finding.kind === "mission_stuck")).toEqual([]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("mission_failed");
    expect(findings[0]?.findingId).toBe("mission_failed:exec-stale-failed");
    expect(findings[0]?.summary).toContain("criteria not met after admission");
  });

  it("failed verification on an execution → mission_failed", () => {
    const findings = list({
      executions: [
        execution({
          executionId: "exec-verify-failed",
          stage: "evidenced",
          updatedAt: NOW,
        }),
      ],
      verificationRecords: [
        {
          executionId: "exec-verify-failed",
          decision: "failed",
          reason: "criteria not met",
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("mission_failed");
    expect(findings[0]?.findingId).toBe("mission_failed:exec-verify-failed");
    expect(findings[0]?.severity).toBe("critical");
    expect(findings[0]?.summary).toContain("criteria not met");
    expect(findings[0]?.evidenceRefs).toEqual(["cg_execution_record:exec-verify-failed"]);
  });

  it("quarantined worker → worker_quarantined", () => {
    const findings = list({
      workerPostures: [
        posture({
          workerId: "worker-q",
          lifecycle: "suspended",
          quarantined: true,
          failureCount: 5,
        }),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("worker_quarantined");
    expect(findings[0]?.findingId).toBe("worker_quarantined:worker-q");
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.evidenceRefs).toEqual(["cg_worker_quarantine:worker-q"]);
    expect(findings[0]?.summary).toContain("5 failure");
  });

  it("suspended unquarantined worker → worker_suspended", () => {
    const findings = list({
      workerPostures: [
        posture({
          workerId: "worker-s",
          lifecycle: "suspended",
          quarantined: false,
          failureCount: 0,
        }),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("worker_suspended");
    expect(findings[0]?.findingId).toBe("worker_suspended:worker-s");
    expect(findings[0]?.severity).toBe("info");
    expect(findings[0]?.evidenceRefs).toEqual(["cg_worker_definition:worker-s"]);
  });

  it("blank tenant → []", () => {
    const executions = [
      execution({ executionId: "exec-denied", stage: "denied", denyReason: "denied" }),
    ];
    expect(list({ tenantId: "", executions })).toEqual([]);
    expect(list({ tenantId: "   ", executions })).toEqual([]);
  });

  it("unparseable now → []", () => {
    const executions = [
      execution({ executionId: "exec-denied", stage: "denied", denyReason: "denied" }),
    ];
    expect(list({ now: "not-a-timestamp", executions })).toEqual([]);
    expect(list({ now: "", executions })).toEqual([]);
  });

  it("cross-tenant executions are skipped before assess", () => {
    const findings = list({
      executions: [
        execution({
          executionId: "exec-foreign",
          tenantId: OTHER_TENANT,
          stage: "denied",
          denyReason: "foreign deny",
        }),
        execution({
          executionId: "exec-local",
          stage: "denied",
          denyReason: "local deny",
        }),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.subjectRef).toBe("exec-local");
    expect(findings[0]?.tenantId).toBe(TENANT);
  });

  it("leased orphan (real lease expiry) still yields mission_stuck — filter is assigned+lease-null only", () => {
    const findings = list({
      executions: [
        execution({
          executionId: "exec-leased",
          stage: "leased",
          lease: {
            leaseId: "lease-1",
            workerId: "worker-1",
            acquiredAt: T0,
            heartbeatAt: T0,
            leaseExpiresAt: T0,
          },
        }),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("mission_stuck");
    expect(findings[0]?.findingId).toBe("mission_stuck:exec-leased");
  });

  it("stage leased + expired leaseExpiresAt → mission_stuck KEPT (real orphan, not invented)", () => {
    const findings = list({
      executions: [
        execution({
          executionId: "exec-orphan-lease",
          stage: "leased",
          lastWorkerId: "worker-1",
          attempt: 1,
          lease: {
            leaseId: "exec-orphan-lease:lease:1",
            workerId: "worker-1",
            acquiredAt: T0,
            heartbeatAt: T0,
            leaseExpiresAt: T0,
          },
        }),
      ],
    });
    const stuck = findings.filter((finding) => finding.kind === "mission_stuck");
    expect(stuck).toHaveLength(1);
    expect(stuck[0]?.subjectRef).toBe("exec-orphan-lease");
    expect(stuck[0]?.summary).toMatch(/lease expired/);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Fake DB client
 * ────────────────────────────────────────────────────────────*/

describe("createHermesFindingsListPort — fake client, no live DB", () => {
  it("fake client returning empty rows → []", async () => {
    const findings = await port({
      cg_execution_record: { rows: [] },
      cg_worker_definition: { rows: [] },
      cg_worker_quarantine: { rows: [] },
    }).listHermesFindings({ tenantId: TENANT, now: NOW });
    expect(findings).toEqual([]);
  });

  it("fake client returning one denied execution row → mission_denied", async () => {
    const findings = await port({
      cg_execution_record: {
        rows: [
          executionRow({
            id: "exec-denied",
            mission_id: "MISSION-exec-denied",
            status: "denied",
            reason: "action not authorized",
          }),
        ],
      },
    }).listHermesFindings({ tenantId: TENANT, now: NOW });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("mission_denied");
    expect(findings[0]?.findingId).toBe("mission_denied:exec-denied");
    expect(findings[0]?.evidenceRefs).toEqual(["cg_execution_record:exec-denied"]);
  });

  it("admitted assigned row with old started_at is NOT mission_stuck (DB lease-gap projection)", async () => {
    const findings = await port({
      cg_execution_record: {
        rows: [executionRow({ id: "exec-admitted", status: "admitted", started_at: T0 })],
      },
    }).listHermesFindings({ tenantId: TENANT, now: NOW });
    expect(findings.filter((finding) => finding.kind === "mission_stuck")).toEqual([]);
    expect(findings).toEqual([]);
  });

  it("fake client: no lease rows → still not stuck", async () => {
    const findings = await port({
      cg_execution_record: {
        rows: [executionRow({ id: "exec-admitted", status: "admitted", started_at: T0 })],
      },
      cg_mission_lease: { rows: [] },
    }).listHermesFindings({ tenantId: TENANT, now: NOW });
    expect(findings.filter((finding) => finding.kind === "mission_stuck")).toEqual([]);
    expect(findings).toEqual([]);
  });

  it("fake client: lease row on admitted execution → leased projection → expired lease yields mission_stuck", async () => {
    const findings = await port({
      cg_execution_record: {
        rows: [executionRow({ id: "exec-leased", status: "admitted", started_at: T0 })],
      },
      cg_mission_lease: {
        rows: [
          leaseRow({
            lease_id: "exec-leased:lease:1",
            execution_id: "exec-leased",
            mission_id: "MISSION-exec-1",
            acquired_at: new Date(T0),
            heartbeat_at: new Date(T0),
            expires_at: new Date(T0),
          }),
        ],
      },
    }).listHermesFindings({ tenantId: TENANT, now: NOW });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("mission_stuck");
    expect(findings[0]?.findingId).toBe("mission_stuck:exec-leased");
    expect(findings[0]?.summary).toMatch(/lease expired/);
  });

  it("failed verification row on a non-stale admitted execution → mission_failed", async () => {
    const findings = await port({
      cg_execution_record: {
        rows: [executionRow({ id: "exec-verify-failed", status: "admitted", started_at: NOW })],
      },
      cg_verification_result: {
        rows: [
          verificationRow({
            verification_id: "exec-verify-failed:verification",
            execution_id: "exec-verify-failed",
            decision: "failed",
            reason: "criteria not met",
          }),
        ],
      },
    }).listHermesFindings({ tenantId: TENANT, now: NOW });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("mission_failed");
    expect(findings[0]?.subjectRef).toBe("exec-verify-failed");
  });

  it("quarantined worker row → worker_quarantined; suspended unquarantined → worker_suspended", async () => {
    const findings = await port({
      cg_worker_definition: {
        rows: [
          workerRow({ id: "worker-q", lifecycle_state: "suspended" }),
          workerRow({ id: "worker-s", lifecycle_state: "suspended" }),
        ],
      },
      cg_worker_quarantine: {
        rows: [quarantineRow({ definition_id: "worker-q", failure_count: 3 })],
      },
    }).listHermesFindings({ tenantId: TENANT, now: NOW });
    const kinds = findings.map((finding) => finding.kind).sort();
    expect(kinds).toEqual(["worker_quarantined", "worker_suspended"]);
    const quarantined = findings.find((finding) => finding.kind === "worker_quarantined");
    expect(quarantined?.subjectRef).toBe("worker-q");
    expect(quarantined?.summary).toContain("3 failure");
    const suspended = findings.find((finding) => finding.kind === "worker_suspended");
    expect(suspended?.subjectRef).toBe("worker-s");
  });

  it("invalid tenantId/now → [] (does not throw)", async () => {
    const client = port({
      cg_execution_record: {
        rows: [executionRow({ id: "exec-denied", status: "denied", reason: "denied" })],
      },
    });
    await expect(client.listHermesFindings({ tenantId: "", now: NOW })).resolves.toEqual([]);
    await expect(client.listHermesFindings({ tenantId: "   ", now: NOW })).resolves.toEqual([]);
    await expect(
      client.listHermesFindings({ tenantId: TENANT, now: "not-a-timestamp" }),
    ).resolves.toEqual([]);
  });

  it("query error (missing table / schema-gap) throws — does not invent []", async () => {
    const client = port({
      cg_execution_record: { selectError: "relation cg_execution_record does not exist" },
    });
    await expect(client.listHermesFindings({ tenantId: TENANT, now: NOW })).rejects.toThrow(
      /hermes findings load failed for cg_execution_record/,
    );
  });
});

/* ─────────────────────────────────────────────────────────────
 * Source pins
 * ────────────────────────────────────────────────────────────*/

describe("Hermes findings list — source pins", () => {
  it("server must not contain runHermesCycle(", () => {
    const source = readFileSync(SERVER_SRC, "utf8");
    expect(source).not.toMatch(/runHermesCycle\(/);
    expect(source).not.toMatch(/enterprise-cycle-runtime/);
    expect(source).not.toMatch(/setInterval/);
    expect(source).toMatch(/listHermesFindingsFromState/);
    expect(source).toMatch(/cg_mission_lease/);
    expect(source).toMatch(/tenant_id/);
    expect(source).toMatch(/projectExecutionWithLeases/);
    expect(source).not.toMatch(/from\s+["'][^"']*hermes-cycle["']/);
  });

  it("must import/call listHermesFindingsFromState and assess via the pure module", () => {
    const pure = readFileSync(PURE_SRC, "utf8");
    const server = readFileSync(SERVER_SRC, "utf8");
    expect(pure).toMatch(/assessExecutions/);
    expect(pure).toMatch(/assessWorkers/);
    expect(pure).toMatch(/from\s+["']\.\/hermes-cycle["']/);
    expect(pure).not.toMatch(/runHermesCycle\(/);
    expect(pure).not.toMatch(/from\s+["'][^"']*\.server/);
    expect(pure).not.toMatch(/setInterval/);
    expect(pure).not.toMatch(/enterprise-cycle-runtime/);
    expect(server).toMatch(/from\s+["']\.\/hermes-findings-list["']/);
    expect(server).toMatch(/listHermesFindingsFromState\(/);
  });
});
