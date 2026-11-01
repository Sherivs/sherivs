import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  cleanupLegacyFixture,
  FIXTURE_SKIP_NO_BACKEND,
  provisionLegacyFixture,
  signIn,
} from "./helpers";

function localDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function signOut(page: import("@playwright/test").Page) {
  await page.getByTestId("app-shell-menu").click();
  await page.getByRole("button", { name: "Sign out" }).click();
}

test("an assignment appears in the member manifest and disappears when revoked", async ({
  page,
}) => {
  const fixture = await provisionLegacyFixture();
  test.skip(!fixture, FIXTURE_SKIP_NO_BACKEND);
  if (!fixture) return;

  try {
    const setup = createClient(
      process.env.SUPABASE_URL ?? "",
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const classResult = await setup
      .from("classes")
      .insert({
        school_id: fixture.schoolId,
        name: `Synthetic Role Fixture ${fixture.slug}`,
      })
      .select("id")
      .single();
    expect(classResult.error).toBeNull();
    const classId = String(classResult.data?.id);

    await signIn(page, fixture.credentials.admin);
    await page.goto("/home/s/roles");
    await expect(page.getByTestId("role-management-screen")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Roles and responsibilities" })).toBeVisible();

    const slug = fixture.slug.replace(/[^a-z0-9]/gi, "_");
    const responsibilityForm = page.locator("form").filter({
      has: page.getByRole("button", { name: "Add responsibility" }),
    });
    await responsibilityForm.getByLabel("Responsibility role").selectOption("teacher");
    for (let index = 1; index <= 3; index += 1) {
      const inputs = responsibilityForm.locator("input");
      await inputs.nth(0).fill(`a1_e2e_${slug}_${index}`);
      await inputs.nth(1).fill(`Synthetic E2E section ${index}`);
      await inputs.nth(2).fill(String(index));
      await inputs.nth(3).fill(`e2e_${slug}_${index}`);
      await inputs.nth(4).fill(`Synthetic E2E section ${index}`);
      await inputs.nth(5).fill("");
      await responsibilityForm.getByRole("button", { name: "Add responsibility" }).click();
      await expect(inputs.nth(0)).toHaveValue("");
      await expect(
        page.getByRole("status").filter({ hasText: "Change saved and audited." }),
      ).toBeVisible();
    }

    const assignmentForm = page.locator("form").filter({
      has: page.getByRole("button", { name: "Assign role" }),
    });
    await assignmentForm.getByLabel("Member").selectOption({
      label: "R1 E2E teacher",
    });
    await assignmentForm.getByLabel("Assignment role").selectOption("teacher");
    await assignmentForm.getByLabel("Assignment scope").selectOption("class");
    await assignmentForm.locator('input[type="text"]').fill(classId);
    await assignmentForm
      .locator('input[type="datetime-local"]')
      .first()
      .fill(localDateTime(new Date()));
    await assignmentForm.getByRole("button", { name: "Assign role" }).click();
    await expect(page.getByText("Change saved and audited.")).toBeVisible();

    const targetAssignment = page
      .getByTestId("role-assignment-row")
      .filter({ hasText: "R1 E2E teacher" })
      .filter({ hasText: "Teacher" });
    await expect(targetAssignment).toBeVisible();

    await signOut(page);
    await signIn(page, fixture.credentials.teacher);
    await page.goto("/home/s/roles");
    await expect(page.getByTestId("manifest-responsibilities")).toContainText(
      "Synthetic E2E section 1",
    );
    await expect(page.getByTestId("manifest-responsibilities")).toContainText(
      "Synthetic E2E section 2",
    );
    await expect(page.getByTestId("manifest-responsibilities")).toContainText(
      "Synthetic E2E section 3",
    );

    await signOut(page);
    await signIn(page, fixture.credentials.admin);
    await page.goto("/home/s/roles");
    const assignmentToRevoke = page
      .getByTestId("role-assignment-row")
      .filter({ hasText: "R1 E2E teacher" })
      .filter({ hasText: "Teacher" });
    await assignmentToRevoke.getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByText("Role revoked and audited.")).toBeVisible();

    await signOut(page);
    await signIn(page, fixture.credentials.teacher);
    await page.goto("/home/s/roles");
    await expect(page.getByTestId("manifest-empty")).toBeVisible();
    await expect(page.getByTestId("manifest-responsibilities")).toHaveCount(0);
  } finally {
    await cleanupLegacyFixture(fixture);
  }
});
