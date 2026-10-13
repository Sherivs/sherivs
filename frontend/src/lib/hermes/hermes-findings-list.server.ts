/**
 * CoreGrid — Hermes FINDINGS list, DB adapter (state of record)
 * (MISSION V1-002 follow-up, team HERMES / OBSERVABILITY).
 *
 * Reads tenant-scoped rows from the EXISTING `cg_*` mission and workforce
 * tables and projects them onto the PURE `listHermesFindingsFromState`
 * contract. Listing is OBSERVE+ASSESS only — this adapter never calls
 * `runHermesCycle` (no repair ACT), never starts a resident process, and
 * never un-freezes Phase 52.
 *
 * Projection (same as `executionFromRow` in mission-execution-db.server.ts):
 *   admitted | assigned → assigned, lease null, evidenceIds []
 *   leased              → leased
 *   evidenced           → evidenced
 *   verified            → verified
 *   requeued            → requeued
 *   exhausted           → exhausted
 *   denied | rolled_back → denied
 *   updatedAt / assignedAt from started_at
 *
 * After loading tenant-scoped executions, this adapter ALSO selects
 * `cg_mission_lease` where `tenant_id` matches (Zod-validated; timestamptz
 * Date values coerced to ISO strings) and projects each execution through
 * `projectExecutionWithLeases`. Empty executions skip the lease query.
 * Query errors THROW — runtime converts throws to a typed skip; this
 * adapter does not fake [] and does not invent leases.
 *
 * The lease-gap honesty filter in the pure module then drops `mission_stuck`
 * on assigned + lease-null rows so a missing lease row cannot invent
 * `mission_timeout`. A projected `stage: "leased"` with expired
 * `leaseExpiresAt` is a REAL orphan and stays `mission_stuck`.
 *
 * Security: service-role client, tenant-scoped SQL, Zod-validated untrusted
 * rows (fail-closed throw). `cg_verification_result` has no tenant_id — it
 * is scoped by the execution ids already loaded for this tenant.
 *
 * Version-target classification: ACTIVE-V1 (AGENTS.md §45).
 */

import { z } from "zod";
import type { MissionExecutionState } from "../missions/mission-execution";
import {
  projectExecutionWithLeases,
  type MissionLeaseProjectionRow,
} from "../missions/mission-lease-projection";
import type { HermesWorkerPosture } from "./hermes-contract";
import type { HermesFindingObservationSource } from "./hermes-finding-observation";
import { listHermesFindingsFromState } from "./hermes-findings-list";

/* ─────────────────────────────────────────────────────────────
 * Client surface (structural — tests inject a fake, no vendor import)
 * ────────────────────────────────────────────────────────────*/

export interface HermesFindingsListQueryResult {
  readonly data: unknown[] | null;
  readonly error: { readonly message: string } | null;
}

export interface HermesFindingsListQuery extends PromiseLike<HermesFindingsListQueryResult> {
  select(columns: string): HermesFindingsListQuery;
  eq(column: string, value: string): HermesFindingsListQuery;
  in(column: string, values: readonly string[]): HermesFindingsListQuery;
}

export interface HermesFindingsListClient {
  from(table: string): HermesFindingsListQuery;
}

export interface HermesFindingsListPort {
  listHermesFindings(input: {
    tenantId: string;
    now: string;
  }): Promise<readonly HermesFindingObservationSource[]>;
}

type FindingsTable =
  | "cg_execution_record"
  | "cg_verification_result"
  | "cg_worker_definition"
  | "cg_worker_quarantine"
  | "cg_mission_lease";

function loadFailed(table: FindingsTable, error: { message: string }): Error {
  return new Error(`hermes findings load failed for ${table}: ${error.message}`);
}

function isUsableListInput(tenantId: string, now: string): boolean {
  if (typeof tenantId !== "string" || tenantId.trim().length === 0) return false;
  if (typeof now !== "string" || !Number.isFinite(Date.parse(now))) return false;
  return true;
}

/* ─────────────────────────────────────────────────────────────
 * Row schemas — duplicated locally (not exported from the DB adapters).
 * Keep aligned with mission-execution-db.server.ts / worker-registry-db.
 * ────────────────────────────────────────────────────────────*/

const EXECUTION_RECORD_STATUS = [
  "admitted",
  "denied",
  "rolled_back",
  "assigned",
  "leased",
  "evidenced",
  "verified",
  "requeued",
  "exhausted",
] as const;

const executionRowSchema = z.object({
  id: z.string().min(1).max(160),
  idempotency_key: z.string().min(1).max(200),
  mission_id: z.string().min(1).max(160),
  mission_version: z.string().min(1).max(32),
  tenant_id: z.string().min(1).max(128),
  actor_id: z.string().min(1).max(160),
  action: z.string().min(1).max(160),
  reality_ref: z.string().min(1).max(200),
  requested_at: z.string().min(1),
  attempt_id: z.string().min(1).max(180),
  started_at: z.string().min(1),
  status: z.enum(EXECUTION_RECORD_STATUS),
  reason: z.string().nullable(),
  external_effect: z.enum(["none", "recorded_intent", "compensation_required"]),
});

const verificationRowSchema = z.object({
  verification_id: z.string().min(1).max(180),
  execution_id: z.string().min(1).max(160),
  evidence_ids: z.array(z.string()),
  decision: z.enum(["verified", "failed", "inconclusive"]),
  reason: z.string().min(1).max(200),
});

const workerDefinitionRowSchema = z.object({
  id: z.string().min(1).max(160),
  tenant_id: z.string().min(1).max(128),
  lifecycle_state: z.enum(["provisioned", "active", "suspended", "archived", "deleted"]),
});

const quarantineRowSchema = z.object({
  id: z.string().min(1).max(160),
  tenant_id: z.string().min(1).max(128),
  definition_id: z.string().min(1).max(160),
  state: z.enum(["quarantined", "released"]),
  // Insert writes failure_count; the registry's parse schema omits it.
  failure_count: z.number().int().min(0).max(1_000_000).nullish(),
});

const isoTimestamp = z
  .union([z.string().min(1), z.date()])
  .transform((value) => (value instanceof Date ? value.toISOString() : value));

const isoTimestampNullable = z
  .union([z.string().min(1), z.date(), z.null()])
  .transform((value) => (value instanceof Date ? value.toISOString() : value));

const leaseRowSchema = z.object({
  lease_id: z.string().min(1).max(160),
  execution_id: z.string().min(1).max(160),
  tenant_id: z.string().min(1).max(128),
  mission_id: z.string().min(1).max(160),
  worker_id: z.string().min(1).max(160),
  acquired_at: isoTimestamp,
  heartbeat_at: isoTimestamp,
  expires_at: isoTimestamp,
  attempt: z.number().int().min(1),
  state: z.enum(["active", "released", "recovered"]),
  outcome: z.enum(["succeeded", "failed"]).nullable(),
  completed_at: isoTimestampNullable,
  retry_not_before: isoTimestampNullable,
});

function parseOrThrow<T extends z.ZodTypeAny>(
  table: FindingsTable,
  schema: T,
  row: unknown,
): z.infer<T> {
  const parsed = schema.safeParse(row);
  if (!parsed.success) {
    throw new Error(
      `hermes findings load failed for ${table}: row validation rejected — ${parsed.error.message}`,
    );
  }
  return parsed.data as z.infer<T>;
}

/** Same projection as `executionFromRow` in mission-execution-db.server.ts. */
function stageFromRecordStatus(
  status: z.infer<typeof executionRowSchema>["status"],
): MissionExecutionState["stage"] {
  switch (status) {
    case "admitted":
    case "assigned":
      return "assigned";
    case "leased":
      return "leased";
    case "evidenced":
      return "evidenced";
    case "verified":
      return "verified";
    case "requeued":
      return "requeued";
    case "exhausted":
      return "exhausted";
    case "denied":
    case "rolled_back":
      return "denied";
  }
}

function executionFromRow(parsed: z.infer<typeof executionRowSchema>): MissionExecutionState {
  return {
    executionId: parsed.id,
    tenantId: parsed.tenant_id,
    missionId: parsed.mission_id,
    missionVersion: parsed.mission_version,
    assignedBy: parsed.actor_id,
    lastWorkerId: null,
    action: parsed.action,
    idempotencyKey: parsed.idempotency_key,
    realityRef: parsed.reality_ref,
    stage: stageFromRecordStatus(parsed.status),
    attempt: 0,
    failureCount: 0,
    retryScheduledAt: null,
    lease: null,
    evidenceIds: [],
    verificationDecision: null,
    denyReason: parsed.reason,
    assignedAt: parsed.started_at,
    updatedAt: parsed.started_at,
  };
}

export interface HermesObservationSnapshot {
  readonly executions: readonly MissionExecutionState[];
  readonly workerPostures: readonly HermesWorkerPosture[];
  readonly verificationRecords: readonly {
    readonly executionId: string;
    readonly decision: "verified" | "failed" | "inconclusive";
    readonly reason: string;
  }[];
}

const EMPTY_OBSERVATION_SNAPSHOT: HermesObservationSnapshot = {
  executions: [],
  workerPostures: [],
  verificationRecords: [],
};

async function selectRows(
  client: HermesFindingsListClient,
  table: FindingsTable,
  filters: ReadonlyArray<readonly [string, string]>,
  inFilter?: { readonly column: string; readonly values: readonly string[] },
): Promise<unknown[]> {
  let query = client.from(table).select("*");
  for (const [column, value] of filters) {
    query = query.eq(column, value);
  }
  if (inFilter !== undefined) {
    query = query.in(inFilter.column, inFilter.values);
  }
  const result = await query;
  if (result.error) throw loadFailed(table, result.error);
  return (result.data ?? []) as unknown[];
}

/**
 * Tenant-scoped observation snapshot for the Hermes resident (Runtime team).
 * Invalid tenantId / now returns empty arrays (does not throw). Query errors throw.
 * Does not call runHermesCycle. Does not start a resident process.
 */
export async function loadHermesObservationSnapshot(
  client: HermesFindingsListClient,
  tenantId: string,
  now: string,
): Promise<HermesObservationSnapshot> {
  if (!isUsableListInput(tenantId, now)) return EMPTY_OBSERVATION_SNAPSHOT;
  tenantId = tenantId.trim();

  const [executionRows, definitionRows, quarantineRows] = await Promise.all([
    selectRows(client, "cg_execution_record", [["tenant_id", tenantId]]),
    selectRows(client, "cg_worker_definition", [["tenant_id", tenantId]]),
    selectRows(client, "cg_worker_quarantine", [
      ["tenant_id", tenantId],
      ["state", "quarantined"],
    ]),
  ]);

  const executions = executionRows.map((row) =>
    executionFromRow(parseOrThrow("cg_execution_record", executionRowSchema, row)),
  );

  let verificationRecords: HermesObservationSnapshot["verificationRecords"] = [];
  let projectedExecutions = executions;
  if (executions.length > 0) {
    const [verificationRows, leaseRows] = await Promise.all([
      selectRows(client, "cg_verification_result", [], {
        column: "execution_id",
        values: executions.map((execution) => execution.executionId),
      }),
      selectRows(client, "cg_mission_lease", [["tenant_id", tenantId]]),
    ]);
    verificationRecords = verificationRows.map((row) => {
      const parsed = parseOrThrow("cg_verification_result", verificationRowSchema, row);
      return {
        executionId: parsed.execution_id,
        decision: parsed.decision,
        reason: parsed.reason,
      };
    });
    const verificationByExecution = new Map(
      verificationRecords.map((record) => [record.executionId, record.decision] as const),
    );
    const leasesByExecution = new Map<string, MissionLeaseProjectionRow[]>();
    for (const row of leaseRows) {
      const parsed = parseOrThrow("cg_mission_lease", leaseRowSchema, row);
      const list = leasesByExecution.get(parsed.execution_id) ?? [];
      list.push({
        leaseId: parsed.lease_id,
        executionId: parsed.execution_id,
        tenantId: parsed.tenant_id,
        workerId: parsed.worker_id,
        acquiredAt: parsed.acquired_at,
        heartbeatAt: parsed.heartbeat_at,
        expiresAt: parsed.expires_at,
        attempt: parsed.attempt,
        state: parsed.state,
        outcome: parsed.outcome,
        completedAt: parsed.completed_at,
        retryNotBefore: parsed.retry_not_before,
      });
      leasesByExecution.set(parsed.execution_id, list);
    }
    projectedExecutions = executions.map((execution) =>
      projectExecutionWithLeases({
        base: execution,
        leases: leasesByExecution.get(execution.executionId) ?? [],
        verificationDecision: verificationByExecution.get(execution.executionId) ?? null,
      }),
    );
  }

  const quarantinedByDefinition = new Map<string, { readonly failureCount: number }>();
  for (const row of quarantineRows) {
    const parsed = parseOrThrow("cg_worker_quarantine", quarantineRowSchema, row);
    if (parsed.state !== "quarantined") continue;
    if (quarantinedByDefinition.has(parsed.definition_id)) continue;
    quarantinedByDefinition.set(parsed.definition_id, {
      failureCount: parsed.failure_count ?? 0,
    });
  }

  const workerPostures: HermesWorkerPosture[] = definitionRows.map((row) => {
    const parsed = parseOrThrow("cg_worker_definition", workerDefinitionRowSchema, row);
    const quarantine = quarantinedByDefinition.get(parsed.id);
    return {
      workerId: parsed.id,
      tenantId: parsed.tenant_id,
      lifecycle: parsed.lifecycle_state,
      quarantined: quarantine !== undefined,
      failureCount: quarantine?.failureCount ?? 0,
      observedAt: now,
    };
  });

  return {
    executions: projectedExecutions,
    workerPostures,
    verificationRecords,
  };
}

/**
 * Build the production findings-list port over a service-role client.
 * Invalid tenantId / now returns [] (does not throw). Query errors throw.
 */
export function createHermesFindingsListPort(client: HermesFindingsListClient): HermesFindingsListPort {
  return {
    async listHermesFindings(input: {
      tenantId: string;
      now: string;
    }): Promise<readonly HermesFindingObservationSource[]> {
      if (!isUsableListInput(input.tenantId, input.now)) return [];
      const snapshot = await loadHermesObservationSnapshot(client, input.tenantId, input.now);
      return listHermesFindingsFromState({
        tenantId: input.tenantId.trim(),
        now: input.now,
        executions: snapshot.executions,
        workerPostures: snapshot.workerPostures,
        verificationRecords: snapshot.verificationRecords,
      });
    },
  };
}
