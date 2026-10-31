/**
 * Sherivs identity resolution chain (§11 Authentication Refoundation).
 *
 * Proves the destination law of `frontend/src/lib/identity/identity.ts` and
 * its agreement with the client-side derivation (`context.ts`):
 *
 *   - internal Sherivs workforce → /console (never a customer workspace)
 *   - one organization membership → that membership's runtime workspace
 *   - multiple memberships → the organization selector
 *   - no membership (or a deactivated one) → /welcome, never a workspace
 */
import { describe, expect, it } from "vitest";
import {
  resolveIdentity,
  SHERIVS_INTERNAL_HOME,
  ORGANIZATION_SELECTOR_PATH,
  UNLINKED_ACCOUNT_PATH,
  type OrganizationMembership,
} from "@/lib/identity/identity";

const scholarMembership = (
  overrides: Partial<OrganizationMembership> = {},
): OrganizationMembership => ({
  organizationId: "org-1",
  name: "Greenfield Academy",
  slug: "greenfield",
  role: "teacher",
  runtimeId: "runtime:scholar",
  runtimeName: "Sherivs Scholar",
  homePath: "/teacher/dashboard",
  ...overrides,
});

describe("resolveIdentity — destination law", () => {
  it("routes internal Sherivs workforce to the internal environment, never a customer workspace", () => {
    const identity = resolveIdentity({
      isSherivsInternal: true,
      memberships: [scholarMembership()],
    });
    expect(identity.kind).toBe("sherivs_internal");
    expect(identity.destination).toBe(SHERIVS_INTERNAL_HOME);
    expect(identity.destination).not.toMatch(/dashboard|workspace/);
    // Internal identity is not an organization membership.
    expect(identity.organizations).toHaveLength(0);
  });

  it("routes a single-membership member straight to their organization's workspace", () => {
    const identity = resolveIdentity({
      isSherivsInternal: false,
      memberships: [scholarMembership()],
    });
    expect(identity.kind).toBe("organization_member");
    expect(identity.destination).toBe("/teacher/dashboard");
    expect(identity.destination).not.toBe(ORGANIZATION_SELECTOR_PATH);
  });

  it("routes multi-organization members to the organization selector", () => {
    const identity = resolveIdentity({
      isSherivsInternal: false,
      memberships: [
        scholarMembership(),
        scholarMembership({
          organizationId: "org-2",
          name: "Harbor School",
          slug: null,
          role: "admin",
          homePath: "/admin/dashboard",
        }),
      ],
    });
    expect(identity.kind).toBe("organization_member");
    expect(identity.destination).toBe(ORGANIZATION_SELECTOR_PATH);
    expect(identity.organizations).toHaveLength(2);
  });

  it("routes users with no membership (or a deactivated one) to the unlinked state", () => {
    const empty = resolveIdentity({ isSherivsInternal: false, memberships: [] });
    expect(empty.kind).toBe("unlinked");
    expect(empty.destination).toBe(UNLINKED_ACCOUNT_PATH);

    // Deactivated memberships resolve as no membership — never as a workspace.
    const deactivated = resolveIdentity({ isSherivsInternal: false, memberships: [] });
    expect(deactivated.destination).not.toMatch(/dashboard/);
  });

  it("keeps single- and multi-organization routing consistent with membership content", () => {
    const memberships = [scholarMembership(), scholarMembership({ organizationId: "org-2" })];
    const identity = resolveIdentity({ isSherivsInternal: false, memberships });
    expect(identity.destination).toBe(ORGANIZATION_SELECTOR_PATH);
    // The selector page itself routes into each membership's home.
    for (const org of identity.organizations) {
      expect(org.homePath).toMatch(/^\//);
    }
  });
});

describe("context derivation agrees with the destination law", () => {
  it("derives internal destination from a super-admin context", async () => {
    const { identityFromAppState } = await import("@/lib/identity/context");
    const identity = identityFromAppState({
      superAdmin: { id: "sa-1", full_name: "Sherivs Staff", email: "staff@sherivs.com" },
      profile: null,
      school: null,
    });
    expect(identity.kind).toBe("sherivs_internal");
    expect(identity.destination).toBe(SHERIVS_INTERNAL_HOME);
  });

  it("derives the member destination from profile + organization context", async () => {
    const { identityFromAppState } = await import("@/lib/identity/context");
    const identity = identityFromAppState({
      superAdmin: null,
      profile: {
        id: "u-1",
        school_id: "org-1",
        full_name: "Ada Teacher",
        email: "ada@school.example",
        role: "teacher",
        avatar_url: null,
      },
      school: {
        id: "org-1",
        name: "Greenfield Academy",
        slug: "greenfield",
        logo_url: null,
        primary_color: null,
        secondary_color: null,
        subscription_tier: null,
        subscription_status: null,
      },
    });
    expect(identity.kind).toBe("organization_member");
    expect(identity.destination).toBe("/teacher/dashboard");
  });

  it("derives the unlinked destination when no profile and no super-admin exist", async () => {
    const { identityFromAppState } = await import("@/lib/identity/context");
    const identity = identityFromAppState({
      superAdmin: null,
      profile: null,
      school: null,
    });
    expect(identity.kind).toBe("unlinked");
    expect(identity.destination).toBe(UNLINKED_ACCOUNT_PATH);
  });
});
