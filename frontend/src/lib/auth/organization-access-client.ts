import { supabase } from "@/integrations/supabase/client";
import { resolveTenantDomain } from "@/lib/tenant";
import { schoolDomainLoginAllowed } from "@/lib/domains/school-domains";
import { isActiveMembership, ORGANIZATION_ACCESS_DENIED } from "./organization-access";

export async function assertPostAuthOrganizationAccess(input: {
  userId: string;
  tenantSlug: string | null;
  schoolId: string | null;
}): Promise<void> {
  const { data: membership } = await supabase
    .from("users")
    .select("id, school_id, is_active, role")
    .eq("id", input.userId)
    .maybeSingle();

  if (membership && !isActiveMembership(membership)) {
    await supabase.auth.signOut();
    throw new Error(ORGANIZATION_ACCESS_DENIED);
  }

  if (input.tenantSlug && input.schoolId) {
    if (!membership || membership.school_id !== input.schoolId) {
      await supabase.auth.signOut();
      throw new Error(ORGANIZATION_ACCESS_DENIED);
    }
  }

  const customHost = resolveTenantDomain();
  if (customHost && !(await schoolDomainLoginAllowed(customHost))) {
    await supabase.auth.signOut();
    throw new Error(ORGANIZATION_ACCESS_DENIED);
  }
}
