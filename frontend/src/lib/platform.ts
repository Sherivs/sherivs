/**
 * Sherivs — platform identity constants (UI chrome).
 *
 * Single source for how the platform presents itself. SHERIVS is the COMPANY
 * and the PLATFORM; "CoreGrid" is a historical internal architecture reference
 * and must never appear on a customer-facing surface. A runtime's own name,
 * id and description belong to that runtime's layer
 * (`@/lib/runtime/installed-runtimes`), never to the platform's identity module,
 * and UI copy must never imply Sherivs is built on top of any one runtime.
 */
export const PLATFORM_NAME = "Sherivs";
export const PLATFORM_TAGLINE = "The operating intelligence for modern organizations";

/** Primary company domain (customer-facing). */
export const PLATFORM_DOMAIN = "sherivs.com";
export const PLATFORM_URL = "https://sherivs.com";

export const PLATFORM_PAGE_TITLE = "Sherivs — The operating intelligence for modern organizations";
export const PLATFORM_PAGE_DESCRIPTION =
  "Sherivs connects your organization's people, knowledge, workflows, communications, data, and AI workforce into one intelligent operating environment.";
