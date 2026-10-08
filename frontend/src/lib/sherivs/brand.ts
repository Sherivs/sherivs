/**
 * Sherivs — canonical brand identity (customer-facing).
 *
 * Single source of truth for how the platform names itself to people. Technical
 * identifiers (package scope `@coregrid/*`, database objects, storage buckets,
 * migration files, header names) intentionally keep their legacy spelling for
 * compatibility — see architecture/sherivs-experience/SHERIVS_BRAND_MIGRATION.md.
 *
 * Version target: V1-ACTIVE. Nothing here names a frozen (V2/V3) capability.
 */

export const BRAND_NAME = "Sherivs";
export const BRAND_WORDMARK = "SHERIVS";
export const BRAND_DOMAIN = "sherivs.com";
export const BRAND_CATEGORY = "Institutional Intelligence Infrastructure";

/** Public origin used for canonical URLs, sitemap, Open Graph. Never client-supplied. */
export const PUBLIC_ORIGIN = `https://${BRAND_DOMAIN}`;

export interface BrandProduct {
  readonly id: "scholar" | "jarvis" | "ai-workforce";
  readonly name: string;
  readonly role: string;
  readonly summary: string;
}

/** The named Sherivs product family. Only products that exist in the V1 envelope. */
export const BRAND_PRODUCTS: readonly BrandProduct[] = [
  {
    id: "scholar",
    name: "Sherivs Scholar",
    role: "Education runtime",
    summary:
      "The first domain runtime installed on Sherivs: schools run admissions, academics, attendance, fees and communication on the shared governed core.",
  },
  {
    id: "jarvis",
    name: "Jarvis",
    role: "Executive intelligence",
    summary:
      "The governed executive orchestrator. It coordinates, escalates and summarizes — it never bypasses authorization or approves its own work.",
  },
  {
    id: "ai-workforce",
    name: "Sherivs AI Workforce",
    role: "Governed AI workers",
    summary:
      "Workers are identities with an owner, scope, tools and a lease. A worker's claim is never verification.",
  },
] as const;

export const BRAND_TAGLINE = BRAND_CATEGORY;

export const BRAND_DESCRIPTION =
  "Sherivs is institutional intelligence infrastructure: one governed platform where an organization's people, work, knowledge and AI workforce operate with evidence, authority and audit.";

/** How a page title is composed everywhere (routes, manifest, shell). */
export function pageTitle(title?: string): string {
  return title ? `${title} — ${BRAND_NAME}` : `${BRAND_NAME} — ${BRAND_CATEGORY}`;
}

export function canonicalUrl(path: string): string {
  const clean = path === "/" ? "/" : `/${path.replace(/^\/+|\/+$/g, "")}`;
  return `${PUBLIC_ORIGIN}${clean === "/" ? "/" : clean}`;
}

/**
 * Real, verifiable social presence only. Empty by design: no Sherivs social
 * accounts are recorded in this repository, and the program forbids inventing
 * them. Add an entry only with a recorded, verified URL.
 */
export const BRAND_SOCIAL_PROFILES: readonly { readonly network: string; readonly url: string }[] =
  [];
