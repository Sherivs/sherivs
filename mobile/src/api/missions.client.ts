/**
 * CoreGrid Mobile — missions client (foundation-loop read path).
 *
 * The canonical mission substrate is the governed `cg_*` kernel tables the
 * web's foundation loop persists (frontend/src/lib/control-plane/
 * foundation-loop.ts). Mobile reads them RLS-scoped with the actor's own
 * JWT, and every row is validated against the mirrored row contracts
 * before use — an invalid row is surfaced as a contract error, never
 * rendered or repaired (§26).
 *
 * Reported contract gap (follow-up): the web app exposes no tenant-scoped
 * "missions list" server function; mobile therefore relies on RLS-governed
 * direct reads today. A server-function read path with the web's gate
 * semantics (requireSchoolAdminScope) should be added and consumed here.
 */
import {
  missionExecutionRowSchema,
  verificationRowSchema,
  evidenceRowSchema,
  type EvidenceRow,
  type MissionExecutionRow,
  type MissionExecutionStatusView,
  type VerificationRow,
} from "./contracts/mission-contracts";
import type { KernelSupabaseClient } from "./client";
import { fromSupabaseError } from "./errors";

export interface MissionExecutionQuery {
  readonly limit?: number;
}

export async function listMissionExecutions(
  client: KernelSupabaseClient,
  query: MissionExecutionQuery = {},
): Promise<readonly MissionExecutionRow[]> {
  const { data, error } = await client
    .from("cg_execution_record")
    .select(
      "id, idempotency_key, mission_id, mission_version, tenant_id, actor_id, action, reality_ref, requested_at, attempt_id, started_at, status, reason, external_effect",
    )
    .order("started_at", { ascending: false })
    .limit(query.limit ?? 50);
  if (error) throw fromSupabaseError(error);
  return (data ?? []).map((row) => missionExecutionRowSchema.parse(row));
}

export async function getMissionExecution(
  client: KernelSupabaseClient,
  executionId: string,
): Promise<MissionExecutionRow | null> {
  const { data, error } = await client
    .from("cg_execution_record")
    .select(
      "id, idempotency_key, mission_id, mission_version, tenant_id, actor_id, action, reality_ref, requested_at, attempt_id, started_at, status, reason, external_effect",
    )
    .eq("id", executionId)
    .maybeSingle();
  if (error) throw fromSupabaseError(error);
  return data ? missionExecutionRowSchema.parse(data) : null;
}

/**
 * The independent verification act for an execution (verification separation:
 * worker completion is not verification — frontend STATUS_SEMANTICS). An
 * execution without a verification row reports `null`; that absence is
 * presented honestly, never filled in.
 */
export async function getMissionVerification(
  client: KernelSupabaseClient,
  executionId: string,
): Promise<VerificationRow | null> {
  const { data, error } = await client
    .from("cg_verification_result")
    .select("verification_id, execution_id, evidence_ids, decision, reason")
    .eq("execution_id", executionId)
    .maybeSingle();
  if (error) throw fromSupabaseError(error);
  return data ? verificationRowSchema.parse(data) : null;
}

export async function getMissionStatusView(
  client: KernelSupabaseClient,
  executionId: string,
): Promise<MissionExecutionStatusView | null> {
  const execution = await getMissionExecution(client, executionId);
  if (!execution) return null;
  const verification = await getMissionVerification(client, executionId);
  return { execution, verification };
}

export async function listMissionEvidence(
  client: KernelSupabaseClient,
  query: MissionExecutionQuery = {},
): Promise<readonly EvidenceRow[]> {
  const { data, error } = await client
    .from("cg_foundation_evidence")
    .select(
      "evidence_id, producer, actor_id, tenant_id, observed_at, recorded_at, provenance, integrity, lifecycle, lineage",
    )
    .order("recorded_at", { ascending: false })
    .limit(query.limit ?? 100);
  if (error) throw fromSupabaseError(error);
  return (data ?? []).map((row) => evidenceRowSchema.parse(row));
}