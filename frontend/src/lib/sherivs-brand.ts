/**
 * SHERIVS — canonical customer-facing brand module (V1 experience foundation).
 *
 * SHERIVS is the customer-facing brand for institutional intelligence
 * infrastructure. "CoreGrid" remains the technical kernel/platform identifier
 * used by engineering artifacts (migrations, database identifiers, package
 * names, architecture records) — see PLATFORM_KERNEL_NAME in
 * `@/lib/platform`. Customer-facing surfaces must read their identity from
 * this module, never from the technical identifier.
 *
 * Domain-neutrality note: this file lives at the universal lib root, so it
 * carries no domain-runtime vocabulary. An installed runtime's own display
 * name lives in that runtime's layer (`@/lib/runtime/installed-runtimes`).
 */

export const SHERIVS_NAME = "Sherivs";

export const SHERIVS_CATEGORY = "Institutional Intelligence Infrastructure";

export const SHERIVS_TAGLINE = "Institutional intelligence infrastructure";

export const SHERIVS_PUBLIC_ORIGIN = "https://sherivs.com";

export const SHERIVS_PAGE_TITLE = "Sherivs — Institutional Intelligence Infrastructure";

export const SHERIVS_PAGE_DESCRIPTION =
  "Sherivs is institutional intelligence infrastructure: one governed platform where organizations model their reality, deploy a governed AI workforce, execute missions with evidence, and verify every outcome.";

/** Executive intelligence surface shipped with the platform. */
export const SHERIVS_EXECUTIVE_INTELLIGENCE = "Jarvis";

/** Governed AI workforce operating inside organizations. */
export const SHERIVS_AI_WORKFORCE = "Sherivs AI Workforce";

/**
 * Customer-facing reference classification for the legacy technical name.
 *
 * - CUSTOMER_FACING: rendered to users → must read Sherivs.
 * - TECHNICAL: engineering identifiers (migrations, database roles, package
 *   names, audit event sources, architecture records) → keep CoreGrid.
 */
export type BrandReferenceClass = "CUSTOMER_FACING" | "TECHNICAL";

export interface BrandReferenceRule {
  pattern: string;
  classification: BrandReferenceClass;
  action: string;
}

export const SHERIVS_BRAND_REFERENCE_RULES: readonly BrandReferenceRule[] = [
  {
    pattern: "Marketing pages, public site chrome, emails rendered to users",
    classification: "CUSTOMER_FACING",
    action: "Render Sherivs via SHERIVS_* constants.",
  },
  {
    pattern: "Authenticated workspace chrome (header, switchers, menus)",
    classification: "CUSTOMER_FACING",
    action: "Render Sherivs via PLATFORM_NAME.",
  },
  {
    pattern: "Document titles, meta descriptions, OpenGraph site name",
    classification: "CUSTOMER_FACING",
    action: "Render Sherivs via SHERIVS_PAGE_* constants.",
  },
  {
    pattern: "Database identifiers, migrations, RLS policy names, storage keys",
    classification: "TECHNICAL",
    action: "Preserve existing identifiers unchanged.",
  },
  {
    pattern: "Package names, module specifiers, import paths",
    classification: "TECHNICAL",
    action: "Preserve existing identifiers unchanged.",
  },
  {
    pattern: "Architecture records, audit event sources, governance documents",
    classification: "TECHNICAL",
    action: "Preserve existing identifiers unchanged.",
  },
];

/** V1 execution boundary classification for experience claims. */
export type VersionTarget = "V1" | "V2_FROZEN" | "V3_FROZEN" | "FUTURE_UNASSIGNED";

export function classifyVersionTarget(feature: string): VersionTarget {
  const frozenV2 = ["device", "iot", "hardware", "sensor", "telemetry-ingest"];
  const frozenV3 = [
    "reality-intelligence",
    "simulation",
    "twin-civilization",
    "autonomous-economy",
  ];
  const lower = feature.toLowerCase();
  if (frozenV2.some((token) => lower.includes(token))) return "V2_FROZEN";
  if (frozenV3.some((token) => lower.includes(token))) return "V3_FROZEN";
  return "V1";
}
