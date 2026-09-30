import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "Demo@2026!";

const ROLE_CASES = [
  {
    role: "admin",
    email: "admin@demo.school",
    start: "/admin/dashboard",
    routes: [
      ["/admin/dashboard", "Dashboard"],
      ["/admin/students", "Students"],
      ["/admin/admissions", "Admissions"],
      ["/admin/bus-management", "Bus management"],
      ["/admin/buses", "Bus management"],
      ["/admin/intelligence", "CoreGrid Intelligence"],
      ["/admin/health-certificate", "Health certificate"],
      ["/messages", "Messages"],
      ["/notifications", "Notifications"],
    ],
  },
  {
    role: "principal",
    email: "principal@demo.school",
    start: "/admin/dashboard",
    routes: [
      ["/admin/dashboard", "Dashboard"],
      ["/admin/teachers", "Teachers"],
      ["/admin/intelligence-ai", "AI Command"],
      ["/admin/settings", "Settings"],
    ],
  },
  {
    role: "teacher",
    email: "teacher@demo.school",
    start: "/teacher/dashboard",
    routes: [
      ["/teacher/dashboard", "Dashboard"],
      ["/teacher/attendance", "Mark Attendance"],
      ["/teacher/attendance-week", "Weekly attendance"],
      ["/teacher/lesson-plans", "Lesson plans"],
      ["/settings", "Settings"],
    ],
  },
  {
    role: "parent",
    email: "parent@demo.school",
    start: "/parent/dashboard",
    routes: [
      ["/parent/dashboard", "Dashboard"],
      ["/parent/children", "Children"],
      ["/parent/bus-tracking", "Bus tracking"],
      ["/settings", "Settings"],
    ],
  },
  {
    role: "student",
    email: "student@demo.school",
    start: "/student/dashboard",
    routes: [
      ["/student/dashboard", "Dashboard"],
      ["/student/timetable", "Timetable"],
      ["/student/report-card", "Report card"],
      ["/settings", "Settings"],
    ],
  },
  {
    role: "bursar",
    email: "bursar@demo.school",
    start: "/bursar/dashboard",
    routes: [
      ["/bursar/dashboard", "Dashboard"],
      ["/bursar/receipts", "Receipts"],
      ["/bursar/reconciliation", "Reconciliation"],
      ["/admin/fees", "Fees (admin)"],
      ["/settings", "Settings"],
    ],
  },
  {
    role: "hq",
    email: "hq@demo.school",
    start: "/hq/dashboard",
    routes: [
      ["/hq/dashboard", "Dashboard"],
      ["/hq/finance", "Finance"],
      ["/hq/reports", "Reports"],
      ["/settings", "Settings"],
    ],
  },
  {
    role: "driver",
    email: "driver@demo.school",
    start: "/driver/dashboard",
    routes: [
      ["/driver/dashboard", "Dashboard"],
      ["/messages", "Messages"],
      ["/notifications", "Notifications"],
      ["/settings", "Settings"],
    ],
  },
  {
    role: "super_admin",
    email: "super@universalschool.os",
    start: "/super-admin/dashboard",
    routes: [
      ["/super-admin/dashboard", "Dashboard"],
      ["/super-admin/schools", "Schools"],
      ["/super-admin/billing", "Billing"],
      ["/super-admin/platform-config", "Platform config"],
    ],
  },
] as const;

async function provisionDemo(page: Page) {
  await page.goto("/auth");
  await page.getByRole("button", { name: /sign in as enterprise demo/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

async function signIn(page: Page, email: string) {
  await page.goto("/auth");
  const signOut = page.getByRole("button", { name: /sign out/i });
  if (await signOut.isVisible().catch(() => false)) await signOut.click();
  await page.goto("/auth");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /^sign in$/i }).click();
}

async function expectActiveSidebarItem(page: Page, label: string) {
  await page.getByRole("button", { name: /toggle sidebar/i }).click();
  const active = page.locator(`a[aria-label="${label}"][data-active="true"]`);
  await expect(active).toBeVisible();
  await expect(active).toHaveAttribute("data-active", "true");
  await page.keyboard.press("Escape");
}

test.describe("mobile sidebar active highlights", () => {
  test.beforeEach(async ({ page }) => {
    await provisionDemo(page);
  });

  for (const portal of ROLE_CASES) {
    test(`${portal.role} highlights top-level and deep-linked routes`, async ({ page }) => {
      await signIn(page, portal.email);
      await expect(page).toHaveURL(new RegExp(portal.start.replaceAll("/", "\\/")));

      for (const [path, expectedLabel] of portal.routes) {
        await page.goto(path);
        await expectActiveSidebarItem(page, expectedLabel);
      }
    });
  }
});
