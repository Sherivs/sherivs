import { expect, test, type Page } from "@playwright/test";

/**
 * Regression: on ~360-390px phones the Sign in card was pushed right /
 * overflowed horizontally once the 300px Turnstile iframe rendered.
 * Run with VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA (Cloudflare's
 * always-pass test key) so the real widget renders. Works in any Playwright
 * browser project (chromium, webkit, firefox).
 */
const WIDTHS = [320, 360, 375, 390, 414, 768, 1024, 1280];
const SHOT_WIDTHS = new Set((process.env.AUTH_SHOT_WIDTHS ?? "").split(",").filter(Boolean).map(Number));
const SHOT_DIR = process.env.AUTH_SHOT_DIR;

const PAGES: { name: string; path: string; prepare?: (p: Page) => Promise<void> }[] = [
  { name: "signin", path: "/auth" },
  { name: "forgot", path: "/forgot-password" },
  { name: "reset", path: "/reset-password" },
];

async function assertCentred(page: Page, width: number) {
  const m = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="auth-card"]') as HTMLElement | null;
    const r = card?.getBoundingClientRect();
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      clientWidth: document.documentElement.clientWidth,
      left: r?.left ?? NaN,
      right: r?.right ?? NaN,
    };
  });
  expect(m.scrollWidth, `no horizontal scroll at ${width}px`).toBeLessThanOrEqual(m.innerWidth);
  expect(m.left, `card inside viewport at ${width}px`).toBeGreaterThanOrEqual(0);
  expect(m.right).toBeLessThanOrEqual(m.clientWidth + 0.5);
  const leftGap = m.left;
  const rightGap = m.clientWidth - m.right;
  expect(Math.abs(leftGap - rightGap), `card centred at ${width}px (L ${leftGap} / R ${rightGap})`).toBeLessThanOrEqual(2);
}

for (const pg of PAGES) {
  test(`auth card stays centred with Turnstile: ${pg.name}`, async ({ page, browserName }) => {
    test.setTimeout(300_000);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 860 });
      await page.goto(pg.path);
      await page.locator('[data-testid="auth-card"]').waitFor();
      await pg.prepare?.(page);
      if (process.env.VITE_TURNSTILE_SITE_KEY && pg.name !== "reset") {
        await page.locator('[data-testid="turnstile"] iframe').first().waitFor({ timeout: 15_000 }).catch(() => {});
        await page.waitForTimeout(800);
      }
      await assertCentred(page, width);
      if (SHOT_DIR && pg.name === "signin" && SHOT_WIDTHS.has(width)) {
        await page.screenshot({ path: `${SHOT_DIR}/${browserName}-signin-${width}.png`, fullPage: true });
      }
    }
  });
}
