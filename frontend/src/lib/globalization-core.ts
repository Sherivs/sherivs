/**
 * CoreGrid Globalization — locale, language, culture, identity, and
 * accessibility domain foundation.
 *
 * Implements `architecture/phase-30-globalization.md`:
 * - Globalization principle (C): One Core Architecture + Regional
 *   Configuration + Jurisdictional Rules + Localization + Institutional
 *   Context = Global CoreGrid — never a separate CoreGrid per country.
 * - Globalization vs localization (F) and internationalization (G).
 * - Locale model (H), resolution (I), priority (J): institutional policy >
 *   user preference > device > browser > platform default, each candidate
 *   checked against the authorized locale set.
 * - Language platform (K), multilingual institutions (L), preferences (M),
 *   fallback (N).
 * - Cultural adaptation (V), cultural safety (W): never assume one culture's
 *   conventions are universal.
 * - Name handling (X) and display (Y): no Western-first assumptions.
 * - Address model (Z), phone numbers (AA) + normalization (AB), email
 *   localization (AC), date (AD) and time (AE) formatting.
 * - RTL support (BJ), bidirectional UI (BK), script support (BL), font
 *   support (BM), Unicode integrity (BN), sorting (BO), search (BP),
 *   collation (BQ), accessibility localization (BR).
 *
 * Phase 30 never changes the authorization model: locale resolution is a
 * presentation-context concern, not an authorization boundary (AGENTS.md 30).
 */

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type LocaleId = string & { readonly __brand: "LocaleId" };
export type LanguageId = string & { readonly __brand: "LanguageId" };

export function localeId(raw: string): LocaleId {
  return raw as LocaleId;
}
export function languageId(raw: string): LanguageId {
  return raw as LanguageId;
}

/* ─────────────────────────────────────────────────────────────
 * Locale model (Section H)
 * ────────────────────────────────────────────────────────────*/

export type LocaleScript = "latin" | "arab" | "ethiopic" | "cyrillic" | "other";
export type LocaleDirection = "ltr" | "rtl";
export type LocaleDateFormat = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
export type LocaleTimeFormat = "12h" | "24h";
export type MeasurementSystem = "metric" | "imperial" | "customary" | "local";

export interface Locale {
  id: LocaleId;
  language: string;
  script: LocaleScript;
  region?: string;
  country?: string;
  direction: LocaleDirection;
  dateFormat: LocaleDateFormat;
  timeFormat: LocaleTimeFormat;
  currency?: string;
  calendar: string;
  measurementSystem: MeasurementSystem;
}

export function createLocale(input: {
  id: LocaleId;
  language: string;
  script?: LocaleScript;
  region?: string;
  country?: string;
  direction?: LocaleDirection;
  dateFormat?: LocaleDateFormat;
  timeFormat?: LocaleTimeFormat;
  currency?: string;
  calendar?: string;
  measurementSystem?: MeasurementSystem;
}): { ok: true; locale: Locale } | { ok: false; error: string } {
  if (!input.id || input.id.length === 0) {
    return { ok: false, error: "Locale id is required (Section H)" };
  }
  if (!input.language.trim()) {
    return { ok: false, error: "Locale language is required (Section H)" };
  }
  const direction = input.direction ?? detectScriptDirection(input.language);
  return {
    ok: true,
    locale: {
      id: input.id,
      language: input.language,
      script: input.script ?? "latin",
      region: input.region,
      country: input.country,
      direction,
      // Unambiguous machine-readable defaults for internal systems (AD).
      dateFormat: input.dateFormat ?? "YYYY-MM-DD",
      timeFormat: input.timeFormat ?? "24h",
      currency: input.currency,
      calendar: input.calendar ?? "gregorian",
      measurementSystem: input.measurementSystem ?? "metric",
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * RTL + bidi + Unicode (Sections BJ, BK, BL, BM, BN)
 * ────────────────────────────────────────────────────────────*/

export const RTL_LANGUAGE_CODES: readonly string[] = [
  "ar",
  "he",
  "fa",
  "ur",
  "ps",
  "sd",
  "ug",
  "dv",
] as const;

export function detectScriptDirection(languageCode: string): LocaleDirection {
  return RTL_LANGUAGE_CODES.includes(languageCode.toLowerCase()) ? "rtl" : "ltr";
}

export function getReadingDirection(locale: Locale): LocaleDirection {
  return locale.direction;
}

// Unicode bidirectional override / isolate control codes (Section BN).
export const BIDI_OVERRIDE_CODES: readonly number[] = [
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
] as const;

export function containsBidiOverride(content: string): boolean {
  for (const code of BIDI_OVERRIDE_CODES) {
    if (content.includes(String.fromCharCode(code))) return true;
  }
  return false;
}

// Unicode integrity (Section BN): reject unpaired/lone surrogate halves.
export function isUnicodeSafe(content: string): { ok: true } | { ok: false; error: string } {
  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = content.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return { ok: false, error: `Unpaired high surrogate at index ${i}` };
      }
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return { ok: false, error: `Lone low surrogate at index ${i}` };
    }
  }
  return { ok: true };
}

/* ─────────────────────────────────────────────────────────────
 * Locale resolution + priority (Sections I, J)
 * ────────────────────────────────────────────────────────────*/

export type LocalePreferenceSource =
  "institutional_policy" | "user_preference" | "device" | "browser" | "platform_default";

export interface LocalePreferenceInput {
  institutionalPolicy?: LocaleId;
  userPreference?: LocaleId;
  device?: LocaleId;
  browser?: LocaleId;
  platformDefault: LocaleId;
}

export function resolveLocale(
  prefs: LocalePreferenceInput,
  authorizedLocales: readonly LocaleId[],
): { ok: true; locale: LocaleId; source: LocalePreferenceSource } | { ok: false; error: string } {
  if (authorizedLocales.length === 0) {
    return { ok: false, error: "At least one authorized locale is required (Section I)" };
  }
  const candidates: { locale: LocaleId; source: LocalePreferenceSource }[] = [];
  if (prefs.institutionalPolicy) {
    candidates.push({ locale: prefs.institutionalPolicy, source: "institutional_policy" });
  }
  if (prefs.userPreference) {
    candidates.push({ locale: prefs.userPreference, source: "user_preference" });
  }
  if (prefs.device) {
    candidates.push({ locale: prefs.device, source: "device" });
  }
  if (prefs.browser) {
    candidates.push({ locale: prefs.browser, source: "browser" });
  }
  candidates.push({ locale: prefs.platformDefault, source: "platform_default" });
  for (const candidate of candidates) {
    if (authorizedLocales.includes(candidate.locale)) {
      return { ok: true, locale: candidate.locale, source: candidate.source };
    }
  }
  return { ok: false, error: "No candidate locale is authorized in this context (Section I)" };
}

/* ─────────────────────────────────────────────────────────────
 * Language platform (Sections K, L, M, N)
 * ────────────────────────────────────────────────────────────*/

export interface LanguagePreferences {
  userRef: string;
  primary: string;
  secondary?: string[];
  interfaceLanguage?: string;
  learningLanguage?: string;
  communicationLanguage?: string;
}

export function createLanguagePreferences(input: {
  userRef: string;
  primary: string;
  secondary?: string[];
  interfaceLanguage?: string;
  learningLanguage?: string;
  communicationLanguage?: string;
}): { ok: true; prefs: LanguagePreferences } | { ok: false; error: string } {
  if (!input.userRef.trim()) {
    return { ok: false, error: "Language preferences require a user reference (Section M)" };
  }
  if (!input.primary.trim()) {
    return { ok: false, error: "Primary language is required (Section M)" };
  }
  return {
    ok: true,
    prefs: {
      userRef: input.userRef,
      primary: input.primary,
      secondary: input.secondary ?? [],
      interfaceLanguage: input.interfaceLanguage,
      learningLanguage: input.learningLanguage,
      communicationLanguage: input.communicationLanguage,
    },
  };
}

// Section N: preferred → secondary → institution default → platform default.
export function resolveLanguageFallback(
  prefs: LanguagePreferences,
  institutionDefault: string,
  platformDefault: string,
): string[] {
  const chain: string[] = [];
  const push = (lang: string | undefined): void => {
    if (lang && lang.trim() && !chain.includes(lang)) chain.push(lang);
  };
  push(prefs.primary);
  for (const lang of prefs.secondary ?? []) push(lang);
  push(institutionDefault);
  push(platformDefault);
  return chain.length > 0 ? chain : [platformDefault];
}

export interface InstitutionLanguages {
  institutionRef: string;
  languages: string[];
  primaryInstructionLanguage?: string;
  secondaryInstructionLanguage?: string;
  localLanguage?: string;
  examinationLanguage?: string;
  communicationLanguage?: string;
}

export function createInstitutionLanguages(input: {
  institutionRef: string;
  languages: string[];
  primaryInstructionLanguage?: string;
  secondaryInstructionLanguage?: string;
  localLanguage?: string;
  examinationLanguage?: string;
  communicationLanguage?: string;
}): { ok: true; config: InstitutionLanguages } | { ok: false; error: string } {
  if (!input.institutionRef.trim()) {
    return { ok: false, error: "Institution reference is required (Section L)" };
  }
  if (input.languages.length === 0) {
    return { ok: false, error: "At least one language is required (Section L)" };
  }
  const referenced = [
    input.primaryInstructionLanguage,
    input.secondaryInstructionLanguage,
    input.localLanguage,
    input.examinationLanguage,
    input.communicationLanguage,
  ].filter((l): l is string => Boolean(l));
  const unknown = referenced.filter((l) => !input.languages.includes(l));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Referenced languages not declared: ${unknown.join(", ")} (Section L)`,
    };
  }
  return { ok: true, config: { ...input } };
}

/* ─────────────────────────────────────────────────────────────
 * Cultural adaptation + safety (Sections V, W)
 * ────────────────────────────────────────────────────────────*/

export interface CulturalProfile {
  region?: string;
  conventions: string[];
  symbols: string[];
  namingConvention?: string;
  communicationExpectation?: string;
  educationalPractices: string[];
  regionalTerminology: string[];
  /** Section W: never assume one culture's conventions are universal. */
  assumesUniversal?: boolean;
}

export function createCulturalProfile(input: {
  region?: string;
  conventions?: string[];
  symbols?: string[];
  namingConvention?: string;
  communicationExpectation?: string;
  educationalPractices?: string[];
  regionalTerminology?: string[];
  assumesUniversal?: boolean;
}): { ok: true; profile: CulturalProfile } | { ok: false; error: string } {
  if (input.assumesUniversal === true) {
    return {
      ok: false,
      error: "Cultural profiles must never assert universal conventions (Section W)",
    };
  }
  if (!input.region && (input.conventions ?? []).length === 0) {
    return {
      ok: false,
      error: "Cultural profile requires a region or explicit conventions (Section V)",
    };
  }
  return {
    ok: true,
    profile: {
      region: input.region,
      conventions: input.conventions ?? [],
      symbols: input.symbols ?? [],
      namingConvention: input.namingConvention,
      communicationExpectation: input.communicationExpectation,
      educationalPractices: input.educationalPractices ?? [],
      regionalTerminology: input.regionalTerminology ?? [],
      assumesUniversal: false,
    },
  };
}

export function isCultureAssumptionFree(profile: CulturalProfile): boolean {
  return profile.assumesUniversal !== true;
}

/* ─────────────────────────────────────────────────────────────
 * Name handling + display (Sections X, Y)
 * ────────────────────────────────────────────────────────────*/

export interface PersonName {
  givenName?: string;
  familyName?: string;
  middleName?: string;
  patronymic?: string;
  compoundNames: string[];
  mononym?: string;
  displayOrder: "given-first" | "family-first" | "mononym" | "custom";
  localConvention?: string;
}

export function createPersonName(input: {
  givenName?: string;
  familyName?: string;
  middleName?: string;
  patronymic?: string;
  compoundNames?: string[];
  mononym?: string;
  displayOrder: PersonName["displayOrder"];
  localConvention?: string;
}): { ok: true; name: PersonName } | { ok: false; error: string } {
  const compoundNames = input.compoundNames ?? [];
  if (input.mononym) {
    if (
      input.givenName ||
      input.familyName ||
      input.middleName ||
      input.patronymic ||
      compoundNames.length > 0
    ) {
      return { ok: false, error: "A mononym must not carry other name components (Section X)" };
    }
    if (input.displayOrder === "given-first" || input.displayOrder === "family-first") {
      return { ok: false, error: "Mononym display order must be mononym or custom (Section Y)" };
    }
  } else if (!input.givenName && !input.familyName && !input.patronymic) {
    return { ok: false, error: "A name requires at least one component (Section X)" };
  } else if (input.displayOrder === "mononym") {
    return { ok: false, error: "Non-mononym names cannot use mononym display order (Section Y)" };
  }
  if (input.displayOrder === "given-first" && !input.givenName) {
    return { ok: false, error: "given-first display requires a given name (Section Y)" };
  }
  if (input.displayOrder === "family-first" && !input.familyName) {
    return { ok: false, error: "family-first display requires a family name (Section Y)" };
  }
  return {
    ok: true,
    name: {
      givenName: input.givenName,
      familyName: input.familyName,
      middleName: input.middleName,
      patronymic: input.patronymic,
      compoundNames,
      mononym: input.mononym,
      displayOrder: input.displayOrder,
      localConvention: input.localConvention,
    },
  };
}

export function formatNameForDisplay(name: PersonName): string {
  switch (name.displayOrder) {
    case "mononym":
      return name.mononym ?? "";
    case "given-first":
      return [name.givenName, name.middleName, name.familyName].filter(Boolean).join(" ");
    case "family-first":
      return [name.familyName, name.middleName, name.givenName].filter(Boolean).join(" ");
    case "custom":
      return [name.familyName, name.givenName, name.middleName, ...name.compoundNames]
        .filter(Boolean)
        .join(" ");
  }
}

/* ─────────────────────────────────────────────────────────────
 * Address model (Section Z)
 * ────────────────────────────────────────────────────────────*/

export interface RegionalAddress {
  street?: string;
  district?: string;
  ward?: string;
  village?: string;
  compound?: string;
  landmark?: string;
  postalCode?: string;
  administrativeRegion?: string;
  locality?: string;
  country: string;
}

export function createRegionalAddress(input: {
  street?: string;
  district?: string;
  ward?: string;
  village?: string;
  compound?: string;
  landmark?: string;
  postalCode?: string;
  administrativeRegion?: string;
  locality?: string;
  country: string;
}): { ok: true; address: RegionalAddress } | { ok: false; error: string } {
  if (!input.country.trim()) return { ok: false, error: "Address country is required (Section Z)" };
  const fields = [
    input.street,
    input.district,
    input.ward,
    input.village,
    input.compound,
    input.landmark,
    input.postalCode,
    input.locality,
  ];
  if (fields.every((f) => !f || !f.trim())) {
    return { ok: false, error: "Address requires at least one locator field (Section Z)" };
  }
  return { ok: true, address: { ...input } };
}

export function isAddressUsableForDelivery(address: RegionalAddress): boolean {
  const locators = [
    address.street,
    address.district,
    address.ward,
    address.village,
    address.compound,
    address.landmark,
    address.postalCode,
    address.locality,
  ];
  return Boolean(address.country.trim()) && locators.some((f) => f && f.trim());
}

/* ─────────────────────────────────────────────────────────────
 * Phone numbers (Sections AA, AB)
 * ────────────────────────────────────────────────────────────*/

export interface PhoneNumber {
  countryCode: string;
  nationalNumber: string;
  displayFormat?: string;
}

export function normalizePhoneNumber(input: {
  countryCode: string;
  nationalNumber: string;
}): { ok: true; number: PhoneNumber; international: string } | { ok: false; error: string } {
  const cc = input.countryCode.replace(/\D/g, "");
  const nn = input.nationalNumber.replace(/\D/g, "");
  if (!/^\d{1,3}$/.test(cc)) {
    return { ok: false, error: "Invalid country code (Section AB)" };
  }
  if (!nn) {
    return { ok: false, error: "National number is required (Section AA)" };
  }
  return {
    ok: true,
    number: { countryCode: cc, nationalNumber: nn },
    international: `+${cc}${nn}`,
  };
}

export function formatPhoneForDisplay(number: PhoneNumber): string {
  return number.displayFormat ?? `+${number.countryCode} ${number.nationalNumber}`;
}

/* ─────────────────────────────────────────────────────────────
 * Email localization (Section AC)
 * ────────────────────────────────────────────────────────────*/

export interface EmailLocalizationProfile {
  language: string;
  dateFormat: string;
  timeFormat: string;
  legalNotices: string[];
  senderIdentity: string;
}

export function createEmailLocalizationProfile(input: {
  language: string;
  dateFormat: string;
  timeFormat: string;
  legalNotices?: string[];
  senderIdentity: string;
}): { ok: true; profile: EmailLocalizationProfile } | { ok: false; error: string } {
  if (!input.language.trim())
    return { ok: false, error: "Email language is required (Section AC)" };
  if (!input.senderIdentity.trim()) {
    return { ok: false, error: "Regional sender identity is required (Section AC)" };
  }
  return {
    ok: true,
    profile: {
      language: input.language,
      dateFormat: input.dateFormat,
      timeFormat: input.timeFormat,
      legalNotices: input.legalNotices ?? [],
      senderIdentity: input.senderIdentity,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Date + time formatting (Sections AD, AE)
 * ────────────────────────────────────────────────────────────*/

export function formatDateForLocale(
  date: string,
  dateFormat: LocaleDateFormat,
): { ok: true; value: string } | { ok: false; error: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return { ok: false, error: "Date must be ISO YYYY-MM-DD (Section AD)" };
  const [, y, mo, d] = m;
  if (dateFormat === "YYYY-MM-DD") return { ok: true, value: `${y}-${mo}-${d}` };
  if (dateFormat === "DD/MM/YYYY") return { ok: true, value: `${d}/${mo}/${y}` };
  return { ok: true, value: `${mo}/${d}/${y}` };
}

export function formatTimeForLocale(
  time: string,
  timeFormat: LocaleTimeFormat,
): { ok: true; value: string } | { ok: false; error: string } {
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return { ok: false, error: "Time must be HH:mm (Section AE)" };
  const hour = Number(m[1]);
  if (hour < 0 || hour > 23) return { ok: false, error: "Hour out of range (Section AE)" };
  const minutes = m[2];
  if (timeFormat === "24h")
    return { ok: true, value: `${String(hour).padStart(2, "0")}:${minutes}` };
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return { ok: true, value: `${hour12}:${minutes} ${suffix}` };
}

/* ─────────────────────────────────────────────────────────────
 * Sorting, search, collation (Sections BO, BP, BQ)
 * ────────────────────────────────────────────────────────────*/

export function localeAwareCompare(a: string, b: string, localeTag: string): number {
  try {
    return new Intl.Collator(localeTag).compare(a, b);
  } catch {
    return a.localeCompare(b);
  }
}

export function normalizeSearchText(text: string): string {
  return text.normalize("NFKC").toLowerCase().trim();
}

/* ─────────────────────────────────────────────────────────────
 * Accessibility localization (Section BR)
 * ────────────────────────────────────────────────────────────*/

export interface AccessibilityLocalization {
  language: string;
  script: string;
  readingDirection: LocaleDirection;
  screenReaderCompatible: boolean;
  localConventions: string[];
}

export function createAccessibilityLocalization(input: {
  language: string;
  script: string;
  readingDirection?: LocaleDirection;
  screenReaderCompatible?: boolean;
  localConventions?: string[];
}): { ok: true; localization: AccessibilityLocalization } | { ok: false; error: string } {
  if (!input.language.trim()) {
    return { ok: false, error: "Accessibility language is required (Section BR)" };
  }
  const readingDirection = input.readingDirection ?? (input.script === "arab" ? "rtl" : "ltr");
  return {
    ok: true,
    localization: {
      language: input.language,
      script: input.script,
      readingDirection,
      screenReaderCompatible: input.screenReaderCompatible ?? true,
      localConventions: input.localConventions ?? [],
    },
  };
}
