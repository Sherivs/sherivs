/**
 * SHERIVS ORGANIZATION ONBOARDING (§21) + REALITY READ-MODEL (Milestone 9).
 *
 * Pins the pure contracts of the onboarding pipeline and the organization
 * reality read-model:
 *
 *   1. The runtime catalog offers exactly ONE selectable runtime at V1
 *      (AGENTS.md §45) and honestly marks the rest "in development".
 *   2. Slug selection can never yield a platform-reserved subdomain.
 *   3. The wizard's step derivation only completes on valid input.
 *   4. Substrate failures map to founder-safe messages — never raw
 *      database errors.
 *   5. Organization lifecycle state derives from verified truth only
 *      (Constitution §9) — active+onboarded = operational, etc.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ONBOARDING_STEPS,
  RESERVED_SLUGS,
  RUNTIME_OFFERS,
  currentStep,
  findRuntimeOffer,
  mapProvisioningError,
  onboardingInputSchema,
  provisioningErrorMessage,
  slugSchema,
  stepCompleted,
} from "@/lib/onboarding/organization-onboarding";
import {
  deriveOrganizationState,
  organizationStateLabel,
} from "@/lib/reality/organization-reality";

describe("Runtime catalog (V1 envelope)", () => {
  it("offers exactly one selectable runtime", () => {
    const available = RUNTIME_OFFERS.filter((r) => r.available);
    expect(available).toHaveLength(1);
    expect(available[0].id).toBe("scholar");
    expect(available[0].label).toMatch(/Sherivs Scholar/);
  });

  it("marks future runtimes as unavailable — never silently selectable", () => {
    for (const offer of RUNTIME_OFFERS) {
      if (!offer.available) {
        expect(findRuntimeOffer(offer.id)?.available).toBe(false);
      }
    }
  });
});

describe("Workspace address (slug) contract", () => {
  it.each(["my-school", "acme2", "a-b-c"])("accepts a valid slug: %s", (slug) => {
    expect(slugSchema.safeParse(slug).success).toBe(true);
  });

  it.each([
    "www",
    "app",
    "api",
    "admin",
    "dashboard",
    "-leading",
    "trailing-",
    "has space",
  ])("rejects an invalid or reserved slug: %s", (slug) => {
    expect(slugSchema.safeParse(slug).success).toBe(false);
  });

  it("normalizes case input but enforces the shape after normalization", () => {
    const parsed = slugSchema.safeParse("UPPER");
    expect(parsed.success).toBe(true);
  });

  it("reservations mirror the tenant resolver — every reserved slug is rejected", () => {
    for (const slug of RESERVED_SLUGS) {
      expect(slugSchema.safeParse(slug).success).toBe(false);
    }
  });
});

describe("Wizard step derivation", () => {
  it("walks identity → runtime → profile → review only on valid input", () => {
    const empty = {};
    expect(currentStep(empty)).toBe("identity");

    const identityDone = { organizationName: "Acme Academy" };
    expect(currentStep(identityDone)).toBe("runtime");

    const runtimeDone = { ...identityDone, runtime: "scholar" };
    expect(currentStep(runtimeDone)).toBe("profile");

    const profileDone = { ...runtimeDone, organizationSlug: "acme", founderName: "Ada Founder" };
    expect(currentStep(profileDone)).toBe("review");
  });

  it("never reports a terminal step as complete", () => {
    expect(stepCompleted("review", {})).toBe(false);
  });

  it("requires a provisionable runtime — a frozen future runtime does not unblock the wizard", () => {
    expect(stepCompleted("runtime", { runtime: "commerce" })).toBe(false);
    expect(stepCompleted("runtime", { runtime: "scholar" })).toBe(true);
  });

  it("orders the steps exactly as directive §21", () => {
    expect(ONBOARDING_STEPS).toEqual(["identity", "runtime", "profile", "review"]);
  });
});

describe("Full input validation", () => {
  it("accepts a complete founder submission", () => {
    const parsed = onboardingInputSchema.safeParse({
      organizationName: "Acme Academy",
      organizationSlug: "Acme-Academy",
      founderName: "Ada Founder",
      runtime: "scholar",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.organizationSlug).toBe("acme-academy");
  });

  it("rejects a frozen runtime at the boundary", () => {
    expect(
      onboardingInputSchema.safeParse({
        organizationName: "Acme Clinic",
        organizationSlug: "acme-clinic",
        founderName: "Ada Founder",
        runtime: "health",
      }).success,
    ).toBe(false);
  });
});

describe("Provisioning failure mapping (§43 — no raw substrate errors)", () => {
  it("maps a slug collision", () => {
    expect(
      mapProvisioningError('duplicate key value violates unique constraint "schools_slug_key"'),
    ).toBe("SLUG_TAKEN");
  });

  it("maps an already-linked founder", () => {
    expect(mapProvisioningError("FOUNDER_ALREADY_LINKED")).toBe("FOUNDER_ALREADY_LINKED");
  });

  it("maps anything else to UNKNOWN — and the copy never leaks substrate text", () => {
    const err = mapProvisioningError("relation does not exist");
    expect(err).toBe("UNKNOWN");
    for (const known of ["SLUG_TAKEN", "FOUNDER_ALREADY_LINKED", "UNKNOWN"] as const) {
      expect(provisioningErrorMessage(known)).not.toMatch(/duplicate|relation|pg_|sql|stack/i);
    }
  });
});

describe("Organization reality read-model (Milestone 9)", () => {
  it("derives lifecycle state from verified truth only", () => {
    expect(deriveOrganizationState({ isActive: false, onboardingCompleted: true })).toBe("inactive");
    expect(deriveOrganizationState({ isActive: true, onboardingCompleted: false })).toBe("onboarding");
    expect(deriveOrganizationState({ isActive: true, onboardingCompleted: true })).toBe("operational");
  });

  it("labels every state — no unrendered state can escape the model", () => {
    for (const state of ["onboarding", "operational", "inactive"] as const) {
      expect(organizationStateLabel(state)).toBeTruthy();
    }
  });
});

describe("Reality exposure inside the runtime workspace (Milestone 9 presentation)", () => {
  const ROOT = fileURLToPath(new URL("../..", import.meta.url));

  it("removes the hardcoded workspace dashboard, reality card, and authenticated shell", () => {
    expect(existsSync(join(ROOT, "frontend/src/routes/_authenticated/admin/dashboard.tsx"))).toBe(
      false,
    );
    expect(
      existsSync(join(ROOT, "frontend/src/components/reality/organization-reality-card.tsx")),
    ).toBe(false);
    expect(existsSync(join(ROOT, "frontend/src/routes/_authenticated/route.tsx"))).toBe(false);
  });
});
