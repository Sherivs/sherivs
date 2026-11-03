/**
 * Sherivs — worker mission launch CONTRACT (client-safe).
 *
 * Everything the route, the server function module and the server runtime
 * module share: the request schema, the typed outcome vocabulary, the
 * credential gate and the audit-intent builders. This file imports NO
 * server-only module at runtime (type-only imports are erased), so it is safe
 * in the client graph. The executable launch pipeline lives in
 * `worker-launch-runtime.server.ts`; the HTTP surface lives in
 * `worker-launch.functions.ts`.
 */
import { z } from "zod";
import type { WriteAuditEntry } from "@/lib/server/write-audit";
import type {
  WorkerHostCycleResult,
  WorkerHostExecutor,
  WorkerLifecycleAuditRecord,
  WorkerHostMissionPorts,
} from "./worker-host";
import type { WorkerRegistryDb } from "./worker-registry-db.server";

/* ─────────────────────────────────────────────────────────────
 * Request contract (§26: validate everything crossing the boundary)
 * ────────────────────────────────────────────────────────────*/

export const workerLaunchRequestSchema = z
  .object({
    /** Tenant scope the launch TARGETS (validated against the registry substrate). */
    tenantId: z.string().trim().min(1).max(128),
    /** The PERSISTENT governed worker identity (the definition id, §28). */
    workerId: z.string().trim().min(1).max(160),
    /** The claimed execution the worker wakes for. */
    executionId: z.string().trim().min(1).max(160),
  })
  .strict();

export type WorkerLaunchRequest = z.infer<typeof workerLaunchRequestSchema>;

/* ─────────────────────────────────────────────────────────────
 * Typed outcomes (§16 decision vocabulary as data, never fake success)
 * ────────────────────────────────────────────────────────────*/

/** Canonical audit action for every launch attempt. */
export const WORKER_LAUNCH_AUDIT_ACTION = "workforce.launch_worker_mission";

/** The audit row's addressed substrate: the execution record a launch targets. */
const AUDIT_TARGET_TABLE = "cg_execution_record";

/**
 * The serializable audit-row INTENT carried in the typed outcome (§27.7
 * permitted data). The full `WriteAuditEntry` is persisted server-side by the
 * fail-closed audit writer; the wire carries its provenance summary only.
 */
export interface WorkerLaunchAuditIntent {
  readonly action: string;
  readonly gate: string;
  readonly outcome: "succeeded" | "failed" | "denied";
  readonly table: string;
  readonly recordId: string | null;
  readonly tenantId: string | null;
  readonly correlationId: string | null;
  readonly launch_outcome_code: string;
  readonly reason: string;
}

export function toAuditIntent(entry: WriteAuditEntry): WorkerLaunchAuditIntent {
  const details = (entry.details ?? {}) as { launch_outcome_code?: string; reason?: string };
  return {
    action: entry.action,
    gate: entry.gate,
    outcome: entry.outcome,
    table: entry.table,
    recordId: entry.recordId ?? null,
    tenantId: entry.tenantId,
    correlationId: entry.correlationId ?? null,
    launch_outcome_code: details.launch_outcome_code ?? "",
    reason: details.reason ?? "",
  };
}

/** The environment variables that must carry a usable AI credential (§30: names, never values). */
export const AI_CREDENTIAL_ENV_VARS = ["AI_API_KEY"] as const;

/**
 * The typed launch outcome. Every terminal state carries the audit row INTENT
 * that was persisted for the attempt (`audit`), so the UI can show the record
 * without re-deriving it and no attempt can pass unaudited.
 */
export type WorkerLaunchOutcome =
  | {
      outcome: "denied";
      code: "gate_denied" | "invalid_request" | "execution_not_found" | "worker_not_launchable";
      reason: string;
      audit: WorkerLaunchAuditIntent;
    }
  | {
      outcome: "blocked_no_credential";
      /** The exit-2 battery convention (F-13 T8 / BLK-2), kept byte-stable. */
      code: "BLOCKED_NO_CREDENTIAL";
      reason: string;
      missingEnvironment: readonly (typeof AI_CREDENTIAL_ENV_VARS)[number][];
      attempted: false;
      audit: WorkerLaunchAuditIntent;
    }
  | {
      outcome: "launched";
      attempted: true;
      /** The full governed host cycle (WAKE → EXECUTE → PERSIST → VERIFY → SLEEP). */
      host: WorkerHostCycleResult;
      audit: WorkerLaunchAuditIntent;
    };

/**
 * The credential gate: a launch may proceed only when every named credential
 * environment variable is present and non-blank. Names only — values never
 * leave this check (§30).
 */
export function resolveAiCredentialGate(
  readEnv: (name: string) => string | undefined,
):
  | { present: true }
  | { present: false; missing: readonly (typeof AI_CREDENTIAL_ENV_VARS)[number][] } {
  const missing = AI_CREDENTIAL_ENV_VARS.filter((name) => (readEnv(name) ?? "").trim() === "");
  return missing.length === 0 ? { present: true } : { present: false, missing };
}

/* ─────────────────────────────────────────────────────────────
 * Audit intent builder (§12 provenance, §29: no secrets)
 * ────────────────────────────────────────────────────────────*/

export function launchAuditEntry(input: {
  tenantId: string;
  actorId: string | null;
  actorEmail: string | null;
  workerId: string;
  executionId: string;
  missionId: string | null;
  outcome: WriteAuditEntry["outcome"];
  code: string;
  reason: string;
  correlationId?: string;
  extra?: Record<string, unknown>;
}): WriteAuditEntry {
  const boundedReason = input.reason.slice(0, 300);
  return {
    action: WORKER_LAUNCH_AUDIT_ACTION,
    gate: "requirePlatformSuperAdmin",
    tenantId: input.tenantId,
    actorId: input.actorId,
    actorEmail: input.actorEmail,
    table: AUDIT_TARGET_TABLE,
    recordId: input.executionId,
    outcome: input.outcome,
    correlationId: input.correlationId,
    details: {
      launch_outcome_code: input.code,
      reason: boundedReason,
      worker_id: input.workerId,
      execution_id: input.executionId,
      mission_id: input.missionId,
      source: "workforce.worker-launch",
      trigger: "platform-super-admin manual launch",
      ...input.extra,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Injectable substrate (the launch pipeline's only I/O seams)
 * ────────────────────────────────────────────────────────────*/

export interface WorkerLaunchDeps {
  /** The governed worker registry (authority resolution + quarantine). */
  readonly registry: Pick<WorkerRegistryDb, "resolveWorkerAuthority" | "quarantineWorker">;
  /** The mission lease/record composite the host drives (V1-004 ports). */
  readonly missions: WorkerHostMissionPorts;
  /** Fail-closed audit writer (§27.6): a rejected audit fails the launch. */
  readonly audit: (entry: WriteAuditEntry) => Promise<void>;
  /** Lifecycle evidence is attributed to the worker, not the launching human. */
  readonly recordLifecycle: (record: WorkerLifecycleAuditRecord) => Promise<void>;
  /** Credential reads (§30: names in outcomes, values never leave the check). */
  readonly readEnv: (name: string) => string | undefined;
  /** J-023 injected clock. */
  readonly now: () => string;
  readonly newCorrelationId: () => string;
  /** Ephemeral runtime-instance id factory (observability only, §28). */
  readonly newRuntimeInstanceId: () => string;
  /**
   * Test seam: the executor the host cycle runs. Default is the live
   * AI-gateway executor (`buildAiGatewayExecutor`) — the live path stays
   * credential-gated and is EXTERNAL REVIEW PENDING.
   */
  readonly executor?: WorkerHostExecutor;
  readonly quarantineThreshold?: number;
}
