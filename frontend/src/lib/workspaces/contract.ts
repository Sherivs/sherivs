export const RESPONSIBILITY_KINDS = ["core", "add_on", "custom"] as const;
export type ResponsibilityKind = (typeof RESPONSIBILITY_KINDS)[number];

export const WORKSPACE_CATEGORIES = [
  "institutional_executive",
  "academic_teaching",
  "administrative_operations",
  "student_family",
  "government_oversight",
] as const;
export type WorkspaceCategory = (typeof WORKSPACE_CATEGORIES)[number];

export const ROLE_SCOPE_TYPES = [
  "org",
  "class",
  "subject",
  "campus",
  "shift",
  "institution",
  "group",
  "lga",
  "authority",
] as const;
export type RoleScopeType = (typeof ROLE_SCOPE_TYPES)[number];

export interface Permission {
  readonly code: string;
  readonly scopeType: RoleScopeType;
  readonly scopeRef: string | null;
}

export interface ApprovalAuthority {
  readonly permissionCode: string;
  readonly limit?: number | null;
  readonly currency?: string;
  readonly requiresSecondApprover?: boolean;
}

export interface ReportingRelationship {
  readonly reportsToRoleTemplateId: string;
  readonly relationship: string;
  readonly effectiveFrom: string;
  readonly effectiveUntil?: string | null;
}

export interface Responsibility {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly kind: ResponsibilityKind;
  readonly permissionCodes: readonly string[];
  readonly dailyPriority: number;
  readonly primaryNav: {
    readonly id: string;
    readonly label: string;
  };
  readonly widgets?: readonly string[];
  readonly assistantRecommendations?: readonly string[];
}

export type WorkspaceResponsibility = Responsibility;

export interface RoleTemplate {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly category: WorkspaceCategory;
  readonly responsibilities: readonly WorkspaceResponsibility[];
  readonly permissions: readonly Permission[];
  readonly approvalAuthorities: readonly ApprovalAuthority[];
  readonly reportingRelationships: readonly ReportingRelationship[];
}

export interface RoleAssignment {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly roleTemplateId: string;
  readonly scopeType: RoleScopeType;
  readonly scopeRef: string | null;
  readonly validFrom: string;
  readonly validUntil?: string | null;
  readonly temporary: boolean;
  readonly delegatedFromAssignmentId?: string | null;
  readonly orgUnitId?: string | null;
  readonly evidence: readonly string[];
  readonly restrictions: readonly string[];
  readonly status: "active" | "ended" | "suspended";
}

export interface ResponsibilityGrant {
  readonly id: string;
  readonly assignmentId: string;
  readonly responsibilityId: string;
  readonly validFrom: string;
  readonly validUntil?: string | null;
  readonly revokedAt?: string | null;
}

export interface RoleDelegation {
  readonly id: string;
  readonly assignmentId: string;
  readonly delegateUserId: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly revokedAt?: string | null;
}

export interface WorkspaceNavSection {
  readonly id: string;
  readonly label: string;
  readonly dailyPriority: number;
  readonly responsibilityId: string;
  readonly kind: ResponsibilityKind;
}

export interface WorkspaceManifest {
  readonly category: WorkspaceCategory;
  readonly sidePanel: readonly WorkspaceNavSection[];
  readonly primaryNav: readonly [WorkspaceNavSection, WorkspaceNavSection, WorkspaceNavSection];
  readonly widgets: readonly string[];
  readonly recent: readonly string[];
  readonly notifications: readonly string[];
  readonly assistantRecommendations: readonly string[];
}
