import { describe, expect, it } from "vitest";
import {
  AUTHORITY_LINK_EVIDENCE_PREFIX,
  resolveWorkspaceManifest,
  type WorkspaceResolutionData,
} from "../../frontend/src/lib/workspaces/manifest-resolver";
import type { RoleAssignment, RoleTemplate } from "../../frontend/src/lib/workspaces/contract";

const role: RoleTemplate = {
  id: "template:admin",
  code: "admin",
  label: "Demo administrator",
  category: "administrative_operations",
  responsibilities: [
    {
      id: "r:people",
      code: "people",
      label: "People",
      kind: "core",
      permissionCodes: ["staff.view"],
      dailyPriority: 1,
      primaryNav: { id: "people", label: "People" },
      widgets: ["staff-today"],
    },
    {
      id: "r:finance",
      code: "finance",
      label: "Finance",
      kind: "core",
      permissionCodes: ["finance.view"],
      dailyPriority: 2,
      primaryNav: { id: "finance", label: "Finance" },
    },
    {
      id: "r:operations",
      code: "operations",
      label: "Operations",
      kind: "core",
      permissionCodes: ["operations.view"],
      dailyPriority: 3,
      primaryNav: { id: "operations", label: "Operations" },
    },
    {
      id: "r:acting-principal",
      code: "acting-principal",
      label: "Acting principal",
      kind: "add_on",
      permissionCodes: ["institution.manage"],
      dailyPriority: 0,
      primaryNav: { id: "leadership", label: "Leadership" },
      assistantRecommendations: ["Review pending approvals"],
    },
  ],
  permissions: [],
  approvalAuthorities: [],
  reportingRelationships: [],
};

const assignment = (
  id: string,
  userId: string,
  tenantId: string,
  scopeType: RoleAssignment["scopeType"] = "institution",
): RoleAssignment => ({
  id,
  tenantId,
  userId,
  roleTemplateId: role.id,
  scopeType,
  scopeRef: null,
  validFrom: "2026-01-01T00:00:00.000Z",
  temporary: false,
  evidence: [],
  restrictions: [],
  status: "active",
});

const institution = { id: "school-a", category: "administrative_operations" as const };
const at = "2026-06-01T00:00:00.000Z";

describe("resolveWorkspaceManifest", () => {
  it("returns only assigned responsibilities and exactly three priority-ordered nav sections", () => {
    const data: WorkspaceResolutionData = {
      assignments: [
        assignment("assignment-a", "user-a", "school-a"),
        assignment("assignment-b", "user-b", "school-a"),
        assignment("assignment-c", "user-a", "school-b"),
      ],
      responsibilityGrants: [
        {
          id: "grant-active",
          assignmentId: "assignment-a",
          responsibilityId: "r:acting-principal",
          validFrom: "2026-05-01T00:00:00.000Z",
          validUntil: "2026-07-01T00:00:00.000Z",
        },
        {
          id: "grant-expired",
          assignmentId: "assignment-a",
          responsibilityId: "r:acting-principal",
          validFrom: "2026-01-01T00:00:00.000Z",
          validUntil: "2026-05-01T00:00:00.000Z",
        },
      ],
      roleTemplates: [role],
    };

    const manifest = resolveWorkspaceManifest({ id: "user-a" }, institution, data, at);

    expect(manifest?.sidePanel.map((item) => item.id)).toEqual([
      "leadership",
      "people",
      "finance",
      "operations",
    ]);
    expect(manifest?.sidePanel.map((item) => item.kind)).toEqual([
      "add_on",
      "core",
      "core",
      "core",
    ]);
    expect(manifest?.primaryNav).toHaveLength(3);
    expect(manifest?.widgets).toEqual(["staff-today"]);
    expect(manifest?.assistantRecommendations).toEqual(["Review pending approvals"]);

    const afterGrantExpiry = resolveWorkspaceManifest(
      { id: "user-a" },
      institution,
      data,
      "2026-08-01T00:00:00.000Z",
    );
    expect(afterGrantExpiry?.sidePanel.map((item) => item.id)).toEqual([
      "people",
      "finance",
      "operations",
    ]);
  });

  it("returns no manifest when the user has no eligible assignment or fewer than three nav sections", () => {
    const noAssignments = resolveWorkspaceManifest(
      { id: "user-a" },
      institution,
      { assignments: [], roleTemplates: [role] },
      at,
    );
    const authorityAssignment = resolveWorkspaceManifest(
      { id: "user-a" },
      institution,
      {
        assignments: [assignment("authority", "user-a", "school-a", "authority")],
        roleTemplates: [role],
      },
      at,
    );

    expect(noAssignments).toBeNull();
    expect(authorityAssignment).toBeNull();
  });

  it("only exposes delegated roles during the delegation and source assignment windows", () => {
    const data: WorkspaceResolutionData = {
      assignments: [assignment("assignment-a", "grantor", "school-a")],
      delegations: [
        {
          id: "delegation-a",
          assignmentId: "assignment-a",
          delegateUserId: "delegate",
          validFrom: "2026-05-01T00:00:00.000Z",
          validUntil: "2026-07-01T00:00:00.000Z",
        },
      ],
      roleTemplates: [role],
    };

    expect(resolveWorkspaceManifest({ id: "delegate" }, institution, data, at)).not.toBeNull();
    expect(
      resolveWorkspaceManifest({ id: "delegate" }, institution, data, "2026-08-01T00:00:00.000Z"),
    ).toBeNull();
  });

  it("fails closed for authority-dependent templates without one active verified linked relationship", () => {
    const authorityRole: RoleTemplate = {
      ...role,
      requiresVerifiedAuthorityLink: true,
    };
    const authorityAssignment = {
      ...assignment("authority-assignment", "user-a", "school-a"),
      evidence: [`${AUTHORITY_LINK_EVIDENCE_PREFIX}link-a`],
    };
    const resolve = (
      verificationStatus: "unverified" | "verified",
      effectiveUntil: string | null,
    ) =>
      resolveWorkspaceManifest(
        { id: "user-a" },
        institution,
        {
          assignments: [authorityAssignment],
          roleTemplates: [authorityRole],
          authorityLinks: [
            {
              id: "link-a",
              tenantId: "school-a",
              verificationStatus,
              effectiveFrom: "2026-01-01T00:00:00.000Z",
              effectiveUntil,
            },
          ],
        },
        at,
      );

    expect(resolve("unverified", null)).toBeNull();
    expect(resolve("verified", "2026-05-01T00:00:00.000Z")).toBeNull();
    expect(resolve("verified", null)?.primaryNav).toHaveLength(3);
  });

  it("does not accept an unrelated or ambiguous relationship reference as authority evidence", () => {
    const authorityRole: RoleTemplate = {
      ...role,
      requiresVerifiedAuthorityLink: true,
    };
    const linkedAssignment = {
      ...assignment("authority-assignment", "user-a", "school-a"),
      evidence: [
        `${AUTHORITY_LINK_EVIDENCE_PREFIX}link-a`,
        `${AUTHORITY_LINK_EVIDENCE_PREFIX}link-b`,
      ],
    };
    expect(
      resolveWorkspaceManifest(
        { id: "user-a" },
        institution,
        {
          assignments: [linkedAssignment],
          roleTemplates: [authorityRole],
          authorityLinks: [
            {
              id: "link-a",
              tenantId: "school-a",
              verificationStatus: "verified",
              effectiveFrom: "2026-01-01T00:00:00.000Z",
            },
            {
              id: "link-b",
              tenantId: "school-a",
              verificationStatus: "verified",
              effectiveFrom: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
        at,
      ),
    ).toBeNull();
  });

  it("rejects verified authority evidence from another tenant", () => {
    const authorityRole: RoleTemplate = {
      ...role,
      requiresVerifiedAuthorityLink: true,
    };
    expect(
      resolveWorkspaceManifest(
        { id: "user-a" },
        institution,
        {
          assignments: [
            {
              ...assignment("authority-assignment", "user-a", "school-a"),
              evidence: [`${AUTHORITY_LINK_EVIDENCE_PREFIX}link-a`],
            },
          ],
          roleTemplates: [authorityRole],
          authorityLinks: [
            {
              id: "link-a",
              tenantId: "school-b",
              verificationStatus: "verified",
              effectiveFrom: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
        at,
      ),
    ).toBeNull();
  });
});
