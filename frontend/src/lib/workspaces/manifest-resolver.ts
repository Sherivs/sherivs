import type {
  ResponsibilityGrant,
  RoleAssignment,
  RoleDelegation,
  RoleTemplate,
  WorkspaceCategory,
  WorkspaceManifest,
  WorkspaceResponsibility,
  WorkspaceNavSection,
} from "./contract";

export interface WorkspaceUser {
  readonly id: string;
}

export interface WorkspaceInstitution {
  readonly id: string;
  readonly category: WorkspaceCategory;
}

export interface WorkspaceResolutionData {
  readonly assignments: readonly RoleAssignment[];
  readonly delegations?: readonly RoleDelegation[];
  readonly responsibilityGrants?: readonly ResponsibilityGrant[];
  readonly roleTemplates: readonly RoleTemplate[];
}

function isEffective(
  validFrom: string,
  validUntil: string | null | undefined,
  revokedAt: string | null | undefined,
  at: number,
): boolean {
  const start = Date.parse(validFrom);
  const end = validUntil == null ? Number.POSITIVE_INFINITY : Date.parse(validUntil);
  const revoked = revokedAt == null ? Number.POSITIVE_INFINITY : Date.parse(revokedAt);
  return (
    Number.isFinite(start) &&
    !Number.isNaN(end) &&
    !Number.isNaN(revoked) &&
    start <= at &&
    at < end &&
    at < revoked
  );
}

function assignmentIsEffective(assignment: RoleAssignment, at: number): boolean {
  return (
    assignment.status === "active" &&
    isEffective(assignment.validFrom, assignment.validUntil, null, at)
  );
}

function responsibilitySection(responsibility: WorkspaceResponsibility): WorkspaceNavSection {
  return {
    id: responsibility.primaryNav.id,
    label: responsibility.primaryNav.label,
    dailyPriority: responsibility.dailyPriority,
    responsibilityId: responsibility.id,
    kind: responsibility.kind,
  };
}

export function resolveWorkspaceManifest(
  user: WorkspaceUser,
  institution: WorkspaceInstitution,
  data: WorkspaceResolutionData,
  at: string,
): WorkspaceManifest | null {
  const timestamp = Date.parse(at);
  if (!user.id || !institution.id || Number.isNaN(timestamp)) return null;

  const delegatedAssignmentIds = new Set(
    (data.delegations ?? [])
      .filter(
        (delegation) =>
          delegation.delegateUserId === user.id &&
          isEffective(delegation.validFrom, delegation.validUntil, delegation.revokedAt, timestamp),
      )
      .map(({ assignmentId }) => assignmentId)
      .filter((id) =>
        data.assignments.some(
          (assignment) =>
            assignment.id === id &&
            assignment.tenantId === institution.id &&
            assignmentIsEffective(assignment, timestamp),
        ),
      ),
  );
  const visibleAssignments = data.assignments.filter(
    (assignment) =>
      assignment.tenantId === institution.id &&
      assignment.scopeType !== "authority" &&
      assignment.scopeType !== "lga" &&
      assignmentIsEffective(assignment, timestamp) &&
      (assignment.userId === user.id || delegatedAssignmentIds.has(assignment.id)),
  );
  const visibleAssignmentIds = new Set(visibleAssignments.map(({ id }) => id));
  if (visibleAssignmentIds.size === 0) return null;

  const templatesById = new Map(data.roleTemplates.map((template) => [template.id, template]));
  const roles = visibleAssignments
    .map((assignment) => templatesById.get(assignment.roleTemplateId))
    .filter((template): template is RoleTemplate => template !== undefined)
    .filter((template) => template.category === institution.category);
  if (roles.length === 0) return null;

  const responsibilities = new Map<string, WorkspaceResponsibility>();
  for (const role of roles) {
    for (const responsibility of role.responsibilities) {
      if (responsibility.kind === "core" || responsibility.kind === "custom") {
        responsibilities.set(responsibility.id, responsibility);
      }
    }
  }

  for (const grant of data.responsibilityGrants ?? []) {
    if (
      visibleAssignmentIds.has(grant.assignmentId) &&
      isEffective(grant.validFrom, grant.validUntil, grant.revokedAt, timestamp)
    ) {
      const responsibility = roles
        .flatMap((role) => role.responsibilities)
        .find((candidate) => candidate.id === grant.responsibilityId);
      if (responsibility?.kind === "add_on") {
        responsibilities.set(responsibility.id, responsibility);
      }
    }
  }

  const ordered = [...responsibilities.values()].sort(
    (left, right) =>
      left.dailyPriority - right.dailyPriority || left.code.localeCompare(right.code),
  );
  const navSections = ordered
    .map(responsibilitySection)
    .filter(
      (section, index, sections) =>
        sections.findIndex((candidate) => candidate.id === section.id) === index,
    );
  if (navSections.length < 3) return null;

  const primaryNav = navSections.slice(0, 3) as [
    WorkspaceNavSection,
    WorkspaceNavSection,
    WorkspaceNavSection,
  ];
  return {
    category: institution.category,
    sidePanel: ordered.map(responsibilitySection),
    primaryNav,
    widgets: [...new Set(ordered.flatMap((item) => item.widgets ?? []))],
    recent: [],
    notifications: [],
    assistantRecommendations: [
      ...new Set(ordered.flatMap((item) => item.assistantRecommendations ?? [])),
    ],
  };
}
