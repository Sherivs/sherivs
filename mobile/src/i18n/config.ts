import { createInstance, type i18n as I18nInstance } from "i18next";
import {
  DEFAULT_LOCALE,
  resolveLocale,
  type SupportedLocale,
  SUPPORTED_LOCALES,
} from "@/i18n/locale";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import ha from "./locales/ha.json";
import ig from "./locales/ig.json";
import yo from "./locales/yo.json";

export { DEFAULT_LOCALE, resolveLocale, type SupportedLocale, SUPPORTED_LOCALES };

export const resources = {
  en: { translation: en },
  ha: { translation: ha },
  yo: { translation: yo },
  ig: { translation: ig },
  fr: { translation: fr },
} as const;

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
