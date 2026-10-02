/**
 * CoreGrid Scholar — persistence, marketplace and experience-memory laws
 * (WAVE-R37 + R38).
 *
 * R37: assignments and grants are tenant policy data that the feature gate
 *      consumes — validated shape, revoked grants ignored, unknown capabilities
 *      rejected, and the SQL surface machine-checked against its server functions.
 * R38: the marketplace catalog is PUBLISHED from reality through the existing P27
 *      contracts (never hand-written), installs are entitlement-gated, and
 *      experience memory is consent-, purpose-, tenant- and retention-bound with
 *      a real forget path.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEntitlement, entitlementId } from "@/lib/marketplace-entitlement";
import { marketplaceProductId } from "@/lib/marketplace-core";
import { tenantId } from "@/lib/tenant-core";
import {
  activeGrantsByRole,
  applyGrantsToRoles,
  auditRoleAssignmentRows,
  isAssignmentInForce,
  roleIdsForIdentity,
  type RoleAssignmentRow,
  type RoleGrantRow,
} from "@/lib/scholar/roles/role-assignment-store";
import {
  EDUCATION_REALITY_ROLES,
  EDUCATION_REALITY_ROLE_IDS,
} from "@/lib/scholar/roles/role-registry";
import { publishRealityListings } from "@/lib/scholar/marketplace/listing-publisher";
import { decideInstall } from "@/lib/scholar/marketplace/install-gate";
import {
  MAX_RETENTION_DAYS,
  auditExperienceMemory,
  forgetExperienceMemory,
  readExperienceMemory,
  recordExperienceMemory,
} from "@/lib/scholar/experience/experience-memory";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATION =
  "database/supabase/migrations/20260907000800_coregrid_role_assignment_substrate.sql";
const FUNCTIONS_FILE = "frontend/src/lib/runtime/scholar/scholar-role-assignments.functions.ts";

const RPC_NAMES = [
  "list_role_assignments",
  "assign_role",
  "end_role_assignment",
  "list_role_grants",
  "grant_role_capability",
  "revoke_role_capability",
] as const;

const assignment = (over: Partial<RoleAssignmentRow> = {}): RoleAssignmentRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  identity_ref: "22222222-2222-4222-8222-222222222222",
  role_id: "role:subject-teacher",
  status: "active",
  started_on: "2026-01-01",
  ended_on: null,
  ...over,
});

const grant = (over: Partial<RoleGrantRow> = {}): RoleGrantRow => ({
  id: "33333333-3333-4333-8333-333333333333",
  role_id: "role:subject-teacher",
  capability: "academic-intelligence",
  granted_by: "44444444-4444-4444-8444-444444444444",
  granted_on: "2026-01-01T00:00:00.000Z",
  revoked_on: null,
  ...over,
});

describe("R37 — assignment & grant store laws", () => {
  it("only counts live, in-window assignments", () => {
    const at = "2026-06-01T00:00:00.000Z";
    expect(isAssignmentInForce(assignment(), at)).toBe(true);
    expect(isAssignmentInForce(assignment({ status: "ended" }), at)).toBe(false);
    expect(isAssignmentInForce(assignment({ started_on: "2026-07-01" }), at)).toBe(false);
    expect(isAssignmentInForce(assignment({ ended_on: "2026-05-01" }), at)).toBe(false);
    expect(isAssignmentInForce(assignment(), "not-a-date")).toBe(false);
  });

  it("resolves the role ids an identity holds right now", () => {
    const rows = [
      assignment(),
      assignment({ id: "55555555-5555-4555-8555-555555555555", role_id: "role:bursar" }),
      assignment({
        id: "66666666-6666-4666-8666-666666666666",
        role_id: "role:principal",
        status: "ended",
      }),
    ];
    expect(roleIdsForIdentity(rows, "2026-06-01T00:00:00.000Z")).toEqual([
      "role:bursar",
      "role:subject-teacher",
    ]);
  });

  it("applies active grants and rejects capabilities the kernel does not own", () => {
    const grants = [
      grant(),
      grant({ id: "77777777-7777-4777-8777-777777777777", capability: "invented-ability" }),
      grant({
        id: "88888888-8888-4888-8888-888888888888",
        capability: "scheduling",
        revoked_on: "2026-02-01T00:00:00.000Z",
      }),
    ];
    expect(activeGrantsByRole(grants).get("role:subject-teacher")).toEqual([
      "academic-intelligence",
      "invented-ability",
    ]);

    const merged = applyGrantsToRoles(EDUCATION_REALITY_ROLES, grants);
    const teacher = merged.roles.find((role) => role.id === "role:subject-teacher");
    expect(teacher?.permissions).toEqual(["academic-intelligence"]);
    expect(merged.rejected).toEqual([
      'role:subject-teacher: unknown capability "invented-ability"',
    ]);
  });

  it("audits rows: unknown roles, unknown capabilities and duplicate live grants", () => {
    const issues = auditRoleAssignmentRows(
      [
        assignment(),
        assignment({ id: "99999999-9999-4999-8999-999999999999" }),
        assignment({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role_id: "role:not-a-role" }),
      ],
      [
        grant(),
        grant({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", capability: "not-a-capability" }),
      ],
      EDUCATION_REALITY_ROLE_IDS,
    ).join(" | ");
    expect(issues).toMatch(/duplicate live assignment/);
    expect(issues).toMatch(/unknown role "role:not-a-role"/);
    expect(issues).toMatch(/unknown capability "not-a-capability"/);
  });

  it("keeps the SQL surface and the server functions in lockstep", () => {
    const sql = readFileSync(join(ROOT, MIGRATION), "utf8");
    const functions = readFileSync(join(ROOT, FUNCTIONS_FILE), "utf8");

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.cg_role_assignment");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.cg_role_grant");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON TABLE public.cg_role_assignment, public.cg_role_grant");
    expect(sql).toContain("GRANT ALL ON TABLE public.cg_role_assignment, public.cg_role_grant");
    expect(sql).toContain("public.is_school_admin()");
    expect(sql).toContain("auth.uid()");

    for (const rpc of RPC_NAMES) {
      expect(sql, `migration defines ${rpc}`).toContain(`FUNCTION public.${rpc}(`);
      // The call may be formatted across lines, so assert the quoted name and
      // that every name is reached through `.rpc(`.
      expect(functions, `server functions call ${rpc}`).toContain(`"${rpc}"`);
    }
    expect(functions.match(/\.rpc\(/g)?.length ?? 0).toBeGreaterThanOrEqual(RPC_NAMES.length);
  });
});

describe("R38 — marketplace publishing and install gate", () => {
  const BOARDING = {
    featureKeys: ["curriculum.core", "schedule.boarding", "community.private"],
    templateRefs: ["boarding_school"],
  };
  const DAY = {
    featureKeys: ["curriculum.core", "schedule.day_full"],
    templateRefs: ["public_day"],
  };

  it("publishes one listing per installed feature code, verified-vendor only", () => {
    const result = publishRealityListings({ reality: BOARDING, vendorRef: "vendor:coregrid" });
    expect(result.ok).toBe(true);
    expect(result.listings.length).toBeGreaterThan(5);
    const codes = result.listings.map((entry) => entry.featureCode);
    expect(codes).toContain("r001.boarding.manage");
    expect(codes).not.toContain("r001.vocational.workshop");
    // Trust is never self-asserted, and nothing is published until reviewed.
    expect(result.listings.every((entry) => entry.product.trustLevel === "unverified")).toBe(true);
    expect(result.listings.every((entry) => entry.listing.publishedAt === null)).toBe(true);

    const day = publishRealityListings({ reality: DAY, vendorRef: "vendor:coregrid" });
    expect(day.listings.map((entry) => entry.featureCode)).not.toContain("r001.boarding.manage");
  });

  it("refuses to publish without a vendor or with a bad version", () => {
    expect(publishRealityListings({ reality: DAY, vendorRef: "  " }).ok).toBe(false);
    expect(
      publishRealityListings({
        reality: DAY,
        vendorRef: "vendor:x",
        bundleVersion: "1.0",
      }).issues.join(" "),
    ).toMatch(/must be semver/);
  });

  it("gates installation on tenant, code, duplication and entitlement", () => {
    const created = createEntitlement({
      id: entitlementId("ent:1"),
      tenantId: tenantId("tenant:a"),
      productId: marketplaceProductId("scholar.r001.academics.grade"),
      source: "institution_plan",
      scopeKind: "tenant",
      scopeRef: "tenant:a",
    });
    if (!created.ok) throw new Error(created.error);
    const entitlements = [created.entitlement];

    expect(
      decideInstall({
        tenantId: null,
        featureCode: "r001.academics.grade",
        installedCodes: [],
        entitlements,
      }).allowed,
    ).toBe(false);
    expect(
      decideInstall({
        tenantId: "tenant:a",
        featureCode: "r001.nope.nope",
        installedCodes: [],
        entitlements,
      }).allowed,
    ).toBe(false);
    expect(
      decideInstall({
        tenantId: "tenant:a",
        featureCode: "r001.academics.grade",
        installedCodes: ["r001.academics.grade"],
        entitlements,
      }).reasons.join(" "),
    ).toMatch(/already installed/);
    expect(
      decideInstall({
        tenantId: "tenant:a",
        featureCode: "r001.academics.grade",
        installedCodes: [],
        entitlements: [],
      }).allowed,
    ).toBe(false);

    const allowed = decideInstall({
      tenantId: "tenant:a",
      featureCode: "r001.academics.grade",
      installedCodes: [],
      entitlements,
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.entitlementRefs).toEqual(["ent:1"]);
  });
});

describe("R38 — experience memory is consent-, purpose- and retention-bound", () => {
  const request = {
    id: "mem:1",
    tenantId: "tenant:a",
    subjectId: "user:1",
    purpose: "workspace_personalisation" as const,
    key: "landing_workspace",
    value: "boarding",
    consentGranted: true,
    recordedAt: "2026-09-01T00:00:00.000Z",
    retentionDays: 90,
  };

  it("refuses to remember without consent, scope or a sane retention", () => {
    expect(recordExperienceMemory({ ...request, consentGranted: false }).ok).toBe(false);
    expect(recordExperienceMemory({ ...request, tenantId: null }).reasons.join(" ")).toMatch(
      /tenant/,
    );
    expect(recordExperienceMemory({ ...request, subjectId: null }).reasons.join(" ")).toMatch(
      /subject/,
    );
    expect(
      recordExperienceMemory({ ...request, retentionDays: MAX_RETENTION_DAYS + 1 }).reasons.join(
        " ",
      ),
    ).toMatch(/retentionDays/);
    expect(
      recordExperienceMemory({
        ...request,
        containsPersonalData: true,
        consentGranted: false,
      }).reasons.join(" "),
    ).toMatch(/explicit consent/);
  });

  it("stores a consented record with a bounded expiry and reads it back scoped", () => {
    const recorded = recordExperienceMemory(request);
    expect(recorded.ok).toBe(true);
    const record = recorded.record;
    if (!record) throw new Error("expected a record");
    expect(record.expiresAt > record.recordedAt).toBe(true);

    const records = [record, { ...record, id: "mem:2", subjectId: "user:2" }];
    expect(
      readExperienceMemory(records, {
        tenantId: "tenant:a",
        subjectId: "user:1",
        now: "2026-09-10T00:00:00.000Z",
      }).map((entry) => entry.id),
    ).toEqual(["mem:1"]);
    // Expired memory is unreadable.
    expect(
      readExperienceMemory(records, {
        tenantId: "tenant:a",
        subjectId: "user:1",
        now: "2027-09-10T00:00:00.000Z",
      }),
    ).toEqual([]);
  });

  it("forgets everything for a subject and audits the store", () => {
    const record = recordExperienceMemory(request).record;
    if (!record) throw new Error("expected a record");
    const { kept, forgotten } = forgetExperienceMemory([record], { subjectId: "user:1" });
    expect(forgotten).toEqual(["mem:1"]);
    expect(kept).toEqual([]);

    expect(
      auditExperienceMemory(
        [{ ...record, consentGranted: false }],
        "2026-09-10T00:00:00.000Z",
      ).join(" "),
    ).toMatch(/without consent/);
    expect(auditExperienceMemory([record], "2027-09-10T00:00:00.000Z").join(" ")).toMatch(
      /expired record retained/,
    );
  });
});
