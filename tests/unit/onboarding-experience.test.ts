/**
 * M008 — organization request page copy and field contract.
 * M5 part B (ADR-108): the page now posts to the intake endpoint; mailto is only a fallback.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildOnboardingMailto } from "@/lib/auth/onboarding-request";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (ref: string) => readFileSync(join(ROOT, ref), "utf8");

const SCREEN = "frontend/src/components/app-entry/app-onboarding-screen.tsx";
const ROUTE = "frontend/src/routes/onboarding.tsx";

describe("onboarding experience copy", () => {
  const screen = read(SCREEN).replace(/\s+/g, " ");
  const route = read(ROUTE).replace(/\s+/g, " ");

  it("uses the owner copy for the heading, steps, form, and privacy note", () => {
    for (const line of [
      "Bring your school into Sherivs.",
      "Request an administrator account to set up your organization, configure school operations, and invite your community into Sherivs Scholar.",
      "What happens next",
      "Submit your request",
      "Share your organization details and administrator contact information.",
      "Account provisioning",
      "The Sherivs team reviews your request and provisions your organization administrator account.",
      "Set up your school",
      "Configure your school operations and invite authorized administrators, staff, teachers, students, and parents as appropriate.",
      "Your request starts the onboarding process. Account access is provided after administrator provisioning.",
      "Organization details",
      "Tell us about your school and the administrator responsible for setting it up.",
      "Request administrator access",
      "Share only the information needed to process your request. Never include passwords.",
    ]) {
      expect(screen, line).toContain(line);
    }
    expect(route).toContain("Bring your school into Sherivs —");
  });

  it("keeps the existing fields and adds the intake fields the request record needs", () => {
    expect(screen).toContain("Organization name");
    expect(screen).toContain("Full name");
    expect(screen).toContain("Work email");
    expect(screen).toContain("Role or title");
    expect(screen).toContain("Message ");
    expect(screen).toContain("Organization type");
    expect(screen).toContain('type="tel"');
    expect(screen).toContain('name="website"');
  });

  it("posts to the intake endpoint; mailto is only a fallback, and success is honest", () => {
    expect(screen).toContain("useIntakeForm");
    expect(screen).not.toContain("window.location.href = href");
    expect(screen).toContain("form.showFallback ?");
    expect(screen).toContain("we will continue your interview by link");
    expect(screen).toContain("No account has been created yet.");
    expect(screen).not.toMatch(/submitted successfully|ticket was created/i);
    expect(screen).not.toContain("signUp");
    expect(screen).not.toContain("Scholar is");
    expect(screen).not.toContain("Scholar's");
    expect(route).not.toContain("opens your email app");
  });

  it("identifies invalid fields for assistive technology", () => {
    expect(screen).toContain("aria-invalid");
    expect(screen).toContain("aria-describedby");
    expect(screen).toContain('role="alert"');
    expect(screen).toContain("noValidate");
    expect(screen).toContain('role="alert"');
  });

  it("the fallback mailto does not invent a ticket id", () => {
    const { href } = buildOnboardingMailto({
      organization: "Northwind",
      name: "Ada",
      email: "ada@northwind.edu",
      role: "",
      message: "Please provision our admin.",
    });
    expect(href.startsWith("mailto:hello@sherivs.com?")).toBe(true);
    expect(decodeURIComponent(href)).not.toMatch(/ticket/i);
  });
});
