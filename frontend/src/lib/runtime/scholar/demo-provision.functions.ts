import { createServerFn } from "@tanstack/react-start";
import type { supabaseAdmin as supabaseAdminRef } from "@/integrations/supabase/client.server";
import { generateInitialPassword } from "@/lib/onboarding/generated-credentials";
import { SUBSCRIPTION_TIERS } from "@/lib/subscription-tiers";

/**
 * Service-role admin client type, derived from the sanctioned substrate module
 * (type-only import — erased at build time, no client-bundle leakage).
 */
type SupabaseAdminClient = typeof supabaseAdminRef;

/**
 * V1-008 (§30 SECRETS): the demo fixture carries NO fixed credentials. The
 * account emails below are deterministic fixture identifiers (required for
 * the idempotent ensure* upsert flow), but every initial password is
 * GENERATED ONCE per provisioning run by the platform credential generator
 * and returned to the caller exactly once — never a constant, never logged.
 */
const DEMO = {
  schoolName: "Demo Enterprise Academy",
  slug: "demo-enterprise",
};

export const DEMO_ACCOUNTS = [
  { role: "super_admin", label: "Super Admin", email: "super@universalschool.os" },
  { role: "admin", label: "School Admin", email: "admin@demo.school" },
  { role: "principal", label: "Principal", email: "principal@demo.school" },
  { role: "teacher", label: "Teacher", email: "teacher@demo.school" },
  { role: "parent", label: "Parent", email: "parent@demo.school" },
  { role: "student", label: "Student", email: "student@demo.school" },
  { role: "bursar", label: "Bursar", email: "bursar@demo.school" },
  { role: "hq", label: "HQ", email: "hq@demo.school" },
  { role: "driver", label: "Driver", email: "driver@demo.school" },
] as const;

type DemoRole = (typeof DEMO_ACCOUNTS)[number]["role"];

const USER_NAMES: Record<Exclude<DemoRole, "super_admin">, string> = {
  admin: "Demo School Admin",
  principal: "Demo Principal",
  teacher: "Demo Teacher",
  parent: "Demo Parent",
  student: "Demo Student",
  bursar: "Demo Bursar",
  hq: "Demo HQ Lead",
  driver: "Demo Bus Driver",
};

const ENTERPRISE_FEATURES = Object.fromEntries(
  Object.keys(SUBSCRIPTION_TIERS.enterprise.features).map((key) => [key, true]),
) as Record<string, boolean>;

export type DemoAccount = {
  role: DemoRole;
  label: string;
  email: string;
};

export type DemoCredentials = {
  email: string;
  /** Generated once per provisioning run; returned once; never a stored constant. */
  password: string;
  schoolName: string;
  created: boolean;
  accounts: readonly DemoAccount[];
};

async function findAuthUserIdByEmail(
  supabaseAdmin: SupabaseAdminClient,
  email: string,
): Promise<string | undefined> {
  // listUsers is paged; a single 1000-page lookup is enough for tenants
  // that don't exceed that size.
  const { data } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return data?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
}

async function ensureAuthUser(
  supabaseAdmin: SupabaseAdminClient,
  email: string,
  fullName: string,
  password: string,
): Promise<string> {
  const existingId = await findAuthUserIdByEmail(supabaseAdmin, email);
  if (existingId) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(existingId, {
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) throw new Error(error.message);
    return existingId;
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data?.user) throw new Error(error?.message ?? `Failed to create ${email}`);
  return data.user.id;
}

async function ensureSchool(
  supabaseAdmin: SupabaseAdminClient,
): Promise<{ id: string; created: boolean }> {
  const { data: existing } = await supabaseAdmin
    .from("schools")
    .select("id, name")
    .eq("slug", DEMO.slug)
    .maybeSingle();

  if (existing) {
    const { error } = await supabaseAdmin
      .from("schools")
      .update({
        name: DEMO.schoolName,
        email: "admin@demo.school",
        subscription_tier: "enterprise",
        subscription_status: "active",
        active_features: ENTERPRISE_FEATURES,
        monthly_fee: 0,
        max_students: -1,
        max_teachers: -1,
        is_active: true,
      })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    return { id: existing.id, created: false };
  }

  const { data: school, error } = await supabaseAdmin
    .from("schools")
    .insert({
      name: DEMO.schoolName,
      slug: DEMO.slug,
      email: "admin@demo.school",
      subscription_tier: "enterprise",
      subscription_status: "active",
      active_features: ENTERPRISE_FEATURES,
      monthly_fee: 0,
      max_students: -1,
      max_teachers: -1,
      is_active: true,
    })
    .select("id")
    .single();
  if (error || !school)
    throw new Error(
      error?.message
        ? `Failed to create demo school: ${error.message}`
        : "Failed to create demo school",
    );
  return { id: school.id, created: true };
}

async function ensureDemoClass(
  supabaseAdmin: SupabaseAdminClient,
  schoolId: string,
): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from("classes")
    .select("id")
    .eq("school_id", schoolId)
    .eq("name", "Grade 7A")
    .limit(1);
  if (existing?.[0]?.id) return existing[0].id;

  const { data, error } = await supabaseAdmin
    .from("classes")
    .insert({
      school_id: schoolId,
      name: "Grade 7A",
      grade_level: "Grade 7",
      academic_year: "2026/2027",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to create demo class");
  return data.id;
}

async function ensureTenantUser(
  supabaseAdmin: SupabaseAdminClient,
  schoolId: string,
  role: Exclude<DemoRole, "super_admin">,
  password: string,
): Promise<string> {
  const cred = DEMO_ACCOUNTS.find((c) => c.role === role)!;
  const userId = await ensureAuthUser(supabaseAdmin, cred.email, USER_NAMES[role], password);
  const { error } = await supabaseAdmin.from("users").upsert({
    id: userId,
    school_id: schoolId,
    full_name: USER_NAMES[role],
    email: cred.email,
    role,
    is_active: true,
  });
  if (error) throw new Error(error.message);
  return userId;
}

export const provisionDemoEnterprise = createServerFn({ method: "POST" }).handler(
  async (): Promise<DemoCredentials> => {
    // Development-fixture isolation (Phase 01 §34/§45): demo reality may only be
    // provisioned when an operator explicitly enables it in the environment.
    // Default is OFF in every environment, including local. This server function
    // creates live rows (school, auth users, classes, bus, subscription) with
    // generated-once credentials (V1-008: no fixed credential constant exists),
    // so it must never run silently.
    if (process.env.ALLOW_DEMO_PROVISIONING !== "true") {
      throw new Error(
        "Demo provisioning is disabled on this environment. Set ALLOW_DEMO_PROVISIONING=true to enable it.",
      );
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // §30: the demo password is generated ONCE per run from platform entropy
    // and returned to the caller exactly once — never a stored constant.
    const demoPassword = generateInitialPassword();

    const { id: schoolId, created } = await ensureSchool(supabaseAdmin);
    const classId = await ensureDemoClass(supabaseAdmin, schoolId);

    const superCred = DEMO_ACCOUNTS.find((c) => c.role === "super_admin")!;
    const superId = await ensureAuthUser(supabaseAdmin, superCred.email, "Demo Super Admin", demoPassword);
    const { error: superErr } = await supabaseAdmin.from("super_admins").upsert({
      id: superId,
      full_name: "Demo Super Admin",
      email: superCred.email,
      role: "super_admin",
      is_active: true,
    });
    if (superErr) throw new Error(superErr.message);

    const ids = {
      admin: await ensureTenantUser(supabaseAdmin, schoolId, "admin", demoPassword),
      principal: await ensureTenantUser(supabaseAdmin, schoolId, "principal", demoPassword),
      teacher: await ensureTenantUser(supabaseAdmin, schoolId, "teacher", demoPassword),
      parent: await ensureTenantUser(supabaseAdmin, schoolId, "parent", demoPassword),
      student: await ensureTenantUser(supabaseAdmin, schoolId, "student", demoPassword),
      bursar: await ensureTenantUser(supabaseAdmin, schoolId, "bursar", demoPassword),
      hq: await ensureTenantUser(supabaseAdmin, schoolId, "hq", demoPassword),
      driver: await ensureTenantUser(supabaseAdmin, schoolId, "driver", demoPassword),
    };

    const { data: existingStudents } = await supabaseAdmin
      .from("students")
      .select("id")
      .eq("user_id", ids.student)
      .limit(1);
    const foundStudentId = existingStudents?.[0]?.id;
    let studentId: string;
    if (foundStudentId) {
      studentId = foundStudentId;
      const { error } = await supabaseAdmin
        .from("students")
        .update({
          school_id: schoolId,
          class_id: classId,
          admission_number: "DEMO-001",
          parent_name: USER_NAMES.parent,
          parent_email: "parent@demo.school",
          parent_id: ids.parent,
          is_active: true,
        })
        .eq("id", studentId);
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await supabaseAdmin
        .from("students")
        .insert({
          school_id: schoolId,
          user_id: ids.student,
          class_id: classId,
          admission_number: "DEMO-001",
          parent_name: USER_NAMES.parent,
          parent_email: "parent@demo.school",
          parent_id: ids.parent,
          gender: "other",
          is_active: true,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(error?.message ?? "Failed to create demo student");
      studentId = data.id;
    }

    const { error: mapErr } = await supabaseAdmin.from("parent_student_map").upsert(
      {
        school_id: schoolId,
        parent_id: ids.parent,
        student_id: studentId,
        relationship: "Parent",
        is_primary_contact: true,
      },
      { onConflict: "parent_id,student_id" },
    );
    if (mapErr) throw new Error(mapErr.message);

    const { data: existingBuses } = await supabaseAdmin
      .from("transport_buses")
      .select("id")
      .eq("school_id", schoolId)
      .eq("bus_number", "DEMO-BUS-1")
      .limit(1);
    const busPayload = {
      school_id: schoolId,
      bus_number: "DEMO-BUS-1",
      registration_plate: "DEMO-2026",
      bus_type: "standard",
      capacity: 32,
      driver_id: ids.driver,
      current_status: "idle",
      route_name: "Demo Route",
      assigned_students: [studentId],
      is_active: true,
    };
    if (existingBuses?.[0]?.id) {
      const { error } = await supabaseAdmin
        .from("transport_buses")
        .update(busPayload)
        .eq("id", existingBuses[0].id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("transport_buses").insert(busPayload);
      if (error) throw new Error(error.message);
    }

    // Idempotent — only insert a subscription row the first time we provision.
    const { data: existingSub } = await supabaseAdmin
      .from("subscriptions")
      .select("id")
      .eq("school_id", schoolId)
      .limit(1);
    if (!existingSub?.[0]) {
      await supabaseAdmin.from("subscriptions").insert({
        school_id: schoolId,
        plan: "enterprise",
        status: "active",
        amount_paid: 0,
      });
    }

    return {
      email: "admin@demo.school",
      password: demoPassword,
      schoolName: DEMO.schoolName,
      created,
      accounts: DEMO_ACCOUNTS,
    };
  },
);
