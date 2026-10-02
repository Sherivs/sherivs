/**
 * CoreGrid Developer Platform — developer, organization, and project domain.
 *
 * Implements `architecture/phase-28-developer-platform.md`:
 * - Subsystem identity (1): the engineering environment through which developers
 *   build software, integrations, agents, AI capabilities, automations,
 *   applications, extensions, connectors, educational capabilities, hardware
 *   integrations, dashboards, workflows, and other CoreGrid-compatible capabilities.
 * - Phase 28 builds products; Phase 27 distributes them (5).
 * - Developer types (6): CoreGrid engineers, independent/startup/enterprise/
 *   school/university/government developers, AI/agent/automation/integration/
 *   hardware/educational-content/research developers, system integrators.
 * - Developer organizations (7-8): owners, administrators, developers, reviewers,
 *   security engineers, release managers, support engineers, billing
 *   administrators; projects of one organization are not visible to another.
 * - Developer projects (9-18): every capability begins as a developer project;
 *   project types (application, extension, plugin, integration, connector, agent,
 *   AI capability, automation, dashboard, educational resource, hardware adapter,
 *   API service).
 * - Project manifest (19): machine-readable manifest with project identity,
 *   version, type, APIs, dependencies, permissions, data requirements,
 *   configuration, events, webhooks, environments, compatibility, security.
 * - CoreGrid SDK (20-21): official SDKs; strongly typed abstractions.
 * - Developer identity (CU): integrates with Phase 02, does not replace identity
 *   authority. Developer authorization (CV) respects Phase 08 security contracts.
 * - Tenant context (CW), developer data isolation (CX), production access (CY)
 *   requiring stronger authentication/role/authorization/audit/risk controls,
 *   break-glass development access (CZ).
 *
 * Phase 28 consumes Phase 02 identity and Phase 08 security by reference
 * (AGENTS.md 65).
 */

import type { TenantId } from "./tenant-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type DeveloperId = string & { readonly __brand: "DeveloperId" };
export type DeveloperOrganizationId = string & { readonly __brand: "DeveloperOrganizationId" };
export type DeveloperProjectId = string & { readonly __brand: "DeveloperProjectId" };
export type ProjectManifestId = string & { readonly __brand: "ProjectManifestId" };
export type SdkId = string & { readonly __brand: "SdkId" };

export function developerId(raw: string): DeveloperId {
  return raw as DeveloperId;
}
export function developerOrganizationId(raw: string): DeveloperOrganizationId {
  return raw as DeveloperOrganizationId;
}
export function developerProjectId(raw: string): DeveloperProjectId {
  return raw as DeveloperProjectId;
}
export function projectManifestId(raw: string): ProjectManifestId {
  return raw as ProjectManifestId;
}
export function sdkId(raw: string): SdkId {
  return raw as SdkId;
}

/* ─────────────────────────────────────────────────────────────
 * Developer types (Section 6)
 * ────────────────────────────────────────────────────────────*/

export type DeveloperType =
  | "coregrid_engineer"
  | "independent"
  | "startup"
  | "enterprise"
  | "school"
  | "university"
  | "government"
  | "ai"
  | "agent"
  | "automation"
  | "integration"
  | "hardware"
  | "educational_content"
  | "research"
  | "system_integrator";

export const DEVELOPER_TYPES: readonly DeveloperType[] = [
  "coregrid_engineer",
  "independent",
  "startup",
  "enterprise",
  "school",
  "university",
  "government",
  "ai",
  "agent",
  "automation",
  "integration",
  "hardware",
  "educational_content",
  "research",
  "system_integrator",
] as const;

/* ─────────────────────────────────────────────────────────────
 * Developer organizations (Sections 7, 8)
 * ────────────────────────────────────────────────────────────*/

export type DeveloperOrgRole =
  | "owner"
  | "administrator"
  | "developer"
  | "reviewer"
  | "security_engineer"
  | "release_manager"
  | "support_engineer"
  | "billing_administrator";

export const DEVELOPER_ORG_ROLES: readonly DeveloperOrgRole[] = [
  "owner",
  "administrator",
  "developer",
  "reviewer",
  "security_engineer",
  "release_manager",
  "support_engineer",
  "billing_administrator",
] as const;

export interface DeveloperOrganization {
  id: DeveloperOrganizationId;
  tenantId: TenantId;
  name: string;
  members: Array<{ developerRef: string; role: DeveloperOrgRole }>;
  createdAt: string;
  updatedAt: string;
}

export function createDeveloperOrganization(input: {
  id: DeveloperOrganizationId;
  tenantId: TenantId;
  name: string;
  members?: Array<{ developerRef: string; role: DeveloperOrgRole }>;
  now?: string;
}): { ok: true; org: DeveloperOrganization } | { ok: false; error: string } {
  if (!input.name.trim()) {
    return { ok: false, error: "Organization name is required" };
  }
  if (!input.members || input.members.length === 0) {
    return { ok: false, error: "An organization requires at least one member" };
  }
  if (!input.members.some((m) => m.role === "owner")) {
    return { ok: false, error: "An organization requires at least one owner (Section 7)" };
  }
  return {
    ok: true,
    org: {
      id: input.id,
      tenantId: input.tenantId,
      name: input.name.trim(),
      members: input.members,
      createdAt: input.now ?? timeAuthority.now().at,
      updatedAt: input.now ?? timeAuthority.now().at,
    },
  };
}

/**
 * Organization isolation (Section 8): projects belonging to one organization
 * must not automatically become visible to another organization.
 */
export function isProjectVisibleToOrg(
  projectOwnerOrgId: DeveloperOrganizationId,
  viewerOrgId: DeveloperOrganizationId,
  isPublic: boolean,
): boolean {
  if (isPublic) return true;
  return projectOwnerOrgId === viewerOrgId;
}

/* ─────────────────────────────────────────────────────────────
 * Developer projects (Sections 9-18)
 * ────────────────────────────────────────────────────────────*/

export type DeveloperProjectType =
  | "application"
  | "extension"
  | "plugin"
  | "integration"
  | "connector"
  | "agent"
  | "ai_capability"
  | "automation"
  | "dashboard"
  | "educational_resource"
  | "hardware_adapter"
  | "api_service";

export const DEVELOPER_PROJECT_TYPES: readonly DeveloperProjectType[] = [
  "application",
  "extension",
  "plugin",
  "integration",
  "connector",
  "agent",
  "ai_capability",
  "automation",
  "dashboard",
  "educational_resource",
  "hardware_adapter",
  "api_service",
] as const;

export type ProjectVisibility = "private" | "org_internal" | "public";

export const PROJECT_VISIBILITIES: readonly ProjectVisibility[] = [
  "private",
  "org_internal",
  "public",
] as const;

export interface DeveloperProject {
  id: DeveloperProjectId;
  organizationId: DeveloperOrganizationId;
  ownerRef: string;
  name: string;
  type: DeveloperProjectType;
  visibility: ProjectVisibility;
  /** Compatible target phase (e.g. "07" agent, "26" AI, "17" automation). */
  targetPhase: string | null;
  /** Manifest reference (Section 19). */
  manifestRef: ProjectManifestId | null;
  createdAt: string;
  updatedAt: string;
}

export function createDeveloperProject(input: {
  id: DeveloperProjectId;
  organizationId: DeveloperOrganizationId;
  ownerRef: string;
  name: string;
  type: DeveloperProjectType;
  visibility?: ProjectVisibility;
  targetPhase?: string | null;
  now?: string;
}): { ok: true; project: DeveloperProject } | { ok: false; error: string } {
  if (!input.name.trim()) {
    return { ok: false, error: "Project name is required" };
  }
  if (!input.ownerRef.trim()) {
    return { ok: false, error: "Project owner is required" };
  }
  return {
    ok: true,
    project: {
      id: input.id,
      organizationId: input.organizationId,
      ownerRef: input.ownerRef,
      name: input.name.trim(),
      type: input.type,
      visibility: input.visibility ?? "private",
      targetPhase: input.targetPhase ?? null,
      manifestRef: null,
      createdAt: input.now ?? timeAuthority.now().at,
      updatedAt: input.now ?? timeAuthority.now().at,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Project manifest (Section 19) + SDK (20, 21)
 * ────────────────────────────────────────────────────────────*/

export interface ProjectManifest {
  id: ProjectManifestId;
  projectId: DeveloperProjectId;
  version: string;
  projectType: DeveloperProjectType;
  apis: string[];
  dependencies: string[];
  permissions: string[];
  dataRequirements: string[];
  configuration: string[];
  events: string[];
  webhooks: string[];
  environments: string[];
  /** Minimum CoreGrid version compatibility. */
  compatibleCoreGridVersion: string;
  securityRequirements: string[];
}

export function createProjectManifest(input: {
  id: ProjectManifestId;
  projectId: DeveloperProjectId;
  version: string;
  projectType: DeveloperProjectType;
  apis?: string[];
  dependencies?: string[];
  permissions?: string[];
  dataRequirements?: string[];
  configuration?: string[];
  events?: string[];
  webhooks?: string[];
  environments?: string[];
  compatibleCoreGridVersion?: string;
  securityRequirements?: string[];
}): { ok: true; manifest: ProjectManifest } | { ok: false; error: string } {
  if (!input.version.trim()) {
    return { ok: false, error: "Manifest version is required" };
  }
  if (!input.compatibleCoreGridVersion && input.environments?.includes("production")) {
    return { ok: false, error: "Production manifests must declare CoreGrid compatibility" };
  }
  return {
    ok: true,
    manifest: {
      id: input.id,
      projectId: input.projectId,
      version: input.version,
      projectType: input.projectType,
      apis: input.apis ?? [],
      dependencies: input.dependencies ?? [],
      permissions: input.permissions ?? [],
      dataRequirements: input.dataRequirements ?? [],
      configuration: input.configuration ?? [],
      events: input.events ?? [],
      webhooks: input.webhooks ?? [],
      environments: input.environments ?? ["development"],
      compatibleCoreGridVersion: input.compatibleCoreGridVersion ?? "",
      securityRequirements: input.securityRequirements ?? [],
    },
  };
}

export type SdkLanguage =
  "typescript" | "javascript" | "python" | "java" | "kotlin" | "swift" | "go" | "rust";

export const SDK_LANGUAGES: readonly SdkLanguage[] = [
  "typescript",
  "javascript",
  "python",
  "java",
  "kotlin",
  "swift",
  "go",
  "rust",
] as const;

export interface Sdk {
  id: SdkId;
  language: SdkLanguage;
  version: string;
  /** Strongly typed abstractions exposed (Section M). */
  abstractions: string[];
  isActive: boolean;
  createdAt: string;
}

export function registerSdk(input: {
  id: SdkId;
  language: SdkLanguage;
  version: string;
  abstractions?: string[];
  isActive?: boolean;
  now?: string;
}): Sdk {
  return {
    id: input.id,
    language: input.language,
    version: input.version,
    abstractions: input.abstractions ?? [],
    isActive: input.isActive ?? false,
    createdAt: input.now ?? timeAuthority.now().at,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Production access (Section CY) + break-glass (CZ)
 * ────────────────────────────────────────────────────────────*/

export interface ProductionAccessCheck {
  developerRef: string;
  strongerAuthentication: boolean;
  appropriateRole: boolean;
  explicitAuthorization: boolean;
  auditable: boolean;
  riskControls: boolean;
}

/**
 * Production access (Section CY): requires stronger authentication, appropriate
 * role, explicit authorization, auditability, and risk controls.
 */
export function isProductionAccessPermitted(input: ProductionAccessCheck): boolean {
  return (
    input.strongerAuthentication &&
    input.appropriateRole &&
    input.explicitAuthorization &&
    input.auditable &&
    input.riskControls
  );
}

export interface BreakGlassDevAccess {
  developerRef: string;
  reason: string;
  scope: string[];
  durationMinutes: number;
  grantedAt: string;
  expiresAt: string;
}

export function grantBreakGlassDevAccess(input: {
  developerRef: string;
  reason: string;
  scope: string[];
  durationMinutes: number;
  now?: string;
}): { ok: true; access: BreakGlassDevAccess } | { ok: false; error: string } {
  const now = input.now ?? timeAuthority.now().at;
  if (!input.reason.trim()) {
    return { ok: false, error: "Break-glass development access requires a reason (Section CZ)" };
  }
  if (input.durationMinutes <= 0 || input.durationMinutes > 480) {
    return { ok: false, error: "Break-glass duration must be between 1 and 480 minutes" };
  }
  const expiresAt = new Date(
    new Date(now).getTime() + input.durationMinutes * 60_000,
  ).toISOString();
  return {
    ok: true,
    access: {
      developerRef: input.developerRef,
      reason: input.reason.trim(),
      scope: input.scope,
      durationMinutes: input.durationMinutes,
      grantedAt: now,
      expiresAt,
    },
  };
}
