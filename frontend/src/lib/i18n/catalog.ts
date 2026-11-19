/**
 * Platform UI string catalogues (mission M23, ADR-110): en, ha, yo, ig.
 *
 * Scaffolding only. English is the source and the fallback; the Hausa, Yoruba and Igbo catalogues
 * hold every English key with an empty value until a human translator supplies it. This module
 * does not replace the existing feature catalogues (lib/website/i18n.ts, lib/sherivs-ws/i18n.ts,
 * lib/scholar/i18n.ts with the `ui_strings` RPC); it is the neutral home for new shell strings.
 */
import type { LocaleCatalogue } from "./catalog-types";
import { en, type CatalogueKey } from "./catalogues/en";
import { ha } from "./catalogues/ha";
import { ig } from "./catalogues/ig";
import { yo } from "./catalogues/yo";

export const CATALOGUE_LOCALES = ["en", "ha", "yo", "ig"] as const;
export type CatalogueLocale = (typeof CATALOGUE_LOCALES)[number];
export type { CatalogueKey };

export const CATALOGUES: Readonly<Record<CatalogueLocale, Readonly<Record<CatalogueKey, string>>>> =
  Object.freeze({
    en,
    ha,
    yo,
    ig,
  } satisfies Record<CatalogueLocale, LocaleCatalogue>);

export function isCatalogueLocale(value: unknown): value is CatalogueLocale {
  return typeof value === "string" && (CATALOGUE_LOCALES as readonly string[]).includes(value);
}

/** The string for `key` in `locale`, falling back to English when missing or empty. */
export function translate(locale: string, key: CatalogueKey): string {
  const catalogue = isCatalogueLocale(locale) ? CATALOGUES[locale] : CATALOGUES.en;
  const value = catalogue[key];
  return typeof value === "string" && value.length > 0 ? value : en[key];
}
