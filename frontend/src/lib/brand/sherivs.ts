/**
 * Sherivs — canonical customer-facing brand layer (V1).
 *
 * Canonical brand: SHERIVS (sherivs.com).
 * Product category: INSTITUTIONAL INTELLIGENCE INFRASTRUCTURE.
 *
 * This module is the single source for how the product presents itself to
 * customers. It is deliberately separate from `@/lib/platform`, which keeps
 * the technical platform identity (the CoreGrid kernel) used by registries,
 * migrations, package names, database objects and server internals.
 *
 * Migration law (see SHERIVS_BRAND_MIGRATION.md):
 * - Customer-facing copy MUST resolve through this module (Sherivs).
 * - Technical identifiers MUST NEVER be rewritten (see
 *   `./brand-classification`): table names, RLS policies, migration files,
 *   package names, type names, kernel vocabulary, audit records.
 *
 * Version-target classification: V1 (organizational capability envelope).
 */

export const SHERIVS_NAME = "Sherivs" as const;
export const SHERIVS_DOMAIN = "sherivs.com" as const;
export const SHERIVS_CATEGORY = "Institutional Intelligence Infrastructure" as const;
export const SHERIVS_TAGLINE = "Institutional Intelligence Infrastructure" as const;

/** Education runtime that runs on the platform. */
export const SHERIVS_SCHOLAR_NAME = "Sherivs Scholar" as const;
/** Executive intelligence surface. */
export const SHERIVS_JARVIS_NAME = "Jarvis" as const;
/** Governed autonomous workforce. */
export const SHERIVS_AI_WORKFORCE_NAME = "Sherivs AI Workforce" as const;

export const SHERIVS_PAGE_TITLE = "Sherivs — Institutional Intelligence Infrastructure" as const;
export const SHERIVS_PAGE_DESCRIPTION =
  "Sherivs is institutional intelligence infrastructure: a governed platform with reality models, missions, an AI workforce, evidence and policy — plus the domain runtimes organizations install on it." as const;

/**
 * Surfaces where the customer-facing brand is rendered. Technical surfaces
 * (migrations, RLS, audit, kernel registries) never consult this map.
 */
export type SherivsBrandContext =
  | "public-site"
  | "auth"
  | "app-shell"
  | "organization-site"
  | "document-head"
  | "notifications"
  | "support";

/**
 * Resolve the customer-facing brand name for a rendering context.
 * Every customer-facing context resolves to Sherivs today; the context
 * parameter keeps future per-surface brand variants governed instead of
 * scattered across JSX.
 */
export function resolveCustomerBrandName(_context: SherivsBrandContext): typeof SHERIVS_NAME {
  return SHERIVS_NAME;
}

/**
 * Customer-facing lockup: product name plus category, e.g. for footers and
 * about surfaces. Never used for technical identifiers.
 */
export function sherivsLockup(product: string = SHERIVS_NAME): string {
  return `${product} · ${SHERIVS_CATEGORY}`;
}
