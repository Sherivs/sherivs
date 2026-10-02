/**
 * CoreGrid — Phase 03 tenant registry server functions (L2 consumption).
 *
 * Registers tenants in `cg_tenant` through the pure `tenant-registry`
 * contract. Platform control-plane operation: the canonical super-admin gate
 * (P03 H1/H2; tenant provisioning is platform-scoped). Hierarchy is expressed
 * via `parent_tenant_id` (self-parent is rejected by the DB CHECK and the
 * draft contract). Writes use the service role — cg_tenant is deny-by-default.
 *
 * Status: DB-VALIDATED schema (20260904020000) — HTTP-layer invocation pending
 * an app runtime; the DB path is exercised live by the L2 verification script.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { asKernelAdmin } from "@/lib/kernel-admin-client";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requirePlatformSuperAdmin } from "@/lib/security-role-gate";
import {
  TENANT_ENVIRONMENTS,
  TENANT_STATUSES,
  tenantDraft,
  type TenantEnvironment,
  type TenantStatus,
} from "@/lib/tenant-registry";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

const registerTenantSchema = z.object({
  tenant_type: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,60}[a-z0-9])?$/),
  status: z.enum(TENANT_STATUSES as unknown as [string, ...string[]]).optional(),
  parent_tenant_id: z.string().uuid().optional().nullable(),
  region: z.string().trim().min(1).max(120).optional().nullable(),
  environment: z
    .enum(TENANT_ENVIRONMENTS as unknown as [TenantEnvironment, ...TenantEnvironment[]])
    .optional(),
});

export type RegisterTenantResult = {
  ok: true;
  id: string;
  slug: string;
  status: TenantStatus;
  duplicated: boolean;
};

export const registerTenant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => registerTenantSchema.parse(input))
  .handler(async ({ data, context }): Promise<RegisterTenantResult> => {
    // Platform control-plane gate: super-admin only (fail closed).
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    await requirePlatformSuperAdmin(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = asKernelAdmin(supabaseAdmin);
    const now = timeAuthority.now().at;

    const row = tenantDraft(
      {
        tenantType: data.tenant_type,
        name: data.name,
        slug: data.slug,
        status: (data.status as TenantStatus | undefined) ?? "PROVISIONING",
        parentTenantId: data.parent_tenant_id ?? null,
        region: data.region ?? null,
        environment: (data.environment as TenantEnvironment | undefined) ?? "development",
      },
      now,
    );

    // Slug is the natural tenant key — idempotent registration returns the
    // existing tenant rather than failing on the unique constraint.
    const { data: existing } = await admin
      .from("cg_tenant")
      .select("id, slug, status")
      .eq("slug", row.slug)
      .maybeSingle();
    if (existing) {
      return {
        ok: true,
        id: existing.id as string,
        slug: existing.slug as string,
        status: existing.status as TenantStatus,
        duplicated: true,
      };
    }

    const { data: inserted, error } = await admin
      .from("cg_tenant")
      .insert(row)
      .select("id, slug, status")
      .single();
    if (error) throw new Error(error.message);

    return {
      ok: true,
      id: inserted.id as string,
      slug: inserted.slug as string,
      status: inserted.status as TenantStatus,
      duplicated: false,
    };
  });

/* ─────────────────────────────────────────────────────────────
 * Reads — the workspace projection's data path (P03-4)
 * ────────────────────────────────────────────────────────────*/

export type TenantSummary = {
  id: string;
  tenant_type: string;
  name: string;
  slug: string;
  status: TenantStatus;
  parent_tenant_id: string | null;
  region: string | null;
  environment: TenantEnvironment;
  created_at: string;
};

export type ListTenantsResult = {
  ok: true;
  tenants: TenantSummary[];
};

const listTenantsSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  status: z.enum(TENANT_STATUSES as unknown as [string, ...string[]]).optional(),
});

/**
 * List tenants for the platform control plane.
 *
 * Platform-scoped by construction: the canonical super-admin gate runs first
 * (fail closed), so this read is never a tenant-visible enumeration vector
 * (P03 J4). Hierarchy is returned as `parent_tenant_id` so the projection can
 * show topology without implying inherited access (Invariant 14).
 */
export const listTenants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => listTenantsSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<ListTenantsResult> => {
    await requirePlatformSuperAdmin(context.supabase, {
      // Lifecycle threading: see registerTenant for the signal semantics
      // (unverified lifecycle flagged; session attested from the token exp).
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = asKernelAdmin(supabaseAdmin);

    let query = admin
      .from("cg_tenant")
      .select(
        "id, tenant_type, name, slug, status, parent_tenant_id, region, environment, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 100);
    if (data.status) query = query.eq("status", data.status);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    return { ok: true, tenants: (rows ?? []) as TenantSummary[] };
  });
