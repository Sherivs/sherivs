/**
 * Server-side identifier directory. Service-role reads only; never returned
 * to the browser as an account-existence oracle. Password verification still
 * goes through GoTrue with the anon/publishable client so RLS sessions match
 * password and Google sign-in.
 */
import { createClient } from "@supabase/supabase-js";
import { classifySignInIdentifier, toPasswordSignInPayload } from "./sign-in-identifier";
import {
  hostnameFromOriginHeader,
  resolveSignInIdentifier,
  type IdentifierDirectoryMatch,
} from "./resolve-sign-in-identifier";

export { hostnameFromOriginHeader };

type AdminFilter = {
  select(columns: string): AdminFilter;
  eq(column: string, value: unknown): AdminFilter;
  ilike(column: string, value: string): AdminFilter;
  in(column: string, values: unknown[]): AdminFilter;
  maybeSingle(): Promise<{
    data: Record<string, unknown> | null;
    error: { message: string } | null;
  }>;
  then: Promise<{ data: unknown; error: { message: string } | null }>["then"];
};

type AdminQuery = {
  from(table: string): AdminFilter;
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
};

export async function schoolIdForLoginHost(
  admin: AdminQuery,
  hostname: string | null,
): Promise<string | null> {
  if (!hostname) return null;
  const { data, error } = await admin.rpc("resolve_school_by_host", { p_host: hostname });
  if (error || !data || typeof data !== "object") return null;
  const schoolId = (data as { school_id?: unknown }).school_id;
  return typeof schoolId === "string" && schoolId.length > 0 ? schoolId : null;
}

export async function lookupAdmissionMatches(
  admin: AdminQuery,
  admissionNumber: string,
): Promise<IdentifierDirectoryMatch[]> {
  const value = admissionNumber.trim();
  if (!value || value.length > 80 || /[%_*]/.test(value)) return [];
  const { data, error } = await admin
    .from("students")
    .select("id, school_id, user_id, is_active, admission_number")
    .ilike("admission_number", value);
  if (error || !Array.isArray(data)) return [];
  const userIds = [
    ...new Set(
      data
        .map((row) => (row as { user_id?: unknown }).user_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  if (userIds.length === 0) return [];
  const { data: users, error: userError } = await admin
    .from("users")
    .select("id, school_id, email, is_active")
    .in("id", userIds);
  if (userError || !Array.isArray(users)) return [];
  const byId = new Map(
    users.map((row) => [String((row as { id: string }).id), row as Record<string, unknown>]),
  );
  const matches: IdentifierDirectoryMatch[] = [];
  for (const row of data as Array<Record<string, unknown>>) {
    const userId = typeof row.user_id === "string" ? row.user_id : "";
    const user = byId.get(userId);
    const email = typeof user?.email === "string" ? user.email : "";
    if (!userId || !email.includes("@")) continue;
    matches.push({
      schoolId: String(row.school_id ?? user?.school_id ?? ""),
      userId,
      email,
      active: row.is_active !== false && user?.is_active !== false,
    });
  }
  return matches;
}

type PasswordAuthClient = {
  auth: {
    signInWithPassword(payload: {
      email?: string;
      phone?: string;
      password: string;
      options?: { captchaToken: string };
    }): Promise<{
      data: {
        session: {
          access_token: string;
          refresh_token: string;
          expires_in?: number;
          user: { id: string };
        } | null;
      };
      error: { message: string } | null;
    }>;
  };
};

export function createPasswordAuthClient(url: string, publishableKey: string): PasswordAuthClient {
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as PasswordAuthClient;
}

export async function passwordSignInFromIdentifier(input: {
  rawIdentifier: string;
  password: string;
  captchaToken?: string;
  originHost: string | null;
  admin: AdminQuery;
  client: PasswordAuthClient;
}): Promise<
  | { ok: true; accessToken: string; refreshToken: string; expiresIn: number; userId: string }
  | { ok: false }
> {
  const classified = classifySignInIdentifier(input.rawIdentifier);
  let payload = toPasswordSignInPayload(classified, input.password, input.captchaToken);
  if (classified.kind === "username") {
    const schoolId = await schoolIdForLoginHost(input.admin, input.originHost);
    const matches = await lookupAdmissionMatches(input.admin, classified.value);
    const resolved = resolveSignInIdentifier({
      raw: input.rawIdentifier,
      schoolId,
      matches,
    });
    if (resolved.status !== "resolved") return { ok: false };
    payload = toPasswordSignInPayload(resolved.identifier, input.password, input.captchaToken);
  }
  const { data, error } = await input.client.auth.signInWithPassword(payload);
  const session = data.session;
  if (error || !session?.access_token || !session.refresh_token || !session.user?.id) {
    return { ok: false };
  }
  return {
    ok: true,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: session.expires_in ?? 3600,
    userId: session.user.id,
  };
}
