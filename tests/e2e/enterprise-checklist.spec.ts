import { expect, test } from "@playwright/test";
import {
  cleanupLegacyFixture,
  provisionLegacyFixture,
  signIn,
  FIXTURE_SKIP_NO_BACKEND,
  type FixtureTenant,
} from "./helpers";

test.describe("Enterprise checklist", () => {
  let fixture: FixtureTenant | null = null;

  test.beforeAll(async () => {
    fixture = await provisionLegacyFixture();
  });
  test.afterAll(async () => {
    await cleanupLegacyFixture(fixture);
    fixture = null;
  });

  test("every module is unlocked and links open the correct page", async ({ page }) => {
    test.skip(!fixture, FIXTURE_SKIP_NO_BACKEND);
    // 24 real page navigations over a dev server in mobile emulation — the
    // default 60s budget only barely fits when run standalone.
    test.setTimeout(180_000);
    await signIn(page, fixture!.credentials.admin);
    await page.goto("/admin/enterprise-checklist");
    await expect(page.getByRole("heading", { name: /enterprise checklist/i })).toBeVisible();

    // No Locked entries under enterprise
    const locked = page.getByText(/^Locked$/);
    await expect(locked).toHaveCount(0);

    const openLinks = page.getByRole("link", { name: /^Open$/ });
    const count = await openLinks.count();
    expect(count).toBeGreaterThan(0);

    // Assert every checklist link resolves to a non-404 route
    for (let i = 0; i < count; i++) {
      const link = openLinks.nth(i);
      const href = await link.getAttribute("href");
      expect(href, "checklist link href").toBeTruthy();
      await page.goto(href!);
      await expect(page.locator("text=/not.?found/i")).toHaveCount(0);
      await page.goto("/admin/enterprise-checklist");
    }
  });
});