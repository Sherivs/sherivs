/**
 * CoreGrid Mobile — authentication client (mirrors the web app's auth
 * semantics, §23 / Phase 22 §P).
 *
 * - sign-in: Supabase `signInWithPassword` over the shared project
 *   (identical to frontend/src/routes/auth.tsx),
 * - sign-out, session access, and auth-state subscription are pass-throughs
 *   of the same client API the web uses,
 * - actor resolution mirrors `frontend/src/contexts/app-context.tsx`: the
 *   `users` row bound to the auth identity carries the tenant
 *   (`school_id`); a `super_admins` row marks a platform actor; neither
 *   means the identity is not yet provisioned. The tenant id is ALWAYS
 *   resolved server-side from the authenticated row — never accepted from
 *   the caller (§26).
 */
import { userProfileSchema, organizationSchema, superAdminProfileSchema, type Organization, type ResolvedActor } from "./contracts/profile-contracts";
import type { CoreGridSupabaseClient } from "./client";
import { fromSupabaseError } from "./errors";

export type CoreGridSession = NonNullable<Awaited<ReturnType<CoreGridSupabaseClient["auth"]["getSession"]>>["data"]["session"]>;

export async function signInWithPassword(
  client: CoreGridSupabaseClient,
  email: string,
  password: string,
): Promise<CoreGridSession> {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw fromSupabaseError(error);
  if (!data.session) throw fromSupabaseError({ message: "sign-in returned no session" });
  return data.session;
}

export async function signOut(client: CoreGridSupabaseClient): Promise<void> {
  const { error } = await client.auth.signOut();
  if (error) throw fromSupabaseError(error);
}

export async function getSession(client: CoreGridSupabaseClient): Promise<CoreGridSession | null> {
  const { data, error } = await client.auth.getSession();
  if (error) throw fromSupabaseError(error);
  return data.session;
}

export async function getAccessToken(client: CoreGridSupabaseClient): Promise<string | null> {
  const { data, error } = await client.auth.getSession();
  if (error) throw fromSupabaseError(error);
  return data.session?.access_token ?? null;
}

export async function resolveActor(
  client: CoreGridSupabaseClient,
  userId: string,
): Promise<ResolvedActor> {
  const { data: profileRow, error: profileError } = await client
    .from("users")
    .select("id, full_name, email, school_id, role")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw fromSupabaseError(profileError);

  if (profileRow) {
    const profile = userProfileSchema.parse(profileRow);
    const { data: orgRow, error: orgError } = await client
      .from("schools")
      .select("id, name, slug, is_active, primary_color")
      .eq("id", profile.school_id)
      .maybeSingle();
    if (orgError) throw fromSupabaseError(orgError);
    const organization: Organization | null = orgRow ? organizationSchema.parse(orgRow) : null;
    return { kind: "user", profile, organization };
  }

  const { data: superAdminRow, error: superAdminError } = await client
    .from("super_admins")
    .select("id, full_name, email")
    .eq("id", userId)
    .maybeSingle();
  if (superAdminError) throw fromSupabaseError(superAdminError);

  if (superAdminRow) {
    return { kind: "super_admin", profile: superAdminProfileSchema.parse(superAdminRow) };
  }

  return { kind: "unprovisioned" };
}

/**
 * Active organizations an actor may present: platform super admins query
 * the active `schools` registry; tenant-scoped users have exactly the
 * organization their provisioned row resolves to. Both are real,
 * RLS-governed queries — no client-side tenant invention (§26 / Phase 22 §R).
 */
export async function listSelectableOrganizations(
  client: CoreGridSupabaseClient,
  actor: ResolvedActor,
): Promise<readonly Organization[]> {
  if (actor.kind === "user") {
    return actor.organization ? [actor.organization] : [];
  }
  if (actor.kind !== "super_admin") return [];
  const { data, error } = await client
    .from("schools")
    .select("id, name, slug, is_active, primary_color")
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (error) throw fromSupabaseError(error);
  return (data ?? []).map((row) => organizationSchema.parse(row));
}