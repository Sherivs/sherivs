/**
 * CoreGrid Regional Context — country, region, jurisdiction, timezone,
 * calendar, holiday, and education-system localization domain.
 *
 * Implements `architecture/phase-30-globalization.md`:
 * - Country profile (CA), region profile (CB).
 * - Jurisdiction model (CC), configuration (CD), effective-dated rules (CE),
 *   rule versioning (CF) — historical rule state is never overwritten.
 * - Legal localization (CG), data residency (CH), data transfer (CI),
 *   regional security (CJ), regional identity (CK) — advisory to Phase 08
 *   security / Phase 20 government authority, never a replacement.
 * - Timezone engine (AF), timezone-aware data (AG), daylight saving (AH),
 *   timezone changes (AI), multi-timezone institutions (AJ), user timezone
 *   (AK), event time (AL), timezone-aware recurrence (AM).
 * - Calendar system (AN), gregorian calendar (AO), other calendars (AP),
 *   academic calendar (AQ), school year (CO) and term (CP).
 * - Holiday engine (AR), holiday source (AS), movable holidays (AT) —
 *   movable/religious dates are computed externally, never hard-coded into
 *   the core — religious calendar support (AU).
 * - Education system localization (CL), terminology (CM), grading (CN) —
 *   Phase 30 owns localized representation only; Phase 26 remains the
 *   educational-meaning authority.
 * - Examination localization (CQ), government reporting localization (CR).
 * - Educational language (BW), multilingual education (BX), African language
 *   support (BY) and prioritization (BZ).
 */

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type JurisdictionId = string & { readonly __brand: "JurisdictionId" };
export type RegionalRuleId = string & { readonly __brand: "RegionalRuleId" };
export type TimezoneProfileId = string & { readonly __brand: "TimezoneProfileId" };
export type CalendarSystemId = string & { readonly __brand: "CalendarSystemId" };
export type AcademicCalendarId = string & { readonly __brand: "AcademicCalendarId" };
export type HolidayId = string & { readonly __brand: "HolidayId" };

export function jurisdictionId(raw: string): JurisdictionId {
  return raw as JurisdictionId;
}
export function regionalRuleId(raw: string): RegionalRuleId {
  return raw as RegionalRuleId;
}
export function timezoneProfileId(raw: string): TimezoneProfileId {
  return raw as TimezoneProfileId;
}
export function calendarSystemId(raw: string): CalendarSystemId {
  return raw as CalendarSystemId;
}
export function academicCalendarId(raw: string): AcademicCalendarId {
  return raw as AcademicCalendarId;
}
export function holidayId(raw: string): HolidayId {
  return raw as HolidayId;
}

/* ─────────────────────────────────────────────────────────────
 * Country profile (CA) + region profile (CB)
 * ────────────────────────────────────────────────────────────*/

export interface CountryProfile {
  /** ISO 3166-1 alpha-2. */
  code: string;
  name: string;
  languages: string[];
  currencies: string[];
  timezones: string[];
  calendars: string[];
  administrativeDivisions: string[];
  educationConventions: string[];
  measurementConventions: string[];
  regulatoryMetadata: string[];
}

export function createCountryProfile(input: {
  code: string;
  name: string;
  languages: string[];
  currencies?: string[];
  timezones?: string[];
  calendars?: string[];
  administrativeDivisions?: string[];
  educationConventions?: string[];
  measurementConventions?: string[];
  regulatoryMetadata?: string[];
}): { ok: true; profile: CountryProfile } | { ok: false; error: string } {
  if (!/^[A-Za-z]{2}$/.test(input.code)) {
    return { ok: false, error: "Country code must be ISO 3166-1 alpha-2 (Section CA)" };
  }
  if (!input.name.trim()) {
    return { ok: false, error: "Country name is required (Section CA)" };
  }
  if (input.languages.length === 0) {
    return { ok: false, error: "At least one language is required (Section CA)" };
  }
  return {
    ok: true,
    profile: {
      code: input.code.toUpperCase(),
      name: input.name,
      languages: input.languages,
      currencies: input.currencies ?? [],
      timezones: input.timezones ?? [],
      calendars: input.calendars ?? ["gregorian"],
      administrativeDivisions: input.administrativeDivisions ?? [],
      educationConventions: input.educationConventions ?? [],
      measurementConventions: input.measurementConventions ?? [],
      regulatoryMetadata: input.regulatoryMetadata ?? [],
    },
  };
}

export interface RegionProfile {
  id: string;
  countryCode: string;
  name: string;
  timezone?: string;
  language?: string;
  currency?: string;
  holidayRefs: string[];
}

export function createRegionProfile(input: {
  id: string;
  countryCode: string;
  name: string;
  timezone?: string;
  language?: string;
  currency?: string;
  holidayRefs?: string[];
}): { ok: true; profile: RegionProfile } | { ok: false; error: string } {
  if (!input.id.trim()) return { ok: false, error: "Region id is required (Section CB)" };
  if (!/^[A-Za-z]{2}$/.test(input.countryCode)) {
    return { ok: false, error: "Region country code must be ISO 3166-1 alpha-2 (Section CB)" };
  }
  if (!input.name.trim()) return { ok: false, error: "Region name is required (Section CB)" };
  return {
    ok: true,
    profile: {
      id: input.id,
      countryCode: input.countryCode.toUpperCase(),
      name: input.name,
      timezone: input.timezone,
      language: input.language,
      currency: input.currency,
      holidayRefs: input.holidayRefs ?? [],
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Jurisdiction model (Sections CC, CD)
 * ────────────────────────────────────────────────────────────*/

export type JurisdictionLevel =
  "global" | "country" | "region" | "district" | "local_authority" | "institution";

export const JURISDICTION_LEVEL_RANK: Record<JurisdictionLevel, number> = {
  global: 0,
  country: 1,
  region: 2,
  district: 3,
  local_authority: 4,
  institution: 5,
};

export interface Jurisdiction {
  id: JurisdictionId;
  level: JurisdictionLevel;
  parentRef?: JurisdictionId;
  name: string;
}

export function createJurisdiction(input: {
  id: JurisdictionId;
  level: JurisdictionLevel;
  parentRef?: JurisdictionId;
  name: string;
}): { ok: true; jurisdiction: Jurisdiction } | { ok: false; error: string } {
  if (!input.id) return { ok: false, error: "Jurisdiction id is required (Section CC)" };
  if (!input.name.trim()) return { ok: false, error: "Jurisdiction name is required (Section CC)" };
  if (input.level === "global") {
    if (input.parentRef) {
      return { ok: false, error: "The global jurisdiction has no parent (Section CC)" };
    }
  } else if (!input.parentRef) {
    return { ok: false, error: "Non-global jurisdictions require a parent (Section CC)" };
  }
  return {
    ok: true,
    jurisdiction: {
      id: input.id,
      level: input.level,
      parentRef: input.parentRef,
      name: input.name,
    },
  };
}

export function isJurisdictionChainValid(chain: readonly Jurisdiction[]): boolean {
  if (chain.length === 0) return false;
  for (let i = 0; i < chain.length; i++) {
    const current = chain[i];
    if (i === 0) {
      if (JURISDICTION_LEVEL_RANK[current.level] !== 0) return false;
      continue;
    }
    const previous = chain[i - 1];
    if (current.parentRef !== previous.id) return false;
    if (JURISDICTION_LEVEL_RANK[current.level] !== JURISDICTION_LEVEL_RANK[previous.level] + 1) {
      return false;
    }
  }
  return true;
}

/* ─────────────────────────────────────────────────────────────
 * Effective-dated rules (Sections CE, CF)
 * ────────────────────────────────────────────────────────────*/

export interface EffectiveDatedRule {
  id: RegionalRuleId;
  jurisdictionRef: JurisdictionId;
  category: string;
  payload: Record<string, unknown>;
  effectiveFrom: string;
  effectiveUntil?: string;
  version: number;
}

export function registerJurisdictionalRule(input: {
  id: RegionalRuleId;
  jurisdictionRef: JurisdictionId;
  category: string;
  payload: Record<string, unknown>;
  effectiveFrom: string;
  effectiveUntil?: string;
}): { ok: true; rule: EffectiveDatedRule } | { ok: false; error: string } {
  if (!input.id) return { ok: false, error: "Rule id is required (Section CE)" };
  if (!input.category.trim()) return { ok: false, error: "Rule category is required (Section CE)" };
  if (!input.effectiveFrom) {
    return { ok: false, error: "Effective date is required (Section CE)" };
  }
  if (input.effectiveUntil && input.effectiveUntil <= input.effectiveFrom) {
    return { ok: false, error: "Effective-until must be after effective-from (Section CE)" };
  }
  return {
    ok: true,
    rule: {
      id: input.id,
      jurisdictionRef: input.jurisdictionRef,
      category: input.category,
      payload: input.payload,
      effectiveFrom: input.effectiveFrom,
      effectiveUntil: input.effectiveUntil,
      version: 1,
    },
  };
}

export function isRuleEffectiveAt(rule: EffectiveDatedRule, atDate: string): boolean {
  if (rule.effectiveFrom > atDate) return false;
  if (rule.effectiveUntil && atDate >= rule.effectiveUntil) return false;
  return true;
}

export function getEffectiveRule(
  rules: readonly EffectiveDatedRule[],
  jurisdictionRef: JurisdictionId,
  category: string,
  atDate: string,
): EffectiveDatedRule | null {
  const candidates = rules
    .filter(
      (r) =>
        r.jurisdictionRef === jurisdictionRef &&
        r.category === category &&
        isRuleEffectiveAt(r, atDate),
    )
    .sort((a, b) => b.version - a.version);
  return candidates[0] ?? null;
}

// Section CF: superseding never overwrites historical rule state.
export function supersedeJurisdictionalRule(
  existing: EffectiveDatedRule,
  nextEffectiveFrom: string,
  nextPayload: Record<string, unknown>,
):
  | { ok: true; superseded: EffectiveDatedRule; current: EffectiveDatedRule }
  | { ok: false; error: string } {
  if (nextEffectiveFrom <= existing.effectiveFrom) {
    return { ok: false, error: "Superseding rule must start after the existing rule (Section CF)" };
  }
  const superseded: EffectiveDatedRule = { ...existing, effectiveUntil: nextEffectiveFrom };
  const current: EffectiveDatedRule = {
    id: existing.id,
    jurisdictionRef: existing.jurisdictionRef,
    category: existing.category,
    payload: nextPayload,
    effectiveFrom: nextEffectiveFrom,
    version: existing.version + 1,
  };
  return { ok: true, superseded, current };
}

/* ─────────────────────────────────────────────────────────────
 * Legal + residency + transfer + identity localization (CG-CK)
 * ────────────────────────────────────────────────────────────*/

export interface JurisdictionLegalMetadata {
  jurisdictionRef: JurisdictionId;
  dataResidencyRequirement?: string;
  dataTransferRestriction?: "restricted" | "conditional" | "unrestricted";
  securityRequirementRef?: string;
  /** attribute → regional format (e.g. national_id → NIN format). */
  identityFormats?: Record<string, string>;
  legalLocalizationRef?: string;
}

export function createJurisdictionLegalMetadata(input: {
  jurisdictionRef: JurisdictionId;
  dataResidencyRequirement?: string;
  dataTransferRestriction?: "restricted" | "conditional" | "unrestricted";
  securityRequirementRef?: string;
  identityFormats?: Record<string, string>;
  legalLocalizationRef?: string;
}): { ok: true; metadata: JurisdictionLegalMetadata } | { ok: false; error: string } {
  if (!input.jurisdictionRef) {
    return { ok: false, error: "Jurisdiction reference is required (Section CG)" };
  }
  return {
    ok: true,
    metadata: {
      jurisdictionRef: input.jurisdictionRef,
      dataResidencyRequirement: input.dataResidencyRequirement,
      dataTransferRestriction: input.dataTransferRestriction,
      securityRequirementRef: input.securityRequirementRef,
      identityFormats: input.identityFormats ?? {},
      legalLocalizationRef: input.legalLocalizationRef,
    },
  };
}

export type CoreDataClass =
  "PUBLIC" | "TENANT_INTERNAL" | "CONFIDENTIAL" | "SENSITIVE" | "RESTRICTED";

// Section CI: transfer must respect the residency restriction and data class.
// Advisory metadata for the Phase 08 security engine — never a substitute.
export function isDataTransferPermitted(
  metadata: JurisdictionLegalMetadata,
  dataClass: CoreDataClass,
  withinSameCountry: boolean,
): boolean {
  const restriction = metadata.dataTransferRestriction ?? "unrestricted";
  if (restriction === "unrestricted") return true;
  if (dataClass === "RESTRICTED" || dataClass === "SENSITIVE") return withinSameCountry;
  return restriction !== "restricted";
}

// Section CK: country-specific identity attribute formatting metadata.
export function resolveIdentityFormat(
  metadata: JurisdictionLegalMetadata,
  attribute: string,
): string | null {
  return metadata.identityFormats?.[attribute] ?? null;
}

/* ─────────────────────────────────────────────────────────────
 * Timezone (Sections AF, AH, AI, AJ, AK)
 * ────────────────────────────────────────────────────────────*/

export interface TimezoneProfile {
  id: TimezoneProfileId;
  ianaName: string;
  dstRules: string;
  version: string;
  validFrom: string;
}

export function createTimezoneProfile(input: {
  id: TimezoneProfileId;
  ianaName: string;
  dstRules: string;
  version: string;
  validFrom: string;
}): { ok: true; profile: TimezoneProfile } | { ok: false; error: string } {
  if (!input.ianaName.trim())
    return { ok: false, error: "Timezone IANA name is required (Section AF)" };
  if (!input.version.trim())
    return { ok: false, error: "Timezone rule version is required (Section AI)" };
  return {
    ok: true,
    profile: {
      id: input.id,
      ianaName: input.ianaName,
      dstRules: input.dstRules,
      version: input.version,
      validFrom: input.validFrom,
    },
  };
}

export function isTimezoneRuleCurrent(profile: TimezoneProfile, atDate: string): boolean {
  return profile.validFrom <= atDate;
}

export interface InstitutionTimezoneMap {
  institutionRef: string;
  locations: { locationRef: string; timezone: string }[];
}

export function createInstitutionTimezoneMap(input: {
  institutionRef: string;
  locations: { locationRef: string; timezone: string }[];
}): { ok: true; map: InstitutionTimezoneMap } | { ok: false; error: string } {
  if (!input.institutionRef.trim()) {
    return { ok: false, error: "Institution reference is required (Section AJ)" };
  }
  if (input.locations.length === 0) {
    return { ok: false, error: "At least one location is required (Section AJ)" };
  }
  const seen = new Set<string>();
  for (const location of input.locations) {
    if (!location.timezone.trim()) {
      return { ok: false, error: "Every location requires a timezone (Section AJ)" };
    }
    if (seen.has(location.locationRef)) {
      return { ok: false, error: `Duplicate location "${location.locationRef}" (Section AJ)` };
    }
    seen.add(location.locationRef);
  }
  return { ok: true, map: { institutionRef: input.institutionRef, locations: input.locations } };
}

export interface UserTimezonePreference {
  userRef: string;
  timezone: string;
}

export function createUserTimezonePreference(input: {
  userRef: string;
  timezone: string;
}): { ok: true; pref: UserTimezonePreference } | { ok: false; error: string } {
  if (!input.userRef.trim() || !input.timezone.trim()) {
    return { ok: false, error: "User timezone preference requires user and timezone (Section AK)" };
  }
  return { ok: true, pref: { userRef: input.userRef, timezone: input.timezone } };
}

/* ─────────────────────────────────────────────────────────────
 * Event time (Sections AG, AL, AM)
 * ────────────────────────────────────────────────────────────*/

export interface EventTime {
  /** Authoritative instant — retains instant semantics (Section AG). */
  instant?: string;
  localTime?: string;
  timezone?: string;
  recurrence?: string;
  displayTimezone?: string;
}

export function createEventTime(input: {
  instant?: string;
  localTime?: string;
  timezone?: string;
  recurrence?: string;
  displayTimezone?: string;
}): { ok: true; eventTime: EventTime } | { ok: false; error: string } {
  const hasInstant = Boolean(input.instant);
  const hasLocal = Boolean(input.localTime && input.timezone);
  if (!hasInstant && !hasLocal) {
    return {
      ok: false,
      error: "Event time requires an instant or a local time with timezone (Section AL)",
    };
  }
  if (input.recurrence && !input.timezone) {
    return { ok: false, error: "Recurring events must be timezone-aware (Section AM)" };
  }
  return {
    ok: true,
    eventTime: {
      instant: input.instant,
      localTime: input.localTime,
      timezone: input.timezone,
      recurrence: input.recurrence,
      displayTimezone: input.displayTimezone,
    },
  };
}

export function isEventTimeUnambiguous(evt: EventTime): boolean {
  return Boolean(evt.instant);
}

/* ─────────────────────────────────────────────────────────────
 * Calendar system (Sections AN, AO, AP)
 * ────────────────────────────────────────────────────────────*/

export interface CalendarSystem {
  id: CalendarSystemId;
  name: string;
  isAuthoritativeMachineCalendar: boolean;
  conventions: string[];
}

export function createCalendarSystem(input: {
  id: CalendarSystemId;
  name: string;
  isAuthoritativeMachineCalendar?: boolean;
  conventions?: string[];
}): { ok: true; system: CalendarSystem } | { ok: false; error: string } {
  if (!input.name.trim())
    return { ok: false, error: "Calendar system name is required (Section AN)" };
  return {
    ok: true,
    system: {
      id: input.id,
      name: input.name,
      isAuthoritativeMachineCalendar: input.isAuthoritativeMachineCalendar ?? false,
      conventions: input.conventions ?? [],
    },
  };
}

// Section AO: at most one authoritative machine calendar (gregorian default).
export function canRegisterAuthoritativeCalendar(systems: readonly CalendarSystem[]): boolean {
  return !systems.some((s) => s.isAuthoritativeMachineCalendar);
}

/* ─────────────────────────────────────────────────────────────
 * Academic calendar (Sections AQ, CO, CP)
 * ────────────────────────────────────────────────────────────*/

export type AcademicTermKind = "term" | "semester" | "trimester" | "quarter" | "custom";

export interface AcademicCalendar {
  id: AcademicCalendarId;
  countryCode: string;
  /** School year start, MM-DD (Section CO). */
  schoolYearStart: string;
  terms: { name: string; kind: AcademicTermKind; start: string; end: string }[];
  conventions: string[];
}

export function createAcademicCalendar(input: {
  id: AcademicCalendarId;
  countryCode: string;
  schoolYearStart: string;
  terms: { name: string; kind: AcademicTermKind; start: string; end: string }[];
  conventions?: string[];
}): { ok: true; calendar: AcademicCalendar } | { ok: false; error: string } {
  if (!/^[A-Za-z]{2}$/.test(input.countryCode)) {
    return { ok: false, error: "Academic calendar country code must be ISO alpha-2 (Section AQ)" };
  }
  if (!/^\d{2}-\d{2}$/.test(input.schoolYearStart)) {
    return { ok: false, error: "School year start must be MM-DD (Section CO)" };
  }
  if (input.terms.length === 0) {
    return { ok: false, error: "At least one school term is required (Section CP)" };
  }
  const sorted = [...input.terms].sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 0; i < sorted.length; i++) {
    const term = sorted[i];
    if (!/^\d{2}-\d{2}$/.test(term.start) || !/^\d{2}-\d{2}$/.test(term.end)) {
      return { ok: false, error: `Term "${term.name}" dates must be MM-DD (Section CP)` };
    }
    if (term.end < term.start) {
      return { ok: false, error: `Term "${term.name}" end must be after its start (Section CP)` };
    }
    if (i > 0 && term.start <= sorted[i - 1].end) {
      return { ok: false, error: "School terms must not overlap (Section CP)" };
    }
  }
  return {
    ok: true,
    calendar: {
      id: input.id,
      countryCode: input.countryCode.toUpperCase(),
      schoolYearStart: input.schoolYearStart,
      terms: input.terms,
      conventions: input.conventions ?? [],
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Holiday engine (Sections AR, AS, AT, AU)
 * ────────────────────────────────────────────────────────────*/

export interface Holiday {
  id: HolidayId;
  jurisdictionRef: string;
  authority: string;
  name: string;
  source: string;
  confidence: "high" | "medium" | "low";
  fixedDate?: string;
  movable?: boolean;
  observance?: "secular" | "islamic" | "christian" | "other" | "institutional";
  effectiveYears?: string[];
}

export function createHoliday(input: {
  id: HolidayId;
  jurisdictionRef: string;
  authority: string;
  name: string;
  source: string;
  confidence: "high" | "medium" | "low";
  fixedDate?: string;
  movable?: boolean;
  observance?: Holiday["observance"];
  effectiveYears?: string[];
}): { ok: true; holiday: Holiday } | { ok: false; error: string } {
  if (
    !input.jurisdictionRef ||
    !input.authority.trim() ||
    !input.name.trim() ||
    !input.source.trim()
  ) {
    return {
      ok: false,
      error: "Holiday requires jurisdiction, authority, name, and source (Section AS)",
    };
  }
  if (!input.fixedDate && !input.movable) {
    return { ok: false, error: "A holiday must be fixed-date or movable (Section AT)" };
  }
  return {
    ok: true,
    holiday: {
      id: input.id,
      jurisdictionRef: input.jurisdictionRef,
      authority: input.authority,
      name: input.name,
      source: input.source,
      confidence: input.confidence,
      fixedDate: input.fixedDate,
      movable: input.movable,
      observance: input.observance,
      effectiveYears: input.effectiveYears,
    },
  };
}

// Section AT: movable holidays are computed externally, never hard-coded.
export function resolveHolidayDate(
  holiday: Holiday,
  year: number,
): { ok: true; date: string } | { ok: false; error: string } {
  if (holiday.fixedDate) {
    if (holiday.effectiveYears && !holiday.effectiveYears.includes(String(year))) {
      return { ok: false, error: "Holiday is not effective for that year (Section AR)" };
    }
    return { ok: true, date: `${year}-${holiday.fixedDate}` };
  }
  return {
    ok: false,
    error: "Movable holidays require external calendar computation (Section AT)",
  };
}

// Section AU: religious observances are configurable with provenance.
export function isReligiousObservanceConfigurable(holiday: Holiday): boolean {
  return holiday.observance !== undefined && holiday.source.trim().length > 0;
}

/* ─────────────────────────────────────────────────────────────
 * Education system localization (CL, CM, CN, CQ, CR)
 * ────────────────────────────────────────────────────────────*/

export interface EducationTerminologyMap {
  countryCode: string;
  terms: { localTerm: string; concept: string; equivalent?: string }[];
}

export function createEducationTerminology(input: {
  countryCode: string;
  terms: { localTerm: string; concept: string; equivalent?: string }[];
}): { ok: true; map: EducationTerminologyMap } | { ok: false; error: string } {
  if (!/^[A-Za-z]{2}$/.test(input.countryCode)) {
    return {
      ok: false,
      error: "Education terminology country code must be ISO alpha-2 (Section CL)",
    };
  }
  if (input.terms.length === 0) {
    return { ok: false, error: "At least one education term is required (Section CM)" };
  }
  for (const term of input.terms) {
    if (!term.localTerm.trim() || !term.concept.trim()) {
      return {
        ok: false,
        error: "Each education term requires a local term and concept (Section CM)",
      };
    }
  }
  return { ok: true, map: { countryCode: input.countryCode.toUpperCase(), terms: input.terms } };
}

export function resolveLocalTerm(
  map: EducationTerminologyMap,
  concept: string,
  fallback: string,
): string {
  const match = map.terms.find((t) => t.concept === concept);
  return match ? match.localTerm : fallback;
}

export type GradingSystemKind = "percentage" | "letter" | "points" | "descriptive" | "competency";

export interface GradingScheme {
  id: string;
  countryCode: string;
  system: GradingSystemKind;
  scale: { grade: string; min: number; max: number; description?: string }[];
  representationOnly: boolean;
}

export function createGradingScheme(input: {
  id: string;
  countryCode: string;
  system: GradingSystemKind;
  scale: { grade: string; min: number; max: number; description?: string }[];
}): { ok: true; scheme: GradingScheme } | { ok: false; error: string } {
  if (!/^[A-Za-z]{2}$/.test(input.countryCode)) {
    return { ok: false, error: "Grading scheme country code must be ISO alpha-2 (Section CN)" };
  }
  if (input.scale.length === 0) {
    return { ok: false, error: "Grading scale is required (Section CN)" };
  }
  for (const grade of input.scale) {
    if (!grade.grade.trim()) {
      return { ok: false, error: "Each grade requires a label (Section CN)" };
    }
    if (grade.min > grade.max) {
      return { ok: false, error: "Grade range min must not exceed max (Section CN)" };
    }
  }
  return {
    ok: true,
    scheme: {
      id: input.id,
      countryCode: input.countryCode.toUpperCase(),
      system: input.system,
      scale: input.scale,
      // Phase 30 owns localized representation; Phase 26 owns meaning.
      representationOnly: true,
    },
  };
}

export interface ExaminationConvention {
  jurisdictionRef: string;
  authorities: string[];
  conventions: string[];
}

export function createExaminationConvention(input: {
  jurisdictionRef: string;
  authorities: string[];
  conventions?: string[];
}): { ok: true; convention: ExaminationConvention } | { ok: false; error: string } {
  if (!input.jurisdictionRef) {
    return { ok: false, error: "Examination jurisdiction is required (Section CQ)" };
  }
  if (input.authorities.length === 0) {
    return { ok: false, error: "At least one examination authority is required (Section CQ)" };
  }
  return {
    ok: true,
    convention: {
      jurisdictionRef: input.jurisdictionRef,
      authorities: input.authorities,
      conventions: input.conventions ?? [],
    },
  };
}

export interface GovernmentReportingLocalization {
  jurisdictionRef: string;
  reportTypes: { name: string; localeFields: string[]; authorityRef: string }[];
}

export function createGovernmentReportingLocalization(input: {
  jurisdictionRef: string;
  reportTypes: { name: string; localeFields: string[]; authorityRef: string }[];
}): { ok: true; localization: GovernmentReportingLocalization } | { ok: false; error: string } {
  if (!input.jurisdictionRef) {
    return { ok: false, error: "Government reporting jurisdiction is required (Section CR)" };
  }
  if (input.reportTypes.length === 0) {
    return { ok: false, error: "At least one government report type is required (Section CR)" };
  }
  return {
    ok: true,
    localization: { jurisdictionRef: input.jurisdictionRef, reportTypes: input.reportTypes },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Educational language (Sections BW, BX)
 * ────────────────────────────────────────────────────────────*/

export interface EducationalLanguageConfig {
  institutionRef: string;
  primaryInstructionLanguage: string;
  secondaryInstructionLanguage?: string;
  localLanguage?: string;
  examinationLanguage?: string;
  communicationLanguage?: string;
}

export function createEducationalLanguageConfig(input: {
  institutionRef: string;
  primaryInstructionLanguage: string;
  secondaryInstructionLanguage?: string;
  localLanguage?: string;
  examinationLanguage?: string;
  communicationLanguage?: string;
}): { ok: true; config: EducationalLanguageConfig } | { ok: false; error: string } {
  if (!input.institutionRef.trim()) {
    return { ok: false, error: "Institution reference is required (Section BW)" };
  }
  if (!input.primaryInstructionLanguage.trim()) {
    return { ok: false, error: "Primary instruction language is required (Section BW)" };
  }
  const declared = [
    input.primaryInstructionLanguage,
    input.secondaryInstructionLanguage,
    input.localLanguage,
    input.examinationLanguage,
    input.communicationLanguage,
  ].filter((l): l is string => Boolean(l));
  if (new Set(declared).size !== declared.length) {
    return { ok: false, error: "Educational language roles must be distinct (Section BX)" };
  }
  return { ok: true, config: { ...input } };
}

/* ─────────────────────────────────────────────────────────────
 * African language support (Sections BY, BZ)
 * ────────────────────────────────────────────────────────────*/

export const AFRICAN_LANGUAGE_FAMILIES: readonly string[] = [
  "niger_congo",
  "afroasiatic",
  "nilo_saharan",
  "khoisan",
] as const;

export type AfricanLanguageDriver =
  | "user_demand"
  | "educational_importance"
  | "geographic_adoption"
  | "linguistic_coverage"
  | "available_resources";

export interface AfricanLanguagePriorityItem {
  language: string;
  family?: string;
  drivers: { driver: AfricanLanguageDriver; weight: number }[];
}

export function createAfricanLanguagePriorityItem(input: {
  language: string;
  family?: string;
  drivers: { driver: AfricanLanguageDriver; weight: number }[];
}): { ok: true; item: AfricanLanguagePriorityItem } | { ok: false; error: string } {
  if (!input.language.trim()) {
    return { ok: false, error: "African language name is required (Section BZ)" };
  }
  if (input.drivers.some((d) => !Number.isFinite(d.weight) || d.weight <= 0)) {
    return { ok: false, error: "Language driver weights must be positive (Section BZ)" };
  }
  return {
    ok: true,
    item: { language: input.language, family: input.family, drivers: input.drivers },
  };
}

export function scoreAfricanLanguagePriority(
  items: readonly AfricanLanguagePriorityItem[],
): { language: string; score: number }[] {
  return items
    .map((item) => ({
      language: item.language,
      score: item.drivers.reduce((sum, d) => sum + d.weight, 0),
    }))
    .sort((a, b) => b.score - a.score);
}

// Section BY: expansion planning must never assume the language set is
// complete — rankings are a starting point, not a closed catalog.
export function planAfricanLanguageExpansion(
  items: readonly AfricanLanguagePriorityItem[],
  budget: number,
): string[] {
  return scoreAfricanLanguagePriority(items)
    .filter((s) => s.score > 0)
    .slice(0, budget)
    .map((s) => s.language);
}
