/**
 * CoreGrid — Phase 02 identity registry server functions (L2 consumption).
 *
 * Registers identities in `cg_identity` through the pure `identity-registry`
 * contract. Tenant-scoped: the canonical school-admin gate resolves the actor's
 * OWN school as the tenant boundary (P02 C2; Constitution §26/§38 — never trust
 * a client-supplied tenant id). Writes use the service role because cg_identity
 * is deny-by-default RLS.
 *
 * Status: DB-VALIDATED schema (20260904020000) — HTTP-layer invocation pending
 * an app runtime; the DB path is exercised live by the L2 verification script.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { asKernelAdmin } from "@/lib/kernel-admin-client";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requireSchoolAdminScope } from "@/lib/security-role-gate";
import {
  IDENTITY_KINDS,
  IDENTITY_STATES,
  identityDraft,
  type IdentityKind,
  type IdentityState,
} from "@/lib/identity-registry";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

const registerIdentitySchema = z.object({
  kind: z.enum(IDENTITY_KINDS as unknown as [string, ...string[]]),
  display_name: z.string().trim().min(1).max(200),
  external_subject: z.string().trim().min(1).max(300).optional().nullable(),
  entity_id: z.string().uuid().optional().nullable(),
  state: z.enum(IDENTITY_STATES as unknown as [IdentityState, ...IdentityState[]]).optional(),
  verified: z.boolean().optional(),
});

export type RegisterIdentityResult = {
  ok: true;
  id: string;
  kind: IdentityKind;
  tenant_id: string;
};

export const registerIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => registerIdentitySchema.parse(input))
  .handler(async ({ data, context }): Promise<RegisterIdentityResult> => {
    // Tenant boundary = the actor's resolved school scope.
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    const schoolId = await requireSchoolAdminScope(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = asKernelAdmin(supabaseAdmin);
    const now = timeAuthority.now().at;

    const row = identityDraft(
      {
        kind: data.kind as IdentityKind,
        displayName: data.display_name,
        externalSubject: data.external_subject ?? null,
        entityId: data.entity_id ?? null,
        tenantId: schoolId,
        state: (data.state as IdentityState | undefined) ?? "provisioned",
        verified: data.verified ?? false,
      },
      now,
    );

    const { data: inserted, error } = await admin
      .from("cg_identity")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    return {
      ok: true,
      id: inserted.id as string,
      kind: row.kind,
      tenant_id: row.tenant_id ?? schoolId,
    };
  });

/* ─────────────────────────────────────────────────────────────
 * Reads — the workspace projection's data path (P02-2)
 * ────────────────────────────────────────────────────────────*/

export type IdentitySummary = {
  id: string;
  kind: IdentityKind;
  display_name: string;
  state: IdentityState;
  verified: boolean;
  tenant_id: string | null;
  created_at: string;
};

export type ListIdentitiesResult = {
  ok: true;
  /** The tenant boundary the read was scoped to (never client-supplied). */
  tenant_id: string;
  identities: IdentitySummary[];
};

const listIdentitiesSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  kind: z.enum(IDENTITY_KINDS as unknown as [string, ...string[]]).optional(),
});

/**
 * List the identities inside the actor's own tenant boundary.
 *
 * The boundary is resolved from the authenticated actor's school scope, exactly
 * like the write path: a client cannot widen it (Constitution §26/§38). RLS is
 * deny-by-default on `cg_identity`, so the read runs through the service role
 * *after* the gate has resolved the tenant, and the query itself is filtered by
 * that resolved tenant id.
 */
export const listIdentities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => listIdentitiesSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<ListIdentitiesResult> => {
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    const schoolId = await requireSchoolAdminScope(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = asKernelAdmin(supabaseAdmin);

    let query = admin
      .from("cg_identity")
      .select("id, kind, display_name, state, verified, tenant_id, created_at")
      .eq("tenant_id", schoolId)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 50);
    if (data.kind) query = query.eq("kind", data.kind);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    return {
      ok: true,
      tenant_id: schoolId,
      identities: (rows ?? []) as IdentitySummary[],
    };
  });
