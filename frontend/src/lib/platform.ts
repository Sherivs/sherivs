/**
 * Sherivs — customer-facing platform identity.
 *
 * Brand law:
 *   Sherivs is the customer-facing platform.
 *   Domain runtimes install on this layer; they never become its identity.
 *   Jarvis is executive intelligence.
 *   CoreGrid is the internal kernel / engineering name. It must not appear as
 *   the product brand on customer-facing chrome.
 *
 * A runtime's own name, id and description belong to that runtime's layer
 * (`@/lib/runtime/installed-runtimes`), never to this module. UI copy must never
 * imply Sherivs is built on top of any one runtime.
 */
export const PLATFORM_NAME = "Sherivs";
export const PLATFORM_TAGLINE = "Institutional Intelligence Infrastructure";
export const PLATFORM_CATEGORY = "Institutional Intelligence Infrastructure";
export const PLATFORM_PUBLIC_DOMAIN = "sherivs.com";
export const PLATFORM_PUBLIC_ORIGIN = "https://sherivs.com";

export const PLATFORM_PAGE_TITLE = "Sherivs — Institutional Intelligence Infrastructure";
export const PLATFORM_PAGE_DESCRIPTION =
  "Sherivs is institutional intelligence infrastructure: a governed operating layer for organizations, people, knowledge, work, evidence and AI. Domain runtimes install on that layer; they are never the platform identity.";

/** Internal engineering / kernel name. Not customer-facing brand. */
export const KERNEL_NAME = "CoreGrid";

export const PRODUCT_JARVIS = "Jarvis";
export const PRODUCT_AI_WORKFORCE = "Sherivs AI Workforce";

/** Legacy production hosts that still resolve as the platform, not a tenant. */
export const LEGACY_PLATFORM_ORIGINS = [
  "https://universalschoolos.com",
  "https://www.universalschoolos.com",
  "https://app.universalschoolos.com",
] as const;
