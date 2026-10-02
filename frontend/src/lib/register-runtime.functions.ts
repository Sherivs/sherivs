/**
 * CoreGrid — Phase 33 kernel backend: domain-runtime registration (control plane).
 *
 * Installs a domain runtime on CoreGrid as a DATA operation over
 * `cg_domain_runtime` — never a kernel edit (Constitution §20, AD-001).
 * The kernel stays vocabulary-free: this module validates any manifest through
 * the generic `kernel/domain-manifest` contract and persists the registry row
 * built by `kernel/runtime-registry` (pure, pre-tested).
 *
 * Security posture (Plan §3):
 * - RLS is deny-by-default on `cg_*` (zero policies; anon/authenticated
 *   revoked). Writes therefore use the service-role `client.server` import —
 *   never the request-scoped client.
 * - Authorization: `requireSupabaseAuth` then the canonical Phase 08 gate
 *   `requirePlatformSuperAdmin` (fail closed). Registration is a platform
 *   control-plane operation; tenant-scoped actors can never reach it.
 * - Status is owned by the registry: a client-declared `status` is never
 *   trusted — registration always starts at `proposed` and advances only via
 *   `transitionRuntimeStatus` under the same gate.
 * - Every write appends to the legacy `super_admin_logs` audit surface with
 *   the acting admin id.
 *
 * Status: AUTHORED — NOT_VALIDATED against a live database. The kernel
 * substrate migration (20260903000000_coregrid_universal_kernel_substrate.sql)
 * must be applied and the RLS isolation check run before enablement
 * (architecture/kernel-wiring-plan.md §1). Generated `Database` types lag the
 * migration; the kernel tables are therefore accessed through a loose client
 * surface here, consistent with the authored-substrate state.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { asKernelAdmin, type KernelAdminClient } from "@/lib/kernel-admin-client";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requirePlatformSuperAdmin } from "@/lib/security-role-gate";
import {
  isRuntimeManifestStatus,
  RUNTIME_MANIFEST_STATUSES,
  validateManifest,
  type RuntimeManifest,
  type RuntimeManifestStatus,
} from "@/lib/kernel/domain-manifest";
import {
  applyRuntimeStatusTransition,
  registryRowFromManifest,
  type RuntimeRegistryRow,
} from "@/lib/kernel/runtime-registry";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

// The generated `Database` type lags the authored (NOT applied) cg_* substrate
// migration; the kernel client surface is shared with kernel-reality server
// functions via `kernel-admin-client.ts` (imported at the top of this file).

/* ─────────────────────────────────────────────────────────────
 * Validators
 * ────────────────────────────────────────────────────────────*/

/** Loose envelope; semantic validation is `kernel/domain-manifest`'s job. */
const manifestEnvelopeSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
    status: z.string(),
    ontology: z.unknown().optional(),
    capabilities: z.array(z.string()).optional(),
    policies: z.array(z.string()).optional(),
    interfaces: z.unknown().optional(),
  })
  .passthrough();

const runtimeIdSchema = z.string().regex(/^[a-z][a-z0-9]*:[a-z0-9-]+$/);
const transitionSchema = z.object({
  runtimeId: runtimeIdSchema,
  to: z.enum(
    RUNTIME_MANIFEST_STATUSES as unknown as [RuntimeManifestStatus, ...RuntimeManifestStatus[]],
  ),
});

function asManifest(value: unknown): RuntimeManifest {
  return value as unknown as RuntimeManifest;
}

function assertValidManifest(manifest: RuntimeManifest): void {
  const validation = validateManifest(manifest);
  if (!validation.ok) {
    throw new Error(`Invalid runtime manifest: ${validation.issues.join("; ")}`);
  }
}

/** Rebuild a typed registry row from a substrate row (defensive status check). */
function registryRowFromSubstrate(raw: KernelAdminClient): RuntimeRegistryRow | null {
  if (!raw || typeof raw !== "object") return null;
  const status: unknown = raw.status;
  if (!isRuntimeManifestStatus(status)) return null;
  const manifest = asManifest(raw.manifest);
  return {
    id: String(raw.id),
    name: String(raw.name),
    version: String(raw.version),
    status,
    manifest,
    created_at: String(raw.created_at ?? ""),
    updated_at: String(raw.updated_at ?? ""),
  };
}

/* ─────────────────────────────────────────────────────────────
 * registerDomainRuntime — idempotent installation
 * ────────────────────────────────────────────────────────────*/

export type RegisterRuntimeResult = {
  ok: true;
  runtime_id: string;
  name: string;
  version: string;
  status: RuntimeManifestStatus;
  registered: boolean; // false when an existing registration was refreshed
};

export const registerDomainRuntime = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => manifestEnvelopeSchema.parse(input))
  .handler(async ({ data, context }): Promise<RegisterRuntimeResult> => {
    // Control-plane gate: platform super-admin only (fail closed).
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    await requirePlatformSuperAdmin(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });

    const manifest = asManifest(data);
    assertValidManifest(manifest);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = asKernelAdmin(supabaseAdmin);
    const now = timeAuthority.now().at;

    // Registry owns lifecycle state: registration always starts at `proposed`;
    // the client-declared manifest.status is never trusted for the row.
    const row = registryRowFromManifest(manifest, now, "proposed");

    // Existing registration check so an idempotent refresh is distinguishable.
    const { data: existing, error: existingError } = await admin
      .from("cg_domain_runtime")
      .select("id")
      .eq("id", row.id)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    // Idempotent upsert keyed by manifest id. `created_at` is intentionally
    // omitted so a refresh never rewrites the original installation date.
    const { error } = await admin.from("cg_domain_runtime").upsert(
      {
        id: row.id,
        name: row.name,
        version: row.version,
        status: row.status,
        manifest: row.manifest,
        updated_at: now,
      },
      { onConflict: "id" },
    );
    if (error) throw new Error(error.message);

    // Audit (legacy platform audit surface, service-role path).
    const { error: auditError } = await admin.from("super_admin_logs").insert({
      admin_id: context.userId,
      action: existing ? "refresh_runtime_registration" : "register_runtime",
      details: {
        runtime_id: row.id,
        name: row.name,
        version: row.version,
        status: row.status,
      },
    });
    if (auditError) throw new Error(auditError.message);

    return {
      ok: true,
      runtime_id: row.id,
      name: row.name,
      version: row.version,
      status: row.status,
      registered: !existing,
    };
  });

/* ─────────────────────────────────────────────────────────────
 * transitionRuntimeStatus — governed lifecycle advance
 * ────────────────────────────────────────────────────────────*/

export type TransitionRuntimeStatusResult = {
  ok: true;
  runtime_id: string;
  from: RuntimeManifestStatus;
  to: RuntimeManifestStatus;
};

export const transitionRuntimeStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => transitionSchema.parse(input))
  .handler(async ({ data, context }): Promise<TransitionRuntimeStatusResult> => {
    // Lifecycle threading: see registerDomainRuntime for the signal semantics.
    await requirePlatformSuperAdmin(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = asKernelAdmin(supabaseAdmin);
    const now = timeAuthority.now().at;

    const { data: raw, error } = await admin
      .from("cg_domain_runtime")
      .select("id, name, version, status, manifest, created_at, updated_at")
      .eq("id", data.runtimeId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const current = registryRowFromSubstrate(raw);
    if (!current) throw new Error(`Runtime "${data.runtimeId}" is not registered`);

    const change = applyRuntimeStatusTransition(current, data.to, now);
    if (!change.ok) throw new Error(change.reason);

    const { error: updateError } = await admin
      .from("cg_domain_runtime")
      .update({ status: change.row.status })
      .eq("id", data.runtimeId);
    if (updateError) throw new Error(updateError.message);

    const { error: auditError } = await admin.from("super_admin_logs").insert({
      admin_id: context.userId,
      action: "transition_runtime_status",
      details: {
        runtime_id: data.runtimeId,
        from: current.status,
        to: change.row.status,
      },
    });
    if (auditError) throw new Error(auditError.message);

    return {
      ok: true,
      runtime_id: data.runtimeId,
      from: current.status,
      to: change.row.status,
    };
  });
