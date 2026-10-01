/**
 * CoreGrid Scholar — reality-role assignment & grant functions (WAVE-R37).
 *
 * APIs are APIs (Constitution §27). Every function authenticates, re-derives the
 * tenant server-side through the canonical gate, validates against platform
 * vocabulary, executes through the scoped RPCs (or the service client with a
 * server-derived tenant/identity) and returns only permitted data.
 *
 * The self-scoped reader is what makes grants real: it assembles the caller's
 * role set (catalog + this tenant's active grants) and returns the feature-gate
 * decisions the runtime consumes. No client ever supplies its own roles,
 * tenant or grants.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { asKernelAdmin, type KernelAdminClient } from "@/lib/kernel-admin-client";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requireSchoolAdminScope } from "@/lib/security-role-gate";
import { KERNEL_CAPABILITIES } from "@/lib/kernel/kernel-capability-registry";
import { featureGateSnapshot, type FeatureGateDecision } from "@/lib/scholar/feature-gate";
import { EDUCATION_REALITY_ROLES, roleById } from "@/lib/scholar/roles/role-registry";
import {
  applyGrantsToRoles,
  roleAssignmentSchema,
  roleGrantSchema,
  roleIdsForIdentity,
  type RoleAssignmentRow,
  type RoleGrantRow,
} from "@/lib/scholar/roles/role-assignment-store";

const CAPABILITY_IDS: ReadonlySet<string> = new Set(KERNEL_CAPABILITIES.map((c) => c.id));

/**
 * Authenticated client for RPCs authored after the last Supabase type
 * generation. The JWT context is preserved (the SECURITY DEFINER functions
 * authorize on auth.uid()); only the generated-name whitelist is bypassed.
 */
function rpcClient(client: unknown): KernelAdminClient {
  return client as KernelAdminClient;
}

/** The caller's OWN assignments, in the caller's OWN tenant (server-derived). */
async function loadMyAssignments(
  admin: KernelAdminClient,
  tenantId: string,
  identityId: string,
): Promise<RoleAssignmentRow[]> {
  const { data } = await admin
    .from("cg_role_assignment")
    .select("id, identity_ref, role_id, status, started_on, ended_on")
    .eq("tenant_ref", tenantId)
    .eq("identity_ref", identityId);
  return (Array.isArray(data) ? data : []).map((row) => roleAssignmentSchema.parse(row));
}

/** Tenant grants (policy data) for the caller's own tenant. */
async function loadTenantGrants(
  admin: KernelAdminClient,
  tenantId: string,
): Promise<RoleGrantRow[]> {
  const { data } = await admin
    .from("cg_role_grant")
    .select("id, role_id, capability, granted_by, granted_on, revoked_on")
    .eq("tenant_ref", tenantId);
  return (Array.isArray(data) ? data : []).map((row) => roleGrantSchema.parse(row));
}

export interface MyRealityRoles {
  tenantId: string | null;
  roleIds: readonly string[];
  /** Grants rejected because they name a capability the kernel does not own. */
  rejectedGrants: readonly string[];
  enabled: readonly string[];
  decisions: readonly FeatureGateDecision[];
}

/**
 * Self-scope: the caller's reality roles in their own tenant, with the tenant's
 * active grants applied, plus the feature decisions those roles produce.
 */
export const getMyRealityRoles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({}).parse(input))
  .handler(async ({ context }): Promise<MyRealityRoles> => {
    const scopeRes = await context.supabase.rpc("get_my_school_id");
    const tenantId = (scopeRes.data as string | null) ?? null;
    if (!tenantId) {
      return { tenantId: null, roleIds: [], rejectedGrants: [], enabled: [], decisions: [] };
    }

    const admin = asKernelAdmin(context.supabase);
    const [assignments, grants] = await Promise.all([
      loadMyAssignments(admin, tenantId, context.userId),
      loadTenantGrants(admin, tenantId),
    ]);

    const roleIds = roleIdsForIdentity(assignments);
    const merged = applyGrantsToRoles(EDUCATION_REALITY_ROLES, grants);
    const decisions = featureGateSnapshot({
      actor: { identityId: context.userId, tenantId, roleIds },
      roles: merged.roles,
    });

    return {
      tenantId,
      roleIds,
      rejectedGrants: merged.rejected,
      enabled: decisions.filter((decision) => decision.enabled).map((decision) => decision.code),
      decisions,
    };
  });

const assignInputSchema = z.object({
  identityId: z.string().uuid(),
  roleId: z.string().regex(/^role:[a-z0-9]+(-[a-z0-9]+)*$/),
  startedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

const grantInputSchema = z.object({
  roleId: z.string().regex(/^role:[a-z0-9]+(-[a-z0-9]+)*$/),
  capability: z.string().min(2).max(81),
});

/** Admin-scope: assign a reality role to an identity in this tenant. */
export const assignRealityRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => assignInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    const schoolId = await requireSchoolAdminScope(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });
    if (!roleById(data.roleId)) throw new Error(`Unknown reality role "${data.roleId}"`);
    const { data: id, error } = await rpcClient(context.supabase).rpc("assign_role", {
      p_tenant: schoolId,
      p_identity: data.identityId,
      p_role_id: data.roleId,
      p_started_on: data.startedOn ?? null,
      p_ended_on: data.endedOn ?? null,
    });
    if (error) throw new Error(error.message);
    return { assignmentId: id as string | null };
  });

/** Admin-scope: end an assignment (history preserved). */
export const endRealityRoleAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ assignmentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    // Lifecycle threading: see assignRealityRole for the signal semantics.
    await requireSchoolAdminScope(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });
    const { data: ended, error } = await rpcClient(context.supabase).rpc("end_role_assignment", {
      p_assignment_id: data.assignmentId,
    });
    if (error) throw new Error(error.message);
    return { ended: ended === true };
  });

/** Admin-scope: list this tenant's assignments. */
export const listTenantRoleAssignments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({}).parse(input))
  .handler(async ({ context }): Promise<RoleAssignmentRow[]> => {
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    const schoolId = await requireSchoolAdminScope(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });
    const { data, error } = await rpcClient(context.supabase).rpc("list_role_assignments", {
      p_tenant: schoolId,
    });
    if (error) throw new Error(error.message);
    return (Array.isArray(data) ? data : []).map((row) => roleAssignmentSchema.parse(row));
  });

/** Admin-scope: list this tenant's grants (active + revoked history). */
export const listTenantRoleGrants = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({}).parse(input))
  .handler(async ({ context }): Promise<RoleGrantRow[]> => {
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    const schoolId = await requireSchoolAdminScope(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });
    const { data, error } = await rpcClient(context.supabase).rpc("list_role_grants", {
      p_tenant: schoolId,
    });
    if (error) throw new Error(error.message);
    return (Array.isArray(data) ? data : []).map((row) => roleGrantSchema.parse(row));
  });

/** Admin-scope: grant a kernel capability to a reality role. */
export const grantRealityCapability = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => grantInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    const schoolId = await requireSchoolAdminScope(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });
    if (!roleById(data.roleId)) throw new Error(`Unknown reality role "${data.roleId}"`);
    if (!CAPABILITY_IDS.has(data.capability)) {
      throw new Error(`Unknown kernel capability "${data.capability}"`);
    }
    const { data: id, error } = await rpcClient(context.supabase).rpc("grant_role_capability", {
      p_tenant: schoolId,
      p_role_id: data.roleId,
      p_capability: data.capability,
    });
    if (error) throw new Error(error.message);
    return { grantId: id as string | null };
  });

/** Admin-scope: revoke a grant (timestamped; history preserved). */
export const revokeRealityCapability = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ grantId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    // Lifecycle threading: see assignRealityRole for the signal semantics.
    await requireSchoolAdminScope(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });
    const { data: revoked, error } = await rpcClient(context.supabase).rpc(
      "revoke_role_capability",
      {
        p_grant_id: data.grantId,
      },
    );
    if (error) throw new Error(error.message);
    return { revoked: revoked === true };
  });

export type MyRealityRolesResult = Awaited<ReturnType<typeof getMyRealityRoles>>;
