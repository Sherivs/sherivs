import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const SCREENSHOTS = process.env.OFFLINE_SCREENSHOT_DIR ?? "/tmp/coregrid-offline-screenshots";

test("Data Saver remains usable on a throttled Slow 3G profile", async ({ page }, testInfo) => {
  await page.goto("/workspace-preview", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("workspace-preview")).toBeVisible();

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    downloadThroughput: (400 * 1024) / 8,
    uploadThroughput: (50 * 1024) / 8,
    latency: 400,
    connectionType: "cellular3g",
  });

  const startedAt = Date.now();
  await page.getByTestId("data-saver-toggle").click();
  await expect(page.getByTestId("data-saver-toggle")).toHaveAttribute("aria-pressed", "true");

  const mediaSettings = await page.getByTestId("workspace-preview").evaluate(async (root) => {
    const image = document.createElement("img");
    const video = document.createElement("video");
    video.autoplay = true;
    root.append(image, video);
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    return {
      dataSaver: document.documentElement.dataset.dataSaver,
      imageLoading: image.loading,
      imageDecoding: image.decoding,
      videoAutoplay: video.autoplay,
      videoPreload: video.preload,
    };
  });
  expect(mediaSettings).toEqual({
    dataSaver: "true",
    imageLoading: "lazy",
    imageDecoding: "async",
    videoAutoplay: false,
    videoPreload: "none",
  });

  const width = page.viewportSize()?.width ?? 0;
  mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: join(SCREENSHOTS, `workspace-data-saver-${width}.png`),
    fullPage: true,
  });

  await page.context().setOffline(true);
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("sherivs:sync-status", {
        detail: { pendingItems: 3, conflictItems: 1, syncing: false },
      }),
    );
  });
  const connection = page.getByTestId("workspace-connection-status");
  await expect(connection).toContainText("Offline");
  await expect(connection).toContainText("3 pending · 1 need review");
  await page.screenshot({
    path: join(SCREENSHOTS, `workspace-pending-conflict-${width}.png`),
    fullPage: true,
  });

  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("sherivs:sync-status", {
        detail: { pendingItems: 0, conflictItems: 0, syncing: false },
      }),
    );
  });
  await expect(connection).toContainText("0 pending");
  await expect(page.getByRole("heading", { name: "teacher workspace" })).toBeVisible();
  await expect(page.getByText("Demo reminder", { exact: true })).toBeVisible();
  await page.screenshot({
    path: join(SCREENSHOTS, `workspace-offline-view-${width}.png`),
    fullPage: true,
  });

  const resources = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((entry) => entry.name.includes(".js"))
      .reduce(
        (total, entry) => total + ((entry as PerformanceResourceTiming).transferSize ?? 0),
        0,
      ),
  );
  await testInfo.attach("slow-3g-throughput.json", {
    body: Buffer.from(
      JSON.stringify({
        profile: "Slow 3G (400 kbps down / 50 kbps up, 400 ms RTT)",
        elapsedMs: Date.now() - startedAt,
        javascriptTransferBytes: resources,
      }),
    ),
    contentType: "application/json",
  });

  await page.context().setOffline(false);
  await cdp.detach();
});
