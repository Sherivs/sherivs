import { expect, test } from "@playwright/test";
import { provisionDemo, signIn } from "./helpers";

test.describe("Enterprise checklist", () => {
  test.beforeEach(async ({ page }) => {
    await provisionDemo(page);
    await signIn(page, "admin@demo.school");
  });

  test("every module is unlocked and links open the correct page", async ({ page }) => {
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
