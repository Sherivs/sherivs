import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PLATFORM_ROLE_CAPABILITIES,
  PLATFORM_ROLE_CODES,
  canTransition,
  capabilitiesForRoles,
  visibleInternalSections,
} from "@/lib/platform-staff/catalogue";
import { resolveIdentity } from "@/lib/identity/identity";
import { identityFromAppState } from "@/lib/identity/context";

const migration = readFileSync(
  "database/supabase/migrations/20261020000150_sherivs_008_platform_staff.sql",
  "utf8",
);
// Capabilities added to a seeded role by a later migration (append-only to the array).
const LATER_GRANTS: Record<string, { file: string; caps: string[] }> = {
  platform_admin: { file: "database/supabase/migrations/20261024000350_sherivs_028_gov_admin_topup_reconcile.sql", caps: ["platform.gov.manage"] },
};
const fns = readFileSync("frontend/src/lib/platform-staff/staff.functions.ts", "utf8");

describe("platform role catalogue mirrors the migration seed", () => {
  it.each(PLATFORM_ROLE_CODES)("%s capabilities match", (code) => {
    const line = migration.split("\n").findIndex((l) => l.includes(`('${code}',`));
    expect(line).toBeGreaterThan(-1);
    const block = migration
      .split("\n")
      .slice(line, line + 3)
      .join("\n");
    const later = LATER_GRANTS[code];
    for (const cap of PLATFORM_ROLE_CAPABILITIES[code]) {
      if (later?.caps.includes(cap)) {
        const sql = readFileSync(later.file, "utf8");
        expect(sql).toMatch(new RegExp(`array_append\\(capabilities, '${cap.replace(/\./g, "\\.")}'\\)[\\s\\S]*code = '${code}'`));
      } else expect(block).toContain(`'${cap}'`);
    }
  });
});

describe("migration security posture", () => {
  it("revokes client writes and enables RLS on every staff table", () => {
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\.platform_roles, public\.platform_staff, public\.platform_staff_roles\s+FROM PUBLIC, anon, authenticated/,
    );
    expect(migration).toMatch(
      /GRANT SELECT ON TABLE public\.platform_roles, public\.platform_staff, public\.platform_staff_roles\s+TO authenticated;/,
    );
    for (const t of ["platform_roles", "platform_staff", "platform_staff_roles"])
      expect(migration).toContain(`ALTER TABLE public.${t}`);
    expect(migration).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*TO authenticated/);
  });
  it("helpers are SECURITY DEFINER with an empty search_path", () => {
    expect(migration.match(/SECURITY DEFINER SET search_path = ''/g)?.length).toBe(3);
  });
});

describe("staff server functions", () => {
  it("every exported server fn runs the super-admin gate", () => {
    const exported = fns.match(/export const \w+ = createServerFn/g) ?? [];
    expect(exported.length).toBe(5);
    expect(fns.match(/await assertSuper\(context\);/g)?.length).toBe(5);
  });
  it("invites redirect to /reset-password and are audited", () => {
    expect(fns).toContain("/reset-password");
    expect(fns).toContain("inviteUserByEmail");
    expect(fns).toContain('gate: "requirePlatformSuperAdmin"');
  });
});

describe("lifecycle + workspace", () => {
  it("allows only the declared transitions", () => {
    expect(canTransition("invited", "active")).toBe(false);
    expect(canTransition("active", "suspended")).toBe(true);
    expect(canTransition("suspended", "active")).toBe(true);
    expect(canTransition("revoked", "active")).toBe(false);
  });
  it("filters internal sections by capability and super-admin-only", () => {
    const sections = [
      {
        key: "a",
        title: "A",
        description: "",
        capability: "platform.tenants.read",
        href: "/a",
        superAdminOnly: false,
      },
      {
        key: "b",
        title: "B",
        description: "",
        capability: "platform.finance.read",
        href: "/b",
        superAdminOnly: false,
      },
      { key: "c", title: "C", description: "", capability: null, href: "/c", superAdminOnly: true },
    ];
    const support = visibleInternalSections(sections, {
      isSuperAdmin: false,
      capabilities: capabilitiesForRoles(["support"]),
    });
    expect(support.map((s) => s.key)).toEqual(["a"]);
    expect(
      visibleInternalSections(sections, { isSuperAdmin: true, capabilities: new Set() }),
    ).toHaveLength(3);
  });
  it("routes active platform staff to /internal", () => {
    const id = identityFromAppState({
      superAdmin: null,
      profile: null,
      school: null,
      platformStaff: {
        id: "x",
        full_name: "S",
        email: "s@x",
        status: "active",
        roles: ["support"],
      },
    });
    expect(id.destination).toBe(
      resolveIdentity({ isSherivsInternal: true, memberships: [] }).destination,
    );
  });
});
