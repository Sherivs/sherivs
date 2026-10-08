/**
 * Sherivs — platform identity constants (UI chrome).
 *
 * Single source for how the platform presents itself: Sherivs is the PLATFORM
 * (AD-001) — a kernel with governed runtimes installed on it. A runtime's own name,
 * id and description belong to that runtime's layer
 * (`@/lib/runtime/installed-runtimes`), never to the platform's identity module,
 * and UI copy must never imply Sherivs is built on top of any one runtime.
 *
 * The canonical brand lives in `@/lib/sherivs/brand`; these names are the
 * long-standing import surface that shell and route code already use.
 */
import { BRAND_CATEGORY, BRAND_DESCRIPTION, BRAND_NAME, pageTitle } from "@/lib/sherivs/brand";

export const PLATFORM_NAME = BRAND_NAME;
export const PLATFORM_TAGLINE = BRAND_CATEGORY;

export const PLATFORM_PAGE_TITLE = pageTitle();
export const PLATFORM_PAGE_DESCRIPTION = BRAND_DESCRIPTION;
