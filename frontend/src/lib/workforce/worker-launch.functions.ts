/**
 * CoreGrid — worker mission launch surface (team WORKFORCE-SURFACE, R7).
 *
 * The operational HTTP/UI entry point for launching a governed worker
 * mission: it closes the F-13 typed skip T8 gap ("no HTTP/UI path to launch
 * a worker mission") by driving MISSION V1-003's library-form worker host
 * (`worker-host.ts`, unmodified) through a §27 SERVER FUNCTION RULE surface.
 *
 * §27 chain, every launch:
 *   1. AUTHENTICATE  — `requireSupabaseAuth` middleware (verified bearer token).
 *   2. RESOLVE TENANT — the launch TARGETS a tenant's governed worker; the
 *      tenant scope is a validated, registry-checked request field (the worker
 *      definition's tenantScope must equal it — multi-tenancy law §13), never
 *      an authority assertion: authorization is control-plane (the platform
 *      super-admin is NOT a tenant, phase 01 §14).
 *   3. AUTHORIZE — `requirePlatformSuperAdmin` (fail closed, lifecycle/session
 *      threading, same canonical gate as the command centre and provisioning).
 *   4. VALIDATE — Zod strict request contract; the requested worker mission is
 *      then validated against the SUBSTRATE: the execution must exist in the
 *      tenant scope (mission record/lease ports) and the worker must resolve
 *      authority through the registry (definition lifecycle, quarantine ledger,
 *      active delegation grants, escalation checks — `resolveWorkerAuthority`).
 *   5. EXECUTE — one governed host cycle: WAKE → EXECUTE → PERSIST → VERIFY →
 *      SLEEP (`runWorkerHost`). The executor runs the mission work through the
 *      centralized AI gateway (§20) — never a scattered provider call.
 *   6. AUDIT — every launch attempt (denied, blocked, launched) writes a
 *      fail-closed audit record (`writeAuditRecord`): WHO / WHICH / WHAT /
 *      GATE / WHEN / OUTCOME, no secrets (§29/§30).
 *   7. RETURN PERMITTED DATA — a TYPED outcome. Denials and credential
 *      blocks are returned as typed records, never thrown fake successes.
 *
 * Fail-closed credential law (F-13 T8 / BLK-2): when `AI_API_KEY` is absent,
 * the launch returns the typed `BLOCKED_NO_CREDENTIAL` outcome (the exit-2
 * drill convention, lib/communications' typed blocking shape) — naming the
 * missing environment variables (never their values) and stating that no
 * wake, no lease and no provider contact was attempted. A fake success is
 * impossible by construction. The live-AI-execution journey stays gated and
 * is EXTERNAL REVIEW PENDING until the credential is provisioned by name.
 *
 * `client.server` (service-role) is imported INSIDE the handler so this file
 * stays safe to import from components/routes.
 */
import { createServerFn } from "@tanstack/react-start";
import { generateText, Output } from "ai";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
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
  WorkerHostCycleResult,
  WorkerHostExecutor,
  WorkerHostMissionPorts,
  WorkerQuarantinePort,
} from "./worker-host";
import { runWorkerHost } from "./worker-host";
import { createWorkerRegistryDb, type WorkerRegistryDb } from "./worker-registry-db.server";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/** Default quarantine bound threaded to the host (registry records the ledger row). */
const DEFAULT_QUARANTINE_THRESHOLD = 3;

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
  readonly outcome: "succeeded" | "failed";
  readonly table: string;
  readonly recordId: string | null;
  readonly tenantId: string | null;
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
): { present: true } | { present: false; missing: readonly (typeof AI_CREDENTIAL_ENV_VARS)[number][] } {
  const missing = AI_CREDENTIAL_ENV_VARS.filter((name) => (readEnv(name) ?? "").trim() === "");
  return missing.length === 0 ? { present: true } : { present: false, missing };
}

/* ─────────────────────────────────────────────────────────────
 * Audit intent builder (§12 provenance, §29: no secrets)
 * ────────────────────────────────────────────────────────────*/

function launchAuditEntry(input: {
  tenantId: string;
  actorId: string | null;
  actorEmail: string | null;
  workerId: string;
  executionId: string;
  missionId: string | null;
  outcome: WriteAuditEntry["outcome"];
  code: string;
  reason: string;
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
  /** Credential reads (§30: names in outcomes, values never leave the check). */
  readonly readEnv: (name: string) => string | undefined;
  /** J-023 injected clock. */
  readonly now: () => string;
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

/** Production substrate: the sanctioned service-role DB adapters, unmodified. */
type WorkerLaunchAdminClient = Parameters<typeof createWorkerRegistryDb>[0];

export function buildWorkerLaunchSubstrate(
  admin: WorkerLaunchAdminClient,
): {
  registry: Pick<WorkerRegistryDb, "resolveWorkerAuthority" | "quarantineWorker">;
  missions: WorkerHostMissionPorts;
} {
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
  admin: Parameters<typeof createWorkerRegistryDb>[0];
  actorId: string;
  actorEmail: string | null;
}): Promise<WorkerLaunchDeps> {
  const actorRow = await input.admin.from("users").select("id").eq("id", input.actorId).maybeSingle();
  if (actorRow.error) throw new Error(actorRow.error.message);
  const actorHasCanonicalRow = actorRow.data != null;
  const { registry, missions } = buildWorkerLaunchSubstrate(input.admin);
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

/* ─────────────────────────────────────────────────────────────
 * The server function (the HTTP surface the route consumes)
 * ────────────────────────────────────────────────────────────*/

export const launchWorkerMission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => workerLaunchRequestSchema.parse(input))
  .handler(async ({ data, context }): Promise<WorkerLaunchOutcome> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const actorEmail =
      (context.claims as { email?: string } | null | undefined)?.email ?? null;
    const deps = await buildWorkerLaunchDeps({
      admin: supabaseAdmin,
      actorId: context.userId,
      actorEmail,
    });
    return executeWorkerMissionLaunch(
      { supabase: context.supabase, userId: context.userId, claims: context.claims, data },
      deps,
    );
  });