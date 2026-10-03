/**
 * CoreGrid — command centre platform reads (V1-012 honest-substrate disposition).
 *
 * The /command-centre surface is the CONTROL-PLANE operations projection
 * (phase 19). Its projection records — open alerts, incidents, observation
 * closures, decision records and observation-cursor deltas — have NO V1
 * substrate: phase 19's declared substrates ("alert definitions", "alert
 * state", "incidents") are authored as pure in-memory contract modules
 * (`command-alerts.ts`, `command-incidents.ts`, `command-centre.ts`) and no
 * migration creates a backing table (audited across all migrations). Those
 * surfaces render an honest planned-capability state on the route; none of
 * their numbers is invented here (§57). The centre never raises an alert and
 * never invents a correlation (phase 19 Z / AF), so no query may be shaped to
 * look like one.
 *
 * What the centre CAN read today, through this family (the ONLY server path
 * the route consumes):
 *   loadPlatformAuditTrail     → super_admin_logs (RLS policy: is_super_admin)
 *   loadKernelEventOutboxState → cg_event (kernel event/outbox registry; RLS
 *      denies the authenticated role by design, so the read uses the
 *      service-role kernel-admin client — the same sanctioned substrate path
 *      as `kernel-reality.functions.ts`)
 *
 * §27 SERVER FUNCTION RULE, every function:
 *   1. AUTHENTICATE  — `requireSupabaseAuth` middleware (verified JWT,
 *      per-request client);
 *   2. RESOLVE TENANT — control-plane authority: the platform super-admin is
 *      NOT a tenant (phase 01 §14); the neutral role gate resolves the
 *      authority server-side and no client tenant field exists to trust (§26);
 *   3. AUTHORIZE — the canonical Phase 08 gate `requirePlatformSuperAdmin`
 *      (fail-closed), with lifecycle/session signals threaded: the JWT
 *      carries no lifecycle claim so `lifecycle: null` flags the identity
 *      lifecycle unverified (never silent) while session validity is attested
 *      from the verified token's exp claim;
 *   4. VALIDATE — read-only GET consuming no client data;
 *   5. EXECUTE — sanctioned substrate only (per-request Supabase client /
 *      kernel-admin client); aggregates only, never row payloads or tenant
 *      references (minimum-necessary view, phase 19 DY);
 *   6. AUDIT — PURE READ (declared no-audit class): no write path exists in
 *      this family; the reads leave no record by design.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requirePlatformSuperAdmin } from "@/lib/security-role-gate";
import { asKernelAdmin, type KernelAdminClient } from "@/lib/kernel-admin-client";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/** Window for the "recent platform administrative activity" aggregate. */
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Recent platform audit actions surfaced on the operations projection. */
const RECENT_ACTION_LIMIT = 5;

/* ─────────────────────────────────────────────────────────────
 * Lifecycle/session signals threaded to the gate (AGENTS §31)
 * ────────────────────────────────────────────────────────────*/

function gateSignals(claims: unknown): { lifecycle: null; sessionValid: boolean } {
  const exp = (claims as { exp?: number } | null | undefined)?.exp;
  return {
    // The JWT carries no lifecycle claim: flag the identity lifecycle
    // unverified (never silent) while attesting session validity from exp.
    lifecycle: null,
    sessionValid: typeof exp === "number" && tokenMsRemaining(exp) > 0,
  };
}

async function loadKernelAdmin(): Promise<KernelAdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return asKernelAdmin(supabaseAdmin);
}

/* ─────────────────────────────────────────────────────────────
 * Platform administrative audit trail (super_admin_logs)
 * ────────────────────────────────────────────────────────────*/

export interface PlatformAuditEvent {
  readonly action: string;
  readonly at: string;
}

export interface PlatformAuditTrail {
  readonly totalEvents: number;
  readonly eventsLast24h: number;
  readonly lastEventAt: string | null;
  readonly recentActions: readonly PlatformAuditEvent[];
}

export const loadPlatformAuditTrail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformAuditTrail> => {
    const lifecycle = gateSignals(context.claims);
    await requirePlatformSuperAdmin(context.supabase, lifecycle);

    const sinceMs = timeAuthority.now().atMs - RECENT_WINDOW_MS;
    const since = new Date(sinceMs).toISOString();

    const [total, last24h, last, recent] = await Promise.all([
      context.supabase.from("super_admin_logs").select("id", { count: "exact", head: true }),
      context.supabase
        .from("super_admin_logs")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since),
      context.supabase
        .from("super_admin_logs")
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      context.supabase
        .from("super_admin_logs")
        .select("action, created_at")
        .order("created_at", { ascending: false })
        .limit(RECENT_ACTION_LIMIT),
    ]);

    if (total.error) throw new Error(total.error.message);
    if (last24h.error) throw new Error(last24h.error.message);
    if (last.error) throw new Error(last.error.message);
    if (recent.error) throw new Error(recent.error.message);

    const recentRows = (recent.data ?? []) as Array<{ action: string; created_at: string | null }>;
    return {
      totalEvents: total.count ?? 0,
      eventsLast24h: last24h.count ?? 0,
      lastEventAt: (last.data?.created_at as string | null) ?? null,
      recentActions: recentRows
        .filter((row) => typeof row.action === "string" && row.action.trim() !== "")
        .map((row) => ({
          action: row.action,
          at: row.created_at as string,
        })),
    };
  });

/* ─────────────────────────────────────────────────────────────
 * Kernel event outbox state (cg_event) — the event bus's own
 * delivery state machine, read as aggregates only
 * ────────────────────────────────────────────────────────────*/

export type KernelEventState = "pending" | "published" | "failed" | "acknowledged" | "dead";

export const KERNEL_EVENT_STATES: readonly KernelEventState[] = [
  "pending",
  "published",
  "failed",
  "acknowledged",
  "dead",
] as const;

export interface KernelEventOutboxState {
  readonly totalEvents: number;
  readonly byState: Record<KernelEventState, number>;
  readonly lastOccurredAt: string | null;
}

export const loadKernelEventOutboxState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<KernelEventOutboxState> => {
    const lifecycle = gateSignals(context.claims);
    await requirePlatformSuperAdmin(context.supabase, lifecycle);

    const admin = await loadKernelAdmin();

    const headCount = (state: KernelEventState | null) =>
      state === null
        ? admin.from("cg_event").select("id", { count: "exact", head: true })
        : admin.from("cg_event").select("id", { count: "exact", head: true }).eq("state", state);

    const [total, pending, published, failed, acknowledged, dead, last] = await Promise.all([
      headCount(null),
      headCount("pending"),
      headCount("published"),
      headCount("failed"),
      headCount("acknowledged"),
      headCount("dead"),
      admin
        .from("cg_event")
        .select("occurred_at")
        .order("occurred_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (total.error) throw new Error(total.error.message);
    if (pending.error) throw new Error(pending.error.message);
    if (published.error) throw new Error(published.error.message);
    if (failed.error) throw new Error(failed.error.message);
    if (acknowledged.error) throw new Error(acknowledged.error.message);
    if (dead.error) throw new Error(dead.error.message);
    if (last.error) throw new Error(last.error.message);

    return {
      totalEvents: total.count ?? 0,
      byState: {
        pending: pending.count ?? 0,
        published: published.count ?? 0,
        failed: failed.count ?? 0,
        acknowledged: acknowledged.count ?? 0,
        dead: dead.count ?? 0,
      },
      lastOccurredAt: (last.data?.occurred_at as string | null) ?? null,
    };
  });