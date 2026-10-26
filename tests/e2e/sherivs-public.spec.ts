import { expect, test } from "@playwright/test";

/**
 * SHERIVS PUBLIC COMPANY EXPERIENCE — critical-flow E2E (directive §33
 * critical flow 1; refoundation §7/§8 acceptance test).
 *
 * A first-time visitor with no account, on mobile viewport (the config's
 * default device), must be able to answer: what is Sherivs, who is it for,
 * what does it do, and how do I engage — within the first screen.
 *
 * This spec runs against the local dev server the Playwright config boots
 * (no backend writes, no fixtures).
 */

test.describe("Sherivs public homepage (plane A)", () => {
  test("communicates the company, the category and the engagement path on the first screen", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/Sherivs — Intelligence infrastructure for a more connected world/);

    // The brand and the category are both present on the first screen: the
    // header carries the company name, the hero carries the category — never
    // a runtime name, never internal architecture.
    await expect(page.locator("header").first()).toContainText(/sherivs/i);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /intelligence layer for a world that works together/i,
    );
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/command centre|coregrid/i);
    expect(body).not.toMatch(/phase \d|kernel contract|runtime binding/i);

    // Primary and secondary CTAs are reachable from the hero.
    await expect(page.getByRole("link", { name: /request a demo/i }).first()).toBeVisible();
  });

  test("navigation exposes the platform story and sign-in — no Scholar authentication surface", async ({
    page,
  }) => {
    await page.goto("/");

    const nav = page.locator("header, nav").first();
    await expect(nav.getByRole("link", { name: /sign in/i }).first()).toBeVisible();

    // The sign-in link lands on the platform auth surface.
    await page.getByRole("link", { name: /sign in/i }).first().click();
    await expect(page).toHaveURL(/\/auth/);
    await expect(page.locator("body")).not.toContainText("Enterprise demo");
    await expect(page.locator("body")).not.toContainText("Sign in as");
  });

  test("the engagement path flows: homepage → request a demo", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /request a demo/i }).first().click();
    await expect(page).toHaveURL(/\/request-demo/);
    await expect(page.getByRole("heading", { name: /request a demo|see sherivs/i })).toBeVisible();
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
