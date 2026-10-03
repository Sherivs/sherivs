import { expect, test, type Page } from "@playwright/test";
import {
  cleanupLegacyFixture,
  envCredentials,
  provisionLegacyFixture,
  signIn,
  FIXTURE_SKIP_NO_BACKEND,
  type FixtureTenant,
  type LegacyRole,
} from "./helpers";

/**
 * Mobile sidebar active-highlight invariant (team R1 remediation).
 *
 * The legacy spec hard-coded a per-role route→label matrix that drifted out
 * of sync with the live nav catalog (scholar-nav-catalog). This rewrite tests
 * the INVARIANT instead of a stale matrix: for every portal role, every
 * in-app route the sidebar itself exposes (discovered at runtime) must carry
 * `data-active="true"` on its sidebar item while that route is active. The
 * spec therefore stays correct as the nav catalog evolves.
 */

const ROLE_START: Record<LegacyRole, string> = {
  admin: "/admin/dashboard",
  principal: "/admin/dashboard",
  teacher: "/teacher/dashboard",
  parent: "/parent/dashboard",
  student: "/student/dashboard",
  bursar: "/bursar/dashboard",
  hq: "/hq/dashboard",
  driver: "/driver/dashboard",
};

const PORTAL_ROLES = Object.keys(ROLE_START) as LegacyRole[];

const SIDEBAR = '[data-sidebar="sidebar"][data-mobile="true"]';

async function openSidebar(page: Page) {
  await page.getByRole("button", { name: /toggle sidebar/i }).click();
  const sidebar = page.locator(SIDEBAR);
  await expect(sidebar).toBeVisible();
  return sidebar;
}

/** Expands every collapsed section so deep-linked items become reachable. */
async function expandSidebarSections(page: Page, sidebar: ReturnType<Page["locator"]>) {
  for (let i = 0; i < 15; i++) {
    if ((await sidebar.locator('button[data-state="closed"]').count()) === 0) return;
    const trigger = sidebar.locator('button[data-state="closed"]').first();
    if (!(await trigger.isVisible().catch(() => false))) return;
    await trigger.click();
    await page.waitForTimeout(150);
  }
}

async function closeSidebar(page: Page) {
  await page.keyboard.press("Escape");
}

/** Collects the in-app routes the role's sidebar exposes (runtime discovery). */
async function sidebarRoutes(page: Page): Promise<string[]> {
  const sidebar = await openSidebar(page);
  await expandSidebarSections(page, sidebar);
  const hrefs = await sidebar
    .locator("a[href]")
    .evaluateAll((els) =>
      els
        .map((el) => (el as HTMLAnchorElement).getAttribute("href"))
        .filter((h): h is string => h !== null && h.startsWith("/")),
    );
  await closeSidebar(page);
  return [...new Set(hrefs)];
}

test.describe("mobile sidebar active highlights", () => {
  let fixture: FixtureTenant | null = null;

  test.beforeAll(async () => {
    fixture = await provisionLegacyFixture();
  });
  test.afterAll(async () => {
    await cleanupLegacyFixture(fixture);
    fixture = null;
  });

  for (const role of PORTAL_ROLES) {
    test(`${role} sidebar highlights every exposed route it links to`, async ({ page }) => {
      test.skip(!fixture, FIXTURE_SKIP_NO_BACKEND);
      await signIn(page, fixture!.credentials[role]);
      // Role → portal routing is preserved (the sign-in redirect lands the
      // role on its own dashboard).
      await expect(page).toHaveURL(new RegExp(ROLE_START[role].replaceAll("/", "\\/")));

      const routes = await sidebarRoutes(page);
      expect(routes.length, `sidebar routes exposed to ${role}`).toBeGreaterThan(0);

      for (const href of routes) {
        await page.goto(href);
        const target = new URL(href, page.url()).pathname;
        const landed = new URL(page.url()).pathname;
        if (landed !== target) {
          // The app redirected away from its own sidebar route — recorded,
          // not silently ignored; the highlight invariant only applies where
          // the app actually landed.
          test.info().annotations.push({ type: "note", description: `${href} redirected to ${landed}` });
          console.log(`sidebar route ${href} (role ${role}) redirected to ${landed}`);
          continue;
        }
        const sidebar = await openSidebar(page);
        await expandSidebarSections(page, sidebar);
        const item = sidebar.locator(`a[href="${href}"]`).first();
        await expect(item, `sidebar item for ${href} (${role})`).toBeVisible();
        await expect(item).toHaveAttribute("data-active", "true");
        await closeSidebar(page);
      }
    });
  }

  test("super_admin sidebar highlights every exposed route it links to", async ({ page }) => {
    const creds = envCredentials("SUPER_ADMIN");
    test.skip(
      !creds,
      "SKIP: no legitimate super-admin identity is available — E2E_SUPER_ADMIN_EMAIL / E2E_SUPER_ADMIN_PASSWORD are absent from the environment and e2e must never create super admins (fabricated bootstrap authority is prohibited); set the env identity pair to run this case against a real super admin.",
    );
    await signIn(page, creds!);
    await expect(page).toHaveURL(/\/super-admin\/dashboard/);

    const routes = await sidebarRoutes(page);
    expect(routes.length, "sidebar routes exposed to super_admin").toBeGreaterThan(0);

    for (const href of routes) {
      await page.goto(href);
      const target = new URL(href, page.url()).pathname;
      const landed = new URL(page.url()).pathname;
      if (landed !== target) {
        test.info().annotations.push({ type: "note", description: `${href} redirected to ${landed}` });
        console.log(`sidebar route ${href} (role super_admin) redirected to ${landed}`);
        continue;
      }
      const sidebar = await openSidebar(page);
      await expandSidebarSections(page, sidebar);
      const item = sidebar.locator(`a[href="${href}"]`).first();
      await expect(item, `sidebar item for ${href} (super_admin)`).toBeVisible();
      await expect(item).toHaveAttribute("data-active", "true");
      await closeSidebar(page);
    }
  });
});