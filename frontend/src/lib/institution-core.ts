/**
 * CoreGrid Institutional Onboarding, Administration & Workforce Identity Platform —
 * Institutional entity domain.
 *
 * Implements `architecture/phase-25-institutional-onboarding-administration-workforce-identity-platform.md`:
 * - Institution creation model (Section D): Institution → Profile, Tenant reference,
 *   Institutional Identity, Default Administrative Policy Set, Initial Administrator.
 * - CoreGrid Platform vs Institution Authority (Section E): the initial administrator
 *   becomes the institution's primary administrative authority subject to platform
 *   controls; an administrator can never override platform-level security controls.
 * - Institutional profile (Section F): legal name, display name, institution type,
 *   ownership type, registration, country/region/state/LGA, contact, email domains,
 *   operating days/hours, currency, timezone, languages, academic calendar.
 * - Institution types (Section G): configurable, not hard-coded.
 * - African Education Complexity Model (Section H): configuration-driven diversity.
 * - School groups (Section I): group administration must not automatically grant
 *   unrestricted access to every institution.
 * - Multi-campus (Section J), multi-premises (Section K), location hierarchy
 *   (Section L): Institution → Campus → Premises → Building → Floor → Room → Resource.
 * - Multi-shift (Section M), multi-timezone (Section N), multilingual (Section O).
 * - Initial administrator account (Section AE).
 *
 * Phase 25 consumes Phase 02 identity, Phase 03 tenancy and Phase 04 institution
 * structure primitives; it never duplicates them (AGENTS.md 65).
 */

import type { TenantId } from "./tenant-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type InstitutionId = string & { readonly __brand: "InstitutionId" };
export type InstitutionalProfileId = string & { readonly __brand: "InstitutionalProfileId" };
export type SchoolGroupId = string & { readonly __brand: "SchoolGroupId" };
export type CampusId = string & { readonly __brand: "CampusId" };
export type PremisesId = string & { readonly __brand: "PremisesId" };
export type BuildingId = string & { readonly __brand: "BuildingId" };
export type FloorId = string & { readonly __brand: "FloorId" };
export type RoomId = string & { readonly __brand: "RoomId" };
export type ShiftId = string & { readonly __brand: "ShiftId" };
export type LanguageConfigId = string & { readonly __brand: "LanguageConfigId" };
export type TimezoneConfigId = string & { readonly __brand: "TimezoneConfigId" };

export function institutionId(raw: string): InstitutionId {
  return raw as InstitutionId;
}
export function institutionalProfileId(raw: string): InstitutionalProfileId {
  return raw as InstitutionalProfileId;
}
export function schoolGroupId(raw: string): SchoolGroupId {
  return raw as SchoolGroupId;
}
export function campusId(raw: string): CampusId {
  return raw as CampusId;
}
export function premisesId(raw: string): PremisesId {
  return raw as PremisesId;
}
export function buildingId(raw: string): BuildingId {
  return raw as BuildingId;
}
export function floorId(raw: string): FloorId {
  return raw as FloorId;
}
export function roomId(raw: string): RoomId {
  return raw as RoomId;
}
export function shiftId(raw: string): ShiftId {
  return raw as ShiftId;
}
export function languageConfigId(raw: string): LanguageConfigId {
  return raw as LanguageConfigId;
}
export function timezoneConfigId(raw: string): TimezoneConfigId {
  return raw as TimezoneConfigId;
}

/* ─────────────────────────────────────────────────────────────
 * Institution types (Section G) — configurable, not hard-coded
 * ────────────────────────────────────────────────────────────*/

export type InstitutionType =
  | "nursery"
  | "primary"
  | "secondary"
  | "senior_secondary"
  | "sixth_form"
  | "technical"
  | "vocational"
  | "college"
  | "university"
  | "polytechnic"
  | "teacher_training"
  | "religious"
  | "private"
  | "public"
  | "community"
  | "boarding"
  | "day"
  | "special_needs"
  | "examination_centre"
  | "education_network"
  | "custom";

export const INSTITUTION_TYPES: readonly InstitutionType[] = [
  "nursery",
  "primary",
  "secondary",
  "senior_secondary",
  "sixth_form",
  "technical",
  "vocational",
  "college",
  "university",
  "polytechnic",
  "teacher_training",
  "religious",
  "private",
  "public",
  "community",
  "boarding",
  "day",
  "special_needs",
  "examination_centre",
  "education_network",
  "custom",
] as const;

/** Is the institution type a known system type? Custom types are always allowed. */
export function isKnownInstitutionType(type: string): boolean {
  return (INSTITUTION_TYPES as readonly string[]).includes(type);
}

/* ─────────────────────────────────────────────────────────────
 * Ownership types (Section F)
 * ────────────────────────────────────────────────────────────*/

export type OwnershipType =
  | "private"
  | "public"
  | "government"
  | "faith_based"
  | "community"
  | "board_governed"
  | "network"
  | "custom";

export const OWNERSHIP_TYPES: readonly OwnershipType[] = [
  "private",
  "public",
  "government",
  "faith_based",
  "community",
  "board_governed",
  "network",
  "custom",
] as const;

/* ─────────────────────────────────────────────────────────────
 * Shift types (Section M)
 * ────────────────────────────────────────────────────────────*/

export type ShiftType =
  "morning" | "afternoon" | "evening" | "night" | "weekend" | "rotating" | "custom";

export const SHIFT_TYPES: readonly ShiftType[] = [
  "morning",
  "afternoon",
  "evening",
  "night",
  "weekend",
  "rotating",
  "custom",
] as const;

export interface InstitutionalShift {
  id: ShiftId;
  tenantId: TenantId;
  name: string;
  type: ShiftType;
  /** Local start/end times (institution local time), e.g. "07:30" / "13:30". */
  startTime: string;
  endTime: string;
  /** Whether this shift is currently active. */
  isActive: boolean;
}

/* ─────────────────────────────────────────────────────────────
 * Language configuration (Section O)
 * ────────────────────────────────────────────────────────────*/

export type LanguageRole = "default" | "user" | "regional" | "instructional" | "administrative";

export const LANGUAGE_ROLES: readonly LanguageRole[] = [
  "default",
  "user",
  "regional",
  "instructional",
  "administrative",
] as const;

export interface InstitutionalLanguage {
  id: LanguageConfigId;
  tenantId: TenantId;
  /** RFC 5646 / BCP 47 code, e.g. "en", "fr", "ig", "sw". */
  code: string;
  /** Display label in the institution's own language. */
  label: string;
  roles: LanguageRole[];
  isActive: boolean;
}

export function validateLanguageConfig(
  languages: InstitutionalLanguage[],
): { ok: true } | { ok: false; error: string } {
  if (languages.length === 0) {
    return { ok: false, error: "At least one institutional language is required" };
  }
  const defaults = languages.filter((l) => l.roles.includes("default") && l.isActive);
  if (defaults.length !== 1) {
    return { ok: false, error: "Exactly one active default institutional language is required" };
  }
  const codes = languages.map((l) => l.code);
  if (new Set(codes).size !== codes.length) {
    return { ok: false, error: "Duplicate language codes are not allowed" };
  }
  return { ok: true };
}

/* ─────────────────────────────────────────────────────────────
 * Timezone configuration (Section N)
 * ────────────────────────────────────────────────────────────*/

export interface InstitutionalTimezone {
  id: TimezoneConfigId;
  tenantId: TenantId;
  /** IANA timezone name, e.g. "Africa/Lagos". */
  ianaName: string;
  /** ISO-8601 offset like "+01:00" used for display fallback. */
  canonicalOffset: string;
  /** Whether this is the institution's default timezone. */
  isDefault: boolean;
  isActive: boolean;
}

export function validateTimezoneConfig(
  timezones: InstitutionalTimezone[],
): { ok: true } | { ok: false; error: string } {
  if (timezones.length === 0) {
    return { ok: false, error: "At least one institutional timezone is required" };
  }
  const defaults = timezones.filter((t) => t.isDefault && t.isActive);
  if (defaults.length !== 1) {
    return { ok: false, error: "Exactly one active default institutional timezone is required" };
  }
  const names = timezones.map((t) => t.ianaName);
  if (new Set(names).size !== names.length) {
    return { ok: false, error: "Duplicate timezone names are not allowed" };
  }
  return { ok: true };
}

/* ─────────────────────────────────────────────────────────────
 * Location hierarchy (Sections J, K, L)
 * Institution → Campus → Premises → Building → Floor → Room → Resource
 * ────────────────────────────────────────────────────────────*/

export interface Campus {
  id: CampusId;
  institutionId: InstitutionId;
  tenantId: TenantId;
  name: string;
  /** Physical address summary. */
  location: string;
  timezoneId: TimezoneConfigId | null;
  languageId: LanguageConfigId | null;
  isActive: boolean;
}

export interface Premises {
  id: PremisesId;
  campusId: CampusId;
  tenantId: TenantId;
  name: string;
  kind: string;
  isActive: boolean;
}

export interface Building {
  id: BuildingId;
  premisesId: PremisesId;
  tenantId: TenantId;
  name: string;
  isActive: boolean;
}

export interface Floor {
  id: FloorId;
  buildingId: BuildingId;
  tenantId: TenantId;
  label: string;
  index: number;
  isActive: boolean;
}

export interface Room {
  id: RoomId;
  floorId: FloorId;
  tenantId: TenantId;
  name: string;
  /** Room kind: classroom, laboratory, library, office, hall, dormitory, clinic… */
  kind: string;
  capacity: number;
  isActive: boolean;
}

export function createCampus(input: {
  id: CampusId;
  institutionId: InstitutionId;
  tenantId: TenantId;
  name: string;
  location: string;
  timezoneId?: TimezoneConfigId | null;
  languageId?: LanguageConfigId | null;
}): Campus {
  if (!input.name.trim()) {
    throw new Error("Campus name is required");
  }
  return {
    id: input.id,
    institutionId: input.institutionId,
    tenantId: input.tenantId,
    name: input.name.trim(),
    location: input.location.trim(),
    timezoneId: input.timezoneId ?? null,
    languageId: input.languageId ?? null,
    isActive: true,
  };
}

export function createRoom(input: {
  id: RoomId;
  floorId: FloorId;
  tenantId: TenantId;
  name: string;
  kind: string;
  capacity: number;
}): Room {
  if (!input.name.trim()) {
    throw new Error("Room name is required");
  }
  if (input.capacity < 1) {
    throw new Error("Room capacity must be positive");
  }
  return {
    id: input.id,
    floorId: input.floorId,
    tenantId: input.tenantId,
    name: input.name.trim(),
    kind: input.kind.trim(),
    capacity: input.capacity,
    isActive: true,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Institutional profile (Section F)
 * ────────────────────────────────────────────────────────────*/

export interface InstitutionalProfile {
  id: InstitutionalProfileId;
  institutionId: InstitutionId;
  tenantId: TenantId;
  legalName: string;
  displayName: string;
  institutionType: InstitutionType;
  ownershipType: OwnershipType;
  /** Registration identifiers (config-driven). */
  registrationRefs: string[];
  /** Accreditation identifiers (config-driven). */
  accreditationRefs: string[];
  country: string;
  region: string | null;
  stateProvince: string | null;
  localGovernmentArea: string | null;
  /** Official email domains — used to validate institutional staff addresses. */
  officialEmailDomains: string[];
  website: string | null;
  /** Default currency, e.g. "NGN", "GHS", "KES". */
  currency: string;
  /** Operating days, e.g. ["monday", "tuesday"]. Empty = configurable by campus. */
  operatingDays: string[];
  operatingHours: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────────────────────────────────────────────────
 * School groups (Section I)
 * ────────────────────────────────────────────────────────────*/

export interface SchoolGroup {
  id: SchoolGroupId;
  tenantId: TenantId;
  name: string;
  institutionIds: InstitutionId[];
  isActive: boolean;
}

export function addInstitutionToGroup(
  group: SchoolGroup,
  target: InstitutionId,
): { ok: true; group: SchoolGroup } | { ok: false; error: string } {
  if (group.institutionIds.includes(target)) {
    return { ok: false, error: "Institution is already a member of this group" };
  }
  return { ok: true, group: { ...group, institutionIds: [...group.institutionIds, target] } };
}

/* ─────────────────────────────────────────────────────────────
 * Institution entity + creation model (Sections D, E, AE)
 * ────────────────────────────────────────────────────────────*/

export interface Institution {
  id: InstitutionId;
  tenantId: TenantId;
  /** Reference to the institutional profile. */
  profileId: InstitutionalProfileId;
  /** Reference to the institution's Phase 02 identity. */
  identityRef: string;
  /** Reference to the default administrative policy set (Phase 08 policy lifecycle). */
  defaultPolicySetRef: string;
  /** Reference to the initial administrator identity (Section AE). */
  initialAdministratorRef: string;
  /** School group membership. */
  groupId: SchoolGroupId | null;
  /** Whether institution creation is complete. */
  setupComplete: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInstitutionInput {
  id: InstitutionId;
  tenantId: TenantId;
  profile: Omit<
    InstitutionalProfile,
    "id" | "institutionId" | "tenantId" | "createdAt" | "updatedAt"
  >;
  /** Phase 02 identity reference for the institution itself. */
  identityRef: string;
  /** Phase 08 security-policy reference for the default administrative policy set. */
  defaultPolicySetRef: string;
  /** Phase 02 identity reference for the initial administrator (Section AE). */
  initialAdministratorRef: string;
  now?: string;
}

export type CreateInstitutionResult =
  | { ok: true; institution: Institution; profile: InstitutionalProfile }
  | { ok: false; error: string };

/**
 * Institution creation (Section D). The CoreGrid platform team creates an institution;
 * the initial administrator becomes the primary administrative authority subject to
 * platform-level controls (Section E). An institution cannot be created without a
 * legal name, an official email domain, a country, and an initial administrator.
 */
export function createInstitution(
  input: CreateInstitutionInput,
  now: string = timeAuthority.now().at,
): CreateInstitutionResult {
  const legalName = input.profile.legalName.trim();
  if (legalName === "") {
    return { ok: false, error: "Legal name is required" };
  }
  if (!isKnownInstitutionType(input.profile.institutionType)) {
    return { ok: false, error: `Unknown institution type: ${input.profile.institutionType}` };
  }
  if (!input.profile.country.trim()) {
    return { ok: false, error: "Country is required" };
  }
  if (input.profile.officialEmailDomains.length === 0) {
    return { ok: false, error: "At least one official email domain is required" };
  }
  if (!input.profile.currency.trim()) {
    return { ok: false, error: "Currency is required" };
  }
  if (input.initialAdministratorRef.trim() === "") {
    return { ok: false, error: "An initial administrator is required (Section AE)" };
  }
  if (input.defaultPolicySetRef.trim() === "") {
    return { ok: false, error: "A default administrative policy set is required (Section D)" };
  }

  const profile: InstitutionalProfile = {
    id: institutionalProfileId(`iprof-${input.id}`),
    institutionId: input.id,
    tenantId: input.tenantId,
    ...input.profile,
    createdAt: now,
    updatedAt: now,
  };

  const institution: Institution = {
    id: input.id,
    tenantId: input.tenantId,
    profileId: profile.id,
    identityRef: input.identityRef,
    defaultPolicySetRef: input.defaultPolicySetRef,
    initialAdministratorRef: input.initialAdministratorRef,
    groupId: null,
    setupComplete: false,
    createdAt: now,
    updatedAt: now,
  };

  return { ok: true, institution, profile };
}

/** Mark an institution's initial setup as complete. */
export function markInstitutionSetupComplete(
  institution: Institution,
  now: string = timeAuthority.now().at,
): Institution {
  return { ...institution, setupComplete: true, updatedAt: now };
}

/* ─────────────────────────────────────────────────────────────
 * African Education Complexity Model (Section H)
 * Configuration-driven operational flags.
 * ────────────────────────────────────────────────────────────*/

export interface EducationComplexityConfig {
  institutionId: InstitutionId;
  tenantId: TenantId;
  /** Support for intermittent connectivity and offline-first workflows. */
  intermittentConnectivity: boolean;
  /** Support for shared devices. */
  sharedDevices: boolean;
  /** Support for bring-your-own-device. */
  byod: boolean;
  /** Mobile-first workflows. */
  mobileFirst: boolean;
  /** Multiple academic sessions per year. */
  multipleAcademicSessions: boolean;
  /** House systems. */
  houseSystem: boolean;
  /** Prefect systems. */
  prefectSystem: boolean;
  /** Boarding structures. */
  boarding: boolean;
  /** Day structures. */
  dayOnly: boolean;
  /** Paper-to-digital migration mode. */
  paperToDigitalMigration: boolean;
  /** Varying staff technology literacy — enable progressive complexity. */
  mixedDigitalMaturity: boolean;
}

export const DEFAULT_EDUCATION_COMPLEXITY_CONFIG: Omit<
  EducationComplexityConfig,
  "institutionId" | "tenantId"
> = {
  intermittentConnectivity: false,
  sharedDevices: false,
  byod: false,
  mobileFirst: false,
  multipleAcademicSessions: false,
  houseSystem: false,
  prefectSystem: false,
  boarding: false,
  dayOnly: false,
  paperToDigitalMigration: false,
  mixedDigitalMaturity: false,
};
