/**
 * Sherivs Scholar — per-feature capability codes.
 *
 * A CAPABILITY CODE is the smallest thing a person can be granted: one feature
 * of the education runtime, installed over exactly one kernel capability, owned
 * by exactly one phase, and unlocked by declared reality (institution feature
 * keys) rather than by an institution-type branch.
 *
 * Boundary: a code never grants access by itself. `feature-gate.ts` decides
 * fail-closed from the actor's roles, the tenant context and policy; Phase 08
 * remains the enforcement authority for live surfaces.
 */

import { KERNEL_CAPABILITIES } from "@/lib/kernel/kernel-capability-registry";
import { PHASE_CATALOG } from "@/lib/phase-catalog";
import type { RoleCategory } from "./roles/role-categories";
import { roleById } from "./roles/role-registry";
import { isRoleWorkspaceKey, type RoleWorkspaceKey } from "./roles/role-workspaces";
import type { InstitutionReality } from "./roles/role-template-engine";

export interface ScholarFeatureCode {
  /** Stable code: `r001.<domain>.<feature>`. */
  code: string;
  label: string;
  /** Kernel capability this code is installed over (must be registered). */
  capability: string;
  /** Owning phase id (must be one of the 51 registered phases). */
  phase: string;
  /** Existing institution feature keys that turn this code on. */
  featureKeys: readonly string[];
  /** Role categories whose holders may use it (advisory input to the gate). */
  roleCategories: readonly RoleCategory[];
  workspace: RoleWorkspaceKey;
}

export const SCHOLAR_FEATURE_CODES: readonly ScholarFeatureCode[] = [
  {
    code: "r001.attendance.record",
    label: "Record attendance",
    capability: "education-reality-ontology",
    phase: "04",
    featureKeys: ["curriculum.core"],
    roleCategories: ["TEACHING", "ACADEMIC", "BOARDING"],
    workspace: "teaching",
  },
  {
    code: "r001.attendance.monitor",
    label: "Monitor attendance across the institution",
    capability: "education-reality-ontology",
    phase: "04",
    featureKeys: ["curriculum.core"],
    roleCategories: ["INSTITUTIONAL_LEADERSHIP", "OPERATIONS"],
    workspace: "operations",
  },
  {
    code: "r001.academics.grade",
    label: "Enter and submit grades",
    capability: "academic-intelligence",
    phase: "11",
    featureKeys: ["curriculum.core"],
    roleCategories: ["TEACHING"],
    workspace: "teaching",
  },
  {
    code: "r001.academics.results",
    label: "Publish results and report cards",
    capability: "academic-intelligence",
    phase: "11",
    featureKeys: ["curriculum.core"],
    roleCategories: ["ACADEMIC", "INSTITUTIONAL_LEADERSHIP"],
    workspace: "academic",
  },
  {
    code: "r001.examinations.plan",
    label: "Plan and run examinations",
    capability: "academic-intelligence",
    phase: "11",
    featureKeys: ["curriculum.core"],
    roleCategories: ["ACADEMIC", "EXAMINATION"],
    workspace: "examination",
  },
  {
    code: "r001.timetable.manage",
    label: "Build and publish the timetable",
    capability: "scheduling",
    phase: "12",
    featureKeys: ["curriculum.core", "schedule.double_shift"],
    roleCategories: ["ACADEMIC", "INSTITUTIONAL_LEADERSHIP"],
    workspace: "academic",
  },
  {
    code: "r001.finance.fees.collect",
    label: "Collect fees and issue receipts",
    capability: "financial-ledger",
    phase: "13",
    featureKeys: ["curriculum.core"],
    roleCategories: ["FINANCE"],
    workspace: "finance",
  },
  {
    code: "r001.finance.report",
    label: "Financial reporting and reconciliation",
    capability: "financial-ledger",
    phase: "13",
    featureKeys: ["curriculum.core"],
    roleCategories: ["FINANCE", "INSTITUTIONAL_LEADERSHIP"],
    workspace: "finance",
  },
  {
    code: "r001.messages.broadcast",
    label: "Broadcast messages to guardians and staff",
    capability: "communication-messaging",
    phase: "10",
    featureKeys: ["curriculum.core"],
    roleCategories: ["INSTITUTIONAL_LEADERSHIP", "OPERATIONS"],
    workspace: "leadership",
  },
  {
    code: "r001.boarding.manage",
    label: "Manage boarding houses and residents",
    capability: "education-reality-ontology",
    phase: "04",
    featureKeys: ["schedule.boarding"],
    roleCategories: ["BOARDING"],
    workspace: "boarding",
  },
  {
    code: "r001.boarding.welfare",
    label: "Boarding welfare and night supervision",
    capability: "live-digital-twin",
    phase: "16",
    featureKeys: ["schedule.boarding"],
    roleCategories: ["BOARDING", "STUDENT_SUPPORT"],
    workspace: "student_welfare",
  },
  {
    code: "r001.welfare.counsel",
    label: "Counselling and student support",
    capability: "education-reality-ontology",
    phase: "04",
    featureKeys: ["curriculum.core"],
    roleCategories: ["STUDENT_SUPPORT"],
    workspace: "student_welfare",
  },
  {
    code: "r001.safeguarding.report",
    label: "Record and escalate safeguarding incidents",
    capability: "analytics-decision-intelligence",
    phase: "18",
    featureKeys: ["curriculum.core"],
    roleCategories: ["SAFETY", "STUDENT_SUPPORT", "INSTITUTIONAL_LEADERSHIP"],
    workspace: "safety",
  },
  {
    code: "r001.health.clinic",
    label: "Run the school clinic and health records",
    capability: "education-reality-ontology",
    phase: "04",
    featureKeys: ["curriculum.core"],
    roleCategories: ["HEALTH"],
    workspace: "health",
  },
  {
    code: "r001.transport.routes",
    label: "Manage transport routes and bus boarding",
    capability: "hardware-device-telemetry",
    phase: "15",
    featureKeys: ["curriculum.core"],
    roleCategories: ["TRANSPORT"],
    workspace: "transport",
  },
  {
    code: "r001.facilities.twin",
    label: "Operate facility and estate twins",
    capability: "live-digital-twin",
    phase: "16",
    featureKeys: ["curriculum.core", "site.multi_campus"],
    roleCategories: ["FACILITIES"],
    workspace: "facilities",
  },
  {
    code: "r001.workforce.positions",
    label: "Manage workforce positions and employment records",
    capability: "onboarding-workforce-identity",
    phase: "25",
    featureKeys: ["curriculum.core"],
    roleCategories: ["OPERATIONS", "INSTITUTIONAL_LEADERSHIP"],
    workspace: "human_resources",
  },
  {
    code: "r001.admissions.enrol",
    label: "Run admissions and enrolment",
    capability: "education-reality-ontology",
    phase: "04",
    featureKeys: ["curriculum.core", "community.private"],
    roleCategories: ["OPERATIONS"],
    workspace: "admissions",
  },
  {
    code: "r001.vocational.workshop",
    label: "Run vocational workshops and placements",
    capability: "education-reality-ontology",
    phase: "04",
    featureKeys: ["curriculum.vocational"],
    roleCategories: ["VOCATIONAL", "TEACHING"],
    workspace: "vocational",
  },
  {
    code: "r001.technical.laboratory",
    label: "Run technical laboratories and workshops",
    capability: "education-reality-ontology",
    phase: "04",
    featureKeys: ["curriculum.technical"],
    roleCategories: ["TECHNICAL", "TEACHING"],
    workspace: "laboratory",
  },
  {
    code: "r001.agriculture.farm",
    label: "Run the school farm and agricultural projects",
    capability: "education-reality-ontology",
    phase: "04",
    featureKeys: ["curriculum.agricultural"],
    roleCategories: ["AGRICULTURAL", "TEACHING"],
    workspace: "agricultural",
  },
  {
    code: "r001.religious.programme",
    label: "Run the religious education programme",
    capability: "education-reality-ontology",
    phase: "04",
    featureKeys: ["curriculum.religious"],
    roleCategories: ["RELIGIOUS", "TEACHING"],
    workspace: "religious",
  },
  {
    code: "r001.enterprise.programme",
    label: "Run the enterprise and entrepreneurship programme",
    capability: "education-reality-ontology",
    phase: "04",
    featureKeys: ["curriculum.entrepreneurship"],
    roleCategories: ["VOCATIONAL", "TEACHING"],
    workspace: "vocational",
  },
  {
    code: "r001.analytics.insight",
    label: "Institution analytics and insight",
    capability: "analytics-decision-intelligence",
    phase: "18",
    featureKeys: ["curriculum.core"],
    roleCategories: ["INSTITUTIONAL_LEADERSHIP", "ACADEMIC", "FINANCE"],
    workspace: "leadership",
  },
  {
    code: "r001.quality.assurance",
    label: "Quality assurance and inspection readiness",
    capability: "education-reality-ontology",
    phase: "04",
    featureKeys: ["curriculum.core"],
    roleCategories: ["QUALITY_ASSURANCE", "ACADEMIC", "REGULATORY"],
    workspace: "quality",
  },
  {
    code: "r001.community.programme",
    label: "Run community and adult learning programmes",
    capability: "education-reality-ontology",
    phase: "04",
    featureKeys: ["curriculum.core"],
    roleCategories: ["COMMUNITY"],
    workspace: "community",
  },
  {
    code: "r001.communications.school-calling-agent",
    label: "Dedicated organization calling agent",
    capability: "communication-messaging",
    phase: "10",
    featureKeys: ["communications.school-calling-agent"],
    roleCategories: ["INSTITUTIONAL_LEADERSHIP"],
    workspace: "leadership",
  },
];

const BY_CODE = new Map(SCHOLAR_FEATURE_CODES.map((entry) => [entry.code, entry]));
const CAPABILITY_IDS = new Set(KERNEL_CAPABILITIES.map((capability) => capability.id));
const PHASE_IDS = new Set(PHASE_CATALOG.map((phase) => phase.phase));
const CODE_RE = /^r001\.[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){1,2}$/;

export function featureCodeByCode(code: string): ScholarFeatureCode | undefined {
  return BY_CODE.get(code);
}

/** Codes a reality turns on (feature-key intersection). */
export function featureCodesForReality(reality: InstitutionReality): ScholarFeatureCode[] {
  const features = new Set(reality.featureKeys);
  return SCHOLAR_FEATURE_CODES.filter((entry) =>
    entry.featureKeys.some((key) => features.has(key)),
  );
}

/** Codes a role's category may use (advisory: the gate still decides). */
export function featureCodesForRole(roleId: string): ScholarFeatureCode[] {
  const role = roleById(roleId);
  if (!role) return [];
  return SCHOLAR_FEATURE_CODES.filter((entry) => entry.roleCategories.includes(role.category));
}

/** Codes any of the given roles may use (union, deterministic order). */
export function featureCodesForRoles(roleIds: readonly string[]): ScholarFeatureCode[] {
  const codes = new Set<string>();
  for (const roleId of roleIds) {
    for (const entry of featureCodesForRole(roleId)) codes.add(entry.code);
  }
  return SCHOLAR_FEATURE_CODES.filter((entry) => codes.has(entry.code));
}

/** Structural audit of the code catalog. */
export function auditScholarFeatureCodes(
  codes: readonly ScholarFeatureCode[] = SCHOLAR_FEATURE_CODES,
): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const entry of codes) {
    if (!CODE_RE.test(entry.code)) issues.push(`${entry.code}: invalid code format`);
    if (seen.has(entry.code)) issues.push(`${entry.code}: duplicate code`);
    seen.add(entry.code);
    if (!CAPABILITY_IDS.has(entry.capability)) {
      issues.push(`${entry.code}: capability "${entry.capability}" is not registered`);
    }
    if (!PHASE_IDS.has(entry.phase)) {
      issues.push(`${entry.code}: unknown owning phase "${entry.phase}"`);
    }
    if (!isRoleWorkspaceKey(entry.workspace)) {
      issues.push(`${entry.code}: unknown workspace "${entry.workspace}"`);
    }
    if (entry.featureKeys.length === 0) issues.push(`${entry.code}: declares no reality feature`);
    if (entry.roleCategories.length === 0) issues.push(`${entry.code}: declares no role category`);
  }
  return issues;
}
