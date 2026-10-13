/**
 * CoreGrid — DB-backed mission execution adapter (MISSION V1-004).
 *
 * Persists the general mission execution path into the EXISTING `cg_*` mission
 * tables authored by
 * `database/supabase/migrations/20260929000000_coregrid_foundation_mission_001.sql`
 * (the applied foundation persistence layer the foundation loop already runs
 * on), plus the HUMAN AUTHORIZED 2026-10-13 status-vocabulary widen
 * `database/supabase/migrations/20261013000050_coregrid_v1_execution_record_status.sql`.
 * This module does not edit checksum-bound
 * `database/supabase/migrations/20261003000019_coregrid_v1_mission_lease.sql`.
 *
 *   recordIntent       → cg_mission_intent       (upsert, idempotent)
 *   assignExecution    → cg_execution_record     (admitted | denied) +
 *                        cg_execution_history    (append-only transition)
 *   recordEvidence     → cg_foundation_evidence  (§12 who/when/source)
 *   recordVerification → cg_verification_result  (independent decision)
 *   lease              → createDbMissionLeasePort over cg_mission_lease
 *                        (V1-003 sibling). After a successful acquire /
 *                        heartbeat / complete / fail / recover, THIS adapter
 *                        (V1-004 owns cg_execution_record) mirrors the
 *                        enriched stage onto cg_execution_record.status and
 *                        appends cg_execution_history.
 *
 * HISTORICAL GAP (closed 2026-10-13): V1-004 previously fail-closed every
 * MissionLeasePort operation with typed `lease_substrate_missing` because
 * cg_execution_record.status admitted only ('admitted','denied','rolled_back')
 * and no lease table existed. The V1-003 sibling authored cg_mission_lease;
 * this adapter now COMPOSES that port. See deprecated MISSION_LEASE_SUBSTRATE_GAP.
 *
 * Security posture (the migration's own law): RLS on every `cg_*` mission
 * table is deny-by-default (enabled, zero policies, anon/authenticated
 * revoked), so this adapter runs on the SERVICE-ROLE client and the
 * authorization contract — lifecycle gate, tenant boundary gate, role grants
 * — is enforced by the neutral RBAC core (`mission-authorization.ts`) BEFORE
 * any row is read or written, plus tenant-scoped SQL on every query. Rows
 * read back are Zod-validated (untrusted reads fail closed). The executor of
 * record on the DB path is the execution's `actor_id` until a lease row
 * refines it (the composed lease port's enriched getExecution).
 *
 * Version-target classification: ACTIVE-V1 (AGENTS.md §45). Does not
 * implement Phase 52 engines. Does not start a resident process.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { admitExecution, type EvidenceRecord } from "../control-plane/foundation-mission";
import type { IdentityEquivalenceRegistry, WorkCriticality } from "../verification";
import {
  authorizeOrDeny,
  buildExecutionEvidence,
  decideExecutionVerification,
  missionIntentInputSchema,
  assignmentInputSchema,
  missionEvidenceInputSchema,
  verifyExecutionInputSchema,
  type ExecutionPathStage,
  type MissionEvidenceInput,
  type MissionExecutionState,
  type MissionIntentInput,
  type MissionVerifyInput,
} from "./mission-execution";
import { missionActorContextSchema } from "./mission-authorization";
import type { MissionLeasePort, MissionRecordPort } from "./mission-execution-store";
import {
  createDbMissionLeasePort,
  type WorkerLeaseGate,
} from "./mission-lease-db.server";

/**
 * The db adapter runs on the service-role client. Typed as the bare
 * `SupabaseClient` because the generated `Database` types lag the authored
 * `cg_*` mission migration — the same posture as `kernel-admin-client.ts`.
 * The untyped surface is contained here: every row read from the database is
 * Zod-validated before it reaches contract state.
 */
export type MissionDbClient = SupabaseClient;

/* ─────────────────────────────────────────────────────────────
 * Historical fail-closed lease-substrate gap (deprecated export)
 * ────────────────────────────────────────────────────────────*/

/**
 * @deprecated Historical fail-closed token. The former typed denial was
 * `lease_substrate_missing` from the removed leaseOperation stub. Adapter.lease
 * is now the real `MissionLeasePort` composed from `createDbMissionLeasePort`.
 * Kept so existing imports compile. Do not use this string as a live denial.
 */
export const MISSION_LEASE_SUBSTRATE_GAP =
  "cg_* mission tables author no worker-lease substrate: " +
  "cg_execution_record.status admits only ('admitted','denied','rolled_back') " +
  "(no leased/evidenced/verified projection), and no lease-owner, heartbeat " +
  "or lease-expiry columns exist on any cg_* mission table (the worker " +
  "definitions migration deliberately excludes runtime leases). " +
  "Lease persistence requires a follow-up migration under explicit " +
  "authorization; until then lease operations fail closed and write nothing.";

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

type ExecutionRecordStatus = (typeof EXECUTION_RECORD_STATUS)[number];

/* ─────────────────────────────────────────────────────────────
 * Row schemas — the untrusted read boundary (Zod, fail-closed)
 * ────────────────────────────────────────────────────────────*/

const missionIntentRowSchema = z.object({
  mission_id: z.string().min(1).max(160),
  version: z.string().min(1).max(32),
  tenant_id: z.string().min(1).max(128),
  purpose: z.string().min(1).max(200),
  authority_ref: z.string().min(1).max(200),
  context_ref: z.string().min(1).max(200),
  owner_ref: z.string().min(1).max(200),
  non_scope: z.array(z.string()),
  authorized_actions: z.array(z.string()),
  lifecycle: z.enum(["proposed", "authorized", "revoked", "closed"]),
  expires_at: z.string().nullable(),
});

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

/**
 * Map a persisted cg_execution_record.status onto the execution-path stage.
 * admitted|assigned → assigned; denied|rolled_back → denied; the remaining
 * widened values pass through. Unknown statuses never reach here (Zod).
 */
function stageFromRecordStatus(status: ExecutionRecordStatus): ExecutionPathStage {
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

/* ─────────────────────────────────────────────────────────────
 * Adapter
 * ────────────────────────────────────────────────────────────*/

type MissionTable =
  | "cg_mission_intent"
  | "cg_execution_record"
  | "cg_execution_history"
  | "cg_foundation_evidence"
  | "cg_verification_result";

function persistenceFailed(table: MissionTable, error: { message: string }): Error {
  return new Error(`mission execution persistence failed for ${table}: ${error.message}`);
}

function loadFailed(table: MissionTable, error: { message: string }): Error {
  return new Error(`mission execution load failed for ${table}: ${error.message}`);
}

function isDuplicateKeyError(message: string): boolean {
  return message.toLowerCase().includes("duplicate");
}

export interface CreateDbMissionExecutionPortsInput {
  /** Declarative identity → effective-identity equivalence registry (verification independence). */
  readonly identityRegistry?: IdentityEquivalenceRegistry;
  /** Criticality used for verification independence checks (default "minor"). */
  readonly defaultWorkCriticality?: WorkCriticality;
  /**
   * Optional read-time worker gate forwarded to `createDbMissionLeasePort`.
   * When omitted, the lease port allows the acquire (same as the V1-003
   * sibling). Worker-launch wires the live gate; this adapter does not.
   */
  readonly workerGate?: WorkerLeaseGate;
}

export interface DbMissionExecutionPorts {
  readonly backend: "db";
  readonly records: MissionRecordPort;
  /** Real MissionLeasePort over cg_mission_lease (V1-003 sibling composed here). */
  readonly lease: MissionLeasePort & Pick<MissionRecordPort, "getExecution">;
}

export function createDbMissionExecutionPorts(
  client: MissionDbClient,
  adapterInput: CreateDbMissionExecutionPortsInput = {},
): DbMissionExecutionPorts {
  const identityRegistry = adapterInput.identityRegistry ?? [];
  const defaultCriticality: WorkCriticality = adapterInput.defaultWorkCriticality ?? "minor";

  async function selectMaybeRow(
    table: MissionTable,
    filters: ReadonlyArray<readonly [string, string]>,
  ): Promise<Record<string, unknown> | null> {
    let query = client.from(table).select("*");
    for (const [column, value] of filters) {
      query = query.eq(column, value);
    }
    const result = await query.maybeSingle();
    if (result.error) throw loadFailed(table, result.error);
    return (result.data ?? null) as Record<string, unknown> | null;
  }

  async function selectRows(
    table: MissionTable,
    filters: ReadonlyArray<readonly [string, string]>,
  ): Promise<Record<string, unknown>[]> {
    let query = client.from(table).select("*");
    for (const [column, value] of filters) {
      query = query.eq(column, value);
    }
    const result = await query;
    if (result.error) throw loadFailed(table, result.error);
    return (result.data ?? []) as Record<string, unknown>[];
  }

  async function insertRow(
    table: MissionTable,
    row: Record<string, unknown>,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const result = await client.from(table).insert(row);
    if (result.error) return { ok: false, message: result.error.message };
    return { ok: true };
  }

  async function updateExecutionStatus(
    tenantId: string,
    executionId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const result = await client
      .from("cg_execution_record")
      .update(patch)
      .eq("id", executionId)
      .eq("tenant_id", tenantId);
    if (result.error) throw persistenceFailed("cg_execution_record", result.error);
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

  async function getExecutionById(
    tenantId: string,
    executionId: string,
  ): Promise<MissionExecutionState | null> {
    const row = await selectMaybeRow("cg_execution_record", [
      ["tenant_id", tenantId],
      ["id", executionId],
    ]);
    if (row === null) return null;
    const parsedRow = executionRowSchema.safeParse(row);
    if (!parsedRow.success) {
      // Untrusted read: a row outside the migration's own CHECK vocabulary
      // never enters contract state (fail closed, loudly).
      throw new Error(
        `mission execution load failed for cg_execution_record: row validation rejected — ${parsedRow.error.message}`,
      );
    }
    return executionFromRow(parsedRow.data);
  }

  /** Project a recorded verification decision onto the execution aggregate. */
  function withVerificationDecision(
    execution: MissionExecutionState,
    decision: "verified" | "failed" | "inconclusive",
  ): MissionExecutionState {
    return {
      ...execution,
      stage: decision === "verified" ? "verified" : "evidenced",
      verificationDecision: decision,
    };
  }

  const records: MissionRecordPort = {
    async recordIntent({ actor, intent, now }) {
      const actorCheck = missionActorContextSchema.safeParse(actor);
      if (!actorCheck.success) {
        return {
          ok: false,
          code: "invalid_input",
          reason: "actor context failed schema validation",
        };
      }
      const parsed = missionIntentInputSchema.safeParse(intent);
      if (!parsed.success) {
        return {
          ok: false,
          code: "invalid_input",
          reason: `intent rejected: ${parsed.error.message}`,
        };
      }
      const data = parsed.data;
      if (data.tenantId !== actor.tenantId) {
        return {
          ok: false,
          code: "cross_tenant",
          reason: "intent tenant does not match the acting identity's resolved tenant",
        };
      }
      const authorized = authorizeOrDeny(actor, data.tenantId, data.missionId, "create");
      if (!authorized.ok) return authorized;

      const existingRow = await selectMaybeRow("cg_mission_intent", [
        ["tenant_id", data.tenantId],
        ["mission_id", data.missionId],
        ["version", data.version],
      ]);
      if (existingRow !== null) {
        // Idempotent replay: the declared intent already exists (§10).
        const existing = missionIntentRowSchema.parse(existingRow);
        return {
          ok: true,
          value: {
            intent: {
              ...data,
              purpose: existing.purpose,
              authorityRef: existing.authority_ref,
              contextRef: existing.context_ref,
              ownerRef: existing.owner_ref,
              nonScope: existing.non_scope,
              authorizedActions: existing.authorized_actions,
            },
            declaredBy: existing.owner_ref,
            declaredAt: now,
            replayed: true,
          },
        };
      }

      const upsert = await client.from("cg_mission_intent").upsert(
        {
          mission_id: data.missionId,
          version: data.version,
          tenant_id: data.tenantId,
          purpose: data.purpose,
          authority_ref: data.authorityRef,
          context_ref: data.contextRef,
          owner_ref: data.ownerRef,
          non_scope: [...data.nonScope],
          authorized_actions: [...data.authorizedActions],
          lifecycle: "authorized",
          expires_at: data.expiresAt,
        },
        { onConflict: "tenant_id,mission_id,version" },
      );
      if (upsert.error) throw persistenceFailed("cg_mission_intent", upsert.error);
      return {
        ok: true,
        value: { intent: data, declaredBy: actor.actorId, declaredAt: now, replayed: false },
      };
    },

    async assignExecution({ actor, assignment }) {
      const actorCheck = missionActorContextSchema.safeParse(actor);
      if (!actorCheck.success) {
        return {
          ok: false,
          code: "invalid_input",
          reason: "actor context failed schema validation",
        };
      }
      const parsed = assignmentInputSchema.safeParse(assignment);
      if (!parsed.success) {
        return {
          ok: false,
          code: "invalid_input",
          reason: `assignment rejected: ${parsed.error.message}`,
        };
      }
      const data = parsed.data;
      const authorized = authorizeOrDeny(actor, data.tenantId, data.missionId, "execute");
      if (!authorized.ok) return authorized;

      const missionRow = await selectMaybeRow("cg_mission_intent", [
        ["tenant_id", data.tenantId],
        ["mission_id", data.missionId],
        ["version", data.version],
      ]);
      if (missionRow === null) {
        return {
          ok: false,
          code: "mission_not_found",
          reason: `mission intent ${data.missionId}@${data.version} is not declared in tenant ${data.tenantId}`,
        };
      }
      const mission = missionIntentRowSchema.parse(missionRow);

      const existingRow = await selectMaybeRow("cg_execution_record", [
        ["tenant_id", data.tenantId],
        ["mission_id", data.missionId],
        ["idempotency_key", data.idempotencyKey],
        ["action", data.action],
      ]);
      if (existingRow !== null) {
        // Idempotent replay: the recorded outcome is canonical truth (§10);
        // no new external effect, no second record.
        const existing = executionRowSchema.parse(existingRow);
        return { ok: true, value: { execution: executionFromRow(existing), replayed: true } };
      }

      const admission = admitExecution(
        {
          missionId: mission.mission_id,
          version: mission.version,
          tenantId: mission.tenant_id,
          purpose: mission.purpose,
          authorityRef: mission.authority_ref,
          contextRef: mission.context_ref,
          ownerRef: mission.owner_ref,
          nonScope: mission.non_scope,
          authorizedActions: mission.authorized_actions,
          lifecycle: mission.lifecycle,
          expiresAt: mission.expires_at,
        },
        { actorId: actor.actorId, tenantId: data.tenantId, revoked: false },
        {
          executionId: data.executionId,
          idempotencyKey: data.idempotencyKey,
          missionId: data.missionId,
          tenantId: data.tenantId,
          actorId: actor.actorId,
          action: data.action,
          realityRef: data.realityRef,
          requestedAt: data.now,
        },
        data.now,
      );

      const executionInsert = await insertRow("cg_execution_record", {
        id: data.executionId,
        idempotency_key: data.idempotencyKey,
        mission_id: data.missionId,
        mission_version: data.version,
        tenant_id: data.tenantId,
        actor_id: actor.actorId,
        action: data.action,
        reality_ref: data.realityRef,
        requested_at: data.now,
        attempt_id: admission.attempt.attemptId,
        started_at: admission.attempt.startedAt,
        status: admission.result.status,
        reason: admission.result.reason,
        external_effect: admission.externalEffect,
      });
      if (!executionInsert.ok) {
        if (isDuplicateKeyError(executionInsert.message)) {
          // Concurrent assignment won the UNIQUE race; its recorded outcome
          // is canonical truth — replay instead of double-executing.
          return {
            ok: false,
            code: "not_found",
            reason: `assignment race lost: ${executionInsert.message}`,
          };
        }
        throw persistenceFailed("cg_execution_record", { message: executionInsert.message });
      }

      const historyInsert = await insertRow("cg_execution_history", {
        execution_id: data.executionId,
        recorded_at: data.now,
        status: admission.result.status,
        reason: admission.result.reason,
        external_effect: admission.externalEffect,
      });
      if (!historyInsert.ok)
        throw persistenceFailed("cg_execution_history", { message: historyInsert.message });

      const execution: MissionExecutionState = {
        executionId: data.executionId,
        tenantId: data.tenantId,
        missionId: data.missionId,
        missionVersion: data.version,
        assignedBy: actor.actorId,
        lastWorkerId: null,
        action: data.action,
        idempotencyKey: data.idempotencyKey,
        realityRef: data.realityRef,
        stage: admission.result.status === "admitted" ? "assigned" : "denied",
        attempt: 0,
        failureCount: 0,
        retryScheduledAt: null,
        lease: null,
        evidenceIds: [],
        verificationDecision: null,
        denyReason: admission.result.reason,
        assignedAt: data.now,
        updatedAt: data.now,
      };
      return { ok: true, value: { execution, replayed: false } };
    },

    async recordEvidence({ tenantId, executionId, evidence, workerId, now }) {
      const parsed = missionEvidenceInputSchema.array().min(1).safeParse(evidence);
      if (!parsed.success) {
        return {
          ok: false,
          code: "invalid_input",
          reason: `evidence rejected: ${parsed.error.message}`,
        };
      }
      const records: EvidenceRecord[] = parsed.data.map((entry: MissionEvidenceInput) =>
        buildExecutionEvidence({
          executionId,
          tenantId,
          workerId,
          evidenceKind: entry.evidenceKind,
          sourceRef: entry.sourceRef,
          lineage: entry.lineage,
          observedAt: now,
        }),
      );
      for (const record of records) {
        const insert = await insertRow("cg_foundation_evidence", {
          evidence_id: record.evidenceId,
          producer: record.producer,
          actor_id: record.actorId,
          tenant_id: record.tenantId,
          observed_at: record.observedAt,
          recorded_at: record.recordedAt,
          provenance: record.provenance,
          integrity: record.integrity,
          lifecycle: record.lifecycle,
          lineage: [...record.lineage],
        });
        if (!insert.ok)
          throw persistenceFailed("cg_foundation_evidence", { message: insert.message });
      }
      return { ok: true, value: records };
    },

    async recordVerification({ execution, decision, reason, evidenceIds }) {
      const existingRow = await selectMaybeRow("cg_verification_result", [
        ["execution_id", execution.executionId],
      ]);
      if (existingRow !== null) {
        const existing = verificationRowSchema.parse(existingRow);
        return { ok: true, value: { decision: existing.decision, replayed: true } };
      }
      const insert = await insertRow("cg_verification_result", {
        verification_id: `${execution.executionId}:verification`,
        execution_id: execution.executionId,
        evidence_ids: [...evidenceIds],
        decision,
        reason: reason.slice(0, 200),
      });
      if (!insert.ok)
        throw persistenceFailed("cg_verification_result", { message: insert.message });
      return { ok: true, value: { decision, replayed: false } };
    },

    async getExecution(tenantId, executionId) {
      return getExecutionById(tenantId, executionId);
    },

    async verifyExecution(actor, request) {
      const actorCheck = missionActorContextSchema.safeParse(actor);
      if (!actorCheck.success) {
        return {
          ok: false,
          code: "invalid_input",
          reason: "actor context failed schema validation",
        };
      }
      const parsed = verifyExecutionInputSchema.safeParse(request);
      if (!parsed.success) {
        return {
          ok: false,
          code: "invalid_input",
          reason: `verification rejected: ${parsed.error.message}`,
        };
      }
      const { tenantId, executionId, criteriaMet, now, workCriticality } = parsed.data;

      const execution = await getExecutionById(tenantId, executionId);
      if (execution === null) {
        // Unknown and cross-tenant executions fail closed with the same signal.
        return { ok: false, code: "cross_tenant", reason: "execution not found in scope" };
      }
      const authorized = authorizeOrDeny(actor, tenantId, execution.missionId, "verify");
      if (!authorized.ok) return authorized;

      const existingVerification = await selectMaybeRow("cg_verification_result", [
        ["execution_id", executionId],
      ]);
      if (existingVerification !== null) {
        const existing = verificationRowSchema.parse(existingVerification);
        return {
          ok: true,
          value: {
            execution: withVerificationDecision(execution, existing.decision),
            verification: {
              decision: existing.decision,
              reason: existing.reason,
              evidenceIds: existing.evidence_ids,
            },
            replayed: true,
          },
        };
      }

      // Evidence belongs to the execution: cg_foundation_evidence has no
      // execution_id column, so the tenant-scoped rows are filtered by the
      // §12 provenance binding (worker:<id>|execution:<id>|source:<ref>).
      // Filtering by actor_id would be wrong: the executor of record is the
      // assignment's actor until a lease row refines it, while evidence is
      // recorded by the lease-holding worker.
      const evidenceRows = await selectRows("cg_foundation_evidence", [["tenant_id", tenantId]]);
      const executionEvidence = evidenceRows
        .filter((row) => String(row.provenance ?? "").includes(`execution:${executionId}`))
        .map((row): EvidenceRecord => ({
          evidenceId: String(row.evidence_id),
          producer: String(row.producer),
          actorId: String(row.actor_id),
          tenantId: String(row.tenant_id),
          observedAt: String(row.observed_at),
          recordedAt: String(row.recorded_at),
          provenance: String(row.provenance),
          integrity: String(row.integrity),
          // Untrusted row: lifecycle outside {superseded, revoked} is treated
          // as the table default ('active'), matching the column CHECK.
          lifecycle:
            row.lifecycle === "superseded" || row.lifecycle === "revoked"
              ? row.lifecycle
              : "active",
          lineage: Array.isArray(row.lineage) ? (row.lineage as string[]) : [],
        }));

      const outcome = decideExecutionVerification({
        verificationId: `${executionId}:verification`,
        executionId,
        executorIdentityRef: execution.lastWorkerId ?? execution.assignedBy,
        verifierIdentityRef: actor.actorId,
        evidence: executionEvidence,
        criteriaMet,
        workCriticality: workCriticality ?? defaultCriticality,
        identityRegistry,
      });

      const recorded = await records.recordVerification({
        execution,
        decision: outcome.decision,
        reason: outcome.reason,
        evidenceIds: [...outcome.evidenceIds],
        verifierId: actor.actorId,
        now,
      });
      if (!recorded.ok) return recorded;
      return {
        ok: true,
        value: {
          execution: withVerificationDecision(execution, outcome.decision),
          verification: outcome,
          replayed: recorded.value.replayed,
        },
      };
    },
  };

  const innerLease = createDbMissionLeasePort(client, {
    records,
    workerGate: adapterInput.workerGate,
  });

  /**
   * Mirror the lease port's enriched stage onto cg_execution_record.status
   * and append cg_execution_history. V1-004 owns the execution record;
   * the V1-003 sibling writes only cg_mission_lease. History status is the
   * enriched execution-path stage (in the widened vocab). external_effect:
   * keep recorded_intent if the current row is recorded_intent, else none
   * — leased/evidenced/verified/requeued/exhausted are not
   * admitted/denied/rolled_back, so the remaining coupling CHECKs pass.
   */
  async function mirrorEnrichedStage(
    tenantId: string,
    executionId: string,
    now: string,
  ): Promise<void> {
    const enriched = await innerLease.getExecution(tenantId, executionId);
    if (enriched === null) return;
    const status: ExecutionPathStage = enriched.stage;
    const current = await selectMaybeRow("cg_execution_record", [
      ["tenant_id", tenantId],
      ["id", executionId],
    ]);
    if (current === null) return;
    const parsed = executionRowSchema.safeParse(current);
    if (!parsed.success) {
      throw new Error(
        `mission execution load failed for cg_execution_record: row validation rejected — ${parsed.error.message}`,
      );
    }
    if (parsed.data.status === status) return;
    const externalEffect =
      parsed.data.external_effect === "recorded_intent" ? "recorded_intent" : "none";
    await updateExecutionStatus(tenantId, executionId, { status });
    const historyInsert = await insertRow("cg_execution_history", {
      execution_id: executionId,
      recorded_at: now,
      status,
      reason: enriched.denyReason,
      external_effect: externalEffect,
    });
    if (!historyInsert.ok) {
      throw persistenceFailed("cg_execution_history", { message: historyInsert.message });
    }
  }

  const lease: MissionLeasePort & Pick<MissionRecordPort, "getExecution"> = {
    getExecution: (tenantId, executionId) => innerLease.getExecution(tenantId, executionId),

    async acquireLease(input) {
      const result = await innerLease.acquireLease(input);
      if (result.ok) {
        await mirrorEnrichedStage(input.request.tenantId, input.request.executionId, input.request.now);
      }
      return result;
    },

    async heartbeatLease(input) {
      const result = await innerLease.heartbeatLease(input);
      if (result.ok) {
        await mirrorEnrichedStage(input.request.tenantId, input.request.executionId, input.request.now);
      }
      return result;
    },

    async completeExecution(input) {
      const result = await innerLease.completeExecution(input);
      if (result.ok) {
        await mirrorEnrichedStage(input.request.tenantId, input.request.executionId, input.request.now);
      }
      return result;
    },

    async failExecution(input) {
      const result = await innerLease.failExecution(input);
      if (result.ok) {
        await mirrorEnrichedStage(input.tenantId, input.executionId, input.now);
      }
      return result;
    },

    async recoverOrphanedLeases(input) {
      const result = await innerLease.recoverOrphanedLeases(input);
      if (result.ok) {
        for (const recovered of result.value) {
          await mirrorEnrichedStage(input.request.tenantId, recovered.executionId, input.request.now);
        }
      }
      return result;
    },
  };

  return {
    backend: "db",
    records,
    lease,
  };
}
