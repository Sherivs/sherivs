import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SCREENSHOT_DIR = process.env.CONSOLE_SCREENSHOT_DIR ?? "test-results/console-shell";

test("console shell remains responsive and keyboard accessible", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "This test sets and checks all required viewport sizes itself.",
  );

  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  const analyticsBanner = page.getByTestId("analytics-consent");
  if (await analyticsBanner.isVisible().catch(() => false)) {
    await analyticsBanner.getByRole("button", { name: "No thanks" }).click();
  }
  await expect(page.getByTestId("console-role-simulation")).toBeVisible();
  await page.getByTestId("console-visual-fixture").click();
  await expect(page.getByTestId("internal-console")).toBeVisible();

  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    }));
    expect(dimensions.document, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(
      dimensions.viewport,
    );

    if (width === 390 || width === 1440) {
      await page.screenshot({
        path: join(
          SCREENSHOT_DIR,
          width === 390 ? "console-mobile-390.png" : "console-desktop-1440.png",
        ),
        animations: "disabled",
      });
    }
  }

  await page.setViewportSize({ width: 320, height: 844 });
  const workspaceButtonAt320 = page.getByRole("button", { name: /^Switch workspace/ });
  await workspaceButtonAt320.click();
  const workspacePanel = await page
    .getByRole("navigation", { name: "Authorized workspaces" })
    .boundingBox();
  expect(workspacePanel).not.toBeNull();
  expect(workspacePanel!.x).toBeGreaterThanOrEqual(0);
  expect(workspacePanel!.x + workspacePanel!.width).toBeLessThanOrEqual(320);
  await page.keyboard.press("Escape");

  const runtimeButtonAt320 = page.getByRole("button", { name: /^Switch runtime/ });
  await runtimeButtonAt320.click();
  const runtimePanel = await page
    .getByRole("navigation", { name: "Operational runtimes" })
    .boundingBox();
  expect(runtimePanel).not.toBeNull();
  expect(runtimePanel!.x).toBeGreaterThanOrEqual(0);
  expect(runtimePanel!.x + runtimePanel!.width).toBeLessThanOrEqual(320);
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 390, height: 844 });
  const menuButton = page.locator(".sherivs-console-menu");
  await menuButton.focus();
  await page.keyboard.press("Enter");
  await expect(menuButton).toHaveAttribute("aria-expanded", "true");
  const firstNavigationLink = page.locator("#console-navigation nav a").first();
  await expect(firstNavigationLink).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menuButton).toHaveAttribute("aria-expanded", "false");
  await expect(menuButton).toBeFocused();

  const workspaceButton = page.getByRole("button", { name: /^Switch workspace/ });
  await workspaceButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("navigation", { name: "Authorized workspaces" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(workspaceButton).toHaveAttribute("aria-expanded", "false");
  await expect(workspaceButton).toBeFocused();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const animationName = await page
    .locator(".sherivs-console-orb")
    .first()
    .evaluate((orb) => getComputedStyle(orb).animationName);
  expect(animationName).toBe("none");
});
