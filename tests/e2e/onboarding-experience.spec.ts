import { expect, test } from "@playwright/test";

/**
 * M008 — /onboarding is an organization-administrator request.
 * Submit opens a mailto draft. The page must not claim the request was sent.
 */
const WIDTHS = [320, 360, 390, 430, 768, 1024, 1440];

test.describe("onboarding experience", () => {
  test("shows the owner copy, field labels, and an honest mailto outcome", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/onboarding");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Bring your school into Sherivs.",
    );
    await expect(page.getByRole("heading", { name: "What happens next" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Organization details" })).toBeVisible();
    await expect(page.getByLabel("Organization name")).toBeVisible();
    await expect(page.getByLabel("Full name")).toBeVisible();
    await expect(page.getByLabel("Work email")).toBeVisible();
    await expect(page.getByLabel(/Role or title/)).toBeVisible();
    await expect(page.getByLabel("Message")).toBeVisible();
    await expect(page.getByRole("button", { name: "Request administrator access" })).toBeVisible();
    await expect(
      page.getByText(/This opens your email app with a draft to hello@sherivs.com/),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("submitted successfully");

    await page.getByRole("button", { name: "Request administrator access" }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page.locator("#onboarding-organization")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#onboarding-organization")).toHaveAttribute(
      "aria-describedby",
      "onboarding-organization-error",
    );
    await expect(page.locator("#onboarding-organization-error")).toHaveText(
      "Enter the organization name.",
    );

    await page.getByLabel("Organization name").fill("Northwind");
    await page.getByLabel("Full name").fill("Ada Lovelace");
    await page.getByLabel("Work email").fill("ada@northwind.edu");
    await page.getByLabel("Message").fill("Please provision an administrator account.");
    await page.getByLabel(/opens my email app/).check();
    await page.getByRole("button", { name: "Request administrator access" }).click();

    const status = page.getByRole("status");
    await expect(status).toContainText("Nothing has been submitted until you send that message.");
    await expect(status).toContainText("hello@sherivs.com");
    await expect(status).not.toContainText(/submitted successfully|ticket was created/i);
  });

  test("does not overflow horizontally at the verified widths", async ({ page }) => {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/onboarding");
      await expect(page.getByTestId("onboarding-first-field")).toBeVisible();
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return doc.scrollWidth - doc.clientWidth;
      });
      expect(overflow, `horizontal overflow at ${width}px`).toBe(0);
    }
  });
});
