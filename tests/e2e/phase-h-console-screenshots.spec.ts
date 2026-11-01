import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const ARTIFACTS = process.env.CONSOLE_WALKTHROUGH_DIR ?? "/opt/cursor/artifacts";

test("captures the synthetic Internal Console at desktop and mobile widths", async ({ page }) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  await page.goto("/auth", { waitUntil: "domcontentloaded" });

  const consent = page.getByTestId("analytics-consent");
  if (await consent.isVisible().catch(() => false)) {
    await consent.getByRole("button", { name: "No thanks" }).click();
  }
  await expect(page.getByTestId("console-role-simulation")).toBeVisible();
  await page.getByTestId("console-visual-fixture").click();
  await expect(page.getByTestId("internal-console")).toBeVisible();
  await expect(page.getByTestId("console-home")).toContainText("Amina Okonkwo");
  await page.evaluate(() => document.fonts.ready);

  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({
      path: join(ARTIFACTS, `console_role_platform_owner_home_${width}.png`),
      animations: "disabled",
    });
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(documentWidth, `console overflows at ${width}px`).toBeLessThanOrEqual(width);
  }
});
