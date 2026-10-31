import { expect, test } from "@playwright/test";

const WORKSPACE_ROLES = [
  { key: "teacher", label: "Teacher", hidden: "Fee collection" },
  { key: "bursar", label: "Bursar", hidden: "Registers to mark" },
  { key: "principal", label: "Principal", hidden: "My children" },
  { key: "parent", label: "Parent", hidden: "Scores to enter" },
  { key: "government-officer", label: "Government officer", hidden: "Fee collection" },
] as const;

test("renders only each fixture role's workspace and exactly three primary sections", async ({
  page,
}, testInfo) => {
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

  for (const role of WORKSPACE_ROLES) {
    await page.getByLabel("Role fixture").selectOption(role.key);
    await expect(page.getByRole("heading", { name: `${role.label} workspace` })).toBeVisible();
    const primary = page.getByRole("navigation", { name: "Primary sections" });
    await expect(primary.getByRole("link")).toHaveCount(3);
    await expect(page.getByRole("heading", { name: "Core responsibilities" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Add-on responsibilities" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible();
    await expect(page.getByText(role.hidden, { exact: true })).toHaveCount(0);
    await expect(page.getByText("Demo reminder", { exact: true })).toBeVisible();

    for (const width of [320, 390, 768, 1024, 1440]) {
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
