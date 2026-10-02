/**
 * Admin flow for creating real portal accounts for a school's staff / students /
 * parents. Returns the freshly-minted email + password so the admin can hand
 * the credentials to the person. Idempotent by email — running it again for
 * an existing user resets the password to a new one.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import {
  decideAccountAdministration,
  resolveRoleGate,
  type AccountAdministrationOutcome,
} from "@/lib/security-role-gate";
import { asKernelAdmin } from "@/lib/kernel-admin-client";
import { identityDraft } from "@/lib/identity-registry";
import { writeAuditRecord } from "@/lib/server/write-audit";
import { SCHOLAR_RUNTIME_REF, scholarWorkforceKind } from "@/lib/runtime/scholar-workforce";
import { WORKFORCE_KIND_CODES } from "@/lib/workforce-kinds";
import { SystemClock, TimeAuthority } from "../../kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

const CREATABLE_ROLES = [
  "admin",
  "principal",
  "teacher",
  "bursar",
  "parent",
  "student",
  "driver",
  "hq",
] as const;

export type CreatableStaffRole = (typeof CREATABLE_ROLES)[number];

const schema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  role: z.enum(CREATABLE_ROLES),
  phone: z.string().trim().max(40).optional().nullable(),
  password: z
    .string()
    .trim()
    .min(8, "Password must be at least 8 characters")
    .max(72)
    .optional()
    .nullable(),
  /**
   * Optional canonical workforce position (runtime:scholar catalog code).
   * The position is workforce REALITY recorded against the cg_workforce_kind
   * substrate; it is never an authorization input (Phase 08 stays the only
   * authority). Membership kind (`role`) remains the coarse access signal.
   */
  positionCode: z.string().regex(WORKFORCE_KIND_CODES).optional().nullable(),
});

export type CreateStaffAccountResult = {
  userId: string;
  email: string;
  password: string;
  role: CreatableStaffRole;
  fullName: string;
  reused: boolean;
  positionCode: string | null;
  positionTitle: string | null;
};

function randomPassword() {
  const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
  const num = "23456789";
  const sym = "!@#$";
  let p = "";
  for (let i = 0; i < 8; i++) p += alpha[Math.floor(Math.random() * alpha.length)];
  for (let i = 0; i < 3; i++) p += num[Math.floor(Math.random() * num.length)];
  p += sym[Math.floor(Math.random() * sym.length)];
  return p;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findAuthUserIdByEmail(admin: any, email: string) {
  // listUsers is paged; a single 1000-page lookup is enough for tenants
  // that don't exceed that size, and matches the rest of the codebase.
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data?.users ?? []).find((u: any) => u.email?.toLowerCase() === email.toLowerCase())
    ?.id as string | undefined;
}

export const createStaffAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }): Promise<CreateStaffAccountResult> => {
    // Canonical Phase 08 composite gate: platform super-admin OR same-school
    // admin/principal. Replaces legacy direct role-row parsing.
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    const lifecycle = {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    };
    const superGate = await resolveRoleGate(context.supabase, "platform_super_admin", lifecycle);
    const adminGate =
      superGate.decision === "allow"
        ? null
        : await resolveRoleGate(context.supabase, "school_admin", lifecycle);

    const access = decideAccountAdministration({
      platformSuper: superGate.decision === "allow",
      schoolAdmin: adminGate?.decision === "allow",
      schoolScope: adminGate?.decision === "allow" ? adminGate.scope : null,
      targetSchoolId: null,
      ...lifecycle,
    });
    if (access.decision === "deny") throw new Error(access.reason);

    const schoolId = access.scope ?? undefined;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const password = data.password?.length ? data.password : randomPassword();

    let userId = await findAuthUserIdByEmail(supabaseAdmin, data.email);
    let reused = false;

    if (userId) {
      reused = true;
      const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password,
        email_confirm: true,
        user_metadata: { full_name: data.fullName },
      });
      if (error) throw new Error(error.message);
    } else {
      const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
        email: data.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: data.fullName },
      });
      if (error || !created?.user) throw new Error(error?.message ?? "Failed to create account");
      userId = created.user.id as string;
    }

    // Link into public.users for this school (upsert by pk).
    if (schoolId) {
      const { error: uErr } = await supabaseAdmin.from("users").upsert({
        id: userId,
        school_id: schoolId,
        full_name: data.fullName,
        email: data.email,
        phone: data.phone ?? null,
        role: data.role,
        is_active: true,
      });
      if (uErr) throw new Error(uErr.message);
    }

    // Phase 02 closure: every new portal account is also registered as a
    // canonical human identity in the universal registry (cg_identity) so the
    // runtime account and the P02 identity model stay unified. Skipped on the
    // reused (password-reset) path where the identity row already exists.
    if (!reused && schoolId) {
      const now = timeAuthority.now().at;
      const identityRow = identityDraft(
        {
          kind: "human",
          displayName: data.fullName,
          externalSubject: userId,
          tenantId: schoolId,
          state: "active",
          verified: true,
        },
        now,
      );
      const { error: identityErr } = await asKernelAdmin(supabaseAdmin)
        .from("cg_identity")
        .insert(identityRow);
      if (identityErr) {
        throw new Error(`Failed to register identity: ${identityErr.message}`);
      }
    }

    // Record the canonical workforce position (workforce reality, advisory).
    // Positions apply to staff accounts only — learners and guardians are
    // Domain ontology relationships (enrolls/guardians), never positions.
    let positionTitle: string | null = null;
    if (data.positionCode) {
      if (!schoolId) throw new Error("A school scope is required to assign a position");
      if (data.role === "parent" || data.role === "student") {
        throw new Error(
          "Positions apply to staff accounts only; parents and students are relationships.",
        );
      }
      const kind = scholarWorkforceKind(data.positionCode);
      if (!kind) throw new Error(`Unknown position kind "${data.positionCode}"`);
      positionTitle = kind.title;
      const kernelAdmin = asKernelAdmin(supabaseAdmin);
      const { error: posErr } = await kernelAdmin.from("cg_workforce_position").insert({
        tenant_ref: schoolId,
        runtime_ref: SCHOLAR_RUNTIME_REF,
        kind_code: kind.kindCode,
        identity_ref: userId,
        is_primary: true,
        employment_type: "full_time",
        started_on: timeAuthority.now().at.slice(0, 10),
        status: "active",
        attributes: {},
      });
      if (posErr) {
        throw new Error(`Failed to record position "${kind.title}": ${posErr.message}`);
      }
    }

    return {
      userId,
      email: data.email,
      password,
      role: data.role,
      fullName: data.fullName,
      reused,
      positionCode: data.positionCode ?? null,
      positionTitle,
    };
  });

export const resetStaffPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    // Canonical Phase 08 composite gate: platform super-admin OR same-school
    // admin/principal, with the target same-tenant rule for school admins.
    // Lifecycle threading: see createStaffAccount for the signal semantics.
    const lifecycle = {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const superGate = await resolveRoleGate(context.supabase, "platform_super_admin", lifecycle);
    let access: AccountAdministrationOutcome;

    if (superGate.decision === "allow") {
      access = decideAccountAdministration({
        platformSuper: true,
        schoolAdmin: false,
        schoolScope: null,
        targetSchoolId: null,
        ...lifecycle,
      });
    } else {
      const adminGate = await resolveRoleGate(context.supabase, "school_admin", lifecycle);
      if (adminGate.decision !== "allow") throw new Error("Forbidden");
      const { data: target } = await supabaseAdmin
        .from("users")
        .select("school_id, email")
        .eq("id", data.userId)
        .maybeSingle();
      if (!target) throw new Error("Not allowed to reset this user");
      access = decideAccountAdministration({
        platformSuper: false,
        schoolAdmin: true,
        schoolScope: adminGate.scope,
        targetSchoolId: (target.school_id as string | null) ?? null,
        ...lifecycle,
      });
    }

    if (access.decision === "deny") throw new Error(access.reason);

    const password = randomPassword();
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);

    const { data: fresh } = await supabaseAdmin
      .from("users")
      .select("school_id, email")
      .eq("id", data.userId)
      .maybeSingle();

    // §27.6 AUDIT — fail-closed separate audit record for the credential
    // reset. Never records the new credential (§29). A platform super admin
    // has no canonical tenant user row (audit_logs.user_id FK), so actor
    // attribution falls to the verified email claim while the auth uid stays
    // in the record payload.
    await writeAuditRecord(supabaseAdmin, {
      action: "staff_account.reset_password",
      gate: "decideAccountAdministration",
      tenantId: (fresh?.school_id as string | null) ?? null,
      actorId: superGate.decision === "allow" ? null : context.userId,
      actorEmail:
        superGate.decision === "allow"
          ? ((context.claims as { email?: string })?.email ?? null)
          : null,
      table: "users",
      recordId: data.userId,
      outcome: "succeeded",
      details: { actor_user_id: context.userId, target_email: fresh?.email ?? null },
    });

    return { userId: data.userId, email: fresh?.email ?? null, password };
  });

export const CREATABLE_STAFF_ROLES = CREATABLE_ROLES;
