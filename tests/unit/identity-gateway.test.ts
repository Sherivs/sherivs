/**
 * Sherivs Identity Gateway — LOGIN does not imply Scholar.
 */
import { describe, expect, it } from "vitest";
import { resolveIdentityGateway } from "@/lib/identity/identity-gateway";
import { classifyExperiencePath } from "@/lib/experience/experience-planes";
import { PLATFORM_NAME, LEGACY_PLATFORM_IDENTIFIER } from "@/lib/platform";

describe("identity gateway", () => {
  it("sends unsigned platform visitors to the Sherivs public plane", () => {
    const decision = resolveIdentityGateway({
      authenticated: false,
      role: null,
      superAdmin: false,
      tenantSlug: null,
      hasOrganizationMembership: false,
      installedRuntimeId: null,
    });
    expect(decision.plane).toBe("public_sherivs");
    expect(decision.destination).toBeNull();
    expect(decision.reason).toBe("sherivs_public");
  });

  it("sends unsigned tenant visitors to the organization public plane", () => {
    const decision = resolveIdentityGateway({
      authenticated: false,
      role: null,
      superAdmin: false,
      tenantSlug: "northwind",
      hasOrganizationMembership: false,
      installedRuntimeId: "runtime:scholar",
    });
    expect(decision.plane).toBe("public_organization");
    expect(decision.destination).toBeNull();
  });

  it("routes super-admins to Sherivs internal, never a school portal", () => {
    const decision = resolveIdentityGateway({
      authenticated: true,
      role: "super_admin",
      superAdmin: true,
      tenantSlug: null,
      hasOrganizationMembership: false,
      installedRuntimeId: "runtime:scholar",
    });
    expect(decision.plane).toBe("sherivs_internal");
    expect(decision.destination).toBe("/super-admin/dashboard");
    expect(decision.reason).toBe("internal_operator");
  });

  it("does not send unlinked identities into Scholar", () => {
    const decision = resolveIdentityGateway({
      authenticated: true,
      role: null,
      superAdmin: false,
      tenantSlug: null,
      hasOrganizationMembership: false,
      installedRuntimeId: "runtime:scholar",
    });
    expect(decision.destination).toBe("/auth");
    expect(decision.reason).toBe("unlinked_identity");
  });

  it("opens Scholar only after membership + scholar runtime resolve", () => {
    const decision = resolveIdentityGateway({
      authenticated: true,
      role: "teacher",
      superAdmin: false,
      tenantSlug: null,
      hasOrganizationMembership: true,
      installedRuntimeId: "runtime:scholar",
    });
    expect(decision.plane).toBe("organization_workspace");
    expect(decision.destination).toBe("/teacher/dashboard");
    expect(decision.reason).toBe("scholar_runtime");
  });

  it("uses the domain-neutral workspace when the org runtime is not Scholar", () => {
    const decision = resolveIdentityGateway({
      authenticated: true,
      role: "teacher",
      superAdmin: false,
      tenantSlug: null,
      hasOrganizationMembership: true,
      installedRuntimeId: "runtime:future",
    });
    expect(decision.destination).toBe("/runtime");
    expect(decision.reason).toBe("domain_neutral_workspace");
  });
});

describe("experience planes", () => {
  it("classifies canonical surfaces onto exactly one plane", () => {
    expect(classifyExperiencePath("/").plane).toBe("public_sherivs");
    expect(classifyExperiencePath("/", { tenantPublicHome: true }).plane).toBe(
      "public_organization",
    );
    expect(classifyExperiencePath("/teacher/dashboard").plane).toBe("organization_workspace");
    expect(classifyExperiencePath("/super-admin/tenants").plane).toBe("sherivs_internal");
    expect(classifyExperiencePath("/coregrid").legacyPath).toBe("/coregrid");
    expect(classifyExperiencePath("/platform/org").plane).toBe("sherivs_internal");
    expect(classifyExperiencePath("/foundation-loop").plane).toBe("sherivs_internal");
    expect(classifyExperiencePath("/signin").plane).toBe("public_sherivs");
  });
});

describe("platform brand", () => {
  it("presents Sherivs publicly and marks CoreGrid as LEGACY", () => {
    expect(PLATFORM_NAME).toBe("Sherivs");
    expect(LEGACY_PLATFORM_IDENTIFIER).toBe("CoreGrid");
  });
});
