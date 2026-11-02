import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Local V1 Internal Console role simulation. Requires:
 *   VITE_CONSOLE_VISUAL_FIXTURE=1
 *   VITE_SHERIVS_HOST_KIND_OVERRIDE=internal
 * Production hostnames never activate this path.
 */

const ARTIFACTS = process.env.CONSOLE_WALKTHROUGH_DIR ?? "/opt/cursor/artifacts";
const MAX_LINKS_PER_ROLE = 50;

const ROLES = [
  { key: "platform_owner", title: "Platform Owner", name: "Amina Okonkwo" },
  { key: "platform_admin", title: "Platform Administrator", name: "Chidi Nwosu" },
  { key: "operations", title: "Operations Administrator", name: "Fatima Bello" },
  { key: "engineering", title: "Engineer", name: "Ifeanyi Eze" },
  { key: "support", title: "Support Specialist", name: "Ngozi Adeyemi" },
  { key: "security", title: "Security", name: "Tunde Bakare" },
  { key: "finance", title: "Finance", name: "Kemi Oladipo" },
  { key: "sales", title: "Sales", name: "Yusuf Ibrahim" },
] as const;

const V1_ROLE_WORKSPACES: Record<string, { key: string; name: string }> = {
  platform_owner: { key: "platform_operations", name: "Platform Operations" },
  platform_admin: { key: "platform_administration", name: "Platform Administration" },
  operations: { key: "operations", name: "Operations" },
  engineering: { key: "engineering", name: "Engineering" },
  support: { key: "support", name: "Support" },
};

test.use({
  viewport: { width: 1280, height: 800 },
  isMobile: false,
  hasTouch: false,
  video: { mode: "on", size: { width: 1280, height: 800 } },
});

test.describe.configure({ timeout: 240_000 });

async function dismissAnalytics(page: Page) {
  const banner = page.getByTestId("analytics-consent");
  if (await banner.isVisible().catch(() => false)) {
    await banner.getByRole("button", { name: "No thanks" }).click();
  }
}

async function collectConsoleHrefs(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="internal-console"]');
    if (!root) return [];
    const nodes = [...root.querySelectorAll<HTMLAnchorElement>("a[href]")];
    const unique = new Map<string, string>();
    for (const node of nodes) {
      const href = node.getAttribute("href") ?? "";
      if (!href.startsWith("/console")) continue;
      if (href.startsWith("http")) continue;
      if (!unique.has(href)) unique.set(href, (node.textContent ?? href).trim().slice(0, 80));
    }
    return [...unique.entries()].map(([href, title]) => ({ href, title }));
  });
}

async function pageFault(page: Page) {
  const missing = await page
    .locator("h2", { hasText: "Page not found" })
    .isVisible()
    .catch(() => false);
  const crashed = await page
    .locator("h1", { hasText: "Something went wrong" })
    .isVisible()
    .catch(() => false);
  const hostDenied = await page
    .getByTestId("console-not-authorised")
    .isVisible()
    .catch(() => false);
  const limited = await page
    .locator("p", { hasText: "Organization records are limited to authorized operators." })
    .isVisible()
    .catch(() => false);
  if (missing) return "404";
  if (crashed) return "error boundary";
  if (hostDenied) return "not authorised host";
  if (limited) return "unauthorized organization page leaked into this role";
  return null;
}

test("signs into every V1 console role and clicks visible console links", async ({
  page,
}, testInfo) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const report: Array<{
    role: string;
    signedIn: boolean;
    heading: string | null;
    homeHasOrgPipeline: boolean;
    chrome: Array<{ name: string; ok: boolean; error?: string }>;
    links: Array<{ href: string; ok: boolean; title: string; error?: string }>;
  }> = [];

  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await dismissAnalytics(page);
  await expect(page.getByTestId("console-role-simulation")).toBeVisible({ timeout: 20_000 });
  for (const role of ROLES) {
    await expect(page.getByRole("button", { name: `Continue as ${role.title}` })).toBeVisible();
  }
  await page.screenshot({ path: join(ARTIFACTS, "console_auth_role_simulation.png") });

  await page.getByTestId("console-visual-fixture").click();
  await expect(page.getByTestId("internal-console")).toBeVisible({ timeout: 20_000 });

  for (const role of ROLES) {
    if (role.key !== "platform_owner") {
      await page.getByTestId("console-fixture-role-switcher").selectOption(role.key);
    }
    await expect(page.getByTestId("console-fixture-role-switcher")).toHaveValue(role.key, {
      timeout: 10_000,
    });
    await page.locator('.sherivs-console-nav a[href="/console"]').first().click();
    await expect(page.getByTestId("console-home")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("console-home")).toContainText(role.name);

    const workspace = V1_ROLE_WORKSPACES[role.key];
    if (workspace) {
      const workspaceLink = page
        .locator('a[href^="/console/workspaces/"]')
        .filter({ hasText: workspace.name })
        .first();
      await expect(workspaceLink).toBeVisible();
      await workspaceLink.click();
      await expect(page.getByTestId(`console-workspace-${workspace.key}`)).toBeVisible();
      if (workspace.key === "platform_administration") {
        await expect(page.getByTestId(`console-workspace-${workspace.key}`)).toContainText(
          "cannot grant super-admin privileges",
        );
      }
      if (workspace.key === "engineering") {
        await expect(page.getByTestId(`console-workspace-${workspace.key}`)).toContainText(
          "does not invent log rows or expose secrets",
        );
      }
      if (workspace.key === "support") {
        await expect(page.getByTestId(`console-workspace-${workspace.key}`)).toContainText(
          "Student records, fees, and biometric data are not available here.",
        );
        await page.locator('.sherivs-console-nav a[href="/console/organizations"]').first().click();
        const organizations = page.getByTestId("console-organizations");
        await expect(organizations).toBeVisible();
        await expect(organizations).toContainText("Riverside School");
        await expect(organizations).not.toContainText("Harbour Academy");
        await expect(organizations).not.toContainText("Sahel College");
      }
      await page.locator('.sherivs-console-nav a[href="/console"]').first().click();
      await expect(page.getByTestId("console-home")).toBeVisible();
    }

    const personalWorkspaceLink = page
      .locator('a[href^="/console/workspaces/"]')
      .filter({ hasText: "My Workspace" })
      .first();
    await expect(personalWorkspaceLink).toBeVisible();
    await personalWorkspaceLink.click();
    await expect(page.getByTestId("console-workspace-personal")).toBeVisible();
    await page.locator('.sherivs-console-nav a[href="/console"]').first().click();
    await expect(page.getByTestId("console-home")).toBeVisible();

    const heading =
      (
        await page
          .locator("h1")
          .first()
          .textContent()
          .catch(() => null)
      )?.trim() ?? null;
    const homeHasOrgPipeline = await page
      .getByTestId("console-org-pipeline")
      .isVisible()
      .catch(() => false);
    await page.screenshot({ path: join(ARTIFACTS, `console_role_${role.key}_home.png`) });

    const chrome: Array<{ name: string; ok: boolean; error?: string }> = [];
    try {
      await page.getByRole("button", { name: "Collapse sidebar" }).click();
      await page.getByRole("button", { name: "Expand sidebar" }).click();
      chrome.push({ name: "sidebar collapse/expand", ok: true });
    } catch (err) {
      chrome.push({
        name: "sidebar collapse/expand",
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    try {
      await page.getByRole("button", { name: "Help" }).click();
      await expect(page.getByTestId("internal-console")).toBeVisible({ timeout: 8_000 });
      const fault = await pageFault(page);
      chrome.push({ name: "header help", ok: !fault, error: fault ?? undefined });
    } catch (err) {
      chrome.push({
        name: "header help",
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    try {
      await page.getByRole("button", { name: "Account menu" }).click();
      await page.locator("header .sherivs-console-search-panel a[href='/console/account']").click();
      await expect(page.getByTestId("internal-console")).toBeVisible({ timeout: 8_000 });
      const fault = await pageFault(page);
      chrome.push({ name: "account menu", ok: !fault, error: fault ?? undefined });
    } catch (err) {
      chrome.push({
        name: "account menu",
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await page.locator('.sherivs-console-nav a[href="/console"]').first().click();
    await expect(page.getByTestId("console-home")).toBeVisible({ timeout: 8_000 });

    const visited = new Set<string>();
    const queue = await collectConsoleHrefs(page);
    const linkResults: Array<{ href: string; ok: boolean; title: string; error?: string }> = [];

    while (queue.length && visited.size < MAX_LINKS_PER_ROLE) {
      const link = queue.shift();
      if (!link || visited.has(link.href)) continue;
      visited.add(link.href);
      try {
        const nav = page.locator(`.sherivs-console-nav a[href="${link.href}"]`).first();
        if (await nav.count()) {
          await nav.click();
        } else {
          const main = page
            .locator(`[data-testid="internal-console"] a[href="${link.href}"]`)
            .first();
          if (await main.count()) {
            await main.click();
          } else {
            await page.goto(link.href, { waitUntil: "domcontentloaded" });
          }
        }
        await expect(page.getByTestId("internal-console")).toBeVisible({ timeout: 8_000 });
        const fault = await pageFault(page);
        linkResults.push({
          href: link.href,
          title: link.title,
          ok: !fault,
          error: fault ?? undefined,
        });
        if (!fault) {
          for (const found of await collectConsoleHrefs(page)) {
            if (!visited.has(found.href) && !queue.some((item) => item.href === found.href)) {
              queue.push(found);
            }
          }
        }
      } catch (err) {
        linkResults.push({
          href: link.href,
          title: link.title,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    report.push({
      role: role.title,
      signedIn: true,
      heading,
      homeHasOrgPipeline,
      chrome,
      links: linkResults,
    });
  }

  writeFileSync(join(ARTIFACTS, "console_role_click_audit.json"), JSON.stringify(report, null, 2));
  const broken = [
    ...report.flatMap((row) =>
      row.chrome
        .filter((item) => !item.ok)
        .map((item) => `${row.role} chrome:${item.name} ${item.error}`),
    ),
    ...report.flatMap((row) =>
      row.links.filter((link) => !link.ok).map((link) => `${row.role} ${link.href} ${link.error}`),
    ),
  ];
  expect(broken, broken.join("\n")).toEqual([]);
  expect(report).toHaveLength(ROLES.length);
  const owner = report.find((row) => row.role === "Platform Owner");
  const engineer = report.find((row) => row.role === "Engineer");
  const support = report.find((row) => row.role === "Support Specialist");
  const finance = report.find((row) => row.role === "Finance");
  expect(owner?.homeHasOrgPipeline).toBe(true);
  expect(engineer?.homeHasOrgPipeline).toBe(false);
  expect(support?.homeHasOrgPipeline).toBe(false);
  expect(finance?.homeHasOrgPipeline).toBe(false);

  const video = testInfo.attachments.find((item) => item.name === "video");
  if (video?.path) {
    writeFileSync(join(ARTIFACTS, "console_role_simulation_video_path.txt"), video.path);
  }
});
