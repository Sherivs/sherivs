import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { emailField, nonEmptyText, optionalText, phoneField } from "@/lib/validation";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requireSchoolAdminScope } from "@/lib/security-role-gate";
import { SystemClock, TimeAuthority } from "../../kernel/time-authority";
import { writeAuditRecord } from "@/lib/server/write-audit";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

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
  return `Teach@${rand}${new Date(timeAuthority.now().atMs).getFullYear()}!`;
}

export const inviteTeacher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => inviteTeacherSchema.parse(input))
  .handler(async ({ data, context }): Promise<InviteTeacherResult> => {
    // Canonical Phase 08 school-admin gate — resolves the actor's school
    // scope and fails closed (replaces the legacy inline RPC checks).
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    const schoolId = await requireSchoolAdminScope(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
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

    // §27.6 AUDIT — fail-closed separate audit record for the provisioning
    // write. Never records the temporary credential (§29).
    await writeAuditRecord(supabaseAdmin, {
      action: "teacher.invite",
      gate: "requireSchoolAdminScope",
      tenantId: schoolId,
      actorId: context.userId,
      table: "users",
      recordId: created.user.id,
      outcome: "succeeded",
      details: { email: data.email, role: "teacher" },
    });

    return { userId: created.user.id, email: data.email, tempPassword: password };
  });

const setActiveSchema = z.object({
  userId: z.string().uuid(),
  isActive: z.boolean(),
});

export const setTeacherActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => setActiveSchema.parse(input))
  .handler(async ({ data, context }) => {
    // Canonical Phase 08 school-admin gate (fail closed).
    // Lifecycle threading: see inviteTeacher for the signal semantics.
    const schoolId = await requireSchoolAdminScope(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });
    // RLS already restricts to same school
    const { error } = await context.supabase
      .from("users")
      .update({ is_active: data.isActive })
      .eq("id", data.userId)
      .eq("role", "teacher");
    if (error) throw new Error(error.message);

    // §27.6 AUDIT — fail-closed separate audit record for the status write.
    await writeAuditRecord(context.supabase, {
      action: "teacher.set_active",
      gate: "requireSchoolAdminScope",
      tenantId: schoolId,
      actorId: context.userId,
      table: "users",
      recordId: data.userId,
      outcome: "succeeded",
      details: { isActive: data.isActive },
    });

    return { ok: true };
  });
