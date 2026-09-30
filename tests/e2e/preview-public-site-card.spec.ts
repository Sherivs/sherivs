import { expect, test } from "@playwright/test";
import { provisionDemo, signIn } from "./helpers";

const DASHBOARDS = [
  { email: "admin@demo.school", path: "/admin/dashboard" },
  { email: "teacher@demo.school", path: "/teacher/dashboard" },
  { email: "student@demo.school", path: "/student/dashboard" },
  { email: "parent@demo.school", path: "/parent/dashboard" },
  { email: "bursar@demo.school", path: "/bursar/dashboard" },
  { email: "hq@demo.school", path: "/hq/dashboard" },
  { email: "driver@demo.school", path: "/driver/dashboard" },
];

test.describe("Preview public site card", () => {
  test.beforeEach(async ({ page }) => {
    await provisionDemo(page);
  });

  for (const d of DASHBOARDS) {
    test(`renders on ${d.path} and links to /?school=`, async ({ page, context }) => {
      await signIn(page, d.email);
      await page.goto(d.path);
      const card = page.getByRole("link", { name: /preview public site/i }).first();
      await expect(card).toBeVisible();
      const href = await card.getAttribute("href");
      expect(href).toMatch(/^\/\?school=/);

      // reload preserves the card
      await page.reload();
      await expect(page.getByRole("link", { name: /preview public site/i }).first()).toBeVisible();

      // navigating away and back preserves the card
      await page.goto("/settings");
      await page.goto(d.path);
      const again = page.getByRole("link", { name: /preview public site/i }).first();
      await expect(again).toBeVisible();

      // it opens the public site with a school in a new tab
      const [popup] = await Promise.all([context.waitForEvent("page"), again.click()]);
      await popup.waitForLoadState("domcontentloaded");
      expect(popup.url()).toContain("?school=");
      await popup.close();
    });
  }
});
