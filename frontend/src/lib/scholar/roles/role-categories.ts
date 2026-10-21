/**
 * Sherivs Scholar — Educational Reality Role Engine: categories.
 *
 * The directive's reality taxonomy: WHO can exist inside an educational
 * reality. Categories are DATA, and every staffed category MAPS to the
 * domain-neutral workforce family it staffs through (P25 `workforce-kinds.ts`)
 * — there is no second staffing taxonomy.
 *
 * Authority boundary: a category never grants access. It scopes which roles can
 * exist in which reality; Phase 08 decides what they may do.
 */

import { WORKFORCE_FAMILIES, type WorkforceFamily } from "../../workforce-kinds";

export const ROLE_CATEGORIES = [
  "GOVERNMENT",
  "REGULATORY",
  "INSTITUTIONAL_LEADERSHIP",
  "ACADEMIC",
  "TEACHING",
  "STUDENT_SUPPORT",
  "FINANCE",
  "OPERATIONS",
  "HEALTH",
  "SAFETY",
  "TECHNOLOGY",
  "FACILITIES",
  "TRANSPORT",
  "BOARDING",
  "COMMUNITY",
  "VOCATIONAL",
  "TECHNICAL",
  "AGRICULTURAL",
  "RELIGIOUS",
  "TRADITIONAL",
  "RESEARCH",
  "EXAMINATION",
  "QUALITY_ASSURANCE",
  "SHERIVS_INTERNAL",
] as const;

export type RoleCategory = (typeof ROLE_CATEGORIES)[number];

export const ROLE_CATEGORY_LABELS: Record<RoleCategory, string> = {
  GOVERNMENT: "Government & Ministry",
  REGULATORY: "Regulatory & Inspectorate",
  INSTITUTIONAL_LEADERSHIP: "Institutional Leadership & Ownership",
  ACADEMIC: "Academic Management",
  TEACHING: "Teaching & Instruction",
  STUDENT_SUPPORT: "Student Support & Wellbeing",
  FINANCE: "Finance & Accounts",
  OPERATIONS: "Operations & Administration",
  HEALTH: "Health & Medical",
  SAFETY: "Safety & Security",
  TECHNOLOGY: "ICT & Digital Education",
  FACILITIES: "Facilities & Property",
  TRANSPORT: "Transportation",
  BOARDING: "Boarding & Residential Life",
  COMMUNITY: "Community & Adult Learning",
  VOCATIONAL: "Vocational Education",
  TECHNICAL: "Technical Education",
  AGRICULTURAL: "Agricultural Education",
  RELIGIOUS: "Religious Education",
  TRADITIONAL: "Traditional & Heritage Learning",
  RESEARCH: "Research & Innovation",
  EXAMINATION: "Examination & Assessment Bodies",
  QUALITY_ASSURANCE: "Accreditation & Quality Assurance",
  SHERIVS_INTERNAL: "Sherivs Platform Organization",
};

/**
 * The workforce family a category staffs through, or `null` when the category
 * is a governance / relationship reality that is never a workforce position
 * (boards, ministries' volunteer oversight, community members, learners).
 */
export const ROLE_CATEGORY_WORKFORCE_FAMILY: Record<RoleCategory, WorkforceFamily | null> = {
  GOVERNMENT: "governance",
  REGULATORY: "governance",
  INSTITUTIONAL_LEADERSHIP: "leadership",
  ACADEMIC: "learning_support",
  TEACHING: "teaching",
  STUDENT_SUPPORT: "learner_welfare",
  FINANCE: "finance",
  OPERATIONS: "administration",
  HEALTH: "health",
  SAFETY: "security",
  TECHNOLOGY: "operations",
  FACILITIES: "facilities",
  TRANSPORT: "transport",
  BOARDING: "learner_welfare",
  COMMUNITY: "extended_services",
  VOCATIONAL: "teaching",
  TECHNICAL: "teaching",
  AGRICULTURAL: "teaching",
  RELIGIOUS: "teaching",
  TRADITIONAL: "extended_services",
  RESEARCH: "learning_support",
  EXAMINATION: "governance",
  QUALITY_ASSURANCE: "governance",
  SHERIVS_INTERNAL: null,
};

export function isRoleCategory(value: string): value is RoleCategory {
  return (ROLE_CATEGORIES as readonly string[]).includes(value);
}

export function roleCategoryLabel(category: RoleCategory): string {
  return ROLE_CATEGORY_LABELS[category];
}

export function roleCategoryWorkforceFamily(category: RoleCategory): WorkforceFamily | null {
  return ROLE_CATEGORY_WORKFORCE_FAMILY[category];
}

/** Structural audit of the category taxonomy itself. */
export function auditRoleCategories(): string[] {
  const issues: string[] = [];
  for (const category of ROLE_CATEGORIES) {
    if (!(category in ROLE_CATEGORY_LABELS)) issues.push(`${category}: missing label`);
    if (!(category in ROLE_CATEGORY_WORKFORCE_FAMILY)) {
      issues.push(`${category}: missing workforce-family mapping`);
    }
    const family = ROLE_CATEGORY_WORKFORCE_FAMILY[category];
    if (family !== null && !(WORKFORCE_FAMILIES as readonly string[]).includes(family)) {
      issues.push(`${category}: maps to unregistered workforce family "${family}"`);
    }
  }
  return issues;
}
