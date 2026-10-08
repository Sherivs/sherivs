/**
 * Sherivs — platform identity constants (UI chrome).
 *
 * Single source for how the platform presents itself to customers. Sherivs is the
 * PLATFORM (AD-001) — a kernel with governed runtimes installed on it. A runtime's own
 * name, id and description belong to that runtime's layer
 * (`@/lib/runtime/installed-runtimes`), never to the platform's identity module, and UI
 * copy must never imply the platform is built on top of any one runtime.
 *
 * Technical identifiers that predate the brand (package names, `cg_` tables, env vars,
 * cache names, route `/coregrid`) are compatibility contracts and are NOT renamed here —
 * see docs/experience/SHERIVS_BRAND_MIGRATION.md.
 */
export const PLATFORM_NAME = "Sherivs";
export const PLATFORM_TAGLINE = "Institutional Intelligence Infrastructure";

export const PLATFORM_DOMAIN = "sherivs.com";
export const PLATFORM_ORIGIN = `https://${PLATFORM_DOMAIN}`;

/** Executive intelligence surface. */
export const PLATFORM_EXECUTIVE_INTELLIGENCE_NAME = "Jarvis";
/** Governed AI workers operating alongside people. */
export const PLATFORM_WORKFORCE_NAME = "Sherivs AI Workforce";

export const PLATFORM_PAGE_TITLE = `${PLATFORM_NAME} — ${PLATFORM_TAGLINE}`;
export const PLATFORM_PAGE_DESCRIPTION =
  "Sherivs is institutional intelligence infrastructure: one governed layer that represents an organization's reality — people, systems, knowledge, events and decisions — and lets people and governed AI workers act on it with evidence, verification and audit.";

/** Absolute canonical URL for a platform path (always the public brand origin). */
export function platformUrl(path = "/"): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${PLATFORM_ORIGIN}${normalized === "/" ? "/" : normalized.replace(/\/+$/u, "")}`;
}
