import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tenantHierarchySchema, type TenantHierarchy } from "./model";

export const getMyTenantHierarchy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({})
      .strict()
      .parse(input ?? {}),
  )
  .handler(async ({ context }): Promise<TenantHierarchy | null> => {
    const { data, error } = await context.supabase.rpc("read_my_tenant_hierarchy");
    if (error) throw new Error(error.message);
    if (data === null) return null;
    return tenantHierarchySchema.parse(data);
  });
