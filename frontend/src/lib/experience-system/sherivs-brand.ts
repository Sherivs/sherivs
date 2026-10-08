/**
 * Sherivs — canonical brand identity (customer-facing).
 *
 * CoreGrid is no longer the customer-facing brand. Technical identifiers that
 * still carry the legacy name (package scope `@coregrid/*`, persisted enum
 * values, storage buckets, credential references, environment variables,
 * migrations) are intentionally preserved for compatibility — see
 * architecture/experience/SHERIVS_BRAND_MIGRATION.md and
 * scripts/experience/brand-classifier.mjs.
 *
 * Domain-neutral: no runtime or vertical vocabulary belongs in this module
 * other than the registered product names below.
 */

export const SHERIVS_BRAND = {
  name: "Sherivs",
  legalName: "Sherivs",
  category: "Institutional Intelligence Infrastructure",
  tagline: "Institutional Intelligence Infrastructure",
  description:
    "Sherivs is institutional intelligence infrastructure: a governed platform that models an organization's reality, gives it memory and context, and lets a governed AI workforce carry out missions with evidence and verification.",
  canonicalOrigin: "https://sherivs.com",
  /** Registered product names. Each is a Sherivs product, not a separate brand. */
  products: {
    scholar: { name: "Sherivs Scholar", role: "Education runtime" },
    jarvis: { name: "Jarvis", role: "Executive intelligence" },
    aiWorkforce: { name: "Sherivs AI Workforce", role: "Governed AI workers" },
  },
  /** Legacy name — preserved only for classified technical compatibility. */
  legacyName: "CoreGrid",
} as const;

export const SHERIVS_PAGE_TITLE = `${SHERIVS_BRAND.name} — ${SHERIVS_BRAND.category}`;

/** Build an absolute canonical URL on the Sherivs public origin. */
export function canonicalUrl(path: string): string {
  const clean = path === "/" ? "/" : `/${path.replace(/^\/+/, "").replace(/\/+$/, "")}`;
  return `${SHERIVS_BRAND.canonicalOrigin}${clean}`;
}

/** Compose a document title for a page: "Page — Sherivs". */
export function pageTitle(page?: string): string {
  return page ? `${page} — ${SHERIVS_BRAND.name}` : SHERIVS_PAGE_TITLE;
}
