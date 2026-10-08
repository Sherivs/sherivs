/**
 * Sherivs — platform identity constants (UI chrome).
 *
 * SHERIVS is the customer-facing brand. "CoreGrid" remains the TECHNICAL
 * kernel identifier (migrations, database identifiers, package names,
 * architecture records) and is preserved for engineering compatibility —
 * see PLATFORM_KERNEL_NAME and docs/experience/SHERIVS_BRAND_MIGRATION.md.
 *
 * A domain runtime's own name, id and description belong to that runtime's
 * layer (`@/lib/runtime/installed-runtimes`), never to the platform's
 * identity module, and UI copy must never imply the platform is built on
 * top of any one runtime.
 */
import {
  SHERIVS_NAME,
  SHERIVS_TAGLINE,
  SHERIVS_PAGE_TITLE,
  SHERIVS_PAGE_DESCRIPTION,
} from "@/lib/sherivs-brand";

/** Customer-facing platform name rendered in UI chrome. */
export const PLATFORM_NAME = SHERIVS_NAME;
export const PLATFORM_TAGLINE = SHERIVS_TAGLINE;

export const PLATFORM_PAGE_TITLE = SHERIVS_PAGE_TITLE;
export const PLATFORM_PAGE_DESCRIPTION = SHERIVS_PAGE_DESCRIPTION;

/**
 * Technical kernel identifier. Preserved for engineering compatibility:
 * database identifiers, migrations, package names, audit sources and
 * architecture records continue to reference the kernel by this name.
 * Never render this to customers — UI chrome uses PLATFORM_NAME.
 */
export const PLATFORM_KERNEL_NAME = "CoreGrid";
