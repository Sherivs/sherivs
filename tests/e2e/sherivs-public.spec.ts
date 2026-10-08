/**
 * Sherivs public experience — structural e2e.
 *
 * Runs against the dev server (see playwright.config.ts). Verifies, for every
 * LIVE public route, that the page renders one h1, has no horizontal overflow
 * and raises no console errors; that deferred routes are real 404s; and that
 * operator surfaces are not reachable from the public entry point.
 */
import { expect, test } from "@playwright/test";
import { DEFERRED_PUBLIC_ROUTES, LIVE_PUBLIC_ROUTES } from "../../frontend/src/lib/experience-system/public-routes";

test.describe("Sherivs public routes", () => {
  for (const route of LIVE_PUBLIC_ROUTES) {
    test(`LIVE ${route.path} renders one h1, no overflow, no console errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      await page.goto(route.path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.locator("main#main-content")).toBeVisible();
      const overflow = await page.evaluate(
        () => document.body.scrollWidth - document.body.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
    });
  }

  for (const route of DEFERRED_PUBLIC_ROUTES) {
    test(`DEFERRED ${route.path} is not built (404, not a stub)`, async ({ page }) => {
      await page.goto(route.path);
      await expect(page.getByText(/page not found/i)).toBeVisible();
    });
  }

  test("an unknown platform part and an unknown content kind are 404", async ({ page }) => {
    await page.goto("/platform/does-not-exist");
    await expect(page.getByText(/page not found/i)).toBeVisible();
    await page.goto("/resources/does-not-exist");
    await expect(page.getByText(/page not found/i)).toBeVisible();
  });

  test("the legacy /coregrid path redirects to the Sherivs home", async ({ page }) => {
    await page.goto("/coregrid");
    await expect(page).toHaveURL(/\/$/);
  });

  test("operator surfaces are not public", async ({ page }) => {
    await page.goto("/platform/org");
    await expect(page.getByText(/page not found/i)).toBeVisible();
    for (const path of ["/super-admin/architecture", "/command-centre/provision"]) {
      await page.goto(path);
      await expect(page).not.toHaveURL(new RegExp(`${path}$`));
    }
  });
});

test.describe("Sherivs accessibility basics", () => {
  test("skip link is the first focusable element and targets main", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    await expect(focused).toHaveText(/skip to main content/i);
    await expect(focused).toHaveAttribute("href", "#main-content");
  });

  test("platform menu opens from the keyboard and closes with Escape", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop navigation only");
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Platform menu" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("link", { name: /^Reality/ }).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  });
});
