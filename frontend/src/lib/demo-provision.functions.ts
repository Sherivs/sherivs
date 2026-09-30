import { createServerFn } from "@tanstack/react-start";
import { SUBSCRIPTION_TIERS } from "@/lib/subscription-tiers";

const DEMO = {
  schoolName: "Demo Enterprise Academy",
  slug: "demo-enterprise",
  password: "Demo@2026!",
};

export const DEMO_CREDENTIALS = [
  {
    role: "super_admin",
    label: "Super Admin",
    email: "super@universalschool.os",
    password: DEMO.password,
  },
  { role: "admin", label: "School Admin", email: "admin@demo.school", password: DEMO.password },
  {
    role: "principal",
    label: "Principal",
    email: "principal@demo.school",
    password: DEMO.password,
  },
  { role: "teacher", label: "Teacher", email: "teacher@demo.school", password: DEMO.password },
  { role: "parent", label: "Parent", email: "parent@demo.school", password: DEMO.password },
  { role: "student", label: "Student", email: "student@demo.school", password: DEMO.password },
  { role: "bursar", label: "Bursar", email: "bursar@demo.school", password: DEMO.password },
  { role: "hq", label: "HQ", email: "hq@demo.school", password: DEMO.password },
  { role: "driver", label: "Driver", email: "driver@demo.school", password: DEMO.password },
] as const;

type DemoRole = (typeof DEMO_CREDENTIALS)[number]["role"];

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

export type DemoCredentials = {
  email: string;
  password: string;
  schoolName: string;
  created: boolean;
  accounts: typeof DEMO_CREDENTIALS;
};

async function findAuthUserIdByEmail(supabaseAdmin: any, email: string) {
  const { data } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return data?.users?.find((u: any) => u.email?.toLowerCase() === email.toLowerCase())?.id as
    string | undefined;
}

async function ensureAuthUser(supabaseAdmin: any, email: string, fullName: string) {
  const existingId = await findAuthUserIdByEmail(supabaseAdmin, email);
  if (existingId) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(existingId, {
      password: DEMO.password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) throw new Error(error.message);
    return existingId;
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: DEMO.password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data?.user) throw new Error(error?.message ?? `Failed to create ${email}`);
  return data.user.id as string;
}

async function ensureSchool(supabaseAdmin: any) {
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
    return { id: existing.id as string, created: false };
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
  return { id: school.id as string, created: true };
}

async function ensureDemoClass(supabaseAdmin: any, schoolId: string) {
  const { data: existing } = await supabaseAdmin
    .from("classes")
    .select("id")
    .eq("school_id", schoolId)
    .eq("name", "Grade 7A")
    .limit(1);
  if (existing?.[0]?.id) return existing[0].id as string;

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
  return data.id as string;
}

async function ensureTenantUser(
  supabaseAdmin: any,
  schoolId: string,
  role: Exclude<DemoRole, "super_admin">,
) {
  const cred = DEMO_CREDENTIALS.find((c) => c.role === role)!;
  const userId = await ensureAuthUser(supabaseAdmin, cred.email, USER_NAMES[role]);
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
    // fixed credentials, so it must never run silently.
    if (process.env.ALLOW_DEMO_PROVISIONING !== "true") {
      throw new Error(
        "Demo provisioning is disabled on this environment. Set ALLOW_DEMO_PROVISIONING=true to enable it.",
      );
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { id: schoolId, created } = await ensureSchool(supabaseAdmin);
    const classId = await ensureDemoClass(supabaseAdmin, schoolId);

    const superCred = DEMO_CREDENTIALS.find((c) => c.role === "super_admin")!;
    const superId = await ensureAuthUser(supabaseAdmin, superCred.email, "Demo Super Admin");
    const { error: superErr } = await supabaseAdmin.from("super_admins").upsert({
      id: superId,
      full_name: "Demo Super Admin",
      email: superCred.email,
      role: "super_admin",
      is_active: true,
    });
    if (superErr) throw new Error(superErr.message);

    const ids = {
      admin: await ensureTenantUser(supabaseAdmin, schoolId, "admin"),
      principal: await ensureTenantUser(supabaseAdmin, schoolId, "principal"),
      teacher: await ensureTenantUser(supabaseAdmin, schoolId, "teacher"),
      parent: await ensureTenantUser(supabaseAdmin, schoolId, "parent"),
      student: await ensureTenantUser(supabaseAdmin, schoolId, "student"),
      bursar: await ensureTenantUser(supabaseAdmin, schoolId, "bursar"),
      hq: await ensureTenantUser(supabaseAdmin, schoolId, "hq"),
      driver: await ensureTenantUser(supabaseAdmin, schoolId, "driver"),
    };

    const { data: existingStudents } = await supabaseAdmin
      .from("students")
      .select("id")
      .eq("user_id", ids.student)
      .limit(1);
    let studentId = existingStudents?.[0]?.id as string | undefined;
    if (studentId) {
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
      studentId = data.id as string;
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
      password: DEMO.password,
      schoolName: DEMO.schoolName,
      created,
      accounts: DEMO_CREDENTIALS,
    };
  },
);
