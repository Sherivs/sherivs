/**
 * CoreGrid — worker mission launch surface (team WORKFORCE-SURFACE, R7;
 * client/server split enforced by the import-protection build gate).
 *
 * The operational HTTP/UI entry point for launching a governed worker
 * mission: it closes the F-13 typed skip T8 gap ("no HTTP/UI path to launch
 * a worker mission") by driving MISSION V1-003's library-form worker host
 * (`worker-host.ts`, unmodified) through a §27 SERVER FUNCTION RULE surface.
 *
 * This file is imported by routes/components, so its module scope carries
 * NOTHING server-only: the request contract and typed outcomes live in
 * `worker-launch-contract.ts` (client-safe), and the executable pipeline
 * (substrate assembly, AI-gateway executor, §27 core) lives in
 * `worker-launch-runtime.server.ts`, imported ONLY inside handler bodies —
 * the same discipline as the command-centre/provisioning families.
 *
 * §27 chain, every launch (implemented across the handler + runtime):
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
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { workerLaunchRequestSchema } from "./worker-launch-contract";
import type { WorkerLaunchOutcome } from "./worker-launch-contract";

/* Contract re-exports (client-safe): the route and tests consume the stable
 * surface from this module. Type-only re-exports are erased at runtime. */
export {
  AI_CREDENTIAL_ENV_VARS,
  WORKER_LAUNCH_AUDIT_ACTION,
  resolveAiCredentialGate,
  toAuditIntent,
  workerLaunchRequestSchema,
} from "./worker-launch-contract";
export type {
  WorkerLaunchAuditIntent,
  WorkerLaunchDeps,
  WorkerLaunchOutcome,
  WorkerLaunchRequest,
} from "./worker-launch-contract";

export const launchWorkerMission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => workerLaunchRequestSchema.parse(input))
  .handler(async ({ data, context }): Promise<WorkerLaunchOutcome> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { buildWorkerLaunchDeps, executeWorkerMissionLaunch } = await import(
      "./worker-launch-runtime.server"
    );
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
