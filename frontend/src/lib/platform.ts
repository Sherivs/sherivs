/**
 * Customer-facing platform identity.
 *
 * Sherivs is the product brand: institutional intelligence infrastructure.
 * CoreGrid remains the technical substrate name in code identifiers, database
 * objects, migrations, package names, and architecture documents. This module
 * must not be used to rename those identifiers.
 *
 * A runtime's own name lives in `@/lib/runtime/installed-runtimes`. UI copy
 * must never treat an installed runtime as the identity of the platform.
 */
export const TECHNICAL_SUBSTRATE_NAME = "CoreGrid";

export const PLATFORM_NAME = "Sherivs";
export const PLATFORM_TAGLINE = "Institutional Intelligence Infrastructure";
export const PLATFORM_CATEGORY = "Institutional intelligence infrastructure";
export const PLATFORM_ORIGIN = "https://sherivs.com";

export const PLATFORM_PAGE_TITLE = `${PLATFORM_NAME} — ${PLATFORM_TAGLINE}`;
export const PLATFORM_PAGE_DESCRIPTION =
  "Sherivs is institutional intelligence infrastructure: a governed platform for organizational reality, memory, missions, an AI workforce, evidence, and the domain runtimes an organization installs. An installed runtime consumes the platform. It is never the platform's identity.";
