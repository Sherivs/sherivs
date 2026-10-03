/**
 * CoreGrid — worker mission launch RUNTIME (server-only).
 *
 * The executable side of the launch surface: substrate assembly over the
 * sanctioned service-role DB adapters, the AI-gateway executor, and the §27
 * launch pipeline core. This module matches the server-file pattern (dot
 * server dot ts) and is imported ONLY
 * from inside `worker-launch.functions.ts` handler bodies (never statically by
 * routes/components), so it never enters the client bundle — the import-
 * protection build gate enforces exactly this (§24/§25, server functions are
 * APIs).
 */
import { z } from "zod";
import { generateText, Output } from "ai";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requirePlatformSuperAdmin } from "@/lib/security-role-gate";
import { invokeAiGateway } from "@/lib/ai-gateway.server";
import { SystemClock, TimeAuthority } from "@/lib/kernel/time-authority";
import { createDbMissionExecutionPorts } from "@/lib/missions/mission-execution-db.server";
import { createDbMissionLeasePort } from "@/lib/missions/mission-lease-db.server";
import type { MissionEvidenceInput } from "@/lib/missions/mission-execution";
import type { MissionExecutionState } from "@/lib/missions/mission-execution";
import type { MissionDriverExecutorResult } from "@/lib/missions/mission-execution-store";
import { writeAuditRecord, type WriteAuditEntry } from "@/lib/server/write-audit";
import type {
  WorkerAuthorityPort,
  WorkerExecutionHandle,
  WorkerHostExecutor,
  WorkerHostMissionPorts,
  WorkerQuarantinePort,
} from "./worker-host";
import { runWorkerHost } from "./worker-host";
import { createWorkerRegistryDb, type WorkerRegistryDb } from "./worker-registry-db.server";
import {
  launchAuditEntry,
  resolveAiCredentialGate,
  toAuditIntent,
  workerLaunchRequestSchema,
} from "./worker-launch-contract";
import type {
  WorkerLaunchAuditIntent,
  WorkerLaunchDeps,
  WorkerLaunchOutcome,
} from "./worker-launch-contract";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/** Default quarantine bound threaded to the host (registry records the ledger row). */
const DEFAULT_QUARANTINE_THRESHOLD = 3;

/** Production substrate: the sanctioned service-role DB adapters, unmodified. */
export type WorkerLaunchAdminClient = Parameters<typeof createWorkerRegistryDb>[0];

export async function buildWorkerLaunchSubstrate(
  admin: WorkerLaunchAdminClient,
): Promise<{
  registry: Pick<WorkerRegistryDb, "resolveWorkerAuthority" | "quarantineWorker">;
  missions: WorkerHostMissionPorts;
}> {
  const registry = createWorkerRegistryDb(admin);
  const records = createDbMissionExecutionPorts(admin).records;
  const leasePort = createDbMissionLeasePort(admin, {
    records,
    workerGate: registry.workerLeaseGate(),
  });
  // The host composite: the lease port's ENRICHED getExecution (lease truth ⊕
  // record state) plus the record port's independent verification step.
  const missions: WorkerHostMissionPorts = {
    ...leasePort,
    verifyExecution: records.verifyExecution,
  };
  return { registry, missions };
}

/**
 * Production deps over the sanctioned substrate. The audit writer resolves
 * WHO exactly like the provisioning family: the canonical users row when one
 * exists (audit_logs.user_id FKs public.users), otherwise the verified email
 * claim with a null actor id — the audit is never unattributed and never
 * silently rewritten (§27.6, fail closed).
 */
export async function buildWorkerLaunchDeps(input: {
  admin: WorkerLaunchAdminClient;
  actorId: string;
  actorEmail: string | null;
}): Promise<WorkerLaunchDeps> {
  const actorRow = await input.admin.from("users").select("id").eq("id", input.actorId).maybeSingle();
  if (actorRow.error) throw new Error(actorRow.error.message);
  const actorHasCanonicalRow = actorRow.data != null;
  const { registry, missions } = await buildWorkerLaunchSubstrate(input.admin);
  return {
    registry,
    missions,
    audit: async (entry) => {
      await writeAuditRecord(input.admin, {
        ...entry,
        actorId: actorHasCanonicalRow ? input.actorId : null,
        actorEmail: actorHasCanonicalRow ? (entry.actorEmail ?? null) : input.actorEmail,
      });
    },
    readEnv: (name) => process.env[name],
    now: () => timeAuthority.now().at,
    newRuntimeInstanceId: () => `runtime-${crypto.randomUUID()}`,
  };
}

/* ─────────────────────────────────────────────────────────────
 * The live AI executor (§20 AI gateway — the ONLY provider path)
 * ────────────────────────────────────────────────────────────*/

/** Declared worker-mission model default; override by name via AI_WORKER_MODEL. */
const WORKER_MISSION_MODEL_DEFAULT = "gpt-4o-mini";

/** The bounded structured output the live executor captures as evidence. */
export const workerMissionOutputSchema = z
  .object({
    summary: z.string().trim().min(1).max(2_000),
    findings: z.array(z.string().trim().min(1).max(500)).max(20),
  })
  .strict();

/**
 * The gateway-backed executor for one host cycle. §19 AI privacy: the prompt
 * carries ONLY the mission task identifiers (mission id, action, reality ref,
 * execution id) — no tenant payload, no PII, no secrets. AI output is
 * Intelligence (§9): it is captured as §12 evidence of the invocation
 * (snapshot-attributed) and never overwrites canonical truth. A gateway deny
 * is a worker-reported FAILURE (bounded-retry backoff), never a crash and
 * never a fabricated success.
 */
export function buildAiGatewayExecutor(input: {
  execution: MissionExecutionState;
  workerId: string;
}): WorkerHostExecutor {
  const { execution, workerId } = input;
  return async (handle: WorkerExecutionHandle): Promise<MissionDriverExecutorResult> => {
    const beat = await handle.heartbeat();
    if (!beat.ok) {
      return { outcome: "failed", reason: `lease_lost_before_inference: ${beat.reason}` };
    }
    const prompt = [
      "You are executing one governed CoreGrid worker mission.",
      `Mission: ${execution.missionId}`,
      `Action: ${execution.action}`,
      `Execution: ${execution.executionId}`,
      `Reality reference: ${execution.realityRef}`,
      "Report a bounded summary and the concrete findings for this action.",
    ].join("\n");

    const outcome = await invokeAiGateway<z.infer<typeof workerMissionOutputSchema>>({
      tenantRef: execution.tenantId,
      actorRef: workerId,
      agentRef: workerId,
      missionRef: execution.missionId,
      model: process.env.AI_WORKER_MODEL ?? WORKER_MISSION_MODEL_DEFAULT,
      provider: "ai-gateway",
      purpose: "workflow_assistance",
      invoke: async (provider, context) => {
        const { output, usage } = await generateText({
          model: provider(context.model),
          output: Output.object({ schema: workerMissionOutputSchema }),
          prompt,
        });
        return {
          payload: output,
          tokensIn: usage?.inputTokens ?? 0,
          tokensOut: usage?.outputTokens ?? 0,
        };
      },
    });

    if (outcome.decision === "deny") {
      return {
        outcome: "failed",
        reason: `ai_gateway_deny:${outcome.code}: ${outcome.reason}`,
      };
    }

    const evidence: MissionEvidenceInput = {
      evidenceKind: "ai_worker_output",
      sourceRef: `ai-gateway:snapshot:${outcome.intelligence.snapshotId}`,
      lineage: [
        `mission:${execution.missionId}`,
        `model:${outcome.usage.model}`,
        `tokens:${outcome.usage.tokensIn}/${outcome.usage.tokensOut}`,
      ],
    };
    return { outcome: "succeeded", evidence: [evidence] };
  };
}

/* ─────────────────────────────────────────────────────────────
 * The launch pipeline (§27 chain, typed outcomes)
 * ────────────────────────────────────────────────────────────*/

/**
 * Run one worker-mission launch attempt. The server function wraps this core;
 * tests inject the substrate (in-memory ports) and exercise the full §27
 * chain without a database and without a live AI key.
 */
export async function executeWorkerMissionLaunch(
  input: {
    supabase: Parameters<typeof requirePlatformSuperAdmin>[0];
    userId: string;
    claims?: { exp?: number; email?: string };
    data: unknown;
  },
  deps: WorkerLaunchDeps,
): Promise<WorkerLaunchOutcome> {
  const parsed = workerLaunchRequestSchema.safeParse(input.data);
  if (!parsed.success) {
    const reason = `launch request rejected: ${parsed.error.message.slice(0, 300)}`;
    const entry = launchAuditEntry({
      tenantId: "",
      actorId: input.userId,
      actorEmail: input.claims?.email ?? null,
      workerId: "",
      executionId: "",
      missionId: null,
      outcome: "failed",
      code: "invalid_request",
      reason,
    });
    await deps.audit(entry);
    return { outcome: "denied", code: "invalid_request", reason, audit: toAuditIntent(entry) };
  }
  const data = parsed.data;
  const identity = {
    actorId: input.userId,
    actorEmail: input.claims?.email ?? null,
  };

  /* 3. AUTHORIZE — canonical platform super-admin gate, fail closed. */
  try {
    await requirePlatformSuperAdmin(input.supabase, {
      // Lifecycle threading: the JWT carries no lifecycle claim, so `null`
      // flags the identity lifecycle unverified (never silent); session
      // validity is attested from the verified token's exp claim.
      lifecycle: null,
      sessionValid:
        typeof input.claims?.exp === "number" && tokenMsRemaining(input.claims.exp) > 0,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "platform super admin gate denied";
    const entry = launchAuditEntry({
      tenantId: data.tenantId,
      ...identity,
      workerId: data.workerId,
      executionId: data.executionId,
      missionId: null,
      outcome: "failed",
      code: "gate_denied",
      reason,
    });
    await deps.audit(entry);
    return { outcome: "denied", code: "gate_denied", reason, audit: toAuditIntent(entry) };
  }

  /* 4a. VALIDATE against the mission substrate: the claimed execution. */
  const execution = await deps.missions.getExecution(data.tenantId, data.executionId);
  if (execution === null) {
    const reason = `execution ${data.executionId} not found in tenant ${data.tenantId}`;
    const entry = launchAuditEntry({
      tenantId: data.tenantId,
      ...identity,
      workerId: data.workerId,
      executionId: data.executionId,
      missionId: null,
      outcome: "failed",
      code: "execution_not_found",
      reason,
    });
    await deps.audit(entry);
    return { outcome: "denied", code: "execution_not_found", reason, audit: toAuditIntent(entry) };
  }

  /* 4b. VALIDATE against the registry + delegation-grant substrate. */
  const authority = await deps.registry.resolveWorkerAuthority({
    tenantId: data.tenantId,
    definitionId: data.workerId,
    missionId: execution.missionId,
  });
  if (!authority.ok) {
    const entry = launchAuditEntry({
      tenantId: data.tenantId,
      ...identity,
      workerId: data.workerId,
      executionId: data.executionId,
      missionId: execution.missionId,
      outcome: "failed",
      code: "worker_not_launchable",
      reason: authority.reason,
      extra: { worker_authority_reason: authority.reason.slice(0, 300) },
    });
    await deps.audit(entry);
    return { outcome: "denied", code: "worker_not_launchable", reason: authority.reason, audit: toAuditIntent(entry) };
  }

  /* 5a. Credential gate — typed BLOCKED_NO_CREDENTIAL, no wake attempted. */
  const credentialGate = resolveAiCredentialGate(deps.readEnv);
  if (!credentialGate.present) {
    const reason =
      "AI_API_KEY is not set (or empty). The worker was not woken, no lease was acquired and no provider contact was made — the launch is fail-closed (BLK-2). Live AI execution is EXTERNAL REVIEW PENDING.";
    const entry = launchAuditEntry({
      tenantId: data.tenantId,
      ...identity,
      workerId: data.workerId,
      executionId: data.executionId,
      missionId: execution.missionId,
      outcome: "failed",
      code: "BLOCKED_NO_CREDENTIAL",
      reason,
      extra: {
        blocked_code: "BLOCKED_NO_CREDENTIAL",
        missing_environment: [...credentialGate.missing],
        launch_attempted: false,
      },
    });
    await deps.audit(entry);
    return {
      outcome: "blocked_no_credential",
      code: "BLOCKED_NO_CREDENTIAL",
      reason,
      missingEnvironment: credentialGate.missing,
      attempted: false,
      audit: toAuditIntent(entry),
    };
  }

  /* 5b. EXECUTE — one governed host cycle over the validated substrate. */
  const authorityPort: WorkerAuthorityPort = {
    resolveAuthority: ({ tenantId, workerId, missionId }) =>
      deps.registry.resolveWorkerAuthority({ tenantId, definitionId: workerId, missionId }),
  };
  const quarantinePort: WorkerQuarantinePort = {
    quarantineWorker: async (q) => {
      await deps.registry.quarantineWorker({
        tenantId: q.tenantId,
        definitionId: q.workerId,
        reason: q.reason,
        failureCount: q.failureCount,
        threshold: q.threshold,
        quarantinedBy: q.quarantinedBy,
        now: q.now,
      });
    },
  };
  const host = await runWorkerHost(
    {
      missions: deps.missions,
      authority: authorityPort,
      quarantine: quarantinePort,
      quarantineThreshold: deps.quarantineThreshold ?? DEFAULT_QUARANTINE_THRESHOLD,
      now: deps.now,
    },
    {
      tenantId: data.tenantId,
      workerId: data.workerId,
      runtimeInstanceId: deps.newRuntimeInstanceId(),
      executionId: data.executionId,
      execute:
        deps.executor ??
        buildAiGatewayExecutor({ execution, workerId: data.workerId }),
    },
  );

  const entry = launchAuditEntry({
    tenantId: data.tenantId,
    ...identity,
    workerId: data.workerId,
    executionId: data.executionId,
    missionId: execution.missionId,
    outcome: host.wake.ok ? "succeeded" : "failed",
    code: "launched",
    reason: host.wake.ok
      ? `host cycle complete: ${host.phases.map((phase) => `${phase.phase}:${phase.ok ? "ok" : "denied"}`).join(" → ")}`
      : host.wake.reason,
    extra: {
      host_execute_outcome: host.execute.outcome,
      host_execute_reason: host.execute.reason.slice(0, 300),
      evidence_count: host.persist.evidenceCount,
      verification_attempted: host.verify.attempted,
      runtime_instance_id: host.runtimeInstanceId,
    },
  });
  await deps.audit(entry);
  return { outcome: "launched", attempted: true, host, audit: toAuditIntent(entry) };
}
