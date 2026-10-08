/**
 * Sherivs — customer-facing platform identity (UI chrome).
 *
 * Single source for how the product presents itself. Sherivs is the PLATFORM
 * (AD-001) — a kernel with governed runtimes installed on it. A runtime's own
 * name, id and description belong to that runtime's layer
 * (`@/lib/runtime/installed-runtimes`), never to the platform's identity module.
 *
 * Engineering/internal kernel name "CoreGrid" is preserved in architecture,
 * database, packages and migrations. It is not the customer-facing brand.
 *
 * UI copy must never imply Sherivs is built on top of any one runtime.
 */
export const PLATFORM_NAME = "Sherivs";
export const PLATFORM_CATEGORY = "Institutional Intelligence Infrastructure";
export const PLATFORM_TAGLINE = "Institutional Intelligence Infrastructure";
export const PLATFORM_DOMAIN = "sherivs.com";
export const PLATFORM_CANONICAL_ORIGIN = "https://sherivs.com";

export const EXECUTIVE_INTELLIGENCE_BRAND = "Jarvis";
export const AI_WORKFORCE_BRAND = "Sherivs AI Workforce";

export const PLATFORM_PAGE_TITLE = "Sherivs — Institutional Intelligence Infrastructure";
export const PLATFORM_PAGE_DESCRIPTION =
  "Sherivs is institutional intelligence infrastructure — a governed platform for organizational reality, memory, missions, an AI workforce, evidence and verification. Domain runtimes consume the platform; they are never its boundary.";
