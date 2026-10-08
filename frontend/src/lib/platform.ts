/**
 * Platform identity constants (UI chrome).
 *
 * Sherivs is the customer-facing brand. CoreGrid remains the technical kernel
 * name for schemas, migrations and internal contracts — preserved, not erased.
 * A runtime's own name, id and description belong to that runtime's layer
 * (`@/lib/runtime/installed-runtimes`), never to this module, and UI copy must
 * never imply the platform is one installed runtime.
 */
export const PLATFORM_KERNEL_NAME = "CoreGrid";
export const PLATFORM_NAME = "Sherivs";
export const PLATFORM_TAGLINE = "Institutional Intelligence Infrastructure";
export const PLATFORM_DOMAIN = "sherivs.com";
export const PLATFORM_ORIGIN = "https://sherivs.com";

export const PLATFORM_PAGE_TITLE = `${PLATFORM_NAME} — ${PLATFORM_TAGLINE}`;
export const PLATFORM_PAGE_DESCRIPTION =
  "Sherivs is institutional intelligence infrastructure: a governed kernel for organizational reality, memory, missions, an AI workforce, evidence and policy. An installed runtime brings only its own domain. It is a consumer of the platform, never its boundary.";
