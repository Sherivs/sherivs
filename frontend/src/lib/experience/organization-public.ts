/**
 * Organization public experience engine (domain-neutral).
 *
 * A customer organization's public website is not the Sherivs marketing site.
 * This module defines the generic section catalog and composition contract.
 * Runtime-specific sections (for example education admissions) are contributed
 * by the installed runtime — they are never hardcoded as the default IA.
 *
 * Backend authorization and tenant resolution remain mandatory. This module
 * only decides which public sections are eligible to render.
 */

export type OrganizationPublicSectionId =
  | "identity"
  | "hero"
  | "about"
  | "services"
  | "locations"
  | "leadership"
  | "people"
  | "departments"
  | "events"
  | "announcements"
  | "resources"
  | "documents"
  | "public-forms"
  | "contact"
  | "careers"
  | "news"
  | "media"
  | "accessibility"
  | "policies"
  | "footer";

export type RuntimePublicSectionId = string;

export interface OrganizationPublicSection {
  readonly id: OrganizationPublicSectionId | RuntimePublicSectionId;
  readonly title: string;
  readonly enabled: boolean;
  readonly source: "platform" | "runtime";
  readonly runtimeId?: string;
}

export interface OrganizationPublicIdentity {
  readonly name: string;
  readonly tagline: string | null;
  readonly logoUrl: string | null;
  readonly primaryColor: string | null;
  readonly secondaryColor: string | null;
}

export interface OrganizationPublicExperience {
  readonly identity: OrganizationPublicIdentity;
  readonly runtimeId: string | null;
  readonly sections: readonly OrganizationPublicSection[];
}

export const UNIVERSAL_PUBLIC_SECTION_CATALOG: readonly Omit<
  OrganizationPublicSection,
  "enabled"
>[] = [
  { id: "identity", title: "Identity", source: "platform" },
  { id: "hero", title: "Hero", source: "platform" },
  { id: "about", title: "About", source: "platform" },
  { id: "services", title: "Services", source: "platform" },
  { id: "locations", title: "Locations", source: "platform" },
  { id: "leadership", title: "Leadership", source: "platform" },
  { id: "people", title: "People", source: "platform" },
  { id: "departments", title: "Departments", source: "platform" },
  { id: "events", title: "Events", source: "platform" },
  { id: "announcements", title: "Announcements", source: "platform" },
  { id: "resources", title: "Resources", source: "platform" },
  { id: "documents", title: "Documents", source: "platform" },
  { id: "public-forms", title: "Public forms", source: "platform" },
  { id: "contact", title: "Contact", source: "platform" },
  { id: "careers", title: "Careers", source: "platform" },
  { id: "news", title: "News", source: "platform" },
  { id: "media", title: "Media", source: "platform" },
  { id: "accessibility", title: "Accessibility", source: "platform" },
  { id: "policies", title: "Policies", source: "platform" },
  { id: "footer", title: "Footer", source: "platform" },
];

export interface RuntimePublicContribution {
  readonly runtimeId: string;
  readonly sections: readonly Omit<OrganizationPublicSection, "enabled" | "source">[];
}

export function composeOrganizationPublicExperience(input: {
  identity: OrganizationPublicIdentity;
  runtimeId: string | null;
  enabledFlags: Readonly<Record<string, boolean | undefined>>;
  runtimeContributions?: readonly RuntimePublicContribution[];
}): OrganizationPublicExperience {
  const runtimeSections =
    input.runtimeId == null
      ? []
      : (input.runtimeContributions ?? [])
          .filter((contribution) => contribution.runtimeId === input.runtimeId)
          .flatMap((contribution) =>
            contribution.sections.map((section) => ({
              ...section,
              source: "runtime" as const,
              runtimeId: contribution.runtimeId,
              enabled: input.enabledFlags[section.id] !== false,
            })),
          );

  const platformSections = UNIVERSAL_PUBLIC_SECTION_CATALOG.map((section) => ({
    ...section,
    enabled: input.enabledFlags[section.id] !== false,
  }));

  return {
    identity: input.identity,
    runtimeId: input.runtimeId,
    sections: [...platformSections, ...runtimeSections],
  };
}

export function enabledSectionIds(experience: OrganizationPublicExperience): string[] {
  return experience.sections.filter((section) => section.enabled).map((section) => section.id);
}
