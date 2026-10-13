/**
 * Sherivs — platform identity constants (customer-facing chrome).
 *
 * Sherivs is the public company and platform brand (sherivs.com).
 * CoreGrid is a LEGACY architectural identifier. It must not appear in new
 * customer-facing copy. Runtime names (Scholar, …) belong to
 * `@/lib/runtime/installed-runtimes`, never here.
 *
 * Version target: ACTIVE-V1.
 */
export const PLATFORM_NAME = "Sherivs";
export const PLATFORM_TAGLINE = "Institutional Intelligence Infrastructure";
export const PLATFORM_PUBLIC_DOMAIN = "sherivs.com";
/** Canonical origin for Open Graph and sitemap. DNS cutover is external. */
export const PLATFORM_PUBLIC_ORIGIN = `https://${PLATFORM_PUBLIC_DOMAIN}`;
export const PLATFORM_OG_IMAGE_PATH = "/og-image.png";
export const PLATFORM_OG_IMAGE_URL = `${PLATFORM_PUBLIC_ORIGIN}${PLATFORM_OG_IMAGE_PATH}`;
export const PLATFORM_CATEGORY = "Institutional Intelligence Infrastructure";

export const PLATFORM_PAGE_TITLE = "Sherivs — Institutional Intelligence Infrastructure";
export const PLATFORM_PAGE_DESCRIPTION =
  "Sherivs gives organizations a persistent, machine-readable model of their reality and coordinates humans and AI workers to understand, execute, verify, and improve it — under explicit authority.";

/**
 * LEGACY internal identifier. Do not use in customer-facing UI, metadata,
 * emails, titles, or onboarding. Removal criteria: no remaining database,
 * package, or migration objects require the string.
 */
export const LEGACY_PLATFORM_IDENTIFIER = "CoreGrid";
export const LEGACY_PLATFORM_IDENTIFIER_STATUS = "LEGACY" as const;
