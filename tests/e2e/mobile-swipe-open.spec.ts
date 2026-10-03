import { expect, test } from "@playwright/test";
import {
  cleanupLegacyFixture,
  edgeSwipeOpen,
  provisionLegacyFixture,
  signIn,
  FIXTURE_SKIP_NO_BACKEND,
  type FixtureTenant,
} from "./helpers";

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
  let fixture: FixtureTenant | null = null;

  test.beforeAll(async () => {
    fixture = await provisionLegacyFixture();
  });
  test.afterAll(async () => {
    await cleanupLegacyFixture(fixture);
    fixture = null;
  });

  test("swipe opens sidebar on every page and keeps working after navigation", async ({ page }) => {
    test.skip(!fixture, FIXTURE_SKIP_NO_BACKEND);
    await signIn(page, fixture!.credentials.admin);
    const sheet = page.locator('[data-mobile="true"][data-state="open"]').first();
    for (const path of PAGES) {
      await page.goto(path);
      // Ensure sidebar is closed to start.
      await page.keyboard.press("Escape").catch(() => {});
      // A freshly-navigated page may still be hydrating (gesture listeners
      // attach in a React effect), so the same edge-swipe gesture is repeated
      // until the app can receive it — the assertion below still requires the
      // real sidebar sheet to open.
      let opened = false;
      for (let attempt = 0; attempt < 10 && !opened; attempt++) {
        await edgeSwipeOpen(page);
        opened = await sheet.isVisible().catch(() => false);
        if (!opened) await page.waitForTimeout(400);
      }
      await expect(sheet, `sidebar sheet on ${path}`).toBeVisible({ timeout: 2000 });
      await page.keyboard.press("Escape");
    }
  });
});