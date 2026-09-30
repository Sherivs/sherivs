import { expect, type Page } from "@playwright/test";

export const PASSWORD = "Demo@2026!";

export async function provisionDemo(page: Page) {
  await page.goto("/auth");
  await page.getByRole("button", { name: /sign in as enterprise demo/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

export async function signIn(page: Page, email: string) {
  await page.goto("/auth");
  const signOut = page.getByRole("button", { name: /sign out/i });
  if (await signOut.isVisible().catch(() => false)) await signOut.click();
  await page.goto("/auth");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /^sign in$/i }).click();
}

/** Simulate an edge-swipe from the left to open the sidebar. */
export async function edgeSwipeOpen(page: Page) {
  const box = page.viewportSize() ?? { width: 400, height: 800 };
  const y = Math.floor(box.height / 2);
  await page.touchscreen.tap(5, y).catch(() => {});
  await page.evaluate(
    ({ y }) => {
      const fire = (type: string, x: number) => {
        const t = new Touch({ identifier: 1, target: document.body, clientX: x, clientY: y });
        const ev = new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          touches: type === "touchend" ? [] : [t],
          targetTouches: type === "touchend" ? [] : [t],
          changedTouches: [t],
        });
        window.dispatchEvent(ev);
      };
      fire("touchstart", 5);
      fire("touchend", 120);
    },
    { y },
  );
}
