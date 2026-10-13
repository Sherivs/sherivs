/**
 * CoreGrid — Jarvis enterprise-cycle surface (team RUNTIME; client/server
 * split enforced by the import-protection build gate).
 *
 * The operational HTTP/cron entry point for one Jarvis WAKE → library cycle
 * → SLEEP: it drives the library-form executive loop (`enterprise-loop.ts`,
 * unmodified) through a §27 SERVER FUNCTION RULE surface. Hermes and Jarvis
 * remain libraries. This file is imported by routes/components, so its
 * module scope carries NOTHING server-only: the request contract and typed
 * outcomes live in `enterprise-cycle-contract.ts` (client-safe), and the
 * executable pipeline lives in `enterprise-cycle-runtime.server.ts`,
 * imported ONLY inside handler bodies — the same discipline as the
 * worker-launch family.
 *
 * §27 chain, every wake (implemented across the handler + runtime):
 *   1. AUTHENTICATE  — `requireSupabaseAuth` middleware (verified bearer token).
 *   2. RESOLVE TENANT — the cycle TARGETS a tenant; the tenant scope is a
 *      validated request field (multi-tenancy law §13), never an authority
 *      assertion: authorization is control-plane (the platform super-admin
 *      is NOT a tenant, phase 01 §14).
 *   3. AUTHORIZE — `requirePlatformSuperAdmin` (fail closed, lifecycle/session
 *      threading, same canonical gate as worker-launch).
 *   4. VALIDATE — Zod strict request contract.
 *   5. EXECUTE — one library cycle: optional provider-health stamp, optional
 *      Hermes `cg_event` observation ingestion, then `runJarvisEnterpriseCycle`.
 *      No model call: `AI_API_KEY` is not required.
 *   6. AUDIT — every wake attempt (denied, blocked, completed) writes a
 *      fail-closed audit record (`writeAuditRecord`): WHO / WHICH / WHAT /
 *      GATE / WHEN / OUTCOME, no secrets (§29/§30). Audit target: `cg_event`.
 *   7. RETURN PERMITTED DATA — a TYPED outcome. Denials are returned as typed
 *      records, never thrown fake successes.
 *
 * Version-target classification: ACTIVE-V1 (AGENTS.md §45). Phase 52 is not
 * authorized by this wake.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { enterpriseCycleRequestSchema } from "./enterprise-cycle-contract";
import type { EnterpriseCycleOutcome } from "./enterprise-cycle-contract";

/* Contract re-exports (client-safe): the route and tests consume the stable
 * surface from this module. Type-only re-exports are erased at runtime. */
export {
  ENTERPRISE_CYCLE_AUDIT_ACTION,
  JARVIS_ENTERPRISE_CYCLE_GRANTED_CAPABILITIES,
  enterpriseCycleRequestSchema,
  toAuditIntent,
} from "./enterprise-cycle-contract";
export type {
  EnterpriseCycleAuditIntent,
  EnterpriseCycleDeps,
  EnterpriseCycleHealthTrace,
  EnterpriseCycleHermesTrace,
  EnterpriseCycleOutcome,
  EnterpriseCycleRequest,
} from "./enterprise-cycle-contract";

export const runJarvisEnterpriseCycleWake = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => enterpriseCycleRequestSchema.parse(input))
  .handler(async ({ data, context }): Promise<EnterpriseCycleOutcome> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { buildEnterpriseCycleDeps, executeEnterpriseCycle } = await import(
      "./enterprise-cycle-runtime.server"
    );
    const actorEmail =
      (context.claims as { email?: string } | null | undefined)?.email ?? null;
    const deps = await buildEnterpriseCycleDeps({
      admin: supabaseAdmin,
      actorId: context.userId,
      actorEmail,
    });
    return executeEnterpriseCycle(
      { supabase: context.supabase, userId: context.userId, claims: context.claims, data },
      deps,
    );
  });
