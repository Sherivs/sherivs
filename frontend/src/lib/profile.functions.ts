/**
 * Profile server functions shared by every role's /settings page.
 *
 * - getMyProfile: returns the editable subset of public.users for the caller.
 * - updateMyProfile: patch the caller's own row.
 * - setDigitalTwinOptOut: parents (and any role) can opt-out of AI calls.
 *
 * Super-admins don't have a tenant profile so these calls just no-op for them.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseSelfProfilePatch } from "@/lib/runtime/identity-privilege";
import { fetchUserPrivateFields } from "@/lib/identity/user-private-fields";

export { parseSelfProfilePatch } from "@/lib/runtime/identity-privilege";

export type MyProfile = {
  id: string;
  full_name: string;
  email: string | null;
  role: string;
  phone: string | null;
  address: string | null;
  avatar_url: string | null;
  emergency_contact_name: string | null;
  emergency_contact: string | null;
  digital_twin_opt_out: boolean | null;
};

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyProfile | null> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("users")
      .select(
        "id, full_name, email, role, address, avatar_url, emergency_contact_name, emergency_contact, digital_twin_opt_out",
      )
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    // SHERIVS-015: phone is no longer directly selectable; the RPC returns own fields.
    const priv = await fetchUserPrivateFields(supabase, [userId]);
    return { ...(data as Omit<MyProfile, "phone">), phone: priv.get(userId)?.phone ?? null };
  });

export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => parseSelfProfilePatch(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (Object.keys(data).length === 0) return { ok: true as const };
    const { error } = await supabase.from("users").update(data).eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

const OptOutInput = z.object({ opt_out: z.boolean() });

export const setDigitalTwinOptOut = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => OptOutInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("users")
      .update({ digital_twin_opt_out: data.opt_out })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
