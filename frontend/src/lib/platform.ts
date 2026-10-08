/**
 * CoreGrid — platform identity constants (UI chrome).
 *
 * Single source for how the platform presents itself: CoreGrid is the PLATFORM
 * (AD-001) — a kernel with governed runtimes installed on it. A runtime's own name,
 * id and description belong to that runtime's layer
 * (`@/lib/runtime/installed-runtimes`), never to the platform's identity module,
 * and UI copy must never imply CoreGrid is built on top of any one runtime.
 */
export const PLATFORM_NAME = "Sherivs";
export const PLATFORM_TAGLINE = "Universal Reality Intelligence Platform";

export const PLATFORM_PAGE_TITLE = "Sherivs — Universal Reality Intelligence Platform";
export const PLATFORM_PAGE_DESCRIPTION =
  "Sherivs is a universal reality intelligence platform — kernel, registries, events, policies and governed runtimes. An installed runtime operates on Sherivs primitives and brings only its own domain: it is a consumer of the platform, never its boundary.";
