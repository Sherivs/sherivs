/**
 * Foundation loop server path.
 *
 * Reality reference → mission/execution rows → independent verification row.
 * Tenant comes from the school-admin scope. The client cannot set tenant or
 * verification outcome. The persistence layer is the applied foundation
 * migration (20260929000000) on the approved dev database.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { asKernelAdmin, type KernelAdminClient } from "@/lib/kernel-admin-client";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requireSchoolAdminScope } from "@/lib/security-role-gate";
import {
  planFoundationLoop,
  type FoundationLoopPlan,
  type FoundationVerificationRow,
} from "@/lib/control-plane/foundation-loop";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

const requestSchema = z
  .object({
    realityRef: z.string().uuid(),
    missionId: z.string().trim().min(1).max(160),
    version: z.string().trim().min(1).max(32),
    purpose: z.string().trim().min(1).max(200),
    authorityRef: z.string().trim().min(1).max(200),
    contextRef: z.string().trim().min(1).max(200),
    ownerRef: z.string().trim().min(1).max(200),
    action: z.literal("record-observation"),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict();

export type FoundationLoopResult = {
  ok: true;
  replayed: boolean;
  executionId: string;
  executionStatus: string;
  verification: FoundationVerificationRow | null;
};

async function loadAdmin(): Promise<KernelAdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return asKernelAdmin(supabaseAdmin);
}

function replayResult(
  existing: { id: unknown; status: unknown },
  priorVerification: Record<string, unknown> | null,
): FoundationLoopResult {
  return {
    ok: true,
    replayed: true,
    executionId: String(existing.id),
    executionStatus: String(existing.status),
    verification: priorVerification
      ? {
          verification_id: String(priorVerification.verification_id),
          execution_id: String(priorVerification.execution_id),
          evidence_ids: (priorVerification.evidence_ids as string[] | null) ?? [],
          decision: priorVerification.decision as FoundationVerificationRow["decision"],
          reason: String(priorVerification.reason),
        }
      : null,
  };
}

/** Persist a planned foundation loop; replays an existing idempotent execution. */
export async function persistFoundationPlan(
  plan: FoundationLoopPlan,
  admin: KernelAdminClient,
): Promise<FoundationLoopResult> {
  const { execution } = plan;
  const { error: missionError } = await admin
    .from("cg_mission_intent")
    .upsert(plan.mission, { onConflict: "tenant_id,mission_id,version" });
  if (missionError) throw new Error(missionError.message);

  const { error: executionError } = await admin.from("cg_execution_record").insert(execution);
  if (executionError) {
    if (!String(executionError.message).toLowerCase().includes("duplicate")) {
      throw new Error(executionError.message);
    }
    const { data: existing, error: existingError } = await admin
      .from("cg_execution_record")
      .select("id, status")
      .eq("tenant_id", execution.tenant_id)
      .eq("mission_id", execution.mission_id)
      .eq("idempotency_key", execution.idempotency_key)
      .eq("action", execution.action)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (!existing) throw new Error(executionError.message);
    const { data: priorVerification, error: priorError } = await admin
      .from("cg_verification_result")
      .select("verification_id, execution_id, evidence_ids, decision, reason")
      .eq("execution_id", existing.id)
      .maybeSingle();
    if (priorError) throw new Error(priorError.message);
    return replayResult(existing, priorVerification);
  }

  const { error: historyError } = await admin.from("cg_execution_history").insert(plan.history);
  if (historyError) throw new Error(historyError.message);

  if (plan.evidence) {
    const { error: evidenceError } = await admin
      .from("cg_foundation_evidence")
      .insert(plan.evidence);
    if (evidenceError) throw new Error(evidenceError.message);
  }
  if (plan.verification) {
    const { error: verificationError } = await admin
      .from("cg_verification_result")
      .insert(plan.verification);
    if (verificationError) throw new Error(verificationError.message);
  }

  return {
    ok: true,
    replayed: false,
    executionId: plan.execution.id,
    executionStatus: plan.execution.status,
    verification: plan.verification,
  };
}

/** Audit append for a completed foundation loop (legacy audit surface). */
export async function auditFoundationLoop(input: {
  admin: KernelAdminClient;
  tenantId: string;
  userId: string;
  action: string;
  result: FoundationLoopResult;
  realityRef: string;
}): Promise<void> {
  const { error: auditError } = await input.admin.from("audit_logs").insert({
    school_id: input.tenantId,
    user_id: input.userId,
    action: input.action,
    table_name: "cg_verification_result",
    record_id: input.result.executionId,
    new_value: {
      execution_status: input.result.executionStatus,
      verification_decision: input.result.verification?.decision ?? null,
      reality_ref: input.realityRef,
    },
  });
  if (auditError) throw new Error(auditError.message);
}

export async function executeRecordFoundationLoop(input: {
  supabase: Parameters<typeof requireSchoolAdminScope>[0];
  userId: string;
  /** Authenticated request claims — attests session validity at the gate. */
  claims?: { exp: number };
  data: {
    realityRef: string;
    missionId: string;
    version: string;
    purpose: string;
    authorityRef: string;
    contextRef: string;
    ownerRef: string;
    action: "record-observation";
    idempotencyKey: string;
  };
}): Promise<FoundationLoopResult> {
  const { data } = input;
  // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
  // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
  // contract while flagging the identity lifecycle unverified (never silent);
  // session validity is attested from the verified token's exp claim when the
  // caller supplies claims, and left unverified (flagged) otherwise.
  const tenantId = await requireSchoolAdminScope(input.supabase, {
    lifecycle: null,
    sessionValid: input.claims ? tokenMsRemaining(input.claims.exp) > 0 : undefined,
  });
  const admin = await loadAdmin();
  const now = timeAuthority.now().at;

  const { data: entity, error: entityError } = await admin
    .from("cg_entity")
    .select("id, tenant_id")
    .eq("id", data.realityRef)
    .maybeSingle();
  if (entityError) throw new Error(entityError.message);

  const executionId = crypto.randomUUID();
  const plan = planFoundationLoop({
    tenantId,
    actorId: input.userId,
    now,
    reality: entity ? { id: String(entity.id), tenantId: entity.tenant_id ?? null } : null,
    requestedRealityRef: data.realityRef,
    request: {
      executionId,
      idempotencyKey: data.idempotencyKey,
      missionId: data.missionId,
      version: data.version,
      purpose: data.purpose,
      authorityRef: data.authorityRef,
      contextRef: data.contextRef,
      ownerRef: data.ownerRef,
      action: data.action,
      requestedAt: now,
    },
  });

  const result = await persistFoundationPlan(plan, admin);
  await auditFoundationLoop({
    admin,
    tenantId,
    userId: input.userId,
    action: "foundation_loop",
    result,
    realityRef: data.realityRef,
  });
  return result;
}

export const recordFoundationLoop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => requestSchema.parse(input))
  .handler(async ({ data, context }): Promise<FoundationLoopResult> =>
    executeRecordFoundationLoop({
      supabase: context.supabase,
      userId: context.userId,
      claims: context.claims,
      data,
    }),
  );

export type FoundationRollbackResult = {
  ok: true;
  executionId: string;
  status: "rolled_back";
  externalEffect: "compensation_required";
  historyCount: number;
};

/** Governed rollback: only admitted executions, own tenant only, history preserved. */
export async function rollbackFoundationExecution(input: {
  supabase: Parameters<typeof requireSchoolAdminScope>[0];
  userId: string;
  /** Authenticated request claims — attests session validity at the gate. */
  claims?: { exp: number };
  executionId: string;
}): Promise<FoundationRollbackResult> {
  // Lifecycle threading: see executeRecordFoundationLoop for the signal semantics.
  const tenantId = await requireSchoolAdminScope(input.supabase, {
    lifecycle: null,
    sessionValid: input.claims ? tokenMsRemaining(input.claims.exp) > 0 : undefined,
  });
  const admin = await loadAdmin();
  const now = timeAuthority.now().at;

  const { data: record, error: recordError } = await admin
    .from("cg_execution_record")
    .select("id, tenant_id, status")
    .eq("id", input.executionId)
    .maybeSingle();
  if (recordError) throw new Error(recordError.message);
  if (!record || record.tenant_id !== tenantId) {
    // Cross-tenant and unknown executions fail closed with the same signal.
    throw new Error("Forbidden: execution not found in scope");
  }
  if (record.status !== "admitted") {
    throw new Error(`Execution "${input.executionId}" is not admitted (status ${record.status})`);
  }

  const { error: updateError } = await admin
    .from("cg_execution_record")
    .update({ status: "rolled_back", external_effect: "compensation_required" })
    .eq("id", input.executionId);
  if (updateError) throw new Error(updateError.message);

  const { error: historyError } = await admin.from("cg_execution_history").insert({
    execution_id: input.executionId,
    recorded_at: now,
    status: "rolled_back",
    reason: "rollback",
    external_effect: "compensation_required",
  });
  if (historyError) throw new Error(historyError.message);

  const { count, error: countError } = await admin
    .from("cg_execution_history")
    .select("id", { count: "exact", head: true })
    .eq("execution_id", input.executionId);
  if (countError) throw new Error(countError.message);

  await auditFoundationLoop({
    admin,
    tenantId,
    userId: input.userId,
    action: "foundation_loop_rollback",
    result: {
      ok: true,
      replayed: false,
      executionId: input.executionId,
      executionStatus: "rolled_back",
      verification: null,
    },
    realityRef: input.executionId,
  });

  return {
    ok: true,
    executionId: input.executionId,
    status: "rolled_back",
    externalEffect: "compensation_required",
    historyCount: count ?? 0,
  };
}
