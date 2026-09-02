import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { runSecurityGateway } from "@/lib/security-gateway.server";
import { emailField, nonEmptyText, optionalText, phoneField } from "@/lib/validation";

/**
 * Tenant-admin server functions that need privileged work (creating auth
 * users, deactivating users tied to auth, deletes that need to clean up
 * auth rows). All gated by is_school_admin() + tenant_id match.
 */

const inviteTeacherSchema = z.object({
  fullName: nonEmptyText("Full name", 120),
  email: emailField,
  phone: phoneField,
  subjectSpecialty: optionalText(120),
  qualification: optionalText(120),
  yearsExperience: z
    .union([z.number(), z.string()])
    .transform((v) => (v === "" || v === null || v === undefined ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 80), {
      message: "Years of experience must be 0–80",
    }),
});

export type InviteTeacherResult = {
  userId: string;
  email: string;
  tempPassword: string;
};

function tempPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Teach@${rand}${new Date().getFullYear()}!`;
}

export const inviteTeacher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inviteTeacherSchema.parse(input))
  .handler(async ({ data, context }): Promise<InviteTeacherResult> => {
    const [adminResult, tenantResult] = await Promise.all([
      context.supabase.rpc("is_school_admin"),
      context.supabase.rpc("get_my_school_id"),
    ]);
    const { tenantId: schoolId } = runSecurityGateway({
      actorId: context.userId,
      hasActiveSession: true,
      schoolAdmin: adminResult.error ? null : (adminResult.data as boolean),
      schoolId: tenantResult.error ? null : (tenantResult.data as string | null),
      role: null,
      withinRateLimit: true,
      requestIntegrityValid: true,
    });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Reject duplicate emails across the platform — they map 1:1 to auth users
    const { data: existing } = await supabaseAdmin
      .from("users")
      .select("id, school_id")
      .eq("email", data.email)
      .maybeSingle();
    if (existing) {
      throw new Error("A user with that email already exists.");
    }

    const password = tempPassword();
    const { data: created, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName, role: "teacher" },
    });
    if (authErr || !created?.user) {
      throw new Error(authErr?.message ?? "Failed to create teacher auth user");
    }

    const { error: userErr } = await supabaseAdmin.from("users").insert({
      id: created.user.id,
      school_id: schoolId,
      full_name: data.fullName,
      email: data.email,
      phone: data.phone,
      role: "teacher",
      subject_specialty: data.subjectSpecialty,
      qualification: data.qualification,
      years_experience: data.yearsExperience,
      is_active: true,
    });
    if (userErr) {
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      throw new Error(userErr.message);
    }

    return { userId: created.user.id, email: data.email, tempPassword: password };
  });

const setActiveSchema = z.object({
  userId: z.string().uuid(),
  isActive: z.boolean(),
});

export const setTeacherActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => setActiveSchema.parse(input))
  .handler(async ({ data, context }) => {
    const [adminResult, tenantResult] = await Promise.all([
      context.supabase.rpc("is_school_admin"),
      context.supabase.rpc("get_my_school_id"),
    ]);
    runSecurityGateway({
      actorId: context.userId,
      hasActiveSession: true,
      schoolAdmin: adminResult.error ? null : (adminResult.data as boolean),
      schoolId: tenantResult.error ? null : (tenantResult.data as string | null),
      role: null,
      withinRateLimit: true,
      requestIntegrityValid: true,
    });
    // RLS already restricts to same school
    const { error } = await context.supabase
      .from("users")
      .update({ is_active: data.isActive })
      .eq("id", data.userId)
      .eq("role", "teacher");
    if (error) throw new Error(error.message);
    return { ok: true };
  });
