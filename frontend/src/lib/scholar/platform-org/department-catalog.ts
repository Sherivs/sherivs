/**
 * Sherivs Scholar — Sherivs platform organization catalog (WAVE-R32).
 *
 * Sherivs itself is a living organization: the platform teams (executive,
 * engineering, AI, product, education domain, customer implementation) are
 * reality roles like any other — they come from the role engine's
 * SHERIVS_INTERNAL groups, and their workspaces are generated, never drawn by
 * hand.
 */

import type { RoleWorkspaceKey } from "../roles/role-workspaces";

export interface PlatformDepartment {
  key: string;
  label: string;
  /** Role-engine groups that staff the department (SHERIVS_INTERNAL). */
  groups: readonly string[];
  workspace: RoleWorkspaceKey;
  /** Widgets the generated department workspace renders (data). */
  widgets: readonly string[];
}

export const PLATFORM_DEPARTMENTS: readonly PlatformDepartment[] = [
  {
    key: "executive",
    label: "Executive",
    groups: ["coregrid_executive"],
    workspace: "platform",
    widgets: [
      "platform_health",
      "organization_portfolio",
      "engineering_overview",
      "security_status",
      "product_roadmap",
      "technical_decisions",
    ],
  },
  {
    key: "engineering",
    label: "Engineering",
    groups: ["coregrid_engineering"],
    workspace: "platform",
    widgets: [
      "repository_view",
      "architecture_docs",
      "deployment_status",
      "system_health",
      "testing_status",
      "infrastructure",
      "security_posture",
    ],
  },
  {
    key: "ai",
    label: "AI & Research",
    groups: ["coregrid_ai"],
    workspace: "platform",
    widgets: [
      "agents",
      "models",
      "knowledge_systems",
      "memory_systems",
      "evaluations",
      "experiments",
      "performance",
    ],
  },
  {
    key: "product",
    label: "Product & Design",
    groups: ["coregrid_product"],
    workspace: "platform",
    widgets: ["roadmap", "objectives", "milestones", "ux_research", "feedback"],
  },
  {
    key: "education_domain",
    label: "Education Domain",
    groups: ["coregrid_education_domain"],
    workspace: "platform",
    widgets: [
      "reality_architecture",
      "curriculum_models",
      "assessment_models",
      "school_operations",
      "teacher_experience",
      "student_experience",
    ],
  },
  {
    key: "customer_implementation",
    label: "Customer & Implementation",
    groups: ["coregrid_customer_implementation"],
    workspace: "platform",
    widgets: [
      "organizations",
      "subscriptions",
      "usage",
      "support",
      "customer_health",
      "implementation_status",
      "feedback",
    ],
  },
];

export const PLATFORM_WIDGET_KEYS: readonly string[] = [
  ...new Set(PLATFORM_DEPARTMENTS.flatMap((department) => department.widgets)),
].sort();

export function platformDepartment(key: string): PlatformDepartment | undefined {
  return PLATFORM_DEPARTMENTS.find((department) => department.key === key);
}
