import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, resolveLocale } from "../../mobile/src/i18n/locale";
import en from "../../mobile/src/i18n/locales/en.json";
import fr from "../../mobile/src/i18n/locales/fr.json";
import ha from "../../mobile/src/i18n/locales/ha.json";
import ig from "../../mobile/src/i18n/locales/ig.json";
import yo from "../../mobile/src/i18n/locales/yo.json";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function leafPaths(value: JsonValue, prefix = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => leafPaths(entry, `${prefix}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, nested]) =>
      leafPaths(nested as JsonValue, prefix ? `${prefix}.${key}` : key),
    );
  }
  return prefix ? [prefix] : [];
}

function hasPath(source: Record<string, unknown>, path: string): boolean {
  const parts = path.split(".");
  let current: unknown = source;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) return false;
    current = (current as Record<string, unknown>)[part];
  }
  return true;
}

describe("mobile i18n locale behavior", () => {
  it("resolves locale with English fallback", () => {
    expect(resolveLocale("pt-BR")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("ha-NG")).toBe("ha");
    expect(resolveLocale(null)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("")).toBe(DEFAULT_LOCALE);
  });

  it("keeps all `(school)` screen key paths in English dictionary", () => {
    const screenPaths = [
      "school.tabs.home",
      "school.tabs.results",
      "school.tabs.attendance",
      "school.tabs.fees",
      "school.tabs.messages",
      "school.tabs.cbt",
      "school.home.welcome",
      "school.home.labels.school",
      "school.home.labels.role",
      "school.home.labels.workspace",
      "school.home.labels.children",
      "school.home.labels.admissionNumber",
      "school.home.platformConsoleTitle",
      "school.home.platformConsoleSubtitle",
      "school.home.signOut",
      "school.results.empty",
      "school.fees.empty",
      "school.fees.outstanding",
      "school.fees.due",
      "school.fees.payOnWeb",
      "school.messages.empty",
      "school.messages.unreadPrefix",
      "school.messages.noSubject",
      "school.cbt.cannotStart",
      "school.cbt.submitFailed",
      "school.cbt.savedOnDeviceRetry",
      "school.cbt.submitted",
      "school.cbt.deadline",
      "school.cbt.notSavedToServer",
      "school.cbt.errorHeadline",
      "school.cbt.submit",
      "school.cbt.empty",
      "school.cbt.durationAndClose",
      "school.attendance.empty",
      "school.attendance.summary",
    ];

    for (const path of screenPaths) {
      expect(hasPath(en as Record<string, unknown>, path), `${path} missing in en.json`).toBe(true);
    }
  });

  it("allows non-English locale files to define only keys that exist in English", () => {
    const englishLeafPaths = new Set(leafPaths(en as JsonValue));
    const localized = { ha, yo, ig, fr };

    for (const [locale, payload] of Object.entries(localized)) {
      for (const path of leafPaths(payload as JsonValue)) {
        expect(
          englishLeafPaths.has(path),
          `${locale}.json has non-English key not present in en.json: ${path}`,
        ).toBe(true);
      }
    }
  });
});
