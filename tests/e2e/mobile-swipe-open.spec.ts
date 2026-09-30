import { expect, test } from "@playwright/test";
import { provisionDemo, signIn, edgeSwipeOpen } from "./helpers";

const PAGES = [
  "/admin/dashboard",
  "/admin/students",
  "/admin/cms",
  "/admin/bus-management",
  "/messages",
  "/notifications",
  "/settings",
];

test.describe("Left-edge swipe opens the sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await provisionDemo(page);
    await signIn(page, "admin@demo.school");
  });

  test("swipe opens sidebar on every page and keeps working after navigation", async ({ page }) => {
    for (const path of PAGES) {
      await page.goto(path);
      // Ensure sidebar is closed to start.
      await page.keyboard.press("Escape").catch(() => {});
      await edgeSwipeOpen(page);
      const sheet = page.locator('[data-mobile="true"][data-state="open"]').first();
      await expect(sheet, `sidebar sheet on ${path}`).toBeVisible({ timeout: 2000 });
      await page.keyboard.press("Escape");
    }
  });
});
