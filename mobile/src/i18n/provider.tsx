import { useMemo, type ReactNode } from "react";
import { getLocales } from "expo-localization";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { initializeI18n } from "@/i18n/config";

export function MobileI18nProvider({ children }: { children: ReactNode }) {
  const i18n = useMemo(() => {
    const locale = getLocales()[0]?.languageTag;
    const instance = createInstance().use(initReactI18next);
    return initializeI18n(instance, locale);
  }, []);
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
