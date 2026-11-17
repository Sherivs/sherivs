import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const emptyInput = z.object({}).strict();
const provisionResult = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("succeeded"),
    twin_id: z.string().uuid(),
    memory_scope_id: z.string().min(1).max(160),
    created: z.boolean(),
  }),
  z.object({ outcome: z.literal("denied") }),
]);

type PersonalTwinProvisioner = {
  rpc(
    name: "cg_personal_twin_provision",
    args: { p_identity_id: string; p_school_id: string },
  ): Promise<{ data: unknown; error: { message: string } | null }>;
};

/** Provision the caller's twin in the server-resolved active tenant. */
export const provisionMyPersonalTwin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => emptyInput.parse(input))
  .handler(async ({ context }) => {
    const { data: schoolId, error: tenantError } = await context.supabase.rpc("get_my_school_id");
    if (tenantError || typeof schoolId !== "string" || !schoolId) {
      throw new Error("An active tenant is required to provision a personal twin.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const provisioner = supabaseAdmin as unknown as PersonalTwinProvisioner;
    const { data, error } = await provisioner.rpc("cg_personal_twin_provision", {
      p_identity_id: context.userId,
      p_school_id: schoolId,
    });
    if (error) throw new Error(error.message);

    const result = provisionResult.parse(data);
    if (result.outcome === "denied") {
      throw new Error("An active membership in the resolved tenant is required.");
    }
    return {
      twinId: result.twin_id,
      memoryScopeId: result.memory_scope_id,
      created: result.created,
    };
  });
