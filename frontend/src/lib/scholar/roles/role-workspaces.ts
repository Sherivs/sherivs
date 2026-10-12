/**
 * CoreGrid Scholar — Educational Reality Role Engine: workspace catalog.
 *
 * Workspaces are the composed working surfaces a role set unlocks (Phase 06
 * workspace engine consumes this). They are DATA keyed by role category — a
 * surface renders whatever the role context resolves; no component decides
 * "if this is a teacher, show the teaching dashboard".
 */

import type { RoleCategory } from "./role-categories";

export const ROLE_WORKSPACE_KEYS = [
  "leadership",
  "governance",
  "academic",
  "teaching",
  "learning",
  "student_welfare",
  "boarding",
  "admissions",
  "finance",
  "operations",
  "human_resources",
  "health",
  "safety",
  "technology",
  "facilities",
  "transport",
  "catering",
  "library",
  "laboratory",
  "examination",
  "quality",
  "research",
  "community",
  "vocational",
  "technical",
  "agricultural",
  "religious",
  "government",
  "regulatory",
  "platform",
] as const;

export type RoleWorkspaceKey = (typeof ROLE_WORKSPACE_KEYS)[number];

export const ROLE_WORKSPACE_LABELS: Record<RoleWorkspaceKey, string> = {
  leadership: "Leadership workspace",
  governance: "Governance workspace",
  academic: "Academic management workspace",
  teaching: "Teaching workspace",
  learning: "Learning environment",
  student_welfare: "Student welfare workspace",
  boarding: "Boarding & residential workspace",
  admissions: "Admissions workspace",
  finance: "Finance workspace",
  operations: "Operations workspace",
  human_resources: "Human resources workspace",
  health: "Health workspace",
  safety: "Safety & security workspace",
  technology: "Technology workspace",
  facilities: "Facilities workspace",
  transport: "Transport workspace",
  catering: "Catering workspace",
  library: "Library & knowledge workspace",
  laboratory: "Laboratory workspace",
  examination: "Examination workspace",
  quality: "Quality & accreditation workspace",
  research: "Research workspace",
  community: "Community learning workspace",
  vocational: "Vocational skills workspace",
  technical: "Technical skills workspace",
  agricultural: "Agricultural workspace",
  religious: "Religious education workspace",
  government: "Government education workspace",
  regulatory: "Regulatory & inspectorate workspace",
  platform: "Sherivs platform workspace",
};

/** Which workspaces a role of this category participates in (data, not logic). */
export const CATEGORY_WORKSPACES: Record<RoleCategory, readonly RoleWorkspaceKey[]> = {
  GOVERNMENT: ["government", "quality", "governance"],
  REGULATORY: ["regulatory", "quality", "governance"],
  INSTITUTIONAL_LEADERSHIP: ["leadership", "governance", "academic", "operations"],
  ACADEMIC: ["academic", "teaching", "quality"],
  TEACHING: ["teaching", "academic"],
  STUDENT_SUPPORT: ["student_welfare", "learning", "leadership"],
  FINANCE: ["finance", "leadership"],
  OPERATIONS: ["operations", "facilities", "human_resources", "admissions"],
  HEALTH: ["health", "student_welfare"],
  SAFETY: ["safety", "operations"],
  TECHNOLOGY: ["technology", "operations"],
  FACILITIES: ["facilities", "operations"],
  TRANSPORT: ["transport", "operations"],
  BOARDING: ["boarding", "student_welfare", "catering"],
  COMMUNITY: ["community", "learning"],
  VOCATIONAL: ["vocational", "teaching"],
  TECHNICAL: ["technical", "laboratory", "teaching"],
  AGRICULTURAL: ["agricultural", "teaching"],
  RELIGIOUS: ["religious", "teaching"],
  TRADITIONAL: ["community", "vocational"],
  RESEARCH: ["research", "library"],
  EXAMINATION: ["examination", "quality"],
  QUALITY_ASSURANCE: ["quality", "regulatory"],
  COREGRID_INTERNAL: ["platform"],
};

export function isRoleWorkspaceKey(value: string): value is RoleWorkspaceKey {
  return (ROLE_WORKSPACE_KEYS as readonly string[]).includes(value);
}

export function roleWorkspaceLabel(key: RoleWorkspaceKey): string {
  return ROLE_WORKSPACE_LABELS[key];
}

export function workspacesForCategory(category: RoleCategory): readonly RoleWorkspaceKey[] {
  return CATEGORY_WORKSPACES[category];
}

export function auditRoleWorkspaces(): string[] {
  const issues: string[] = [];
  for (const key of ROLE_WORKSPACE_KEYS) {
    if (!(key in ROLE_WORKSPACE_LABELS)) issues.push(`${key}: missing label`);
  }
  for (const [category, keys] of Object.entries(CATEGORY_WORKSPACES)) {
    if (keys.length === 0) issues.push(`${category}: no workspace`);
    for (const key of keys) {
      if (!isRoleWorkspaceKey(key)) issues.push(`${category}: unknown workspace "${key}"`);
    }
  }
  return issues;
}
