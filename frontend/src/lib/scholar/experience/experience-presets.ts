/**
 * CoreGrid Scholar — organization-class reality presets (WAVE-R36).
 *
 * A surface can generate an experience for an organization CLASS before it knows
 * the organization's own answers (the provisioning flow's selected org type).
 * Presets are data over the SAME institution vocabulary, so the preview a
 * provisioner sees is produced by exactly the engine the tenant will run.
 *
 * Non-education organization classes intentionally declare no education features:
 * their own vocabulary arrives with their vertical runtime (kernel neutrality).
 */

import type { InstitutionReality } from "../roles/role-template-engine";

export const EXPERIENCE_REALITY_PRESETS: Readonly<Record<string, InstitutionReality>> = {
  school: {
    featureKeys: ["curriculum.core", "schedule.day_full"],
    templateRefs: ["public_day"],
    educationLevels: ["primary", "junior_secondary"],
  },
  islamic_school: {
    featureKeys: ["curriculum.core", "curriculum.religious", "community.private"],
    templateRefs: ["islamic_madrassa"],
    educationLevels: ["primary", "junior_secondary", "senior_secondary"],
    curriculumFlavour: "islamic",
  },
  christian_school: {
    featureKeys: ["curriculum.core", "curriculum.religious", "community.private"],
    templateRefs: ["religious_christian"],
    educationLevels: ["primary", "junior_secondary", "senior_secondary"],
    curriculumFlavour: "christian",
  },
  boarding_school: {
    featureKeys: ["curriculum.core", "schedule.boarding", "community.private"],
    templateRefs: ["boarding_school"],
    educationLevels: ["junior_secondary", "senior_secondary"],
  },
  vocational_school: {
    featureKeys: ["curriculum.core", "curriculum.vocational"],
    templateRefs: ["vocational_tvet"],
    educationLevels: ["vocational"],
  },
  technical_institute: {
    featureKeys: ["curriculum.core", "curriculum.technical"],
    templateRefs: ["technical_institute"],
    educationLevels: ["vocational"],
  },
  agricultural_school: {
    featureKeys: ["curriculum.core", "curriculum.agricultural"],
    templateRefs: ["agricultural_school"],
    educationLevels: ["junior_secondary", "vocational"],
  },
  entrepreneurship_academy: {
    featureKeys: ["curriculum.core", "curriculum.entrepreneurship"],
    templateRefs: ["entrepreneurship_academy"],
    educationLevels: ["senior_secondary", "adult"],
  },
  university: {
    featureKeys: ["curriculum.core"],
    templateRefs: ["multi_campus_group"],
    educationLevels: ["tertiary"],
  },
  multi_campus_network: {
    featureKeys: ["curriculum.core", "site.multi_campus"],
    templateRefs: ["multi_campus_group"],
  },
  government_agency: { featureKeys: [], templateRefs: [] },
  company: { featureKeys: [], templateRefs: [] },
  community_institution: { featureKeys: [], templateRefs: [] },
  non_profit: { featureKeys: [], templateRefs: [] },
  network: {
    featureKeys: ["site.multi_campus"],
    templateRefs: [],
  },
};

/**
 * A class with no declared vocabulary (or an unknown class key) generates the
 * universal organization surface ONLY — it never inherits Scholar's education
 * vocabulary. Kernel neutrality: education sections arrive with education
 * reality, never with the class label.
 */
export const NEUTRAL_REALITY: InstitutionReality = { featureKeys: [], templateRefs: [] };

/** Deterministic preset lookup; unknown classes fall back to the neutral reality. */
export function realityForOrgType(orgType: string): InstitutionReality {
  return EXPERIENCE_REALITY_PRESETS[orgType] ?? NEUTRAL_REALITY;
}

export function experiencePresetKeys(): readonly string[] {
  return Object.keys(EXPERIENCE_REALITY_PRESETS).sort();
}
