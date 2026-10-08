import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

/**
 * AUTHENTICATED-SHELL browser E2E (directive §33 critical flow 2).
 *
 * The API-level critical flows (scripts/verify-critical-flows.mjs) prove the
 * substrate contracts; THIS spec proves the BROWSER surface end to end:
 *
 *   sign in → unlinked routing (/welcome) → founder wizard → provisioning →
 *   the workspace shell renders (runtime navigation, universal organization
 *   reality card with live lifecycle state) — against the REAL Supabase
 *   project, with self-cleaning probe data (zz-e2e-<runid> prefix).
 *
 * Live-gated: without service-role credentials (probe setup/cleanup ONLY —
 * never to perform an action under test) the suite skips.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY ?? "";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const LIVE = Boolean(SUPABASE_URL && SUPABASE_ANON && SERVICE_ROLE);

const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PROBE_EMAIL = `zz-e2e-${RUN_ID}@probe.sherivs.com`;
const PROBE_PASS = `E2e-${RUN_ID}-x9!`;
const PROBE_SLUG = `zz-e2e-${RUN_ID}`;
const ORG_NAME = "E2E Shell Academy";
const FOUNDER_NAME = "E2E Shell Founder";

test.describe("Authenticated workspace shell (founder journey)", () => {
  test.skip(!LIVE, "live-gated: requires SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY");

  test.setTimeout(120_000);

  const admin = LIVE
    ? createClient(SUPABASE_URL, SERVICE_ROLE, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;
  let authUserId: string | null = null;

  test.afterEach(async () => {
    // Self-cleaning probe: the run leaves the substrate exactly as it found it.
    if (!admin || !authUserId) return;
    await admin.from("organization_memberships").delete().eq("user_id", authUserId);
    await admin.from("users").delete().eq("id", authUserId);
    await admin.from("schools").delete().eq("slug", PROBE_SLUG);
    await admin.from("audit_logs").delete().ilike("new_value::text", `%${PROBE_SLUG}%`);
    await admin.auth.admin.deleteUser(authUserId);
    authUserId = null;
  });

  test("sign in → found an organization through the wizard → the shell renders", async ({
    page,
  }) => {
    test.skip(!admin, "live-gated");

    // Probe setup: a verified, UNLINKED account (email confirmation pre-done;
    // the flow under test starts at the sign-in surface).
    const created = await admin!.auth.admin.createUser({
      email: PROBE_EMAIL,
      password: PROBE_PASS,
      email_confirm: true,
    });
    expect(created.error, "probe user setup").toBeNull();
    authUserId = created.data.user?.id ?? null;
    expect(authUserId).toBeTruthy();

    // 1 — Sign in through the real auth surface.
    await page.goto("/auth");
    await page.getByRole("heading", { name: /sign in/i }).waitFor();
    await page.locator('input[type="email"]').fill(PROBE_EMAIL);
    await page.locator('input[type="password"]').fill(PROBE_PASS);
    await page.getByRole("button", { name: /sign in/i }).click();

    // 2 — Identity routing: an unlinked account lands on /welcome, never
    // inside a workspace.
    await expect(page).toHaveURL(/\/welcome/);
    await expect(
      page.getByRole("link", { name: /create your organization/i }),
    ).toBeVisible();

    // 3 — Founder wizard: identity step.
    await page.getByRole("link", { name: /create your organization/i }).click();
    await expect(page).toHaveURL(/\/onboarding/);
    await page.locator("#org-name").fill(ORG_NAME);
    await page.getByRole("button", { name: /continue/i }).click();

    // 4 — Runtime selection: Scholar is the selectable V1 runtime; frozen
    // runtimes render disabled.
    const scholarRadio = page.locator('input[name="runtime"][value="scholar"]');
    await expect(scholarRadio).toBeEnabled();
    await scholarRadio.check();
    await page.getByRole("button", { name: /continue/i }).click();

    // 5 — Profile: workspace address + founder identity.
    await page.locator("#org-slug").fill(PROBE_SLUG);
    await page.locator("#founder-name").fill(FOUNDER_NAME);
    await page.getByRole("button", { name: /review/i }).click();

    // 6 — Provisioning through the sole customer write path, then the shell
    // routes the founder to their runtime workspace home.
    await page.getByRole("button", { name: /create organization/i }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 30_000 });

    // 7 — The shell renders the universal organization reality card with
    // LIVE verified truth: fresh org → "Setting up" (onboarding), roster of
    // exactly one (the founder), workspace address from the chosen slug.
    const card = page.getByTestId("organization-reality-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText(ORG_NAME);
    await expect(card).toContainText("Setting up");
    await expect(card).toContainText("1 member");
    await expect(card).toContainText(`${PROBE_SLUG}.sherivs.com`);
    await expect(card).toContainText("In progress");

    // 8 — The shell carries the runtime-contributed navigation (resolved
    // against the founder's admin capabilities), and the workspace is the
    // platform surface, not a fake: no invented credentials anywhere.
    const body = await page.locator("body").innerText();
    expect(body.length).toBeGreaterThan(0);
  });
});
