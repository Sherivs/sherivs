/**
 * Sherivs — canonical brand model (SHERIVS_BRAND_MIGRATION.md §2).
 *
 * The customer-facing brand is SHERIVS. "CoreGrid" survives ONLY as a
 * technical lineage identifier (package names, `cg_*` tables, migration
 * ids, architecture document titles, registry ids) and must never reach a
 * customer-facing string. This module is the single source for every
 * customer-visible brand token; `@/lib/platform` re-exports the platform
 * identity constants from here for existing consumers.
 *
 * Runtime names (e.g. the education runtime) belong to the runtime layer
 * (`@/lib/runtime/installed-runtimes`), never here — the platform's identity
 * must remain valid with no runtime installed.
 */

export const BRAND = {
  /** Canonical wordmark. */
  name: "Sherivs",
  /** Wordmark as set (uppercase display lockup). */
  wordmark: "SHERIVS",
  /** Product category — the public tagline. */
  category: "Institutional Intelligence Infrastructure",
  /** Canonical public host and origin. */
  domain: "sherivs.com",
  origin: "https://sherivs.com",
  /** Executive intelligence surface. */
  executiveIntelligence: "Jarvis",
  /** Governed AI workforce. */
  aiWorkforce: "Sherivs AI Workforce",
  /** Technical lineage identifier — NEVER customer-facing. */
  lineage: "coregrid",
} as const;

export const BRAND_PAGE_TITLE = `${BRAND.name} — ${BRAND.category}`;

export const BRAND_PAGE_DESCRIPTION =
  "Sherivs is institutional intelligence infrastructure: one governed layer that represents an organization's reality — people, systems, knowledge, events and decisions — and lets a governed AI workforce act on it with evidence, verification and audit.";

/** Hosts that resolve to the Sherivs platform plane (never an organization). */
export const PLATFORM_HOSTS: readonly string[] = [
  "localhost",
  "127.0.0.1",
  "sherivs.com",
  "www.sherivs.com",
  "app.sherivs.com",
  // Legacy hosts retained for continuity until DNS cut-over is recorded.
  "universalschoolos.com",
  "www.universalschoolos.com",
  "app.universalschoolos.com",
];

/** Build a canonical absolute URL on the Sherivs public origin. */
export function canonicalUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${BRAND.origin}${normalized}`;
}

/** Compose a document title in the Sherivs convention: "Page — Sherivs". */
export function pageTitle(page?: string | null): string {
  return page && page.trim().length > 0 ? `${page.trim()} — ${BRAND.name}` : BRAND_PAGE_TITLE;
}

/**
 * Classification of a legacy brand reference, used by the migration audit
 * and its unit test. Only USER_VISIBLE references are renamed.
 */
export type BrandReferenceClass =
  | "USER_VISIBLE"
  | "TECHNICAL_IDENTIFIER"
  | "COMMENT"
  | "LEGACY_DOMAIN";

export const BRAND_REFERENCE_POLICY: Readonly<Record<BrandReferenceClass, "rename" | "keep">> = {
  USER_VISIBLE: "rename",
  TECHNICAL_IDENTIFIER: "keep",
  COMMENT: "keep",
  LEGACY_DOMAIN: "rename",
};
