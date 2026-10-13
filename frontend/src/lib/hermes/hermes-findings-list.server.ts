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
 *   admitted     → assigned, lease null, evidenceIds []
 *   denied /
 *   rolled_back  → denied
 *   updatedAt / assignedAt from started_at
 *
 * The lease-gap honesty filter in the pure module then drops `mission_stuck`
 * on assigned + lease-null rows so a missing lease substrate cannot invent
 * `mission_timeout`. Query errors (including a missing table) THROW —
 * runtime converts throws to a typed skip; this adapter does not fake [].
 *
 * Security: service-role client, tenant-scoped SQL, Zod-validated untrusted
 * rows (fail-closed throw). `cg_verification_result` has no tenant_id — it
 * is scoped by the execution ids already loaded for this tenant.
 *
 * Version-target classification: ACTIVE-V1 (AGENTS.md §45).
 */

import { z } from "zod";
import type { MissionExecutionState } from "../missions/mission-execution";
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
  | "cg_worker_quarantine";

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
  status: z.enum(["admitted", "denied", "rolled_back"]),
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
    stage: parsed.status === "admitted" ? "assigned" : "denied",
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

/**
 * Build the production findings-list port over a service-role client.
 * Invalid tenantId / now returns [] (does not throw). Query errors throw.
 */
export function createHermesFindingsListPort(client: HermesFindingsListClient): HermesFindingsListPort {
  async function selectRows(
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

  return {
    async listHermesFindings(input: {
      tenantId: string;
      now: string;
    }): Promise<readonly HermesFindingObservationSource[]> {
      if (!isUsableListInput(input.tenantId, input.now)) return [];
      const tenantId = input.tenantId.trim();
      const now = input.now;

      const [executionRows, definitionRows, quarantineRows] = await Promise.all([
        selectRows("cg_execution_record", [["tenant_id", tenantId]]),
        selectRows("cg_worker_definition", [["tenant_id", tenantId]]),
        selectRows("cg_worker_quarantine", [
          ["tenant_id", tenantId],
          ["state", "quarantined"],
        ]),
      ]);

      const executions = executionRows.map((row) =>
        executionFromRow(parseOrThrow("cg_execution_record", executionRowSchema, row)),
      );

      let verificationRecords: { executionId: string; decision: string; reason: string }[] = [];
      if (executions.length > 0) {
        const verificationRows = await selectRows("cg_verification_result", [], {
          column: "execution_id",
          values: executions.map((execution) => execution.executionId),
        });
        verificationRecords = verificationRows.map((row) => {
          const parsed = parseOrThrow("cg_verification_result", verificationRowSchema, row);
          return {
            executionId: parsed.execution_id,
            decision: parsed.decision,
            reason: parsed.reason,
          };
        });
      }

      const quarantinedByDefinition = new Map<
        string,
        { readonly failureCount: number }
      >();
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

      return listHermesFindingsFromState({
        tenantId,
        now,
        executions,
        workerPostures,
        verificationRecords,
      });
    },
  };
}
