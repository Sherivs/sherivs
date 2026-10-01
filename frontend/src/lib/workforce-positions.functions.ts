/**
 * CoreGrid — workforce-position server functions (org-admin HR surface).
 *
 * Wraps the RPC layer of migration 20260907000300 with the canonical
 * school-admin scope gate. The tenant boundary is resolved server-side from
 * the actor; the client never supplies it. Positions are workforce reality —
 * they never grant authorization (Phase 08 stays the only authority).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { asKernelAdmin } from "@/lib/kernel-admin-client";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requireSchoolAdminScope } from "@/lib/security-role-gate";
import { scholarWorkforceKind } from "@/lib/runtime/scholar-workforce";
import {
  isWorkforceEmploymentType,
  parseWorkforcePositionView,
  type WorkforcePositionView,
} from "@/lib/workforce-positions";

export const listWorkforcePositions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({}).parse(input))
  .handler(async ({ context }): Promise<WorkforcePositionView[]> => {
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    const schoolId = await requireSchoolAdminScope(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });
    const db = asKernelAdmin(context.supabase);
    const { data, error } = await db.rpc("list_workforce_positions", { p_tenant: schoolId });
    if (error) throw new Error(error.message);
    const rows = Array.isArray(data) ? data : [];
    return rows.map((row) => parseWorkforcePositionView(row));
  });

export const assignWorkforcePosition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        kindCode: z.string().min(1).max(80),
        isPrimary: z.boolean().default(false),
        employmentType: z.string().default("full_time"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    const schoolId = await requireSchoolAdminScope(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });

    if (!isWorkforceEmploymentType(data.employmentType)) {
      throw new Error(`Invalid employment type "${data.employmentType}"`);
    }
    const kind = scholarWorkforceKind(data.kindCode);
    if (!kind) throw new Error(`Unknown position kind "${data.kindCode}"`);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: target } = await supabaseAdmin
      .from("users")
      .select("role, school_id")
      .eq("id", data.userId)
      .maybeSingle();
    if (!target) throw new Error("Target account not found");
    if (target.school_id !== schoolId) throw new Error("Target account is outside this school");
    if (target.role === "parent" || target.role === "student") {
      throw new Error(
        "Positions apply to staff accounts only; parents and students are relationships.",
      );
    }

    const { data: positionId, error } = await asKernelAdmin(context.supabase).rpc(
      "assign_workforce_position",
      {
        p_tenant: schoolId,
        p_identity: data.userId,
        p_kind_code: kind.kindCode,
        p_primary: data.isPrimary,
        p_employment_type: data.employmentType,
      },
    );
    if (error) throw new Error(error.message);
    return { positionId: positionId as string | null, kindTitle: kind.title };
  });

export const endWorkforcePosition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ positionId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    // The RPC re-derives the tenant from the position row and re-checks the
    // actor scope; resolving the scope here is belt-and-braces context.
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    const schoolId = await requireSchoolAdminScope(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });
    void schoolId;
    const { data: ended, error } = await asKernelAdmin(context.supabase).rpc(
      "end_workforce_position",
      { p_position_id: data.positionId },
    );
    if (error) throw new Error(error.message);
    return { ended: ended === true };
  });

/**
 * Self-scoped read: the authenticated member's OWN active primary position.
 * No school-admin scope required — the RPC enforces identity_ref = auth.uid()
 * inside the security-definer function. Returns null when the member has no
 * primary position (or is a learner/parent/guardian).
 */
export const getMyPrimaryWorkforcePosition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({}).parse(input))
  .handler(async ({ context }): Promise<WorkforcePositionView | null> => {
    const { data, error } = await asKernelAdmin(context.supabase).rpc(
      "get_my_primary_workforce_position",
    );
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
    return row ? parseWorkforcePositionView(row) : null;
  });

export type AssignWorkforcePositionResult = Awaited<ReturnType<typeof assignWorkforcePosition>>;
