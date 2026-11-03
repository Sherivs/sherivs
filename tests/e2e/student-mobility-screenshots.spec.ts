import { expect, test, type Page, type Route } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const API_URL = "https://synthetic.supabase.test";
const SCHOOL_ID = "b2000000-0000-4000-8000-000000000001";
const ADMIN_ID = "b2000000-0000-4000-8000-000000000002";
const STUDENT_ONE = "b2000000-0000-4000-8000-000000000003";
const STUDENT_TWO = "b2000000-0000-4000-8000-000000000004";
const CLASS_ONE = "b2000000-0000-4000-8000-000000000005";
const CLASS_TWO = "b2000000-0000-4000-8000-000000000006";
const CAMPUS_ONE = "b2000000-0000-4000-8000-000000000007";
const CAMPUS_TWO = "b2000000-0000-4000-8000-000000000008";
const REQUEST_ID = "b2000000-0000-4000-8000-000000000009";
const REQUEST_TWO_ID = "b2000000-0000-4000-8000-000000000019";

type FixtureRow = Record<string, unknown>;

const users: FixtureRow[] = [
  {
    id: ADMIN_ID,
    school_id: SCHOOL_ID,
    full_name: "Synthetic School Administrator",
    email: "mobility-admin@example.test",
    role: "admin",
    avatar_url: null,
    is_active: true,
  },
  { id: STUDENT_ONE, full_name: "Ada Okafor" },
  { id: STUDENT_TWO, full_name: "Tunde Bello" },
];

const school = {
  id: SCHOOL_ID,
  name: "Synthetic Unity Academy",
  slug: "synthetic-unity-academy",
  logo_url: null,
  primary_color: null,
  secondary_color: null,
  subscription_tier: "enterprise",
  subscription_status: "active",
  is_active: true,
};

const classes: FixtureRow[] = [
  {
    id: CLASS_ONE,
    school_id: SCHOOL_ID,
    name: "JSS 1",
    grade_level: "JSS 1",
    academic_year: "2026/2027",
    capacity: 30,
    campus_id: CAMPUS_ONE,
    section_id: "b2000000-0000-4000-8000-000000000010",
    shift_id: "b2000000-0000-4000-8000-000000000011",
    arm: "A",
  },
  {
    id: CLASS_TWO,
    school_id: SCHOOL_ID,
    name: "JSS 2",
    grade_level: "JSS 2",
    academic_year: "2026/2027",
    capacity: 30,
    campus_id: CAMPUS_TWO,
    section_id: "b2000000-0000-4000-8000-000000000012",
    shift_id: "b2000000-0000-4000-8000-000000000013",
    arm: "C",
  },
];

const tableData: Record<string, FixtureRow[]> = {
  users,
  organization_memberships: [
    { user_id: ADMIN_ID, school_id: SCHOOL_ID, role: "admin", is_active: true },
  ],
  students: [
    {
      id: STUDENT_ONE,
      school_id: SCHOOL_ID,
      admission_number: "UA-1001",
      class_id: CLASS_ONE,
      user_id: STUDENT_ONE,
      is_active: true,
    },
    {
      id: STUDENT_TWO,
      school_id: SCHOOL_ID,
      admission_number: "UA-1002",
      class_id: CLASS_ONE,
      user_id: STUDENT_TWO,
      is_active: true,
    },
  ],
  classes,
  campuses: [
    { id: CAMPUS_ONE, school_id: SCHOOL_ID, name: "Central Campus" },
    { id: CAMPUS_TWO, school_id: SCHOOL_ID, name: "Riverside Campus" },
  ],
  school_sections: [
    {
      id: "b2000000-0000-4000-8000-000000000010",
      school_id: SCHOOL_ID,
      name: "Junior Secondary",
      campus_id: CAMPUS_ONE,
    },
    {
      id: "b2000000-0000-4000-8000-000000000012",
      school_id: SCHOOL_ID,
      name: "Senior Secondary",
      campus_id: CAMPUS_TWO,
    },
  ],
  school_shifts: [
    {
      id: "b2000000-0000-4000-8000-000000000011",
      school_id: SCHOOL_ID,
      name: "Morning",
      campus_id: CAMPUS_ONE,
    },
    {
      id: "b2000000-0000-4000-8000-000000000013",
      school_id: SCHOOL_ID,
      name: "Afternoon",
      campus_id: CAMPUS_TWO,
    },
  ],
  fees: [
    {
      school_id: SCHOOL_ID,
      student_id: STUDENT_ONE,
      amount: 125000,
      paid_amount: 25000,
      status: "unpaid",
    },
    {
      school_id: SCHOOL_ID,
      student_id: STUDENT_TWO,
      amount: 60000,
      paid_amount: 60000,
      status: "paid",
    },
  ],
  student_placements: [
    {
      id: "b2000000-0000-4000-8000-000000000014",
      school_id: SCHOOL_ID,
      student_id: STUDENT_ONE,
      campus_id: CAMPUS_ONE,
      section_id: "b2000000-0000-4000-8000-000000000010",
      shift: "Morning",
      arm: "A",
      class_id: CLASS_ONE,
      session: "2025/2026",
      effective_from: "2025-09-01T00:00:00.000Z",
      effective_to: "2026-08-31T23:59:59.000Z",
      movement_type: "enrollment",
      reason: "Initial placement",
    },
    {
      id: "b2000000-0000-4000-8000-000000000015",
      school_id: SCHOOL_ID,
      student_id: STUDENT_ONE,
      campus_id: CAMPUS_TWO,
      section_id: "b2000000-0000-4000-8000-000000000012",
      shift: "Afternoon",
      arm: "C",
      class_id: CLASS_TWO,
      session: "2026/2027",
      effective_from: "2026-09-01T00:00:00.000Z",
      effective_to: null,
      movement_type: "promote",
      reason: "End-of-session promotion",
    },
  ],
  student_mobility_fee_allocations: [
    {
      event_id: "b2000000-0000-4000-8000-000000000017",
      fee_id: "b2000000-0000-4000-8000-000000000018",
      placement_id: "b2000000-0000-4000-8000-000000000015",
      period_start: "2026-09-01",
      period_end: "2026-11-30",
      service_seconds: 7776000,
      period_seconds: 7776000,
      fee_amount: 60000,
      paid_amount: 60000,
      outstanding_amount: 0,
      created_at: "2026-09-01T00:00:00.000Z",
    },
  ],
  student_mobility_requests: [
    {
      id: REQUEST_ID,
      school_id: SCHOOL_ID,
      student_id: STUDENT_ONE,
      movement_type: "internal_transfer",
      target_class_id: CLASS_TWO,
      target_session: "2026/2027",
      target_shift: "Afternoon",
      effective_at: new Date(Date.now() + 86_400_000).toISOString(),
      reason: "Approved campus placement change",
      status: "pending",
      requested_by: "b2000000-0000-4000-8000-000000000016",
      policy_snapshot: {},
      created_at: new Date().toISOString(),
    },
    {
      id: REQUEST_TWO_ID,
      school_id: SCHOOL_ID,
      student_id: STUDENT_TWO,
      movement_type: "internal_transfer",
      target_class_id: CLASS_TWO,
      target_session: "2026/2027",
      target_shift: "Afternoon",
      effective_at: new Date(Date.now() + 86_400_000).toISOString(),
      reason: "Pending requester reschedule",
      status: "pending",
      requested_by: ADMIN_ID,
      policy_snapshot: {},
      created_at: new Date().toISOString(),
    },
  ],
  student_mobility_approvals: [],
  student_mobility_events: [
    {
      id: "b2000000-0000-4000-8000-000000000017",
      school_id: SCHOOL_ID,
      student_id: STUDENT_ONE,
      from_placement_id: null,
      to_placement_id: "b2000000-0000-4000-8000-000000000014",
      movement_type: "enrollment",
      reason: "Initial placement",
      effective_at: "2025-09-01T00:00:00.000Z",
      actor_id: ADMIN_ID,
      approved_by: null,
    },
  ],
  student_mobility_rules: [
    {
      school_id: SCHOOL_ID,
      required_approvals: 2,
      approval_roles: [],
      fee_clearance: "warn",
      updated_at: new Date().toISOString(),
    },
  ],
};

async function reply(route: Route, value: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "access-control-allow-headers": "*",
    },
    body: value === undefined ? "" : JSON.stringify(value),
  });
}

async function installMobilityFixture(page: Page) {
  const authUser = {
    id: ADMIN_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "mobility-admin@example.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { full_name: "Synthetic School Administrator" },
    created_at: "2026-10-31T00:00:00.000Z",
  };
  await page.addInitScript(
    ({ key, value }) => window.sessionStorage.setItem(key, JSON.stringify(value)),
    {
      key: "sb-synthetic-auth-token",
      value: {
        access_token: "synthetic-fixture-access-token",
        refresh_token: "synthetic-fixture-refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: authUser,
      },
    },
  );
  await page.route(`${API_URL}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") {
      await reply(route, undefined, 204);
      return;
    }
    if (url.pathname === "/auth/v1/user") {
      await reply(route, authUser);
      return;
    }
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const name = url.pathname.split("/").at(-1);
      const args = request.postDataJSON() as Record<string, unknown>;
      if (name === "scholar_can") {
        await reply(
          route,
          ["students.view", "students.transfer", "fees.view"].includes(String(args.p_perm)),
        );
        return;
      }
      if (name === "workspace_manifest") {
        await reply(route, null);
        return;
      }
      if (name === "workspace_widget_data") {
        await reply(route, { cards: {} });
        return;
      }
      if (name === "student_mobility_preview") {
        await reply(route, {
          student_id: args.p_student,
          eligible: true,
          unmet: [],
          warnings: ["Outstanding balance requires reviewer attention."],
          average_pct: 78,
          attendance_pct: 94,
          outstanding_balance: 100000,
          occupied_seats: 12,
          target_capacity: 30,
          required_approvals: 2,
          approval_roles: [],
          fee_clearance: "warn",
        });
        return;
      }
      if (name === "student_mobility_bulk_preview") {
        const items = Array.isArray(args.p_items) ? args.p_items : [];
        await reply(
          route,
          items.map((item) => ({
            student_id: (item as Record<string, unknown>).student_id,
            eligible: true,
            unmet: [],
            warnings: [],
            average_pct: 78,
            attendance_pct: 94,
            outstanding_balance: 0,
            occupied_seats: 12,
            target_capacity: 30,
            required_approvals: 2,
            approval_roles: [],
            fee_clearance: "warn",
          })),
        );
        return;
      }
      if (name === "student_mobility_bulk_request") {
        const items = Array.isArray(args.p_items) ? args.p_items : [];
        await reply(
          route,
          items.map((item, index) => ({
            student_id: (item as Record<string, unknown>).student_id,
            request_id: `b2000000-0000-4000-8000-${String(index + 20).padStart(12, "0")}`,
          })),
        );
        return;
      }
      if (name === "student_mobility_reschedule") {
        await reply(route, null);
        return;
      }
      await reply(route, REQUEST_ID);
      return;
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.split("/").at(-1) ?? "";
      if (table === "schools") {
        const isMembershipList = [...url.searchParams.values()].some((value) =>
          value.startsWith("in."),
        );
        await reply(route, isMembershipList ? [{ id: SCHOOL_ID, name: school.name }] : school);
        return;
      }
      let rows = tableData[table] ?? [];
      if (table === "users" && url.searchParams.has("id")) {
        const filter = url.searchParams.get("id") ?? "";
        rows = users.filter((row) => filter.includes(String(row.id)));
      }
      const hasObjectAccept = request.headers()["accept"]?.includes("vnd.pgrst.object");
      await reply(route, hasObjectAccept ? (rows[0] ?? null) : rows);
      return;
    }
    await reply(route, null);
  });
}

async function assertNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

test("captures desktop and mobile student, movement, and bulk promotion screens", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Screenshots are captured once by the desktop project.",
  );
  await installMobilityFixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/home/s/nav.students");
  await expect(page.getByTestId("student-mobility")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Student records", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ada Okafor" })).toBeVisible();
  await expect(page.getByText("Consolidated outstanding balance")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Prorated fees by placement" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download transfer certificate" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download movement record" })).toBeVisible();
  const certificateDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download transfer certificate" }).click();
  expect((await certificateDownload).suggestedFilename()).toBe("transfer-certificate.pdf");
  const movementDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download movement record" }).click();
  expect((await movementDownload).suggestedFilename()).toBe("movement-record.pdf");
  await expect(page.getByText("Eligibility checks passed").first()).toBeVisible();
  await assertNoHorizontalOverflow(page);
  mkdirSync(join(process.cwd(), "docs/screenshots"), { recursive: true });

  await page.screenshot({
    path: "docs/screenshots/student-mobility-profile-1440.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Ada Okafor" })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    path: "docs/screenshots/student-mobility-profile-390.png",
    fullPage: true,
  });

  await page.getByRole("tab", { name: "Movement" }).click();
  await expect(page.getByRole("heading", { name: "Request a movement" })).toBeVisible();
  await expect(page.getByText("AI advisory only")).toBeVisible();
  await expect(page.getByRole("button", { name: "Get AI advisory" })).toBeVisible();
  await expect(page.getByText("Eligibility checks passed").first()).toBeVisible();
  await expect(page.getByText("Placement timeline")).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    path: "docs/screenshots/student-mobility-movement-390.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    path: "docs/screenshots/student-mobility-movement-1440.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "Bulk promotion" }).click();
  await page.getByRole("checkbox").nth(0).check();
  await page.getByRole("checkbox").nth(1).check();
  await page.getByRole("button", { name: "Run dry-run" }).click();
  await expect(
    page.getByText("Dry-run complete. Review every student result before confirming the batch."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue to confirmation" }).click();
  const confirmation = page.getByRole("checkbox", {
    name: /I confirm that 2 eligible request\(s\) will be submitted/,
  });
  await expect(page.getByRole("button", { name: "Apply requests" })).toBeDisabled();
  await confirmation.check();
  await expect(page.getByRole("button", { name: "Apply requests" })).toBeEnabled();
  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    path: "docs/screenshots/student-mobility-bulk-1440.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: "docs/screenshots/student-mobility-bulk-390.png", fullPage: true });
  await page.getByRole("button", { name: "Apply requests" }).click();
  await expect(page.getByText("2 promotion requests submitted atomically.")).toBeVisible();
  await page.getByRole("button", { name: /Tunde Bello/ }).click();
  await expect(page.getByRole("heading", { name: "Tunde Bello" })).toBeVisible();
  const requesterCard = page
    .locator(".mobility-request-card")
    .filter({ hasText: "Pending requester reschedule" })
    .first();
  await expect(requesterCard.getByRole("button", { name: "Approve" })).toHaveCount(0);
  const rescheduleDate = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("New effective date").fill(rescheduleDate);
  await page.getByRole("button", { name: "Change effective date" }).click();
  await expect(
    page.getByText("Effective date updated; the movement still requires human approval."),
  ).toBeVisible();
});
