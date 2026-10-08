/**
 * Sherivs brand boundary.
 *
 * Customer-facing names change here. Technical identifiers do not.
 */
import {
  PLATFORM_CATEGORY,
  PLATFORM_NAME,
  PLATFORM_ORIGIN,
  PLATFORM_TAGLINE,
  TECHNICAL_SUBSTRATE_NAME,
} from "@/lib/platform";

export const SHERIVS_BRAND = {
  name: PLATFORM_NAME,
  tagline: PLATFORM_TAGLINE,
  category: PLATFORM_CATEGORY,
  origin: PLATFORM_ORIGIN,
  educationRuntime: "Scholar",
  executiveIntelligence: "Jarvis",
  aiWorkforce: "Sherivs AI Workforce",
  technicalSubstrate: TECHNICAL_SUBSTRATE_NAME,
} as const;

/** No public social profile is published. Do not invent accounts. */
export const SHERIVS_SOCIAL_PROFILES: readonly { network: string; url: string }[] = [];

export type BrandReferenceClass =
  | "customer-facing"
  | "technical-identifier"
  | "internal-architecture"
  | "education-runtime"
  | "executive-intelligence";

export interface BrandReferenceRule {
  class: BrandReferenceClass;
  treatment: "rename-in-ui" | "preserve" | "classify-only";
  examples: readonly string[];
}

export const BRAND_REFERENCE_RULES: readonly BrandReferenceRule[] = [
  {
    class: "customer-facing",
    treatment: "rename-in-ui",
    examples: ["page titles", "marketing copy", "app display name", "push notification title"],
  },
  {
    class: "technical-identifier",
    treatment: "preserve",
    examples: [
      "package name coregrid-scholar",
      "cache name coregrid-app-shell-v1",
      "bundle id com.coregrid.app",
      "database and migration identifiers",
      "TypeScript types such as CoreGridDatabase",
    ],
  },
  {
    class: "internal-architecture",
    treatment: "classify-only",
    examples: ["AGENTS.md", "architecture/", "phase blueprints", "module header comments"],
  },
  {
    class: "education-runtime",
    treatment: "preserve",
    examples: ["Scholar", "runtime:scholar"],
  },
  {
    class: "executive-intelligence",
    treatment: "preserve",
    examples: ["Jarvis contracts under lib/jarvis"],
  },
];
