// ─── Phase 30 — Globalization ────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  localeId,
  createLocale,
  detectScriptDirection,
  getReadingDirection,
  containsBidiOverride,
  isUnicodeSafe,
  resolveLocale,
  createLanguagePreferences,
  resolveLanguageFallback,
  createInstitutionLanguages,
  createCulturalProfile,
  isCultureAssumptionFree,
  createPersonName,
  formatNameForDisplay,
  createRegionalAddress,
  isAddressUsableForDelivery,
  normalizePhoneNumber,
  formatPhoneForDisplay,
  createEmailLocalizationProfile,
  formatDateForLocale,
  formatTimeForLocale,
  localeAwareCompare,
  normalizeSearchText,
  createAccessibilityLocalization,
} from "@/lib/globalization-core";
import {
  createTranslationKey,
  parseTranslationKey,
  createTranslation,
  updateTranslation,
  createAiTranslation,
  isAiTranslationDeployable,
  reviewTranslation,
  approveTranslation,
  createTranslationMemoryEntry,
  findTranslationMemory,
  createTerminologyEntry,
  proposeTerminologyChange,
  approveTerminologyChange,
  createLocalizedContent,
  resolveContentFallback,
  detectTranslationDrift,
  hasOutdatedVariants,
  validateContentGovernance,
  createLocalizationFeedback,
  translationKeyId,
  translationId,
  terminologyId,
  contentVariantId,
  localizationFeedbackId,
} from "@/lib/localization-content";
import {
  createCountryProfile,
  createRegionProfile,
  createJurisdiction,
  isJurisdictionChainValid,
  registerJurisdictionalRule,
  isRuleEffectiveAt,
  getEffectiveRule,
  supersedeJurisdictionalRule,
  createJurisdictionLegalMetadata,
  isDataTransferPermitted,
  resolveIdentityFormat,
  createTimezoneProfile,
  isTimezoneRuleCurrent,
  createInstitutionTimezoneMap,
  createEventTime,
  isEventTimeUnambiguous,
  createCalendarSystem,
  canRegisterAuthoritativeCalendar,
  createAcademicCalendar,
  createHoliday,
  resolveHolidayDate,
  isReligiousObservanceConfigurable,
  createEducationTerminology,
  resolveLocalTerm,
  createGradingScheme,
  createExaminationConvention,
  createGovernmentReportingLocalization,
  createEducationalLanguageConfig,
  createAfricanLanguagePriorityItem,
  scoreAfricanLanguagePriority,
  planAfricanLanguageExpansion,
  jurisdictionId,
  regionalRuleId,
  timezoneProfileId,
  calendarSystemId,
  academicCalendarId,
  holidayId,
} from "@/lib/regional-context";
import {
  createLocalizedMonetaryValue,
  createNumberFormatConfig,
  formatNumber,
  formatCurrencyForLocale,
  createFxRate,
  roundCurrencyMajor,
  convertCurrency,
  getHistoricalFxRate,
  createTaxConfiguration,
  getEffectiveTaxRate,
  createUnitDefinition,
  createUnitConversion,
  convertUnit,
  createCsvLocalizationConfig,
  formatCsvCell,
  createDocumentLocalizationProfile,
  createCommunicationLocalization,
  createPaymentLocalization,
  createIntegrationLocalization,
  fxRateId,
  taxConfigId,
  unitSystemId,
} from "@/lib/global-formats";
import {
  createLocalizationConfig,
  resolveConfigValue,
  isImmutableGlobalizationRule,
  canOverrideRule,
  createRegionalFeatureFlag,
  isFeatureAvailable,
  createGlobalServiceCatalogEntry,
  isRegionalDependencySatisfied,
  findServiceForRegion,
  createCountryReadiness,
  readinessScore,
  isCountryLaunchReady,
  canAdvanceExpansion,
  openRegionalPilot,
  createRegionalSupportProfile,
  createIncidentCommunicationPlan,
  createRegionalSla,
  createPseudoLocalizationConfig,
  pseudoLocalize,
  createLocaleMatrix,
  createLocaleTestRun,
  isLocaleTestRunGreen,
  createHumanReview,
  createConnectivityProfile,
  shouldAdaptSync,
  canOperateOffline,
  createDeviceCapabilityProfile,
  createVoiceLocalization,
  createGlobalizationKnowledgeEntity,
  validateRegionalGraph,
  isGlobalizationApiCovered,
  publishGlobalizationEvent,
  isGlobalizationEntity,
  localizationConfigId,
  featureFlagId,
  countryReadinessId,
  localeTestRunId,
  globalizationEventId,
} from "@/lib/global-governance";

describe("globalization-core — Locale model & resolution (H, I, J)", () => {
  it("creates a locale with unambiguous defaults", () => {
    const r = createLocale({ id: localeId("en-NG"), language: "en" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.locale.dateFormat).toBe("YYYY-MM-DD");
      expect(r.locale.timeFormat).toBe("24h");
      expect(r.locale.direction).toBe("ltr");
      expect(r.locale.calendar).toBe("gregorian");
      expect(getReadingDirection(r.locale)).toBe("ltr");
    }
  });
  it("rejects a locale without a language", () => {
    expect(createLocale({ id: localeId("x"), language: "  " }).ok).toBe(false);
  });
  it("derives RTL direction from Arabic", () => {
    const r = createLocale({ id: localeId("ar-NG"), language: "ar" });
    if (!r.ok) throw new Error("expected ok");
    expect(r.locale.direction).toBe("rtl");
  });
  it("resolves institutional policy before user preference", () => {
    const authorized = [localeId("en"), localeId("ha")];
    const r = resolveLocale(
      {
        institutionalPolicy: localeId("ha"),
        userPreference: localeId("en"),
        platformDefault: localeId("en"),
      },
      authorized,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.locale).toBe(localeId("ha"));
      expect(r.source).toBe("institutional_policy");
    }
  });
  it("falls through when the top candidate is unauthorized", () => {
    const authorized = [localeId("en")];
    const r = resolveLocale(
      { userPreference: localeId("fr"), browser: localeId("en"), platformDefault: localeId("en") },
      authorized,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.locale).toBe(localeId("en"));
  });
  it("requires at least one authorized locale", () => {
    expect(resolveLocale({ platformDefault: localeId("en") }, []).ok).toBe(false);
  });
});

describe("globalization-core — Language platform (K, L, M, N)", () => {
  it("rejects language preferences without a primary language", () => {
    expect(createLanguagePreferences({ userRef: "u1", primary: " " }).ok).toBe(false);
  });
  it("builds a deduplicated fallback chain", () => {
    const prefs = createLanguagePreferences({ userRef: "u1", primary: "ha", secondary: ["en"] });
    if (!prefs.ok) throw new Error("expected ok");
    expect(resolveLanguageFallback(prefs.prefs, "en", "en")).toEqual(["ha", "en"]);
  });
  it("rejects institution languages referencing undeclared languages", () => {
    const r = createInstitutionLanguages({
      institutionRef: "inst-1",
      languages: ["en"],
      examinationLanguage: "fr",
    });
    expect(r.ok).toBe(false);
  });
});

describe("globalization-core — RTL, bidi, Unicode (BJ, BK, BN)", () => {
  it("detects RTL languages", () => {
    expect(detectScriptDirection("ar")).toBe("rtl");
    expect(detectScriptDirection("en")).toBe("ltr");
  });
  it("detects bidi override attacks", () => {
    expect(containsBidiOverride("normal text")).toBe(false);
    expect(containsBidiOverride("x\u202Ey")).toBe(true);
  });
  it("rejects unpaired surrogate halves", () => {
    expect(isUnicodeSafe("abc").ok).toBe(true);
    expect(isUnicodeSafe("a\uD800b").ok).toBe(false);
  });
});

describe("globalization-core — Cultural safety & names (V, W, X, Y)", () => {
  it("rejects profiles that assume universal conventions", () => {
    expect(createCulturalProfile({ region: "NG", assumesUniversal: true }).ok).toBe(false);
  });
  it("accepts a region-scoped cultural profile", () => {
    const r = createCulturalProfile({ region: "NG", conventions: ["elders-first"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(isCultureAssumptionFree(r.profile)).toBe(true);
  });
  it("rejects a mononym carrying other name components", () => {
    expect(
      createPersonName({ mononym: "Onyeka", givenName: "X", displayOrder: "mononym" }).ok,
    ).toBe(false);
  });
  it("formats family-first names without Western assumptions", () => {
    const r = createPersonName({
      familyName: "Adeyemi",
      givenName: "Fola",
      displayOrder: "family-first",
    });
    if (!r.ok) throw new Error("expected ok");
    expect(formatNameForDisplay(r.name)).toBe("Adeyemi Fola");
  });
});

describe("globalization-core — Address, phone, email, dates (Z, AA-AC, AD-AE)", () => {
  it("requires a country for addresses", () => {
    expect(createRegionalAddress({ country: "" }).ok).toBe(false);
  });
  it("accepts non-Western address structures", () => {
    const r = createRegionalAddress({
      country: "Nigeria",
      ward: "Garki",
      village: "Garki",
      landmark: "Near Central Mosque",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(isAddressUsableForDelivery(r.address)).toBe(true);
  });
  it("normalizes phone numbers to an international representation", () => {
    const r = normalizePhoneNumber({ countryCode: "234", nationalNumber: "803 123 4567" });
    if (!r.ok) throw new Error("expected ok");
    expect(r.international).toBe("+2348031234567");
    expect(formatPhoneForDisplay(r.number)).toBe("+234 8031234567");
  });
  it("localizes email sender identity and legal notices", () => {
    const r = createEmailLocalizationProfile({
      language: "ha",
      dateFormat: "DD/MM/YYYY",
      timeFormat: "24h",
      senderIdentity: "Makarantar Firamare",
    });
    expect(r.ok).toBe(true);
    expect(
      createEmailLocalizationProfile({
        language: "ha",
        dateFormat: "DD/MM/YYYY",
        timeFormat: "24h",
        senderIdentity: "",
      }).ok,
    ).toBe(false);
  });
  it("formats dates and times per locale", () => {
    expect(formatDateForLocale("2026-08-28", "DD/MM/YYYY")).toEqual({
      ok: true,
      value: "28/08/2026",
    });
    expect(formatTimeForLocale("14:30", "12h")).toEqual({ ok: true, value: "2:30 PM" });
    expect(formatDateForLocale("not-a-date", "DD/MM/YYYY").ok).toBe(false);
  });
});

describe("globalization-core — Collation & accessibility (BO, BQ, BR)", () => {
  it("compares using locale collation with a safe fallback", () => {
    expect(localeAwareCompare("a", "b", "en")).toBeLessThan(0);
    expect(Number.isNaN(localeAwareCompare("x", "y", "invalid-tag"))).toBe(false);
  });
  it("normalizes search text via NFKC", () => {
    expect(normalizeSearchText("  Adé  ")).toBe("adé");
  });
  it("defaults arab-script accessibility to RTL", () => {
    const r = createAccessibilityLocalization({ language: "ar", script: "arab" });
    if (!r.ok) throw new Error("expected ok");
    expect(r.localization.readingDirection).toBe("rtl");
    expect(r.localization.screenReaderCompatible).toBe(true);
  });
});

describe("localization-content — Translation keys, versioning & quality (P, Q, R)", () => {
  it("creates and parses stable keys", () => {
    const r = createTranslationKey("school", "welcome");
    if (!r.ok) throw new Error("expected ok");
    expect(parseTranslationKey(r.id)).toEqual({ namespace: "school", key: "welcome" });
  });
  it("bumps version and resets approval on update", () => {
    const created = createTranslation({
      id: translationId("t1"),
      key: translationKeyId("school.welcome"),
      locale: "ha",
      text: "Barka",
      sourceVersion: "v1",
    });
    if (!created.ok) throw new Error("expected ok");
    const approved = approveTranslation(created.translation, "rev-1");
    if (!approved.ok) throw new Error("expected ok");
    expect(approved.translation.approved).toBe(true);
    const updated = updateTranslation(approved.translation, "Barka da zuwa");
    if (!updated.ok) throw new Error("expected ok");
    expect(updated.translation.version).toBe(2);
    expect(updated.translation.approved).toBe(false);
  });
  it("marks high-risk AI translations for human approval", () => {
    const r = createAiTranslation({
      id: translationId("t2"),
      key: translationKeyId("finance.fee"),
      locale: "yo",
      text: "Owo",
      sourceVersion: "v1",
      domain: "finance",
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.translation.requiresHumanApproval).toBe(true);
    expect(isAiTranslationDeployable(r.translation, { requireHumanReviewForAi: true })).toBe(false);
    const reviewed = reviewTranslation(r.translation, "reviewer-1");
    if (!reviewed.ok) throw new Error("expected ok");
    const approved = approveTranslation(reviewed.translation, "approver-1");
    if (!approved.ok) throw new Error("expected ok");
    expect(isAiTranslationDeployable(approved.translation, { requireHumanReviewForAi: true })).toBe(
      true,
    );
  });
});

describe("localization-content — Translation memory & terminology (T, U, DN)", () => {
  it("finds reusable segments in translation memory", () => {
    const entry = createTranslationMemoryEntry({
      id: "mem-1",
      sourceLocale: "en",
      sourceText: "Attendance",
      targetLocale: "ha",
      targetText: "Halartar",
      domain: "education",
    });
    if (!entry.ok) throw new Error("expected ok");
    expect(findTranslationMemory([entry.entry], "en", "attendance", "ha")).toBe(entry.entry);
    expect(findTranslationMemory([entry.entry], "en", "attendance", "yo")).toBeNull();
  });
  it("proposes terminology changes without silently applying them", () => {
    const entry = createTerminologyEntry({
      id: terminologyId("term-1"),
      term: "Principal",
      domain: "school",
      locale: "en",
      definition: "Head of school",
    });
    if (!entry.ok) throw new Error("expected ok");
    expect(entry.entry.approved).toBe(false);
    const proposal = proposeTerminologyChange(entry.entry, "Head Teacher");
    if (!proposal.ok) throw new Error("expected ok");
    expect(proposal.proposal.status).toBe("proposed");
    expect(entry.entry.definition).toBe("Head of school");
    const applied = approveTerminologyChange(proposal.proposal, entry.entry);
    if (!applied.ok) throw new Error("expected ok");
    expect(applied.entry.definition).toBe("Head Teacher");
    expect(applied.entry.approved).toBe(true);
  });
});

describe("localization-content — Content variants & governance (DB-DO)", () => {
  it("resolves content via controlled fallback order", () => {
    const en = createLocalizedContent({
      id: contentVariantId("c1"),
      sourceContentRef: "src-1",
      locale: "en",
      body: "Hello",
      sourceVersion: "v1",
    });
    const ha = createLocalizedContent({
      id: contentVariantId("c2"),
      sourceContentRef: "src-1",
      locale: "ha",
      body: "Sannu",
      sourceVersion: "v1",
    });
    if (!en.ok || !ha.ok) throw new Error("expected ok");
    const resolved = resolveContentFallback([en.content, ha.content], "yo", ["ha", "en"]);
    if (!resolved.ok) throw new Error("expected ok");
    expect(resolved.content.body).toBe("Sannu");
    expect(resolveContentFallback([en.content], "yo", []).ok).toBe(false);
  });
  it("detects translation drift against source versions", () => {
    const content = createLocalizedContent({
      id: contentVariantId("c3"),
      sourceContentRef: "src-1",
      locale: "en",
      body: "Hi",
      sourceVersion: "v1",
    });
    if (!content.ok) throw new Error("expected ok");
    expect(detectTranslationDrift(content.content, "v2")).toBe(true);
    expect(hasOutdatedVariants([content.content], "v1")).toBe(false);
  });
  it("enforces content governance levels", () => {
    const canonical = createLocalizedContent({
      id: contentVariantId("c4"),
      sourceContentRef: "src-2",
      locale: "en",
      body: "X",
      governanceLevel: "global_canonical",
      sourceVersion: "v1",
    });
    if (!canonical.ok) throw new Error("expected ok");
    expect(validateContentGovernance(canonical.content, "global_canonical")).toBe(true);
    expect(validateContentGovernance(canonical.content, "regional")).toBe(false);
  });
  it("opens localization feedback", () => {
    const r = createLocalizationFeedback({
      id: localizationFeedbackId("fb-1"),
      locale: "ha",
      reportType: "incorrect_translation",
      details: "Terminoloji bai dace ba",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.feedback.status).toBe("open");
  });
});

describe("regional-context — Country, region, jurisdiction (CA-CC)", () => {
  it("creates a country profile", () => {
    const r = createCountryProfile({
      code: "NG",
      name: "Nigeria",
      languages: ["en", "ha", "yo", "ig"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.profile.code).toBe("NG");
  });
  it("rejects country profiles without languages", () => {
    expect(createCountryProfile({ code: "XZ", name: "X", languages: [] }).ok).toBe(false);
  });
  it("creates a region profile scoped to a country", () => {
    const r = createRegionProfile({
      id: "ng-lagos",
      countryCode: "NG",
      name: "Lagos",
      timezone: "Africa/Lagos",
    });
    expect(r.ok).toBe(true);
  });
  it("builds and validates a jurisdiction chain", () => {
    const global = createJurisdiction({
      id: jurisdictionId("global"),
      level: "global",
      name: "Global",
    });
    const ng = createJurisdiction({
      id: jurisdictionId("ng"),
      level: "country",
      parentRef: jurisdictionId("global"),
      name: "Nigeria",
    });
    const lagos = createJurisdiction({
      id: jurisdictionId("lagos"),
      level: "region",
      parentRef: jurisdictionId("ng"),
      name: "Lagos",
    });
    if (!global.ok || !ng.ok || !lagos.ok) throw new Error("expected ok");
    expect(
      isJurisdictionChainValid([global.jurisdiction, ng.jurisdiction, lagos.jurisdiction]),
    ).toBe(true);
    expect(isJurisdictionChainValid([ng.jurisdiction, lagos.jurisdiction])).toBe(false);
  });
});

describe("regional-context — Effective-dated rules & versioning (CE, CF)", () => {
  it("registers and evaluates effective-dated rules", () => {
    const rule = registerJurisdictionalRule({
      id: regionalRuleId("r1"),
      jurisdictionRef: jurisdictionId("ng"),
      category: "school_year",
      payload: { start: "09-01" },
      effectiveFrom: "2026-01-01",
    });
    if (!rule.ok) throw new Error("expected ok");
    expect(isRuleEffectiveAt(rule.rule, "2026-06-01")).toBe(true);
    expect(isRuleEffectiveAt(rule.rule, "2025-06-01")).toBe(false);
    expect(getEffectiveRule([rule.rule], jurisdictionId("ng"), "school_year", "2026-06-01")).toBe(
      rule.rule,
    );
  });
  it("supersedes rules without losing history", () => {
    const rule = registerJurisdictionalRule({
      id: regionalRuleId("r2"),
      jurisdictionRef: jurisdictionId("ng"),
      category: "vat",
      payload: { rate: 7.5 },
      effectiveFrom: "2026-01-01",
    });
    if (!rule.ok) throw new Error("expected ok");
    const next = supersedeJurisdictionalRule(rule.rule, "2027-01-01", { rate: 10 });
    if (!next.ok) throw new Error("expected ok");
    expect(next.superseded.effectiveUntil).toBe("2027-01-01");
    expect(next.current.version).toBe(2);
    expect(
      getEffectiveRule([next.superseded, next.current], jurisdictionId("ng"), "vat", "2026-06-01")
        ?.payload.rate,
    ).toBe(7.5);
    expect(
      getEffectiveRule([next.superseded, next.current], jurisdictionId("ng"), "vat", "2027-06-01")
        ?.payload.rate,
    ).toBe(10);
  });
  it("rejects superseding before the existing rule start", () => {
    const rule = registerJurisdictionalRule({
      id: regionalRuleId("r3"),
      jurisdictionRef: jurisdictionId("ng"),
      category: "x",
      payload: {},
      effectiveFrom: "2026-01-01",
    });
    if (!rule.ok) throw new Error("expected ok");
    expect(supersedeJurisdictionalRule(rule.rule, "2025-01-01", {}).ok).toBe(false);
  });
});

describe("regional-context — Residency & transfer localization (CH, CI, CK)", () => {
  it("restricts sensitive data transfers to in-country", () => {
    const meta = createJurisdictionLegalMetadata({
      jurisdictionRef: jurisdictionId("ng"),
      dataTransferRestriction: "restricted",
    });
    if (!meta.ok) throw new Error("expected ok");
    expect(isDataTransferPermitted(meta.metadata, "RESTRICTED", false)).toBe(false);
    expect(isDataTransferPermitted(meta.metadata, "RESTRICTED", true)).toBe(true);
    expect(isDataTransferPermitted(meta.metadata, "PUBLIC", false)).toBe(false);
  });
  it("resolves country identity formats", () => {
    const meta = createJurisdictionLegalMetadata({
      jurisdictionRef: jurisdictionId("ng"),
      identityFormats: { national_id: "NNN-NNNN-NNNN" },
    });
    if (!meta.ok) throw new Error("expected ok");
    expect(resolveIdentityFormat(meta.metadata, "national_id")).toBe("NNN-NNNN-NNNN");
    expect(resolveIdentityFormat(meta.metadata, "phone")).toBeNull();
  });
});

describe("regional-context — Timezone & event time (AF-AM)", () => {
  it("creates versioned timezone rules", () => {
    const tz = createTimezoneProfile({
      id: timezoneProfileId("tz-1"),
      ianaName: "Africa/Lagos",
      dstRules: "none",
      version: "2026a",
      validFrom: "2026-01-01",
    });
    expect(tz.ok).toBe(true);
    if (tz.ok) expect(isTimezoneRuleCurrent(tz.profile, "2026-06-01")).toBe(true);
  });
  it("requires every campus location to have a timezone", () => {
    expect(
      createInstitutionTimezoneMap({
        institutionRef: "inst-1",
        locations: [{ locationRef: "campus-a", timezone: "" }],
      }).ok,
    ).toBe(false);
    expect(
      createInstitutionTimezoneMap({
        institutionRef: "inst-1",
        locations: [
          { locationRef: "campus-a", timezone: "Africa/Lagos" },
          { locationRef: "campus-a", timezone: "Africa/Abuja" },
        ],
      }).ok,
    ).toBe(false);
  });
  it("requires recurrence to be timezone-aware", () => {
    expect(
      createEventTime({ localTime: "09:00", timezone: "Africa/Lagos", recurrence: "weekly" }).ok,
    ).toBe(true);
    expect(createEventTime({ localTime: "09:00", recurrence: "weekly" }).ok).toBe(false);
  });
  it("keeps instants unambiguous", () => {
    const evt = createEventTime({ instant: "2026-09-01T09:00:00.000Z" });
    if (!evt.ok) throw new Error("expected ok");
    expect(isEventTimeUnambiguous(evt.eventTime)).toBe(true);
  });
});

describe("regional-context — Calendar & holidays (AN-AT)", () => {
  it("allows only one authoritative machine calendar", () => {
    const gregorian = createCalendarSystem({
      id: calendarSystemId("cal-1"),
      name: "gregorian",
      isAuthoritativeMachineCalendar: true,
    });
    const islamic = createCalendarSystem({ id: calendarSystemId("cal-2"), name: "islamic" });
    if (!gregorian.ok || !islamic.ok) throw new Error("expected ok");
    expect(canRegisterAuthoritativeCalendar([gregorian.system])).toBe(false);
    expect(canRegisterAuthoritativeCalendar([islamic.system])).toBe(true);
  });
  it("builds a non-overlapping academic calendar", () => {
    const ok = createAcademicCalendar({
      id: academicCalendarId("ac-1"),
      countryCode: "NG",
      schoolYearStart: "09-01",
      terms: [
        { name: "T1", kind: "term", start: "09-09", end: "12-18" },
        { name: "T2", kind: "term", start: "01-06", end: "04-10" },
      ],
    });
    expect(ok.ok).toBe(true);
    const bad = createAcademicCalendar({
      id: academicCalendarId("ac-2"),
      countryCode: "NG",
      schoolYearStart: "09-01",
      terms: [
        { name: "T1", kind: "term", start: "09-09", end: "12-18" },
        { name: "T2", kind: "term", start: "12-01", end: "04-10" },
      ],
    });
    expect(bad.ok).toBe(false);
  });
  it("resolves fixed holidays and defers movable ones", () => {
    const fixed = createHoliday({
      id: holidayId("h1"),
      jurisdictionRef: "ng",
      authority: "gov",
      name: "New Year",
      source: "statute",
      confidence: "high",
      fixedDate: "01-01",
    });
    const movable = createHoliday({
      id: holidayId("h2"),
      jurisdictionRef: "ng",
      authority: "religious",
      name: "Eid",
      source: "calendar",
      confidence: "medium",
      movable: true,
      observance: "islamic",
    });
    if (!fixed.ok || !movable.ok) throw new Error("expected ok");
    expect(resolveHolidayDate(fixed.holiday, 2027)).toEqual({ ok: true, date: "2027-01-01" });
    expect(resolveHolidayDate(movable.holiday, 2027).ok).toBe(false);
    expect(isReligiousObservanceConfigurable(movable.holiday)).toBe(true);
  });
});

describe("regional-context — Education system localization (CL-CN, CQ, CR)", () => {
  it("maps local education terminology", () => {
    const map = createEducationTerminology({
      countryCode: "NG",
      terms: [{ localTerm: "Head Teacher", concept: "principal", equivalent: "Principal" }],
    });
    if (!map.ok) throw new Error("expected ok");
    expect(resolveLocalTerm(map.map, "principal", "Principal")).toBe("Head Teacher");
    expect(resolveLocalTerm(map.map, "bursar", "Bursar")).toBe("Bursar");
  });
  it("keeps grading schemes as localized representation only", () => {
    const r = createGradingScheme({
      id: "gs-1",
      countryCode: "GH",
      system: "letter",
      scale: [{ grade: "A", min: 80, max: 100 }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scheme.representationOnly).toBe(true);
  });
  it("requires an examination authority", () => {
    expect(createExaminationConvention({ jurisdictionRef: "ng", authorities: [] }).ok).toBe(false);
  });
  it("localizes government reporting metadata", () => {
    const r = createGovernmentReportingLocalization({
      jurisdictionRef: "ng",
      reportTypes: [{ name: "census", localeFields: ["name", "lga"], authorityRef: "nbs" }],
    });
    expect(r.ok).toBe(true);
  });
});

describe("regional-context — Educational & African language support (BW-BZ)", () => {
  it("requires distinct educational language roles", () => {
    expect(
      createEducationalLanguageConfig({
        institutionRef: "inst-1",
        primaryInstructionLanguage: "en",
        examinationLanguage: "en",
      }).ok,
    ).toBe(false);
    expect(
      createEducationalLanguageConfig({
        institutionRef: "inst-1",
        primaryInstructionLanguage: "en",
        localLanguage: "ha",
      }).ok,
    ).toBe(true);
  });
  it("ranks African languages by driver weight", () => {
    const hausa = createAfricanLanguagePriorityItem({
      language: "Hausa",
      drivers: [{ driver: "user_demand", weight: 10 }],
    });
    const yoruba = createAfricanLanguagePriorityItem({
      language: "Yoruba",
      drivers: [{ driver: "educational_importance", weight: 5 }],
    });
    if (!hausa.ok || !yoruba.ok) throw new Error("expected ok");
    const ranked = scoreAfricanLanguagePriority([yoruba.item, hausa.item]);
    expect(ranked[0].language).toBe("Hausa");
    expect(planAfricanLanguageExpansion([yoruba.item, hausa.item], 1)).toEqual(["Hausa"]);
  });
});

describe("global-formats — Currency model & display (AW, AX, BI)", () => {
  it("creates localized monetary values", () => {
    const r = createLocalizedMonetaryValue({
      amountMinor: 125050,
      currency: "NGN",
      precision: 2,
      source: "tuition",
      timestamp: "2026-08-28T00:00:00Z",
    });
    expect(r.ok).toBe(true);
  });
  it("rejects non-ISO currencies", () => {
    expect(
      createLocalizedMonetaryValue({
        amountMinor: 1,
        currency: "ngn",
        precision: 2,
        source: "s",
        timestamp: "t",
      }).ok,
    ).toBe(false);
  });
  it("formats numbers and currency per locale", () => {
    const config = createNumberFormatConfig({ decimalSeparator: ".", thousandsSeparator: "," });
    if (!config.ok) throw new Error("expected ok");
    expect(formatNumber(1250.5, config.config, 2)).toBe("1,250.50");
    const value = createLocalizedMonetaryValue({
      amountMinor: 125050,
      currency: "NGN",
      precision: 2,
      source: "tuition",
      timestamp: "t",
    });
    if (!value.ok) throw new Error("expected ok");
    expect(formatCurrencyForLocale(value.value, config.config, "N")).toBe("N1,250.50");
  });
});

describe("global-formats — FX & conversion (AY-BB)", () => {
  it("converts currencies with rounding and conversion context", () => {
    const value = createLocalizedMonetaryValue({
      amountMinor: 1250,
      currency: "NGN",
      precision: 2,
      source: "fee",
      timestamp: "2026-08-28T00:00:00Z",
    });
    const rate = createFxRate({
      id: fxRateId("fx-1"),
      sourceCurrency: "NGN",
      targetCurrency: "USD",
      rate: 0.0007,
      timestamp: "2026-08-28T00:00:00Z",
    });
    if (!value.ok || !rate.ok) throw new Error("expected ok");
    const converted = convertCurrency(value.value, rate.rate, 2);
    if (!converted.ok) throw new Error("expected ok");
    expect(converted.value.currency).toBe("USD");
    expect(converted.value.amountMinor).toBe(1);
    expect(converted.value.conversionContext).toContain("NGN->USD");
  });
  it("rejects FX rates on the same currency", () => {
    expect(
      createFxRate({
        id: fxRateId("fx-2"),
        sourceCurrency: "NGN",
        targetCurrency: "NGN",
        rate: 1,
        timestamp: "t",
      }).ok,
    ).toBe(false);
  });
  it("finds historical FX by timestamp", () => {
    const older = createFxRate({
      id: fxRateId("fx-3"),
      sourceCurrency: "NGN",
      targetCurrency: "USD",
      rate: 0.0006,
      timestamp: "2026-01-01T00:00:00Z",
    });
    const newer = createFxRate({
      id: fxRateId("fx-4"),
      sourceCurrency: "NGN",
      targetCurrency: "USD",
      rate: 0.0008,
      timestamp: "2026-07-01T00:00:00Z",
    });
    if (!older.ok || !newer.ok) throw new Error("expected ok");
    expect(
      getHistoricalFxRate([older.rate, newer.rate], "NGN", "USD", "2026-03-01T00:00:00Z")?.rate,
    ).toBe(0.0006);
    expect(
      getHistoricalFxRate([older.rate, newer.rate], "NGN", "USD", "2025-01-01T00:00:00Z"),
    ).toBeNull();
  });
  it("rounds currency majors to precision", () => {
    expect(roundCurrencyMajor(12.345, 2)).toBe(12.35);
  });
});

describe("global-formats — Tax & measurement (BC-BH)", () => {
  it("selects the effective tax rate", () => {
    const v1 = createTaxConfiguration({
      id: taxConfigId("tax-1"),
      jurisdictionRef: "ng",
      taxType: "vat",
      ratePercent: 7.5,
      effectiveFrom: "2026-01-01",
    });
    const v2 = createTaxConfiguration({
      id: taxConfigId("tax-2"),
      jurisdictionRef: "ng",
      taxType: "vat",
      ratePercent: 10,
      effectiveFrom: "2027-01-01",
    });
    if (!v1.ok || !v2.ok) throw new Error("expected ok");
    expect(
      getEffectiveTaxRate([v1.config, v2.config], "ng", "vat", "2026-06-01")?.ratePercent,
    ).toBe(7.5);
    expect(
      getEffectiveTaxRate([v1.config, v2.config], "ng", "vat", "2027-06-01")?.ratePercent,
    ).toBe(10);
  });
  it("rejects unknown tax types", () => {
    expect(
      createTaxConfiguration({
        id: taxConfigId("tax-3"),
        jurisdictionRef: "ng",
        taxType: "poll_tax" as never,
        ratePercent: 5,
        effectiveFrom: "2026-01-01",
      }).ok,
    ).toBe(false);
  });
  it("defines units and converts while preserving context", () => {
    const unit = createUnitDefinition({
      id: unitSystemId("u1"),
      system: "metric",
      name: "metre",
      symbol: "m",
      kind: "length",
    });
    expect(unit.ok).toBe(true);
    const conv = createUnitConversion({
      source: "m",
      target: "ft",
      factor: 3.28084,
      context: "height",
    });
    if (!conv.ok) throw new Error("expected ok");
    const r = convertUnit(2, conv.conversion);
    if (!r.ok) throw new Error("expected ok");
    expect(r.result.originalUnit).toBe("m");
    expect(r.result.convertedUnit).toBe("ft");
    expect(r.result.value).toBeCloseTo(6.56168);
  });
});

describe("global-formats — Data formats & documents (EK-EP)", () => {
  it("quotes CSV cells containing the configured separator", () => {
    const csv = createCsvLocalizationConfig({
      separator: ";",
      encoding: "utf-8",
      decimalSeparator: ",",
      dateFormat: "DD/MM/YYYY",
    });
    if (!csv.ok) throw new Error("expected ok");
    expect(formatCsvCell("Ikeja; Lagos", csv.config)).toBe('"Ikeja; Lagos"');
    expect(formatCsvCell("plain", csv.config)).toBe("plain");
  });
  it("localizes document scripts and layout direction", () => {
    const r = createDocumentLocalizationProfile({
      language: "ar",
      locale: "ar-NG",
      script: "arab",
      dateFormat: "DD/MM/YYYY",
      numberingSystem: "arab",
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.profile.direction).toBe("rtl");
  });
});

describe("global-formats — Communication & payment localization (CS-CU, EV)", () => {
  it("requires a timezone for communication templates", () => {
    expect(
      createCommunicationLocalization({
        language: "ha",
        templateRef: "fee-reminder",
        dateFormat: "DD/MM/YYYY",
        timezone: "",
      }).ok,
    ).toBe(false);
  });
  it("keeps payment providers configurable", () => {
    const r = createPaymentLocalization({
      jurisdictionRef: "ng",
      supportedMethods: ["bank_transfer", "mobile_money"],
      currency: "NGN",
    });
    expect(r.ok).toBe(true);
  });
  it("localizes integrations per region", () => {
    const r = createIntegrationLocalization({
      providerRef: "some-erp",
      locale: "ha",
      language: "ha",
    });
    expect(r.ok).toBe(true);
  });
});

describe("global-governance — Config precedence & immutable rules (DP-DU)", () => {
  it("resolves the most specific configuration", () => {
    const global = createLocalizationConfig({
      id: localizationConfigId("c1"),
      key: "language.default",
      level: "global",
      value: "en",
    });
    const inst = createLocalizationConfig({
      id: localizationConfigId("c2"),
      key: "language.default",
      level: "institution",
      value: "ha",
    });
    if (!global.ok || !inst.ok) throw new Error("expected ok");
    const r = resolveConfigValue([global.config, inst.config], "language.default", "institution");
    if (!r.ok) throw new Error("expected ok");
    expect(r.value).toBe("ha");
    expect(r.sourceLevel).toBe("institution");
  });
  it("never overrides immutable rules", () => {
    expect(isImmutableGlobalizationRule("tenant_isolation")).toBe(true);
    expect(canOverrideRule("tenant_isolation", "institution")).toBe(false);
    expect(canOverrideRule("language.default", "user")).toBe(true);
    expect(canOverrideRule("governance.content", "user")).toBe(false);
  });
});

describe("global-governance — Feature availability & service catalog (DW-DZ)", () => {
  it("enables features only when explicitly configured", () => {
    const flag = createRegionalFeatureFlag({
      id: featureFlagId("f1"),
      feature: "mobile-money",
      jurisdictionRef: "NG",
      enabled: true,
    });
    if (!flag.ok) throw new Error("expected ok");
    expect(isFeatureAvailable([flag.flag], "mobile-money", "NG", "2026-08-28")).toBe(true);
    expect(isFeatureAvailable([flag.flag], "mobile-money", "GH", "2026-08-28")).toBe(false);
  });
  it("checks regional dependencies", () => {
    const pay = createGlobalServiceCatalogEntry({
      service: "payments",
      region: "NG",
      provider: "paystack",
      available: true,
    });
    const school = createGlobalServiceCatalogEntry({
      service: "school-os",
      region: "NG",
      provider: "coregrid",
      available: true,
      dependencies: ["payments"],
    });
    if (!pay.ok || !school.ok) throw new Error("expected ok");
    expect(isRegionalDependencySatisfied(school.entry, [pay.entry])).toBe(true);
    expect(findServiceForRegion([pay.entry], "payments", "NG")).toBe(pay.entry);
  });
});

describe("global-governance — Country readiness & expansion (EA-EE)", () => {
  it("computes readiness and launch gates", () => {
    const r = createCountryReadiness({
      id: countryReadinessId("cr1"),
      countryCode: "NG",
      scores: {
        language: 1,
        currency: 1,
        timezone: 1,
        education: 1,
        payments: 1,
        government: 1,
        connectivity: 1,
        cloud: 1,
        integration: 1,
        security: 1,
        localization: 1,
        support: 1,
      },
      gates: [{ gate: "legal", passed: true }],
    });
    if (!r.ok) throw new Error("expected ok");
    expect(readinessScore(r.readiness)).toBe(1);
    expect(isCountryLaunchReady(r.readiness, 0.9)).toBe(true);
  });
  it("rejects readiness scores outside 0..1", () => {
    expect(
      createCountryReadiness({
        id: countryReadinessId("cr2"),
        countryCode: "NG",
        scores: { language: 2 },
      }).ok,
    ).toBe(false);
  });
  it("advances expansion one stage at a time", () => {
    expect(canAdvanceExpansion("localization", "pilot")).toBe(true);
    expect(canAdvanceExpansion("localization", "launch")).toBe(false);
  });
  it("opens controlled regional pilots with monitoring", () => {
    const r = openRegionalPilot({
      pilotRef: "ng-pilot-1",
      countryCode: "NG",
      institutions: ["inst-1"],
      startDate: "2026-09-01",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.pilot.monitoring).toBe(true);
  });
});

describe("global-governance — Support, incident & SLA (EF-EJ)", () => {
  it("requires regional support languages", () => {
    expect(createRegionalSupportProfile({ region: "NG", languages: [] }).ok).toBe(false);
  });
  it("plans incident communication in local language and timezone", () => {
    const r = createIncidentCommunicationPlan({
      incidentRef: "inc-1",
      languages: ["ha", "en"],
      timezone: "Africa/Lagos",
    });
    expect(r.ok).toBe(true);
  });
  it("records SLAs as representation only", () => {
    const r = createRegionalSla({ region: "NG", deploymentEnv: "prod", availabilityPercent: 99.9 });
    if (!r.ok) throw new Error("expected ok");
    expect(r.sla.representationOnly).toBe(true);
  });
});

describe("global-governance — Localization QA & testing (DG-DL)", () => {
  it("pseudo-localizes to expose layout assumptions", () => {
    const cfg = createPseudoLocalizationConfig({
      locale: "pseudo",
      prefix: "[",
      suffix: "]",
      expansionFactor: 1.5,
    });
    if (!cfg.ok) throw new Error("expected ok");
    const out = pseudoLocalize("Save", cfg.config);
    expect(out.length).toBeGreaterThan(4);
  });
  it("requires both LTR and RTL in the locale matrix", () => {
    const ok = createLocaleMatrix([
      { locale: "en", language: "en", script: "latin", direction: "ltr", covered: true },
      { locale: "ar", language: "ar", script: "arab", direction: "rtl", covered: true },
    ]);
    expect(ok.ok).toBe(true);
    const bad = createLocaleMatrix([
      { locale: "en", language: "en", script: "latin", direction: "ltr", covered: true },
    ]);
    expect(bad.ok).toBe(false);
  });
  it("tracks locale test runs", () => {
    const run = createLocaleTestRun({
      id: localeTestRunId("run-1"),
      locale: "ha",
      tests: ["language", "dates", "currency"],
      passed: 3,
      failed: 0,
    });
    if (!run.ok) throw new Error("expected ok");
    expect(isLocaleTestRunGreen(run.run)).toBe(true);
  });
  it("requires human review for critical localization", () => {
    const r = createHumanReview({ target: "terms/fee-notice", reviewer: "regional-expert-1" });
    expect(r.ok).toBe(true);
  });
});

describe("global-governance — Connectivity, device & voice (CV-DA, BS-BV)", () => {
  it("adapts sync on data-cost-aware limited networks", () => {
    const profile = createConnectivityProfile({
      region: "NG",
      class: "limited",
      dataCostAware: true,
      offlineSupport: true,
    });
    if (!profile.ok) throw new Error("expected ok");
    expect(shouldAdaptSync(profile.profile)).toBe(true);
    expect(canOperateOffline(profile.profile)).toBe(true);
  });
  it("models regional device conditions without premium assumptions", () => {
    const r = createDeviceCapabilityProfile({
      region: "NG",
      lowCpu: true,
      lowMemory: true,
      connectivityClass: "limited",
    });
    expect(r.ok).toBe(true);
  });
  it("localizes voice assistance", () => {
    const r = createVoiceLocalization({ region: "NG", languages: ["en", "ha"] });
    expect(r.ok).toBe(true);
  });
});

describe("global-governance — Knowledge graph, API & events (FC-FI)", () => {
  it("validates the regional graph", () => {
    const country = createGlobalizationKnowledgeEntity({ type: "country", id: "ng" });
    const region = createGlobalizationKnowledgeEntity({
      type: "region",
      id: "lagos",
      parentRef: "ng",
    });
    const district = createGlobalizationKnowledgeEntity({
      type: "district",
      id: "ikeja",
      parentRef: "lagos",
    });
    if (!country.ok || !region.ok || !district.ok) throw new Error("expected ok");
    const r = validateRegionalGraph([country.entity, region.entity, district.entity]);
    if (!r.ok) throw new Error("expected ok");
    expect(r.nodeCount).toBe(3);
    expect(r.edgeCount).toBe(2);
  });
  it("rejects dangling parent references", () => {
    const region = createGlobalizationKnowledgeEntity({
      type: "region",
      id: "lagos",
      parentRef: "missing",
    });
    if (!region.ok) throw new Error("expected ok");
    expect(validateRegionalGraph([region.entity]).ok).toBe(false);
  });
  it("covers the globalization API surface", () => {
    expect(isGlobalizationApiCovered("LocaleAPI")).toBe(true);
    expect(isGlobalizationApiCovered("NotAnAPI")).toBe(false);
  });
  it("publishes only known event types", () => {
    const r = publishGlobalizationEvent({
      id: globalizationEventId("evt-1"),
      type: "locale.created",
      actorRef: "user-1",
      resourceRef: "locale:en",
      occurredAt: "2026-08-28T00:00:00Z",
    });
    expect(r.ok).toBe(true);
  });
  it("recognizes globalization data model entities", () => {
    expect(isGlobalizationEntity("Jurisdiction")).toBe(true);
    expect(isGlobalizationEntity("Tuition")).toBe(false);
  });
});
