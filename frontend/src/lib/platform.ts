/**
 * Sherivs — platform identity constants (UI chrome).
 *
 * Single source for how the platform presents itself: Sherivs is the PLATFORM
 * (AD-001) — a kernel with governed runtimes installed on it. A runtime's own
 * name, id and description belong to that runtime's layer
 * (`@/lib/runtime/installed-runtimes`), never to the platform's identity module,
 * and UI copy must never imply Sherivs is built on top of any one runtime.
 *
 * The customer-facing brand is Sherivs. The legacy name "CoreGrid" survives only
 * in classified technical identifiers (see the brand migration record).
 */
import { SHERIVS_BRAND, SHERIVS_PAGE_TITLE } from "@/lib/experience-system/sherivs-brand";

export const PLATFORM_NAME = SHERIVS_BRAND.name;
export const PLATFORM_TAGLINE = SHERIVS_BRAND.tagline;

export const PLATFORM_PAGE_TITLE = SHERIVS_PAGE_TITLE;
export const PLATFORM_PAGE_DESCRIPTION = SHERIVS_BRAND.description;
