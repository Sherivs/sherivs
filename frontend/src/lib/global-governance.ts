/**
 * CoreGrid Globalization Governance — configuration precedence, feature
 * availability, country readiness/expansion, support, localization QA,
 * connectivity/device localization, voice/accessibility UX, knowledge graph,
 * and globalization API/events domain.
 *
 * Implements `architecture/phase-30-globalization.md`:
 * - Global configuration (DP), regional overrides (DQ), institutional
 *   overrides (DR), user preferences (DS), configuration precedence (DT) —
 *   user > institution > region > jurisdiction > global — and immutable
 *   rules (DU): security, integrity, identity, audit, tenant isolation are
 *   never overridable through globalization configuration.
 * - Global product consistency (DV), feature availability (DW), feature
 *   flags (DX) — feature differences are configuration-driven.
 * - Regional dependency management (DY), global service catalog (DZ).
 * - Country readiness (EA), launch checklist (EB), regional pilot (EC),
 *   country expansion (ED) — one stage at a time — market entry (EE).
 * - Regional support (EF), support language (EG), global incident
 *   communication (EH), global status (EI), regional SLA (EJ).
 * - Localization testing (DG), pseudo-localization (DH), locale matrix (DI),
 *   regional QA (DJ), human review (DK), community review (DL).
 * - Mobile network localization (CV), offline localization (CW), low
 *   bandwidth design (CX), data cost awareness (CY), regional device
 *   conditions (CZ), device capability localization (DA).
 * - Low-literacy UX (BS), voice localization (BT), speech recognition (BU),
 *   speech synthesis (BV).
 * - Globalization knowledge graph (FC), regional graph (FD), language graph
 *   (FE), jurisdiction graph (FF) — Phase 06 remains the knowledge-graph
 *   authority; Phase 30 only seeds regional metadata into it.
 * - Globalization API (FG), globalization events (FH), data model (FI).
 */

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type LocalizationConfigId = string & { readonly __brand: "LocalizationConfigId" };
export type FeatureFlagId = string & { readonly __brand: "FeatureFlagId" };
export type CountryReadinessId = string & { readonly __brand: "CountryReadinessId" };
export type LocaleTestRunId = string & { readonly __brand: "LocaleTestRunId" };
export type GlobalizationEventId = string & { readonly __brand: "GlobalizationEventId" };

export function localizationConfigId(raw: string): LocalizationConfigId {
  return raw as LocalizationConfigId;
}
export function featureFlagId(raw: string): FeatureFlagId {
  return raw as FeatureFlagId;
}
export function countryReadinessId(raw: string): CountryReadinessId {
  return raw as CountryReadinessId;
}
export function localeTestRunId(raw: string): LocaleTestRunId {
  return raw as LocaleTestRunId;
}
export function globalizationEventId(raw: string): GlobalizationEventId {
  return raw as GlobalizationEventId;
}

/* ─────────────────────────────────────────────────────────────
 * Configuration precedence (Sections DP-DU)
 * ────────────────────────────────────────────────────────────*/

export type ConfigOverrideLevel = "global" | "jurisdiction" | "region" | "institution" | "user";

export const CONFIG_OVERRIDE_LEVELS: readonly ConfigOverrideLevel[] = [
  "global",
  "jurisdiction",
  "region",
  "institution",
  "user",
] as const;

export const CONFIG_RANK: Record<ConfigOverrideLevel, number> = {
  global: 0,
  jurisdiction: 1,
  region: 2,
  institution: 3,
  user: 4,
};

// Section DU: invariants that can never be overridden through configuration.
export const IMMUTABLE_GLOBALIZATION_RULES: readonly string[] = [
  "security_invariants",
  "data_integrity",
  "identity_boundaries",
  "audit_requirements",
  "tenant_isolation",
] as const;

export interface LocalizationConfigValue {
  id: LocalizationConfigId;
  key: string;
  level: ConfigOverrideLevel;
  value: unknown;
  tenantRef?: string;
  scope?: string;
}

export function createLocalizationConfig(input: {
  id: LocalizationConfigId;
  key: string;
  level: ConfigOverrideLevel;
  value: unknown;
  tenantRef?: string;
  scope?: string;
}): { ok: true; config: LocalizationConfigValue } | { ok: false; error: string } {
  if (!input.id) return { ok: false, error: "Configuration id is required (Section DP)" };
  if (!input.key.trim()) return { ok: false, error: "Configuration key is required (Section DP)" };
  if (input.value === undefined) {
    return { ok: false, error: "Configuration value is required (Section DP)" };
  }
  return {
    ok: true,
    config: {
      id: input.id,
      key: input.key,
      level: input.level,
      value: input.value,
      tenantRef: input.tenantRef,
      scope: input.scope,
    },
  };
}

// Section DT: resolve the most specific applicable value (highest rank).
export function resolveConfigValue(
  configs: readonly LocalizationConfigValue[],
  key: string,
  atLevel: ConfigOverrideLevel,
): { ok: true; value: unknown; sourceLevel: ConfigOverrideLevel } | { ok: false; error: string } {
  const applicable = configs
    .filter((c) => c.key === key && CONFIG_RANK[c.level] <= CONFIG_RANK[atLevel])
    .sort((a, b) => CONFIG_RANK[b.level] - CONFIG_RANK[a.level]);
  const top = applicable[0];
  if (!top) {
    return {
      ok: false,
      error: `No configuration value for "${key}" at level "${atLevel}" (Section DT)`,
    };
  }
  return { ok: true, value: top.value, sourceLevel: top.level };
}

export function isImmutableGlobalizationRule(key: string): boolean {
  return IMMUTABLE_GLOBALIZATION_RULES.includes(key);
}

// Sections DU + DS: immutable rules cannot be overridden anywhere; user
// preferences may tune presentation, never governance invariants.
export function canOverrideRule(key: string, level: ConfigOverrideLevel): boolean {
  if (isImmutableGlobalizationRule(key)) return false;
  if (level === "user" && key.startsWith("governance.")) return false;
  return true;
}

/* ─────────────────────────────────────────────────────────────
 * Feature availability (Sections DV, DW, DX)
 * ────────────────────────────────────────────────────────────*/

export interface RegionalFeatureFlag {
  id: FeatureFlagId;
  feature: string;
  jurisdictionRef?: string;
  enabled: boolean;
  reason?: string;
  providerDependency?: string;
  expiresAt?: string;
}

export function createRegionalFeatureFlag(input: {
  id: FeatureFlagId;
  feature: string;
  jurisdictionRef?: string;
  enabled: boolean;
  reason?: string;
  providerDependency?: string;
  expiresAt?: string;
}): { ok: true; flag: RegionalFeatureFlag } | { ok: false; error: string } {
  if (!input.id) return { ok: false, error: "Feature flag id is required (Section DX)" };
  if (!input.feature.trim()) return { ok: false, error: "Feature name is required (Section DX)" };
  return { ok: true, flag: { ...input } };
}

// Section DW: feature differences are configuration-driven; unconfigured
// features are unavailable until explicitly enabled.
export function isFeatureAvailable(
  flags: readonly RegionalFeatureFlag[],
  feature: string,
  jurisdictionRef: string,
  atDate: string,
): boolean {
  const regional = flags.find(
    (f) => f.feature === feature && f.jurisdictionRef === jurisdictionRef,
  );
  const target =
    regional ?? flags.find((f) => f.feature === feature && f.jurisdictionRef === undefined);
  if (!target) return false;
  if (!target.enabled) return false;
  if (target.expiresAt && atDate >= target.expiresAt) return false;
  return true;
}

/* ─────────────────────────────────────────────────────────────
 * Global service catalog (Sections DY, DZ)
 * ────────────────────────────────────────────────────────────*/

export interface GlobalServiceCatalogEntry {
  service: string;
  region: string;
  provider: string;
  available: boolean;
  dependencies: string[];
}

export function createGlobalServiceCatalogEntry(input: {
  service: string;
  region: string;
  provider: string;
  available?: boolean;
  dependencies?: string[];
}): { ok: true; entry: GlobalServiceCatalogEntry } | { ok: false; error: string } {
  if (!input.service.trim()) return { ok: false, error: "Service name is required (Section DZ)" };
  if (!input.region.trim()) return { ok: false, error: "Service region is required (Section DZ)" };
  if (!input.provider.trim())
    return { ok: false, error: "Service provider is required (Section DZ)" };
  return {
    ok: true,
    entry: {
      service: input.service,
      region: input.region,
      provider: input.provider,
      available: input.available ?? false,
      dependencies: input.dependencies ?? [],
    },
  };
}

// Section DY: dependencies must be explicit and satisfied within the region.
export function isRegionalDependencySatisfied(
  entry: GlobalServiceCatalogEntry,
  catalog: readonly GlobalServiceCatalogEntry[],
): boolean {
  return entry.dependencies.every((dep) => {
    const found = catalog.find((c) => c.service === dep && c.region === entry.region);
    return found !== undefined && found.available;
  });
}

export function findServiceForRegion(
  catalog: readonly GlobalServiceCatalogEntry[],
  service: string,
  region: string,
): GlobalServiceCatalogEntry | null {
  return catalog.find((c) => c.service === service && c.region === region) ?? null;
}

/* ─────────────────────────────────────────────────────────────
 * Country readiness + expansion (Sections EA, EB, EC, ED, EE)
 * ────────────────────────────────────────────────────────────*/

export const READINESS_DIMENSIONS: readonly string[] = [
  "language",
  "currency",
  "timezone",
  "education",
  "payments",
  "government",
  "connectivity",
  "cloud",
  "integration",
  "security",
  "localization",
  "support",
] as const;

export type CountryReadinessStatus =
  "research" | "localization" | "pilot" | "validation" | "launch" | "monitoring" | "scale";

export interface CountryReadiness {
  id: CountryReadinessId;
  countryCode: string;
  scores: Record<string, number>;
  gates: { gate: string; passed: boolean }[];
  status: CountryReadinessStatus;
}

export function createCountryReadiness(input: {
  id: CountryReadinessId;
  countryCode: string;
  scores: Record<string, number>;
  gates?: { gate: string; passed: boolean }[];
  status?: CountryReadinessStatus;
}): { ok: true; readiness: CountryReadiness } | { ok: false; error: string } {
  if (!input.countryCode.trim()) {
    return { ok: false, error: "Country code is required (Section EA)" };
  }
  for (const [dimension, score] of Object.entries(input.scores)) {
    if (!Number.isFinite(score) || score < 0 || score > 1) {
      return {
        ok: false,
        error: `Readiness score for "${dimension}" must be between 0 and 1 (Section EA)`,
      };
    }
  }
  return {
    ok: true,
    readiness: {
      id: input.id,
      countryCode: input.countryCode,
      scores: input.scores,
      gates: input.gates ?? [],
      status: input.status ?? "research",
    },
  };
}

export function readinessScore(readiness: CountryReadiness): number {
  const values = Object.values(readiness.scores);
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// Section EB: launch requires every gate passed and the minimum score.
export function isCountryLaunchReady(readiness: CountryReadiness, minScore: number): boolean {
  return (
    readiness.gates.length > 0 &&
    readiness.gates.every((g) => g.passed) &&
    readinessScore(readiness) >= minScore
  );
}

export const EXPANSION_ORDER: readonly CountryReadinessStatus[] = [
  "research",
  "localization",
  "pilot",
  "validation",
  "launch",
  "monitoring",
  "scale",
] as const;

// Section ED: country expansion advances one stage at a time.
export function canAdvanceExpansion(
  current: CountryReadinessStatus,
  target: CountryReadinessStatus,
): boolean {
  const from = EXPANSION_ORDER.indexOf(current);
  const to = EXPANSION_ORDER.indexOf(target);
  return from >= 0 && to === from + 1;
}

// Section EC: controlled regional pilots — scoped institutions + monitoring.
export function openRegionalPilot(input: {
  pilotRef: string;
  countryCode: string;
  institutions: string[];
  startDate: string;
  monitoring?: boolean;
}):
  | {
      ok: true;
      pilot: {
        pilotRef: string;
        countryCode: string;
        institutions: string[];
        startDate: string;
        status: "active";
        monitoring: boolean;
      };
    }
  | { ok: false; error: string } {
  if (!input.pilotRef.trim())
    return { ok: false, error: "Pilot reference is required (Section EC)" };
  if (!input.countryCode.trim())
    return { ok: false, error: "Pilot country is required (Section EC)" };
  if (input.institutions.length === 0) {
    return { ok: false, error: "A regional pilot requires at least one institution (Section EC)" };
  }
  return {
    ok: true,
    pilot: {
      pilotRef: input.pilotRef,
      countryCode: input.countryCode,
      institutions: input.institutions,
      startDate: input.startDate,
      status: "active",
      monitoring: input.monitoring ?? true,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Support + incident + status + SLA (Sections EF, EG, EH, EI, EJ)
 * ────────────────────────────────────────────────────────────*/

export interface RegionalSupportProfile {
  region: string;
  languages: string[];
  channels: string[];
  localizedDocs: boolean;
}

export function createRegionalSupportProfile(input: {
  region: string;
  languages: string[];
  channels?: string[];
  localizedDocs?: boolean;
}): { ok: true; profile: RegionalSupportProfile } | { ok: false; error: string } {
  if (!input.region.trim()) return { ok: false, error: "Support region is required (Section EF)" };
  if (input.languages.length === 0) {
    return { ok: false, error: "At least one support language is required (Section EG)" };
  }
  return {
    ok: true,
    profile: {
      region: input.region,
      languages: input.languages,
      channels: input.channels ?? [],
      localizedDocs: input.localizedDocs ?? false,
    },
  };
}

export interface IncidentCommunicationPlan {
  incidentRef: string;
  languages: string[];
  timezone: string;
  templates: string[];
}

export function createIncidentCommunicationPlan(input: {
  incidentRef: string;
  languages: string[];
  timezone: string;
  templates?: string[];
}): { ok: true; plan: IncidentCommunicationPlan } | { ok: false; error: string } {
  if (!input.incidentRef.trim())
    return { ok: false, error: "Incident reference is required (Section EH)" };
  if (input.languages.length === 0 || !input.timezone.trim()) {
    return {
      ok: false,
      error: "Incident communication requires languages and a timezone (Section EH)",
    };
  }
  return {
    ok: true,
    plan: {
      incidentRef: input.incidentRef,
      languages: input.languages,
      timezone: input.timezone,
      templates: input.templates ?? [],
    },
  };
}

export interface LocalizedStatusView {
  statusRef: string;
  locale: string;
  text: string;
}

export function createLocalizedStatusView(input: {
  statusRef: string;
  locale: string;
  text: string;
}): { ok: true; view: LocalizedStatusView } | { ok: false; error: string } {
  if (!input.statusRef.trim() || !input.locale.trim() || !input.text.trim()) {
    return {
      ok: false,
      error: "Localized status view requires status, locale, and text (Section EI)",
    };
  }
  return { ok: true, view: { statusRef: input.statusRef, locale: input.locale, text: input.text } };
}

export interface RegionalSla {
  region: string;
  deploymentEnv: string;
  availabilityPercent: number;
  /** Section EJ: representation only — operational ownership stays with SRE. */
  representationOnly: boolean;
}

export function createRegionalSla(input: {
  region: string;
  deploymentEnv: string;
  availabilityPercent: number;
}): { ok: true; sla: RegionalSla } | { ok: false; error: string } {
  if (!input.region.trim()) return { ok: false, error: "SLA region is required (Section EJ)" };
  if (
    !Number.isFinite(input.availabilityPercent) ||
    input.availabilityPercent < 0 ||
    input.availabilityPercent > 100
  ) {
    return {
      ok: false,
      error: "SLA availability must be a percentage between 0 and 100 (Section EJ)",
    };
  }
  return {
    ok: true,
    sla: {
      region: input.region,
      deploymentEnv: input.deploymentEnv,
      availabilityPercent: input.availabilityPercent,
      representationOnly: true,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Localization QA + testing (Sections DG, DH, DI, DJ, DK, DL)
 * ────────────────────────────────────────────────────────────*/

export interface PseudoLocalizationConfig {
  locale: string;
  prefix: string;
  suffix: string;
  expansionFactor: number;
}

export function createPseudoLocalizationConfig(input: {
  locale: string;
  prefix: string;
  suffix: string;
  expansionFactor: number;
}): { ok: true; config: PseudoLocalizationConfig } | { ok: false; error: string } {
  if (!input.locale.trim())
    return { ok: false, error: "Pseudo-localization locale is required (Section DH)" };
  if (input.expansionFactor < 1) {
    return {
      ok: false,
      error: "Pseudo-localization expansion factor must be at least 1 (Section DH)",
    };
  }
  return {
    ok: true,
    config: {
      locale: input.locale,
      prefix: input.prefix,
      suffix: input.suffix,
      expansionFactor: input.expansionFactor,
    },
  };
}

// Section DH: exposes text overflow, hard-coded strings, layout assumptions.
export function pseudoLocalize(text: string, config: PseudoLocalizationConfig): string {
  const expanded = Math.ceil(text.length * config.expansionFactor);
  const padding = "[".repeat(Math.max(0, expanded - text.length));
  return `${config.prefix}${text}${padding}${config.suffix}`;
}

export interface LocaleMatrixEntry {
  locale: string;
  language: string;
  script: string;
  direction: "ltr" | "rtl";
  covered: boolean;
}

// Section DI: every supported locale must be covered, with LTR and RTL paths.
export function createLocaleMatrix(
  entries: readonly LocaleMatrixEntry[],
): { ok: true; matrix: readonly LocaleMatrixEntry[] } | { ok: false; error: string } {
  if (entries.length === 0)
    return { ok: false, error: "Locale matrix requires entries (Section DI)" };
  if (!entries.every((e) => e.covered)) {
    return { ok: false, error: "Every supported locale must be covered (Section DI)" };
  }
  if (!entries.some((e) => e.direction === "ltr") || !entries.some((e) => e.direction === "rtl")) {
    return {
      ok: false,
      error: "Locale matrix must include both LTR and RTL coverage (Section DI)",
    };
  }
  return { ok: true, matrix: entries };
}

export interface LocaleTestRun {
  id: LocaleTestRunId;
  locale: string;
  tests: string[];
  passed: number;
  failed: number;
}

export function createLocaleTestRun(input: {
  id: LocaleTestRunId;
  locale: string;
  tests: string[];
  passed: number;
  failed: number;
}): { ok: true; run: LocaleTestRun } | { ok: false; error: string } {
  if (!input.locale.trim()) return { ok: false, error: "Test run locale is required (Section DG)" };
  if (input.passed < 0 || input.failed < 0) {
    return { ok: false, error: "Test run counts must be non-negative (Section DG)" };
  }
  return {
    ok: true,
    run: {
      id: input.id,
      locale: input.locale,
      tests: input.tests,
      passed: input.passed,
      failed: input.failed,
    },
  };
}

export function isLocaleTestRunGreen(run: LocaleTestRun): boolean {
  return run.failed === 0;
}

export interface LocalizationReview {
  target: string;
  kind: "human" | "community";
  reviewer: string;
  status: "pending" | "approved" | "rejected";
}

// Section DK: critical localization requires human regional review.
export function createHumanReview(input: {
  target: string;
  reviewer: string;
}): { ok: true; review: LocalizationReview } | { ok: false; error: string } {
  if (!input.target.trim() || !input.reviewer.trim()) {
    return { ok: false, error: "Human review requires a target and reviewer (Section DK)" };
  }
  return {
    ok: true,
    review: { target: input.target, kind: "human", reviewer: input.reviewer, status: "pending" },
  };
}

export function approveCommunityReview(
  review: LocalizationReview,
): { ok: true; review: LocalizationReview } | { ok: false; error: string } {
  if (!review.reviewer.trim()) {
    return { ok: false, error: "Community review requires a reviewer identity (Section DL)" };
  }
  return { ok: true, review: { ...review, status: "approved" } };
}

/* ─────────────────────────────────────────────────────────────
 * Connectivity + device localization (CV, CW, CX, CY, CZ, DA)
 * ────────────────────────────────────────────────────────────*/

export type ConnectivityClass = "stable" | "limited" | "offline";

export interface ConnectivityProfile {
  region: string;
  class: ConnectivityClass;
  bandwidthKbps?: number;
  dataCostAware: boolean;
  offlineSupport: boolean;
  lowBandwidthDesign: boolean;
}

export function createConnectivityProfile(input: {
  region: string;
  class: ConnectivityClass;
  bandwidthKbps?: number;
  dataCostAware?: boolean;
  offlineSupport?: boolean;
  lowBandwidthDesign?: boolean;
}): { ok: true; profile: ConnectivityProfile } | { ok: false; error: string } {
  if (!input.region.trim())
    return { ok: false, error: "Connectivity region is required (Section CV)" };
  return {
    ok: true,
    profile: {
      region: input.region,
      class: input.class,
      bandwidthKbps: input.bandwidthKbps,
      dataCostAware: input.dataCostAware ?? false,
      offlineSupport: input.offlineSupport ?? false,
      lowBandwidthDesign: input.lowBandwidthDesign ?? false,
    },
  };
}

// Section CY: data-cost aware synchronization based on network conditions.
export function shouldAdaptSync(profile: ConnectivityProfile): boolean {
  return profile.dataCostAware && profile.class === "limited";
}

export function canOperateOffline(profile: ConnectivityProfile): boolean {
  return profile.offlineSupport;
}

export interface DeviceCapabilityProfile {
  region: string;
  screenSizes: string[];
  lowCpu: boolean;
  lowMemory: boolean;
  hasCamera: boolean;
  hasBiometrics: boolean;
  connectivityClass: ConnectivityClass;
}

export function createDeviceCapabilityProfile(input: {
  region: string;
  screenSizes?: string[];
  lowCpu?: boolean;
  lowMemory?: boolean;
  hasCamera?: boolean;
  hasBiometrics?: boolean;
  connectivityClass: ConnectivityClass;
}): { ok: true; profile: DeviceCapabilityProfile } | { ok: false; error: string } {
  if (!input.region.trim()) {
    return { ok: false, error: "Device capability region is required (Section CZ)" };
  }
  return {
    ok: true,
    profile: {
      region: input.region,
      screenSizes: input.screenSizes ?? [],
      lowCpu: input.lowCpu ?? false,
      lowMemory: input.lowMemory ?? false,
      hasCamera: input.hasCamera ?? false,
      hasBiometrics: input.hasBiometrics ?? false,
      connectivityClass: input.connectivityClass,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Voice + low-literacy UX (Sections BS, BT, BU, BV)
 * ────────────────────────────────────────────────────────────*/

export interface LowLiteracyUxConfig {
  region: string;
  useIcons: boolean;
  useGuidedFlows: boolean;
  useAudioAssistance: boolean;
  useVisualExplanations: boolean;
  progressiveOnboarding: boolean;
}

export function createLowLiteracyUxConfig(input: {
  region: string;
  useIcons?: boolean;
  useGuidedFlows?: boolean;
  useAudioAssistance?: boolean;
  useVisualExplanations?: boolean;
  progressiveOnboarding?: boolean;
}): { ok: true; config: LowLiteracyUxConfig } | { ok: false; error: string } {
  if (!input.region.trim())
    return { ok: false, error: "Low-literacy UX region is required (Section BS)" };
  return {
    ok: true,
    config: {
      region: input.region,
      useIcons: input.useIcons ?? false,
      useGuidedFlows: input.useGuidedFlows ?? false,
      useAudioAssistance: input.useAudioAssistance ?? false,
      useVisualExplanations: input.useVisualExplanations ?? false,
      progressiveOnboarding: input.progressiveOnboarding ?? false,
    },
  };
}

export interface VoiceLocalization {
  region: string;
  languages: string[];
  speechRecognition: boolean;
  speechSynthesis: boolean;
  localAccents: string[];
}

export function createVoiceLocalization(input: {
  region: string;
  languages: string[];
  speechRecognition?: boolean;
  speechSynthesis?: boolean;
  localAccents?: string[];
}): { ok: true; localization: VoiceLocalization } | { ok: false; error: string } {
  if (!input.region.trim())
    return { ok: false, error: "Voice localization region is required (Section BT)" };
  return {
    ok: true,
    localization: {
      region: input.region,
      languages: input.languages,
      speechRecognition: input.speechRecognition ?? false,
      speechSynthesis: input.speechSynthesis ?? false,
      localAccents: input.localAccents ?? [],
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Globalization knowledge graph (FC, FD, FE, FF)
 * ────────────────────────────────────────────────────────────*/

export type GlobalizationKnowledgeEntityType =
  | "country"
  | "region"
  | "district"
  | "institution"
  | "language"
  | "locale"
  | "jurisdiction"
  | "authority";

export interface GlobalizationKnowledgeEntity {
  type: GlobalizationKnowledgeEntityType;
  id: string;
  parentRef?: string;
}

export function createGlobalizationKnowledgeEntity(input: {
  type: GlobalizationKnowledgeEntityType;
  id: string;
  parentRef?: string;
}): { ok: true; entity: GlobalizationKnowledgeEntity } | { ok: false; error: string } {
  if (!input.id.trim()) return { ok: false, error: "Knowledge entity id is required (Section FC)" };
  return { ok: true, entity: { type: input.type, id: input.id, parentRef: input.parentRef } };
}

// Section FD: validate a regional graph — every parent resolves and the
// type chain is legal (Country → Region → District → Institution).
export function validateRegionalGraph(
  entities: readonly GlobalizationKnowledgeEntity[],
): { ok: true; nodeCount: number; edgeCount: number } | { ok: false; error: string } {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const allowedParents: Partial<
    Record<GlobalizationKnowledgeEntityType, readonly GlobalizationKnowledgeEntityType[]>
  > = {
    region: ["country"],
    district: ["region"],
    institution: ["district", "region"],
  };
  for (const entity of entities) {
    if (!entity.parentRef) continue;
    const parent = byId.get(entity.parentRef);
    if (!parent) {
      return {
        ok: false,
        error: `Missing parent "${entity.parentRef}" for "${entity.id}" (Section FD)`,
      };
    }
    const allowed = allowedParents[entity.type];
    if (allowed && !allowed.includes(parent.type)) {
      return {
        ok: false,
        error: `Invalid parent type "${parent.type}" for "${entity.type}" (Section FD)`,
      };
    }
  }
  return {
    ok: true,
    nodeCount: entities.length,
    edgeCount: entities.filter((e) => e.parentRef).length,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Globalization API + events + data model (FG, FH, FI)
 * ────────────────────────────────────────────────────────────*/

export const GLOBALIZATION_APIS: readonly string[] = [
  "LocaleAPI",
  "LanguageAPI",
  "TranslationAPI",
  "CurrencyPresentationAPI",
  "TimezoneAPI",
  "CalendarAPI",
  "HolidayAPI",
  "MeasurementAPI",
  "CountryProfileAPI",
  "RegionProfileAPI",
  "JurisdictionAPI",
  "LocalizationConfigAPI",
  "TerminologyAPI",
  "LocalizedContentAPI",
  "GlobalizationReadinessAPI",
] as const;

export function isGlobalizationApiCovered(api: string): boolean {
  return GLOBALIZATION_APIS.includes(api);
}

export type GlobalizationEventType =
  | "locale.created"
  | "locale.updated"
  | "translation.created"
  | "translation.updated"
  | "translation.reviewed"
  | "country.profile.updated"
  | "regional.rule.updated"
  | "holiday.updated"
  | "timezone.rule.updated"
  | "currency.rule.updated"
  | "localization.release.created"
  | "localization.release.approved";

export const GLOBALIZATION_EVENT_TYPES: readonly GlobalizationEventType[] = [
  "locale.created",
  "locale.updated",
  "translation.created",
  "translation.updated",
  "translation.reviewed",
  "country.profile.updated",
  "regional.rule.updated",
  "holiday.updated",
  "timezone.rule.updated",
  "currency.rule.updated",
  "localization.release.created",
  "localization.release.approved",
] as const;

export interface GlobalizationEvent {
  id: GlobalizationEventId;
  type: GlobalizationEventType;
  actorRef: string;
  resourceRef: string;
  occurredAt: string;
}

export function publishGlobalizationEvent(input: {
  id: GlobalizationEventId;
  type: GlobalizationEventType;
  actorRef: string;
  resourceRef: string;
  occurredAt: string;
}): { ok: true; event: GlobalizationEvent } | { ok: false; error: string } {
  if (!GLOBALIZATION_EVENT_TYPES.includes(input.type)) {
    return { ok: false, error: "Unknown globalization event type (Section FH)" };
  }
  if (!input.actorRef.trim() || !input.resourceRef.trim()) {
    return {
      ok: false,
      error: "Globalization event requires actor and resource references (Section FH)",
    };
  }
  return {
    ok: true,
    event: {
      id: input.id,
      type: input.type,
      actorRef: input.actorRef,
      resourceRef: input.resourceRef,
      occurredAt: input.occurredAt,
    },
  };
}

export const GLOBALIZATION_CORE_ENTITIES: readonly string[] = [
  "Locale",
  "Language",
  "Script",
  "Country",
  "Region",
  "Jurisdiction",
  "Currency",
  "Timezone",
  "Calendar",
  "Holiday",
  "MeasurementSystem",
  "Translation",
  "TranslationKey",
  "Terminology",
  "LocalizedContent",
] as const;

export function isGlobalizationEntity(name: string): boolean {
  return GLOBALIZATION_CORE_ENTITIES.includes(name);
}
