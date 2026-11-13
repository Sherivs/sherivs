export interface ActiveOrganizationMembership {
  user_id: string;
  school_id: string;
  is_active: boolean;
}

export async function listActiveMembershipUserIds(
  schoolId: string,
  roles?: readonly string[],
): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let membershipQuery = supabaseAdmin
    .from("organization_memberships")
    .select("user_id, role")
    .eq("school_id", schoolId)
    .eq("is_active", true);
  if (roles?.length) membershipQuery = membershipQuery.in("role", [...roles]);

  const { data: memberships, error: membershipError } = await membershipQuery;
  if (membershipError) throw new Error(membershipError.message);
  const membershipIds = Array.from(new Set((memberships ?? []).map((row) => row.user_id)));
  if (!membershipIds.length) return [];

  const { data: users, error: userError } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("is_active", true)
    .in("id", membershipIds);
  if (userError) throw new Error(userError.message);
  return Array.from(new Set((users ?? []).map((user) => user.id)));
}

export function selectActiveMembershipRecipientIds(
  candidates: readonly string[],
  activeUserIds: readonly string[],
  memberships: readonly ActiveOrganizationMembership[],
  schoolId: string,
): string[] {
  const activeUsers = new Set(activeUserIds);
  const memberIds = new Set(
    memberships
      .filter((membership) => membership.school_id === schoolId && membership.is_active)
      .map((membership) => membership.user_id),
  );
  return Array.from(
    new Set(candidates.filter((userId) => activeUsers.has(userId) && memberIds.has(userId))),
  );
}
