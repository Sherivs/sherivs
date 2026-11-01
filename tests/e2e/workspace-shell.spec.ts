import { expect, test } from "@playwright/test";

const EXPECTED_HIDDEN_ITEMS: Record<string, string> = {
  teacher: "Fee collection",
  bursar: "Registers to mark",
  head_of_institution: "My children",
  parent: "Scores to enter",
  regulator_inspector: "Fee collection",
};
const RESPONSIVE_ROLES = new Set([
  "teacher",
  "bursar",
  "head_of_institution",
  "parent",
  "regulator_inspector",
]);

test("renders only each fixture role's workspace and exactly three primary sections", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workspace-preview");
  await expect(page.getByTestId("workspace-preview")).toBeVisible();
  await page.getByLabel("Role fixture").focus();
  await expect(page.getByLabel("Role fixture")).toBeFocused();
  expect(
    await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle),
  ).not.toBe("none");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Search authorized workspace")).toBeFocused();

  const roleOptions = await page
    .getByLabel("Role fixture")
    .locator("option")
    .evaluateAll((options) =>
      options.map((option) => ({
        key: (option as HTMLOptionElement).value,
        label: option.textContent?.trim() ?? "",
      })),
    );
  expect(roleOptions.length).toBeGreaterThan(5);

  for (const role of roleOptions) {
    await page.getByLabel("Role fixture").selectOption(role.key);
    await expect(page.getByRole("heading", { name: `${role.label} workspace` })).toBeVisible();
    const primary = page.getByRole("navigation", { name: "Primary sections" });
    await expect(primary.getByRole("link")).toHaveCount(3);
    await expect(page.getByRole("heading", { name: "Core responsibilities" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Add-on responsibilities" })).toBeVisible();
    const responsibilityCards = page.locator(".workspace-preview-responsibility-card");
    await expect(responsibilityCards.locator("svg")).toHaveCount(await responsibilityCards.count());
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible();
    await expect(page.getByText("Demo reminder", { exact: true })).toBeVisible();
    await expect(page.getByText("Demo attendance view", { exact: true })).toBeVisible();
    const pageEnd = await page.locator(".app-shell-recent-list").evaluate((element) => {
      const documentHeight = document.documentElement.scrollHeight;
      const bottom = element.getBoundingClientRect().bottom + window.scrollY;
      let ancestor: HTMLElement | null = element as HTMLElement;
      while (ancestor && ancestor !== document.body) {
        const style = getComputedStyle(ancestor);
        if (
          (style.overflowY === "hidden" || style.overflowY === "clip") &&
          ancestor.scrollHeight > ancestor.clientHeight
        ) {
          return { bottom, documentHeight, clipped: true };
        }
        ancestor = ancestor.parentElement;
      }
      return { bottom, documentHeight, clipped: false };
    });
    expect(pageEnd.clipped, `${role.label} preview content is clipped`).toBe(false);
    expect(pageEnd.bottom, `${role.label} preview extends beyond the page`).toBeLessThanOrEqual(
      pageEnd.documentHeight,
    );
    const hiddenItem = EXPECTED_HIDDEN_ITEMS[role.key];
    if (hiddenItem) await expect(page.getByText(hiddenItem, { exact: true })).toHaveCount(0);

    const widths = RESPONSIVE_ROLES.has(role.key) ? [320, 390, 768, 1024, 1440] : [390, 1440];
    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
      await expect(primary.getByRole("link")).toHaveCount(3);
      const horizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(horizontalOverflow, `${role.label} overflows at ${width}px`).toBe(false);
      if (width === 390 || width === 1440) {
        await page.screenshot({
          path: testInfo.outputPath(`${role.key}-${width}.png`),
          fullPage: true,
          scale: "css",
        });
      }
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Role fixture").selectOption("teacher");
  await expect(page.getByLabel("Assigned scope")).toBeVisible();
  await expect(page.getByLabel("Assigned scope").locator("option")).toHaveCount(3);
  await page.getByRole("button", { name: "Unread" }).click();
  await expect(page.getByText("Demo reminder", { exact: true })).toBeVisible();
  await expect(page.getByText("Demo update", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await expect(page.getByText("Demo update", { exact: true })).toBeVisible();
  await expect(page.getByText("Demo reminder", { exact: true })).toHaveCount(0);

  await page.getByLabel("Search authorized workspace").fill("fee");
  await expect(page.getByLabel("Authorized search results")).not.toContainText("Fee collection");

  const connection = page.getByTestId("workspace-connection-status");
  await expect(connection).toContainText("Online");
  await page.context().setOffline(true);
  await expect(connection).toContainText("Offline");
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("sherivs:sync-status", { detail: { pendingItems: 3, syncing: true } }),
    );
  });
  await expect(connection).toContainText("3 pending");
  await page.context().setOffline(false);
  await expect(connection).toContainText("Syncing");
});
