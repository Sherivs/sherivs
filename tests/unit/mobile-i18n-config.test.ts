import { describe, expect, it } from "vitest";
import { createI18n, DEFAULT_LOCALE, resolveLocale } from "../../mobile/src/i18n/config";

describe("mobile i18n locale behavior", () => {
  it("falls back to English for unknown locales", () => {
    expect(resolveLocale("pt-BR")).toBe(DEFAULT_LOCALE);
    const i18n = createI18n("pt-BR");
    expect(i18n.language).toBe("en");
    expect(i18n.t("school.home.signOut")).toBe("Sign out");
  });

  it("falls back to English when a supported locale is missing a key", () => {
    const i18n = createI18n("ha-NG");
    expect(i18n.language).toBe("ha");
    expect(i18n.t("school.attendance.empty")).toBe("No attendance recorded in the last 60 days.");
  });
});
