import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mig = readFileSync(
  "database/supabase/migrations/20261020000160_sherivs_009_support_access.sql",
  "utf8",
);
const fns = readFileSync("frontend/src/lib/platform-staff/support-access.functions.ts", "utf8");

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
});
