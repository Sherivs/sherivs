import { expect, test, type Page, type Route } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

const API_URL = "https://synthetic.supabase.test";
const SCHOOL_ID = "a1000000-0000-4000-8000-000000000001";
const ADMIN_ID = "a1000000-0000-4000-8000-000000000002";
const TEACHER_ID = "a1000000-0000-4000-8000-000000000003";
const BURSAR_ID = "a1000000-0000-4000-8000-000000000004";
const INITIAL_ASSIGNMENT_ID = "a1000000-0000-4000-8000-000000000005";

type FixtureRow = Record<string, unknown>;

function localDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isoAfter(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

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

async function installSyntheticRoleFixture(page: Page) {
  const adminUser = {
    id: ADMIN_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "synthetic-hr-admin@example.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { full_name: "Synthetic HR Admin" },
    created_at: "2026-10-31T00:00:00.000Z",
  };
  const session = {
    access_token: "synthetic-fixture-access-token",
    refresh_token: "synthetic-fixture-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: adminUser,
  };
  await page.addInitScript(
    ({ key, value }) => {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    },
    { key: "sb-synthetic-auth-token", value: session },
  );

  const roles: FixtureRow[] = [
    {
      code: "head_of_institution",
      name: "Synthetic Principal",
      category: "school",
      template_code: "head_of_institution",
      org_id: null,
    },
    {
      code: "teacher",
      name: "Synthetic Teacher",
      category: "school",
      template_code: "teacher",
      org_id: null,
    },
  ];
  const responsibilities: FixtureRow[] = [
    {
      id: "a1000000-0000-4000-8000-000000000010",
      org_id: null,
      code: "synthetic_attendance",
      label: "Synthetic attendance",
      kind: "core",
      daily_priority: 1,
      primary_nav_id: "synthetic_attendance",
      primary_nav_label: "Attendance",
    },
    {
      id: "a1000000-0000-4000-8000-000000000011",
      org_id: null,
      code: "synthetic_people",
      label: "Synthetic people",
      kind: "core",
      daily_priority: 2,
      primary_nav_id: "synthetic_people",
      primary_nav_label: "People",
    },
    {
      id: "a1000000-0000-4000-8000-000000000012",
      org_id: null,
      code: "synthetic_reports",
      label: "Synthetic reports",
      kind: "core",
      daily_priority: 3,
      primary_nav_id: "synthetic_reports",
      primary_nav_label: "Reports",
    },
    {
      id: "a1000000-0000-4000-8000-000000000013",
      org_id: null,
      code: "synthetic_acting_principal",
      label: "Synthetic acting principal",
      kind: "add_on",
      daily_priority: 4,
      primary_nav_id: "synthetic_acting_principal",
      primary_nav_label: "Acting principal",
    },
  ];
  const roleResponsibilities: FixtureRow[] = responsibilities.map((responsibility) => ({
    org_id: SCHOOL_ID,
    role_code: "head_of_institution",
    responsibility_id: responsibility.id,
  }));
  const users: FixtureRow[] = [
    {
      id: ADMIN_ID,
      school_id: SCHOOL_ID,
      full_name: "Synthetic HR Admin",
      email: "synthetic-hr-admin@example.test",
      role: "admin",
      is_active: true,
    },
    {
      id: TEACHER_ID,
      school_id: SCHOOL_ID,
      full_name: "Synthetic Teacher",
      email: "synthetic-teacher@example.test",
      role: "teacher",
      is_active: true,
    },
    {
      id: BURSAR_ID,
      school_id: SCHOOL_ID,
      full_name: "Synthetic Bursar",
      email: "synthetic-bursar@example.test",
      role: "bursar",
      is_active: true,
    },
  ];
  const assignments: FixtureRow[] = [
    {
      id: INITIAL_ASSIGNMENT_ID,
      org_id: SCHOOL_ID,
      user_id: ADMIN_ID,
      role_code: "head_of_institution",
      scope_type: "institution",
      scope_ref: null,
      status: "active",
      started_at: new Date(Date.now() - 3_600_000).toISOString(),
      valid_until: null,
      temporary: false,
      org_unit_id: null,
      evidence: ["Synthetic fixture"],
      restrictions: [],
    },
  ];
  const grants: FixtureRow[] = [];
  const delegations: FixtureRow[] = [];
  const auditEvents: FixtureRow[] = [];
  let customRoleNumber = 0;
  let assignmentNumber = 0;
  let grantNumber = 0;
  let delegationNumber = 0;
  let responsibilityNumber = 0;

  const tableData: Record<string, FixtureRow[]> = {
    users,
    role_catalog: roles,
    user_role_assignments: assignments,
    workspace_org_units: [],
    workspace_responsibility_catalog: responsibilities,
    workspace_role_responsibilities: roleResponsibilities,
    workspace_responsibility_permissions: [],
    role_assignment_responsibility_grants: grants,
    role_assignment_delegations: delegations,
    role_assignment_audit_events: auditEvents,
    organization_memberships: [
      { school_id: SCHOOL_ID, role: "admin", is_active: true, user_id: ADMIN_ID },
    ],
  };

  await page.route(`${API_URL}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") {
      await reply(route, undefined, 204);
      return;
    }

    if (url.pathname === "/auth/v1/user") {
      await reply(route, adminUser);
      return;
    }

    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const rpcName = url.pathname.split("/").at(-1);
      const args = request.postDataJSON() as Record<string, unknown>;
      let result: unknown = null;
      if (rpcName === "can_manage_roles") {
        result =
          args.p_org === SCHOOL_ID &&
          ["roles.assign", "roles.configure"].includes(String(args.p_perm));
      } else if (rpcName === "role_create_custom") {
        customRoleNumber += 1;
        const code = `custom.${SCHOOL_ID.replaceAll("-", "")}.synthetic_hr_${customRoleNumber}`;
        roles.push({
          code,
          name: String(args.p_name),
          category: "school",
          template_code: String(args.p_base_role),
          org_id: SCHOOL_ID,
        });
        result = code;
      } else if (rpcName === "workspace_responsibility_create_custom") {
        responsibilityNumber += 1;
        const id = `a1000000-0000-4000-8000-${String(100 + responsibilityNumber).padStart(12, "0")}`;
        responsibilities.push({
          id,
          org_id: SCHOOL_ID,
          code: String(args.p_code),
          label: String(args.p_label),
          kind: "custom",
          daily_priority: args.p_daily_priority,
          primary_nav_id: String(args.p_primary_nav_id),
          primary_nav_label: String(args.p_primary_nav_label),
        });
        roleResponsibilities.push({
          org_id: SCHOOL_ID,
          role_code: String(args.p_role),
          responsibility_id: id,
        });
        result = id;
      } else if (rpcName === "workspace_role_assignment_create") {
        assignmentNumber += 1;
        const id = `a1000000-0000-4000-8000-${String(200 + assignmentNumber).padStart(12, "0")}`;
        assignments.push({
          id,
          org_id: SCHOOL_ID,
          user_id: args.p_user,
          role_code: args.p_role,
          scope_type: args.p_scope_type,
          scope_ref: args.p_scope_ref,
          status: "active",
          started_at: args.p_started_at,
          valid_until: args.p_valid_until,
          temporary: args.p_temporary,
          org_unit_id: args.p_org_unit_id,
          evidence: args.p_evidence,
          restrictions: args.p_restrictions,
        });
        auditEvents.unshift({
          id: `synthetic-assignment-audit-${assignmentNumber}`,
          org_id: SCHOOL_ID,
          actor_user_id: ADMIN_ID,
          target_user_id: args.p_user,
          target_type: "assignment",
          target_id: id,
          action: "assignment_created",
          scope_type: args.p_scope_type,
          scope_ref: args.p_scope_ref,
          before_state: null,
          after_state: { role_code: args.p_role, synthetic: true },
          occurred_at: new Date().toISOString(),
        });
        result = id;
      } else if (rpcName === "workspace_responsibility_grant") {
        grantNumber += 1;
        const id = `a1000000-0000-4000-8000-${String(300 + grantNumber).padStart(12, "0")}`;
        grants.unshift({
          id,
          org_id: SCHOOL_ID,
          assignment_id: args.p_assignment,
          responsibility_id: args.p_responsibility,
          valid_from: args.p_valid_from,
          valid_until: args.p_valid_until,
          granted_by: ADMIN_ID,
          granted_at: new Date().toISOString(),
          revoked_by: null,
          revoked_at: null,
        });
        result = id;
      } else if (rpcName === "workspace_responsibility_revoke") {
        const grant = grants.find((row) => row.id === args.p_grant);
        if (grant) grant.revoked_at = new Date().toISOString();
      } else if (rpcName === "workspace_role_delegate") {
        delegationNumber += 1;
        const id = `a1000000-0000-4000-8000-${String(400 + delegationNumber).padStart(12, "0")}`;
        delegations.unshift({
          id,
          org_id: SCHOOL_ID,
          assignment_id: args.p_assignment,
          delegate_user_id: args.p_delegate_user,
          valid_from: args.p_valid_from,
          valid_until: args.p_valid_until,
          created_by: ADMIN_ID,
          created_at: new Date().toISOString(),
          revoked_at: null,
        });
        result = id;
      } else if (rpcName === "workspace_role_delegation_revoke") {
        const delegation = delegations.find((row) => row.id === args.p_delegation);
        if (delegation) delegation.revoked_at = new Date().toISOString();
      } else if (rpcName === "role_unassign") {
        const assignment = assignments.find((row) => row.id === args.p_assignment);
        if (assignment) assignment.status = "ended";
      } else if (rpcName === "workspace_manifest") {
        result = null;
      } else if (rpcName === "workspace_widget_data") {
        result = { cards: {} };
      }
      await reply(route, result);
      return;
    }

    if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.split("/").at(-1) ?? "";
      let rows = tableData[table] ?? [];
      if (table === "schools") {
        const school = {
          id: SCHOOL_ID,
          name: "Synthetic Fixture School",
          slug: "synthetic-fixture-school",
          logo_url: null,
          primary_color: null,
          secondary_color: null,
          subscription_tier: "enterprise",
          subscription_status: "active",
          is_active: true,
        };
        const isMembershipList = [...url.searchParams.values()].some((value) =>
          value.startsWith("in."),
        );
        await reply(route, isMembershipList ? [{ id: SCHOOL_ID, name: school.name }] : school);
        return;
      }
      if (table === "users" && url.searchParams.has("id")) {
        rows = users.filter((row) => row.id === url.searchParams.get("id")?.replace("eq.", ""));
        await reply(route, rows[0] ?? null);
        return;
      }
      await reply(route, rows);
      return;
    }

    await reply(route, null);
  });
}

test("captures desktop and mobile role-management screens with synthetic records", async ({
  page,
}, testInfo) => {
  await installSyntheticRoleFixture(page);
  await page.goto("/home/s/roles");

  const screen = page.getByTestId("role-management-screen");
  await expect(screen).toBeVisible();
  await expect(page.getByTestId("manifest-responsibilities")).toContainText("Attendance");

  const customRoleForm = page.locator("form").filter({
    has: page.getByRole("button", { name: "Create role" }),
  });
  await customRoleForm.locator("input").fill("Synthetic HR Coordinator");
  await customRoleForm.getByRole("button", { name: "Create role" }).click();
  const customRoleCodeElement = page.locator("code").filter({ hasText: "synthetic_hr_" });
  await expect(customRoleCodeElement).toBeVisible();
  const customRoleCode = await customRoleCodeElement
    .textContent()
    .then((text) => text?.trim() ?? "");
  expect(customRoleCode).toContain("synthetic_hr_");
  await expect(page.getByRole("button", { name: "Copy role code" })).toBeVisible();

  const responsibilityForm = page.locator("form").filter({
    has: page.getByRole("button", { name: "Add responsibility" }),
  });
  await responsibilityForm.getByLabel("Responsibility role").selectOption(customRoleCode);
  const responsibilityInputs = responsibilityForm.locator("input");
  await responsibilityInputs.nth(0).fill("synthetic_hr_support");
  await responsibilityInputs.nth(1).fill("Synthetic HR support");
  await responsibilityInputs.nth(2).fill("12");
  await responsibilityInputs.nth(3).fill("synthetic_hr_support");
  await responsibilityInputs.nth(4).fill("HR support");
  await responsibilityInputs.nth(5).fill("");
  await responsibilityForm.getByRole("button", { name: "Add responsibility" }).click();
  await expect(responsibilityInputs.nth(0)).toHaveValue("");

  const assignmentForm = page.locator("form").filter({
    has: page.getByRole("button", { name: "Assign role" }),
  });
  await assignmentForm.getByLabel("Member").selectOption(TEACHER_ID);
  await assignmentForm.getByLabel("Assignment role").selectOption(customRoleCode);
  await assignmentForm
    .locator('input[type="datetime-local"]')
    .nth(0)
    .fill(localDateTime(new Date()));
  await assignmentForm
    .locator('input[type="datetime-local"]')
    .nth(1)
    .fill(localDateTime(new Date(Date.now() + 2 * 60 * 60_000)));
  await assignmentForm.locator('input[type="checkbox"]').check();
  await assignmentForm.getByRole("button", { name: "Assign role" }).click();
  await expect(page.getByText("Change saved and audited.")).toBeVisible();
  const temporaryAssignment = page
    .getByTestId("role-assignment-row")
    .filter({ hasText: "Synthetic Teacher" })
    .filter({ hasText: "Synthetic HR Coordinator" });
  await expect(temporaryAssignment).toBeVisible();

  const grantForm = page.locator("form").filter({
    has: page.getByRole("button", { name: "Grant add-on" }),
  });
  await grantForm.getByLabel("Grant assignment").selectOption({
    label: "Synthetic Teacher · Synthetic HR Coordinator",
  });
  await grantForm.getByLabel("Add-on responsibility").selectOption({
    label: "Synthetic acting principal",
  });
  await grantForm.locator('input[type="datetime-local"]').nth(0).fill(localDateTime(new Date()));
  await grantForm.getByRole("button", { name: "Grant add-on" }).click();
  await expect(page.getByText("Change saved and audited.")).toBeVisible();
  const grantRow = page.getByTestId("role-add-on-grant-row").filter({
    hasText: "Synthetic acting principal",
  });
  await expect(grantRow.getByRole("button", { name: "Revoke add-on" })).toBeVisible();
  await grantRow.getByRole("button", { name: "Revoke add-on" }).click();
  await expect(page.getByText("Add-on revoked and audited.")).toBeVisible();
  await expect(page.getByText(/Synthetic acting principal.*revoked/)).toBeVisible();

  const delegationForm = page.locator("form").filter({
    has: page.getByRole("button", { name: "Delegate temporarily" }),
  });
  await delegationForm.getByLabel("Delegation assignment").selectOption({
    label: "Synthetic Teacher · Synthetic HR Coordinator",
  });
  await delegationForm.getByLabel("Delegate member").selectOption(BURSAR_ID);
  await delegationForm
    .locator('input[type="datetime-local"]')
    .nth(0)
    .fill(localDateTime(new Date()));
  await delegationForm
    .locator('input[type="datetime-local"]')
    .nth(1)
    .fill(localDateTime(new Date(Date.now() + 60 * 60_000)));
  await delegationForm.getByRole("button", { name: "Delegate temporarily" }).click();
  await expect(page.getByText("Change saved and audited.")).toBeVisible();
  await expect(page.getByTestId("role-delegation-row")).toContainText(
    "Delegated to Synthetic Bursar",
  );
  await expect(temporaryAssignment).toContainText("temporary");

  const width = testInfo.project.name === "desktop-chromium" ? 1440 : 390;
  await expect(screen).toBeVisible();
  for (const section of [
    "Create a custom role",
    "Add custom responsibility",
    "Assign a role",
    "Grant an add-on responsibility",
    "Delegate a role temporarily",
    "Role assignments",
    "Add-on grants and delegations",
    "Assignment audit history",
  ]) {
    await expect(screen.getByText(section, { exact: true })).toBeVisible();
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.clientWidth)).toBe(width);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(width);
  await expect(page.getByRole("link", { name: "← Home" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const header = document.querySelector(".app-shell-header")?.getBoundingClientRect();
        const breadcrumb = document
          .querySelector('[data-testid="role-management-screen"] .app-shell-back')
          ?.getBoundingClientRect();
        return (breadcrumb?.top ?? 0) >= (header?.bottom ?? Infinity);
      }),
    )
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
    .toBeGreaterThan(2000);
  await page.evaluate(() => document.fonts.ready);
  const path = testInfo.outputPath(`role-management-${width}.png`);
  mkdirSync(dirname(path), { recursive: true });
  const shellBounds = await page.getByTestId("app-shell").boundingBox();
  expect(shellBounds?.width).toBe(width);
  expect(shellBounds?.height).toBeGreaterThan(800);
  await page.screenshot({
    path,
    fullPage: true,
    scale: "css",
    animations: "disabled",
  });
  const screenshot = readFileSync(path);
  expect(screenshot.readUInt32BE(16)).toBe(width);
  expect(screenshot.readUInt32BE(20)).toBeGreaterThan(2000);
});
