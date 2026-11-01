import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import {
  cleanupLegacyFixture,
  FIXTURE_SKIP_NO_BACKEND,
  provisionLegacyFixture,
  signIn,
  type FixtureTenant,
} from "./helpers";

const supabaseUrl = process.env.SUPABASE_URL ?? "";
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

test.describe("communication inbox tenant isolation", () => {
  test.describe.configure({ mode: "serial" });

  let fixture: FixtureTenant | null = null;
  let admin: SupabaseClient | null = null;
  let memberClient: SupabaseClient | null = null;
  let proposerClient: SupabaseClient | null = null;
  let foreignSchoolId: string | null = null;
  let foreignAuthUserId: string | null = null;
  let foreignMessageId: string | null = null;
  let sharedGuardianId: string | null = null;
  let sharedGuardianMessageId: string | null = null;
  let sharedGuardianInboundId: string | null = null;
  let foreignStudentId: string | null = null;

  test.beforeAll(async () => {
    fixture = await provisionLegacyFixture();
    if (!fixture || !supabaseUrl || !publishableKey || !serviceRoleKey) return;

    admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    memberClient = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    proposerClient = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const tag = randomUUID();
    const school = await admin
      .from("schools")
      .insert({
        name: `Communication isolation ${tag}`,
        slug: `comms-isolation-${tag}`,
        subscription_tier: "starter",
      })
      .select("id")
      .single();
    if (school.error || !school.data) {
      throw new Error(`foreign-school fixture creation failed: ${school.error?.message}`);
    }
    foreignSchoolId = String(school.data.id);

    const sharedGuardian = await admin
      .from("users")
      .select("id")
      .eq("email", fixture.credentials.parent.email)
      .single();
    if (sharedGuardian.error || !sharedGuardian.data) {
      throw new Error(`shared guardian fixture lookup failed: ${sharedGuardian.error?.message}`);
    }
    sharedGuardianId = String(sharedGuardian.data.id);
    const sharedMembership = await admin.from("organization_memberships").insert({
      user_id: sharedGuardianId,
      school_id: foreignSchoolId,
      role: "parent",
      is_primary: false,
      is_active: true,
    });
    if (sharedMembership.error) {
      throw new Error(
        `shared guardian membership fixture failed: ${sharedMembership.error.message}`,
      );
    }

    const email = `comms-${tag}@example.invalid`;
    const created = await admin.auth.admin.createUser({
      email,
      password: randomBytes(24).toString("base64url") + "aA1!",
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      throw new Error(`foreign-user fixture creation failed: ${created.error?.message}`);
    }
    foreignAuthUserId = created.data.user.id;

    const profile = await admin.from("users").insert({
      id: foreignAuthUserId,
      school_id: foreignSchoolId,
      full_name: "Foreign Inbox User",
      email,
      phone: "+2349015056299",
      role: "parent",
    });
    if (profile.error) throw new Error(`foreign-profile fixture failed: ${profile.error.message}`);

    const student = await admin
      .from("students")
      .insert({
        school_id: foreignSchoolId,
        admission_number: `comms-${tag}`,
        parent_id: sharedGuardianId,
      })
      .select("id")
      .single();
    if (student.error || !student.data) {
      throw new Error(`foreign-student fixture failed: ${student.error?.message}`);
    }
    foreignStudentId = String(student.data.id);

    const ownMessage = await admin.from("outbound_messages").insert({
      school_id: fixture.schoolId,
      org_id: fixture.schoolId,
      recipient_user_id: sharedGuardianId,
      channel: "in_app",
      to_address: sharedGuardianId,
      template_code: "communication_scope_test",
      language: "en",
      category: "utility",
      body: "ORG_A_SHARED_GUARDIAN_SENTINEL",
      status: "sent",
      provider: "stub",
      reference: randomUUID(),
      created_by: fixture.authUserIds[0],
    });
    if (ownMessage.error)
      throw new Error(`org A message fixture failed: ${ownMessage.error.message}`);

    const message = await admin
      .from("outbound_messages")
      .insert({
        school_id: foreignSchoolId,
        org_id: foreignSchoolId,
        recipient_user_id: foreignAuthUserId,
        channel: "in_app",
        to_address: foreignAuthUserId,
        template_code: "communication_scope_test",
        language: "en",
        category: "utility",
        body: "ORG_B_ONLY_COMMUNICATION_SENTINEL",
        status: "sent",
        provider: "stub",
        reference: randomUUID(),
        created_by: fixture.authUserIds[0],
      })
      .select("id")
      .single();
    if (message.error || !message.data) {
      throw new Error(`foreign-message fixture failed: ${message.error?.message}`);
    }
    foreignMessageId = String(message.data.id);

    const sharedMessage = await admin
      .from("outbound_messages")
      .insert({
        school_id: foreignSchoolId,
        org_id: foreignSchoolId,
        recipient_user_id: sharedGuardianId,
        channel: "in_app",
        to_address: sharedGuardianId,
        template_code: "communication_scope_test",
        language: "en",
        category: "utility",
        body: "ORG_B_SHARED_GUARDIAN_SENTINEL",
        status: "sent",
        provider: "stub",
        reference: randomUUID(),
        created_by: fixture.authUserIds[0],
      })
      .select("id")
      .single();
    if (sharedMessage.error || !sharedMessage.data) {
      throw new Error(`shared guardian message fixture failed: ${sharedMessage.error?.message}`);
    }
    sharedGuardianMessageId = String(sharedMessage.data.id);

    const sharedInbound = await admin
      .from("inbound_messages")
      .insert({
        school_id: foreignSchoolId,
        org_id: foreignSchoolId,
        sender_user_id: sharedGuardianId,
        channel: "whatsapp",
        from_address: "+2349015056201",
        body: "ORG_B_SHARED_GUARDIAN_INBOUND_SENTINEL",
        provider_ref: randomUUID(),
        action: "logged",
      })
      .select("id")
      .single();
    if (sharedInbound.error || !sharedInbound.data) {
      throw new Error(`shared guardian inbound fixture failed: ${sharedInbound.error?.message}`);
    }
    sharedGuardianInboundId = String(sharedInbound.data.id);

    const template = await admin.from("comms_templates").insert({
      school_id: fixture.schoolId,
      org_id: fixture.schoolId,
      code: "communication_scope_isolation_draft",
      channel: "in_app",
      language: "en",
      category: "utility",
      body: "{{school}}: {{student}}",
      status: "approved",
    });
    if (template.error)
      throw new Error(`proposal template fixture failed: ${template.error.message}`);
  });

  test.afterAll(async () => {
    if (admin && foreignSchoolId) {
      await admin.from("schools").delete().eq("id", foreignSchoolId);
    }
    if (admin && foreignAuthUserId) {
      await admin.auth.admin.deleteUser(foreignAuthUserId);
    }
    await cleanupLegacyFixture(fixture);
  });

  test("the API and inbox never expose another organization's message", async ({ page }) => {
    test.skip(
      !fixture ||
        !memberClient ||
        !foreignMessageId ||
        !sharedGuardianMessageId ||
        !sharedGuardianInboundId,
      FIXTURE_SKIP_NO_BACKEND,
    );

    const signInResult = await memberClient!.auth.signInWithPassword(fixture!.credentials.parent);
    expect(signInResult.error).toBeNull();

    const foreignRead = await memberClient!
      .from("outbound_messages")
      .select("id,org_id,body")
      .eq("id", foreignMessageId!);
    expect(foreignRead.error).toBeNull();
    expect(foreignRead.data).toEqual([]);

    const sharedParentList = await memberClient!
      .from("outbound_messages")
      .select("id,org_id,body")
      .eq("recipient_user_id", sharedGuardianId!)
      .order("created_at", { ascending: false });
    expect(sharedParentList.error).toBeNull();
    expect(sharedParentList.data?.map((row) => row.body)).toContain(
      "ORG_A_SHARED_GUARDIAN_SENTINEL",
    );
    expect(sharedParentList.data?.some((row) => row.id === sharedGuardianMessageId)).toBe(false);
    expect(
      await memberClient!.from("outbound_messages").select("id").eq("id", sharedGuardianMessageId!),
    ).toMatchObject({ data: [], error: null });
    const outboundSearch = await memberClient!
      .from("outbound_messages")
      .select("id,body")
      .ilike("body", "%ORG_B_SHARED_GUARDIAN_SENTINEL%");
    expect(outboundSearch).toMatchObject({ data: [], error: null });

    const inboundList = await memberClient!
      .from("inbound_messages")
      .select("id,org_id,body")
      .eq("sender_user_id", sharedGuardianId!);
    expect(inboundList.error).toBeNull();
    expect(inboundList.data?.some((row) => row.id === sharedGuardianInboundId)).toBe(false);
    const inboundSearch = await memberClient!
      .from("inbound_messages")
      .select("id,body")
      .ilike("body", "%ORG_B_SHARED_GUARDIAN_INBOUND_SENTINEL%");
    expect(inboundSearch).toMatchObject({ data: [], error: null });

    await signIn(page, fixture!.credentials.parent);
    await page.goto("/home/s/communications");
    const inbox = page.getByTestId("communication-inbox");
    await expect(inbox).toBeVisible();
    await expect(inbox).not.toContainText("ORG_B_ONLY_COMMUNICATION_SENTINEL");
    await expect(inbox).not.toContainText("ORG_B_SHARED_GUARDIAN_SENTINEL");
    await expect(inbox).not.toContainText("ORG_B_SHARED_GUARDIAN_INBOUND_SENTINEL");
  });

  test("drafting, replies, and outbox writes fail closed across schools and spoofed numbers", async () => {
    test.skip(
      !fixture || !memberClient || !proposerClient || !foreignStudentId || !sharedGuardianId,
      FIXTURE_SKIP_NO_BACKEND,
    );

    const signedIn = await proposerClient!.auth.signInWithPassword(fixture!.credentials.admin);
    expect(signedIn.error).toBeNull();
    const draft = await proposerClient!.rpc("comms_propose_send", {
      p_org: fixture!.schoolId,
      p_channel: "in_app",
      p_audience: { kind: "guardian_of_student", student_id: foreignStudentId! },
      p_template: "communication_scope_isolation_draft",
      p_vars: { student: "Org B student" },
      p_language: "en",
    });
    expect(draft.error?.message).toContain(
      "audience has no verified contacts in this organization",
    );

    const browserReply = await memberClient!.rpc("comms_route_inbound", {
      p_gateway_number: "+2349015056201",
      p_from: "+2349015056299",
      p_body: "forged org B reply",
      p_provider_ref: randomUUID(),
    });
    expect(browserReply.error).not.toBeNull();

    const spoofedOutbox = await admin!
      .from("outbound_messages")
      .insert({
        school_id: fixture!.schoolId,
        org_id: fixture!.schoolId,
        recipient_user_id: sharedGuardianId!,
        channel: "whatsapp",
        to_address: "+2349015056299",
        template_code: "absence_alert",
        language: "en",
        category: "utility",
        body: "must not dispatch to a spoofed number",
        status: "queued",
        provider: "meta_cloud",
        reference: randomUUID(),
        created_by: fixture!.authUserIds[0],
      })
      .select("id");
    expect(spoofedOutbox.data).toBeNull();
    expect(spoofedOutbox.error?.message).toContain(
      "outbound address does not match the organization member",
    );
  });
});
