import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  cleanupLegacyFixture,
  FIXTURE_SKIP_NO_BACKEND,
  provisionLegacyFixture,
  signIn,
} from "./helpers";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";

function localDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const EXECUTIVE_ROLES: readonly {
  roleCode: string;
  label: string;
  expectedTemplate?: string;
  readOnly?: boolean;
}[] = [
  { roleCode: "ng.principal", label: "principal" },
  { roleCode: "ng.proprietor", label: "proprietor" },
  {
    roleCode: "ng.vice_chancellor",
    label: "tertiary vice-chancellor",
    expectedTemplate: "m009_tertiary_executive_read_only",
    readOnly: true,
  },
  { roleCode: "ng.governing_council_member", label: "governance member" },
] as const;

test.describe("M009 B-1 verified executive assignment flows", () => {
  test.describe.configure({ mode: "serial" });

  for (const roleCase of EXECUTIVE_ROLES) {
    test(`${roleCase.label} requires independent verification and reaches its workspace`, async ({
      page,
    }, testInfo) => {
      const fixture = await provisionLegacyFixture();
      test.skip(!fixture, FIXTURE_SKIP_NO_BACKEND);
      if (!fixture) return;

      const authenticated = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const verifier = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const setup = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      try {
        const signedIn = await authenticated.auth.signInWithPassword(fixture.credentials.admin);
        expect(signedIn.error).toBeNull();
        const verifierSignedIn = await verifier.auth.signInWithPassword(
          fixture.credentials.verifier,
        );
        expect(verifierSignedIn.error).toBeNull();
        const roleRow = await setup
          .from("role_catalog")
          .select("template_code")
          .eq("code", roleCase.roleCode)
          .is("org_id", null)
          .single();
        expect(roleRow.error).toBeNull();
        if (roleCase.expectedTemplate) {
          expect(roleRow.data?.template_code).toBe(roleCase.expectedTemplate);
        }

        const linkResult = await verifier
          .from("institution_authority_links")
          .insert({
            school_id: fixture.schoolId,
            authority_name: `Synthetic E2E authority ${fixture.slug}`,
            legal_basis: "Synthetic fixture only",
            source: "Synthetic E2E fixture",
            verification_status: "unverified",
          })
          .select("id")
          .single();
        expect(linkResult.error).toBeNull();
        const authorityLinkId = String(linkResult.data?.id);

        await signIn(page, fixture.credentials.admin);
        await page.goto("/home/s/roles");
        await expect(page.getByTestId("role-management-screen")).toBeVisible();

        const responsibilityForm = page.locator("form").filter({
          has: page.getByRole("button", { name: "Add responsibility" }),
        });
        await responsibilityForm.getByLabel("Responsibility role").selectOption(roleCase.roleCode);
        const slug = roleCase.roleCode
          .replace(/^ng\./, "")
          .replace(/[^a-z0-9]/gi, "_")
          .slice(0, 40);
        const responsibilities = [
          ["analytics.institution", "Institution indicators"],
          ["reports.academic", "Academic reports"],
          ["reports.financial", "Financial reports"],
        ] as const;
        for (const [index, [permission, label]] of responsibilities.entries()) {
          const inputs = responsibilityForm.locator("input");
          await inputs.nth(0).fill(`m009_b1_${slug}_${index + 1}`);
          await inputs.nth(1).fill(`Synthetic ${label}`);
          await inputs.nth(2).fill(String(index + 1));
          await inputs.nth(3).fill(`m009_b1_${slug}_nav_${index + 1}`);
          await inputs.nth(4).fill(label);
          await inputs.nth(5).fill(permission);
          await responsibilityForm.getByRole("button", { name: "Add responsibility" }).click();
          await expect(page.getByText("Change saved and audited.")).toBeVisible();
        }

        const assignmentForm = page.locator("form").filter({
          has: page.getByRole("button", { name: "Assign role" }),
        });
        await assignmentForm.getByLabel("Member").selectOption({ label: "R1 E2E principal" });
        await assignmentForm.getByLabel("Assignment role").selectOption(roleCase.roleCode);
        const authoritySelect = assignmentForm.getByLabel(
          "Verified institution-authority relationship",
        );
        await expect(authoritySelect.locator("option")).toHaveCount(1);
        await expect(assignmentForm.getByRole("button", { name: "Assign role" })).toBeDisabled();

        const verified = await verifier
          .from("institution_authority_links")
          .update({
            verification_status: "verified",
            evidence_url: "https://example.invalid/synthetic-authority-evidence",
          })
          .eq("id", authorityLinkId);
        expect(verified.error).toBeNull();
        await page.reload();
        await expect(page.getByTestId("role-management-screen")).toBeVisible();

        const refreshedForm = page.locator("form").filter({
          has: page.getByRole("button", { name: "Assign role" }),
        });
        await refreshedForm.getByLabel("Member").selectOption({ label: "R1 E2E principal" });
        await refreshedForm.getByLabel("Assignment role").selectOption(roleCase.roleCode);
        await refreshedForm
          .getByLabel("Verified institution-authority relationship")
          .selectOption(authorityLinkId);
        await refreshedForm.getByLabel("Assignment scope").selectOption("institution");
        await refreshedForm
          .locator('input[type="datetime-local"]')
          .first()
          .fill(localDateTime(new Date()));
        await refreshedForm.getByRole("button", { name: "Assign role" }).click();
        await expect(page.getByText("Change saved and audited.")).toBeVisible();
        const member = await setup
          .from("users")
          .select("id")
          .eq("school_id", fixture.schoolId)
          .eq("full_name", "R1 E2E principal")
          .single();
        expect(member.error).toBeNull();
        if (!member.data) throw new Error("Synthetic principal fixture user was not found");
        const memberId = member.data.id;
        await expect(
          page.getByTestId("role-assignment-row").filter({ hasText: "R1 E2E principal" }),
        ).toBeVisible();
        const audit = await setup
          .from("role_assignment_audit_events")
          .select("id,action")
          .eq("org_id", fixture.schoolId)
          .eq("target_user_id", memberId)
          .eq("target_type", "user_role_assignments")
          .eq("action", "insert");
        expect(audit.error).toBeNull();
        expect(audit.data?.length).toBeGreaterThan(0);

        const notification = await setup.from("notifications").insert({
          school_id: fixture.schoolId,
          user_id: memberId,
          title: "Synthetic executive workspace ready",
          message: "Synthetic assignment fixture notification.",
          type: "system",
          action_url: "/admin/analytics",
        });
        expect(notification.error).toBeNull();

        if (roleCase.readOnly) {
          const readOnlyPermissions = await setup
            .from("role_template_permissions")
            .select("permission_code")
            .eq("template_code", roleCase.expectedTemplate ?? "");
          expect(readOnlyPermissions.error).toBeNull();
          expect(readOnlyPermissions.data?.map((row) => row.permission_code)).not.toContain(
            "expenses.approve",
          );
          expect(readOnlyPermissions.data?.map((row) => row.permission_code)).not.toContain(
            "payroll.approve",
          );
        }

        await page.getByTestId("app-shell-menu").click();
        await page.getByRole("button", { name: "Sign out" }).click();
        await signIn(page, fixture.credentials.principal);
        await page.goto("/home/s/roles");
        await expect(page.getByTestId("manifest-responsibilities").locator("li")).toHaveCount(3);
        const primaryResponsibilities = page
          .getByTestId("manifest-primary-responsibilities")
          .locator("li");
        await expect(primaryResponsibilities).toHaveCount(3);
        await expect(primaryResponsibilities).toHaveText([
          "Institution indicators · custom",
          "Academic reports · custom",
          "Financial reports · custom",
        ]);

        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto("/home");
        const executiveWorkspace = page.getByTestId("institutional-executive-workspace");
        await expect(executiveWorkspace).toBeVisible();
        await expect(
          executiveWorkspace.getByText("Synthetic executive workspace ready"),
        ).toBeVisible();
        await expect(
          page.getByRole("navigation", { name: "Primary sections" }).getByRole("link"),
        ).toHaveCount(3);
        await page.screenshot({
          path: testInfo.outputPath(`executive-${roleCase.label}-390.png`),
          fullPage: true,
          scale: "css",
        });
        await page.getByRole("link", { name: "Open Attendance" }).click();
        await expect(page).toHaveURL(/\/admin\/analytics/);

        await page.goto("/home");
        await page.setViewportSize({ width: 1440, height: 1000 });
        await expect(page.getByTestId("institutional-executive-workspace")).toBeVisible();
        await page.screenshot({
          path: testInfo.outputPath(`executive-${roleCase.label}-1440.png`),
          fullPage: true,
          scale: "css",
        });
      } finally {
        await authenticated.auth.signOut();
        await verifier.auth.signOut();
        await cleanupLegacyFixture(fixture);
      }
    });
  }
});
