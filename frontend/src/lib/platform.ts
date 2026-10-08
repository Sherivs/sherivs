/**
 * Sherivs — platform identity constants (UI chrome).
 *
 * Single source for how the platform presents itself. The platform is the
 * governed kernel on which runtimes are installed (AD-001); a runtime's own
 * name, id and description belong to the runtime layer
 * (`@/lib/runtime/installed-runtimes`), never here, and UI copy must never
 * imply the platform is built on top of any one runtime.
 *
 * Brand values are owned by `@/lib/experience/brand` (SHERIVS_BRAND_MIGRATION.md);
 * this module re-exports them under the names existing consumers import.
 */
import { BRAND, BRAND_PAGE_DESCRIPTION, BRAND_PAGE_TITLE } from "@/lib/experience/brand";

export const PLATFORM_NAME = BRAND.name;
export const PLATFORM_TAGLINE = BRAND.category;

export const PLATFORM_PAGE_TITLE = BRAND_PAGE_TITLE;
export const PLATFORM_PAGE_DESCRIPTION = BRAND_PAGE_DESCRIPTION;
