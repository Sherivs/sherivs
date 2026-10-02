/**
 * School + super-admin provisioning.
 *
 * Two server functions:
 *
 *  - claimFirstSuperAdmin  — public bootstrap. Only succeeds when zero
 *    super admins exist in the database. The caller must be signed in
 *    (we use that auth user as the new super admin).
 *  - createSchoolWithAdmin — requires the caller to already be a super
 *    admin. Provisions a new school, a first admin auth user, the users
 *    row linking them, an initial subscription row, and an audit log.
 *
 * `client.server` (service-role) is imported INSIDE handlers so this file
 * stays safe to import from components / route loaders.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requirePlatformSuperAdmin } from "@/lib/security-role-gate";
import { writeAuditRecord } from "@/lib/server/write-audit";
import {
  emailField,
  nonEmptyText,
  optionalEmail,
  optionalText,
  phoneField,
  subscriptionTier,
} from "@/lib/validation";

const claimSchema = z.object({
  fullName: nonEmptyText("Full name", 120),
});

const createSchoolSchema = z.object({
  schoolName: nonEmptyText("School name", 120),
  schoolEmail: optionalEmail,
  phone: phoneField,
  address: optionalText(300),
  adminFullName: nonEmptyText("Admin full name", 120),
  adminEmail: emailField,
  subscriptionTier: subscriptionTier.default("trial"),
  monthlyFee: z
    .union([z.number(), z.string()])
    .transform((v) => (v === "" || v === null || v === undefined ? 0 : Number(v)))
    .refine((v) => Number.isFinite(v) && v >= 0 && v <= 1_000_000, {
      message: "Monthly fee must be between 0 and 1,000,000",
    })
    .default(0),
});

/* ---------- shared helpers ---------- */

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function defaultAdminPassword(slug: string) {
  return `Admin@${slug}${new Date().getFullYear()}!`;
}

/* ---------- public read: is the platform bootstrapped? ---------- */

export const checkPlatformBootstrap = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { count, error } = await supabaseAdmin
    .from("super_admins")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return { hasSuperAdmin: (count ?? 0) > 0 };
});

/* ---------- bootstrap: become the first super admin ---------- */

export const claimFirstSuperAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => claimSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Gate: only proceeds when zero super admins exist
    const { count, error: countErr } = await supabaseAdmin
      .from("super_admins")
      .select("id", { count: "exact", head: true });
    if (countErr) throw new Error(countErr.message);
    if ((count ?? 0) > 0) {
      throw new Error("Platform already has a super admin. Bootstrap is closed.");
    }

    // The caller (signed in via the bearer attacher) becomes the first super admin
    const userId = context.userId;
    const email = (context.claims as { email?: string })?.email ?? "";

    const { error: insertErr } = await supabaseAdmin.from("super_admins").insert({
      id: userId,
      full_name: data.fullName,
      email,
      is_active: true,
    });
    if (insertErr) throw new Error(insertErr.message);

    return { ok: true, id: userId, email };
  });

/* ---------- create a school + its first admin ---------- */

export type CreateSchoolInput = {
  schoolName: string;
  schoolEmail?: string;
  phone?: string;
  address?: string;
  adminFullName: string;
  adminEmail: string;
  subscriptionTier: "trial" | "starter" | "growth" | "professional" | "enterprise";
  monthlyFee?: number;
};

export type CreateSchoolResult = {
  schoolId: string;
  schoolSlug: string;
  schoolName: string;
  adminEmail: string;
  tempPassword: string;
  publicUrlSuffix: string; // e.g. "?school=stmarys"
};

export const createSchoolWithAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => createSchoolSchema.parse(input))
  .handler(async ({ data, context }): Promise<CreateSchoolResult> => {
    // Canonical Phase 08 role gate — platform super admin (fail closed).
    // Lifecycle threading: see assertSuper for the signal semantics.
    await requirePlatformSuperAdmin(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    /* --- 1. resolve a unique slug --- */
    const base = slugify(data.schoolName) || "school";
    let slug = base;
    for (let i = 0; i < 8; i++) {
      const { data: existing } = await supabaseAdmin
        .from("schools")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (!existing) break;
      slug = `${base}-${i + 2}`;
    }

    /* --- 2. create the school --- */
    const { data: school, error: schoolErr } = await supabaseAdmin
      .from("schools")
      .insert({
        name: data.schoolName,
        slug,
        email: data.schoolEmail,
        phone: data.phone,
        address: data.address,
        subscription_tier: data.subscriptionTier,
        subscription_status: "active",
        monthly_fee: data.monthlyFee,
        is_active: true,
      })
      .select("id, slug, name")
      .single();
    if (schoolErr || !school) {
      throw new Error(schoolErr?.message ?? "Failed to create school");
    }

    /* --- 3. create the first admin auth user --- */
    const tempPassword = defaultAdminPassword(slug);
    const { data: created, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.adminEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: data.adminFullName },
    });
    if (authErr || !created?.user) {
      // rollback school so we don't leave an orphan tenant
      await supabaseAdmin.from("schools").delete().eq("id", school.id);
      throw new Error(authErr?.message ?? "Failed to create admin user");
    }

    /* --- 4. link them via public.users with role=admin --- */
    const { error: userErr } = await supabaseAdmin.from("users").insert({
      id: created.user.id,
      school_id: school.id,
      full_name: data.adminFullName,
      email: data.adminEmail,
      role: "admin",
      is_active: true,
    });
    if (userErr) {
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      await supabaseAdmin.from("schools").delete().eq("id", school.id);
      throw new Error(userErr.message);
    }

    /* --- 5. initial subscription row --- */
    await supabaseAdmin.from("subscriptions").insert({
      school_id: school.id,
      plan: data.subscriptionTier,
      status: "active",
      amount_paid: 0,
    });

    /* --- 6. audit log --- */
    await supabaseAdmin.from("super_admin_logs").insert({
      admin_id: context.userId,
      action: "create_school",
      target_school_id: school.id,
      details: {
        school_name: school.name,
        slug: school.slug,
        admin_email: data.adminEmail,
        tier: data.subscriptionTier,
      },
    });

    return {
      schoolId: school.id,
      schoolSlug: school.slug,
      schoolName: school.name,
      adminEmail: data.adminEmail,
      tempPassword,
      publicUrlSuffix: `?school=${school.slug}`,
    };
  });

/* ---------- super-admin school ops ---------- */

async function assertSuper(context: {
  supabase: Parameters<typeof requirePlatformSuperAdmin>[0];
  claims: { exp: number };
}) {
  // Canonical Phase 08 role gate — platform super admin (fail closed).
  // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
  // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
  // contract while flagging the identity lifecycle unverified (never silent);
  // session validity is attested from the verified token's exp claim.
  await requirePlatformSuperAdmin(context.supabase, {
    lifecycle: null,
    sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
  });
}

const updateSchoolSchema = z.object({
  schoolId: z.string().uuid(),
  subscriptionTier: subscriptionTier.optional(),
  subscriptionStatus: z.enum(["active", "suspended", "expired", "trial"]).optional(),
  monthlyFee: z.number().min(0).max(1_000_000).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const updateSchoolPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => updateSchoolSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertSuper(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: {
      subscription_tier?: string;
      subscription_status?: string;
      monthly_fee?: number;
      subscription_expires_at?: string | null;
      is_active?: boolean;
    } = {};
    if (data.subscriptionTier != null) patch.subscription_tier = data.subscriptionTier;
    if (data.subscriptionStatus != null) patch.subscription_status = data.subscriptionStatus;
    if (data.monthlyFee != null) patch.monthly_fee = data.monthlyFee;
    if (data.expiresAt !== undefined) patch.subscription_expires_at = data.expiresAt;
    if (data.isActive != null) patch.is_active = data.isActive;
    const { error } = await supabaseAdmin.from("schools").update(patch).eq("id", data.schoolId);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("super_admin_logs").insert({
      admin_id: context.userId,
      action: "update_school",
      target_school_id: data.schoolId,
      details: patch as Record<string, string | number | boolean | null>,
    });
    return { ok: true };
  });

const resetPwSchema = z.object({ schoolId: z.string().uuid() });

export const resetSchoolAdminPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => resetPwSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertSuper(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: school } = await supabaseAdmin
      .from("schools")
      .select("slug")
      .eq("id", data.schoolId)
      .maybeSingle();
    if (!school) throw new Error("School not found");
    const { data: admin } = await supabaseAdmin
      .from("users")
      .select("id, email")
      .eq("school_id", data.schoolId)
      .eq("role", "admin")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!admin) throw new Error("No admin account for this school");
    const tempPassword = defaultAdminPassword(school.slug);
    const { error } = await supabaseAdmin.auth.admin.updateUserById(admin.id, {
      password: tempPassword,
    });
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("super_admin_logs").insert({
      admin_id: context.userId,
      action: "reset_school_admin_password",
      target_school_id: data.schoolId,
      details: { admin_email: admin.email },
    });
    return { adminEmail: admin.email, tempPassword };
  });
