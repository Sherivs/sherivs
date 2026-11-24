import { createInstance, type i18n as I18nInstance } from "i18next";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import ha from "./locales/ha.json";
import ig from "./locales/ig.json";
import yo from "./locales/yo.json";

export const SUPPORTED_LOCALES = ["en", "ha", "yo", "ig", "fr"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = "en";

export const resources = {
  en: { translation: en },
  ha: { translation: ha },
  yo: { translation: yo },
  ig: { translation: ig },
  fr: { translation: fr },
} as const;

export function resolveLocale(locale: string | null | undefined): SupportedLocale {
  const normalized = locale?.trim().toLowerCase();
  if (!normalized) return DEFAULT_LOCALE;
  const base = normalized.split("-")[0] as SupportedLocale;
  return SUPPORTED_LOCALES.includes(base) ? base : DEFAULT_LOCALE;
}

export function initializeI18n(
  instance: I18nInstance,
  locale: string | null | undefined,
): I18nInstance {
  void instance.init({
    resources: resources as Record<string, { translation: object }>,
    lng: resolveLocale(locale),
    fallbackLng: DEFAULT_LOCALE,
    defaultNS: "translation",
    interpolation: { escapeValue: false },
    returnNull: false,
    initAsync: false,
  });
  return instance;
}

export function createI18n(locale: string | null | undefined): I18nInstance {
  return initializeI18n(createInstance(), locale);
}
