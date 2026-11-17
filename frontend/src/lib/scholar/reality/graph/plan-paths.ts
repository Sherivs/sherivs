/**
 * M5a (E-009) — the known plan paths a question may write to (ADR-107).
 */
import { planPathMatcher } from "@/lib/onboarding/plan";

export const KNOWN_PLAN_PATHS: readonly string[] = [
  "institutionProfile.institution_type",
  "institutionProfile.ownership",
  "institutionProfile.regulators",
  "institutionProfile.languages",
  "institutionProfile.attributes.*",
  "calendarModel",
  "gradingSystem",
  "curricula",
  "admissions.enabledByDefault",
  "admissions.mode",
];

export const PLAN_PATHS = planPathMatcher(KNOWN_PLAN_PATHS);
