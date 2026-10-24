/**
 * SHERIVS-015 privacy lockdown.
 *
 * `anon`/`authenticated` can no longer SELECT these public.users columns:
 * nin, account_number, salary, face_biometric, phone. A `select("*")` on users
 * therefore fails; list USER_SAFE_COLUMNS instead and fetch sensitive fields
 * through the `users_private_fields(uuid[])` RPC, which returns a field only
 * when the caller is entitled to it (own record; admin/principal/bursar/hq per
 * field; NIN and face data owner-only). Unentitled fields come back null.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const USER_SENSITIVE_COLUMNS = [
  "nin",
  "account_number",
  "salary",
  "face_biometric",
  "phone",
] as const;
export type UserSensitiveColumn = (typeof USER_SENSITIVE_COLUMNS)[number];

/** Every public.users column a signed-in client may still read directly. */
export const USER_SAFE_COLUMNS = [
  "id",
  "school_id",
  "full_name",
  "email",
  "role",
  "avatar_url",
  "address",
  "gender",
  "date_of_birth",
  "emergency_contact",
  "emergency_contact_name",
  "subject_specialty",
  "qualification",
  "years_experience",
  "employment_type",
  "bank_name",
  "account_name",
  "date_enrolled",
  "next_of_kin_name",
  "next_of_kin_phone",
  "face_registered_at",
  "is_active",
  "last_login_at",
  "created_at",
  "updated_at",
  "face_skip_count",
  "face_attempt_count",
  "face_locked_at",
  "face_lock_reason",
  "is_face_locked",
  "digital_twin_opt_out",
  "push_token",
  "push_token_updated_at",
].join(", ");

export type UserPrivateFields = {
  id: string;
  phone: string | null;
  nin: string | null;
  account_number: string | null;
  salary: number | null;
  face_biometric: unknown;
};

/** Fetch the caller-entitled sensitive fields for the given user ids. */
export async function fetchUserPrivateFields(
  client: SupabaseClient<any, any, any>,
  ids: string[],
): Promise<Map<string, UserPrivateFields>> {
  const out = new Map<string, UserPrivateFields>();
  if (ids.length === 0) return out;
  const { data, error } = await client.rpc("users_private_fields", { p_ids: ids });
  if (error) throw error;
  for (const row of (data ?? []) as UserPrivateFields[]) out.set(row.id, row);
  return out;
}

/** Merge selected sensitive fields onto rows fetched with safe columns. */
export async function withUserPrivateFields<
  T extends { id: string },
  K extends UserSensitiveColumn,
>(
  client: SupabaseClient<any, any, any>,
  rows: T[],
  keys: readonly K[],
): Promise<Array<T & Pick<UserPrivateFields, K>>> {
  const priv = await fetchUserPrivateFields(
    client,
    rows.map((r) => r.id),
  );
  return rows.map((r) => {
    const p = priv.get(r.id);
    const extra = {} as Pick<UserPrivateFields, K>;
    for (const k of keys) (extra as Record<string, unknown>)[k] = p ? p[k] : null;
    return { ...r, ...extra };
  });
}
