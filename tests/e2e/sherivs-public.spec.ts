import { expect, test } from "@playwright/test";

/**
 * SHERIVS PUBLIC COMPANY EXPERIENCE — after Lovable prototype removal.
 *
 * A first-time visitor with no account must see the company name and a real
 * sign-in path. The marketing prototype (story sections, demo CTA theatre)
 * is gone; this spec pins the blank canvas so the new site can be built.
 */

test.describe("Sherivs public homepage (plane A)", () => {
  test("shows the company name and a real sign-in path", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/Sherivs/);
    await expect(page.locator("header").first()).toContainText(/sherivs/i);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/sherivs/i);
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/command centre|coregrid/i);
    expect(body).not.toMatch(/phase \d|kernel contract|runtime binding/i);
    expect(body).not.toMatch(/request a demo/i);

    await expect(page.getByRole("link", { name: /sign in/i }).first()).toBeVisible();
  });

  test("sign-in lands on the platform auth surface", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: /sign in/i }).first().click();
    await expect(page).toHaveURL(/\/auth/);
    await expect(page.locator("body")).not.toContainText("Enterprise demo");
    await expect(page.locator("body")).not.toContainText("Sign in as");
  });

  test("former marketing paths redirect to the company root", async ({ page }) => {
    await page.goto("/sherivs");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/sherivs/i);

    await page.goto("/about");
    await expect(page).toHaveURL(/\/$/);
  });

  test("mobile layout: no horizontal overflow at 320px (§19 responsive floor)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/");

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth - doc.clientWidth;
    });
    expect(overflow, "horizontal overflow at 320px").toBeLessThanOrEqual(1);
  });

  test("SEO foundation: canonical URL, description, and semantic headings", async ({ page }) => {
    await page.goto("/");

    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveAttribute("href", /https:\/\/(www\.)?sherivs\.com\/?/);
    expect(await page.locator('meta[name="description"]').getAttribute("content")).toBeTruthy();

    const h1 = await page.getByRole("heading", { level: 1 }).count();
    expect(h1, "exactly one h1").toBe(1);
  });
});
