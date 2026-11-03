import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROLE_SCOPE_TYPES } from "@/lib/workspaces/contract";
import { tenantHierarchySchema } from "@/lib/tenancy/model";

const migration = readFileSync(
  "database/supabase/migrations/20261102180300_sherivs_m04_tenant_authority_links.sql",
  "utf8",
);
const rollback = readFileSync(
  "database/supabase/rollbacks/20261102180300_sherivs_m04_tenant_authority_links.sql",
  "utf8",
);
const harness = readFileSync("tests/integration/m04-tenant-authority.local.sql", "utf8");

describe("M04 tenant hierarchy", () => {
  it("supports organization, campus, and shift assignment scopes", () => {
    expect(ROLE_SCOPE_TYPES).toEqual(
      expect.arrayContaining(["org", "institution", "campus", "shift"]),
    );
  });

  it("validates the authenticated hierarchy contract, including legacy unassigned shifts", () => {
    expect(
      tenantHierarchySchema.parse({
        organization: { id: "54000000-0000-4000-8000-0000000000a1", name: "Synthetic Org" },
        campuses: [
          {
            id: "54000000-0000-4000-8000-0000000000a2",
            name: "Synthetic Campus",
            code: null,
            isActive: true,
            shifts: [
              {
                id: "54000000-0000-4000-8000-0000000000a3",
                name: "Synthetic Shift",
                kind: "morning",
                startsAt: null,
                endsAt: null,
              },
            ],
          },
        ],
        unassignedShifts: [],
      }).campuses,
    ).toHaveLength(1);
    expect(() =>
      tenantHierarchySchema.parse({
        organization: { id: "invalid", name: "Synthetic Org" },
        campuses: [],
        unassignedShifts: [],
      }),
    ).toThrow();
  });

  it("adds forced tenant isolation, audited evidence-gated verification, and a rollback", () => {
    expect(migration).toContain("FOREIGN KEY (campus_id, school_id)");
    expect(migration).toContain(
      "ALTER TABLE public.institution_authority_links FORCE ROW LEVEL SECURITY",
    );
    expect(migration).toContain(
      "ALTER TABLE public.institution_authority_link_audit FORCE ROW LEVEL SECURITY",
    );
    expect(migration).toContain("verified authority links require evidence_url");
    expect(migration).toContain(
      "OLD.verification_status = 'verified' THEN OLD.verified_by ELSE v_actor",
    );
    expect(migration).toContain("authority-link changes require an authenticated, audited actor");
    expect(migration).toContain("public.read_my_tenant_hierarchy()");
    expect(migration).not.toMatch(/INSERT\s+INTO\s+public\.institution_authority_links/i);
    expect(rollback).toContain("DROP TABLE IF EXISTS public.institution_authority_links");
    expect(harness).toContain("cross-tenant organization is isolated");
    expect(harness).toContain("cross-tenant campus is isolated");
    expect(harness).toContain("cross-tenant shift is isolated");
    expect(harness).toContain("verified link audit attributes the actor");
    expect(harness).toContain("unrelated edits preserve verification stamp");
    expect(harness).toContain("ROLLBACK;");
  });
});
