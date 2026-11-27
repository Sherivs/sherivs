export const SUPPORTED_LOCALES = ["en", "ha", "yo", "ig", "fr"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = "en";

export function resolveLocale(locale: string | null | undefined): SupportedLocale {
  const normalized = locale?.trim().toLowerCase();
  if (!normalized) return DEFAULT_LOCALE;
  const base = normalized.split("-")[0] as SupportedLocale;
  return SUPPORTED_LOCALES.includes(base) ? base : DEFAULT_LOCALE;
}
