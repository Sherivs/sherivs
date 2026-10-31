import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  grantableSupportOrganizations,
  grantableSupportStaff,
} from "@/lib/platform-staff/support-access";

const mig = readFileSync(
  "database/supabase/migrations/20261020000160_sherivs_009_support_access.sql",
  "utf8",
);
const fns = readFileSync("frontend/src/lib/platform-staff/support-access.functions.ts", "utf8");
const screens = readFileSync(
  "frontend/src/components/internal-console/support-access-screens.tsx",
  "utf8",
);
const route = readFileSync("frontend/src/routes/console/team/access.tsx", "utf8");
const workspace = readFileSync(
  "frontend/src/components/internal-console/workspace-screens.tsx",
  "utf8",
);

describe("SHERIVS-009 support access", () => {
  it("bounds every grant to at most 8 hours in the database", () => {
    expect(mig).toMatch(/expires_at <= starts_at \+ interval '8 hours'/);
  });
  it("gives clients read-only access", () => {
    expect(mig).toMatch(
      /REVOKE ALL ON TABLE public\.platform_support_grants FROM PUBLIC, anon, authenticated/,
    );
    expect(mig).toMatch(/GRANT SELECT ON TABLE public\.platform_support_grants TO authenticated;/);
    expect(mig).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*TO authenticated/);
  });
  it("requires the support capability AND a live grant", () => {
    expect(mig).toContain("has_platform_capability('platform.support.handle')");
    expect(mig).toContain("g.revoked_at IS NULL");
    expect(mig).toContain("now() < g.expires_at");
  });
  it("grant/revoke are super-admin gated and every path is audited", () => {
    expect(fns.match(/await assertSuper\(context\);/g)?.length).toBe(2);
    for (const a of [
      "platform_support.grant",
      "platform_support.revoke",
      "platform_support.read",
      "platform_access_review.view",
    ])
      expect(fns).toContain(a);
    expect(fns).toContain('"has_support_access"');
    expect(fns).toContain('assertCapability(context, "platform.audit.read")');
  });
  it("staff may open /internal/* only", () => {
    expect(existsSync("frontend/src/routes/_authenticated/route.tsx")).toBe(false);
  });

  it("selects only active Support or Platform Administration staff and provisioned organizations", () => {
    expect(fns).toContain("SUPPORT_GRANT_MAX_HOURS = 8");
    expect(
      grantableSupportStaff([
        { id: "a", status: "active", roles: ["support"], email: "a@example.com" },
        { id: "b", status: "invited", roles: ["support"], email: "b@example.com" },
        { id: "c", status: "active", roles: ["engineering"], email: "c@example.com" },
        { id: "d", status: "active", roles: ["platform_admin"], email: "d@example.com" },
      ]).map((row) => row.id),
    ).toEqual(["a", "d"]);
    expect(
      grantableSupportOrganizations([
        { schoolId: "11111111-1111-4111-8111-111111111111", displayName: "North" },
        { schoolId: null, displayName: "Draft" },
        { schoolId: "", displayName: "Empty" },
      ]).map((row) => row.displayName),
    ).toEqual(["North"]);
  });

  it("wires grant, revoke, and authorized summary into the console UI", () => {
    expect(route).toContain("support-access-screens");
    expect(screens).toContain("grantSupportAccess");
    expect(screens).toContain("revokeSupportAccess");
    expect(screens).toContain("readSupportTenantSummary");
    expect(screens).toContain("listSupportGrants");
    expect(screens).toContain("consoleVisualFixtureActive()");
    expect(screens).toContain("Create support grant");
    expect(screens).toContain("Read authorized summary");
    expect(workspace).toContain("SupportTenantPanel");
    expect(screens).not.toMatch(/Scholar remains/);
  });
});
