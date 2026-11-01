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
  let foreignSchoolId: string | null = null;
  let foreignAuthUserId: string | null = null;
  let foreignMessageId: string | null = null;

  test.beforeAll(async () => {
    fixture = await provisionLegacyFixture();
    if (!fixture || !supabaseUrl || !publishableKey || !serviceRoleKey) return;

    admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    memberClient = createClient(supabaseUrl, publishableKey, {
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
      role: "parent",
    });
    if (profile.error) throw new Error(`foreign-profile fixture failed: ${profile.error.message}`);

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
    test.skip(!fixture || !memberClient || !foreignMessageId, FIXTURE_SKIP_NO_BACKEND);

    const signInResult = await memberClient!.auth.signInWithPassword(fixture!.credentials.parent);
    expect(signInResult.error).toBeNull();

    const foreignRead = await memberClient!
      .from("outbound_messages")
      .select("id,org_id,body")
      .eq("id", foreignMessageId!);
    expect(foreignRead.error).toBeNull();
    expect(foreignRead.data).toEqual([]);

    await signIn(page, fixture!.credentials.parent);
    await page.goto("/home/s/communications");
    const inbox = page.getByTestId("communication-inbox");
    await expect(inbox).toBeVisible();
    await expect(inbox).not.toContainText("ORG_B_ONLY_COMMUNICATION_SENTINEL");
  });
});
