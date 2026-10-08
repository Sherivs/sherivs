/**
 * Organization public experience engine.
 *
 * This is NOT the Sherivs marketing site. It composes a customer organization's
 * public presence from identity + enabled sections. Scholar-specific sections
 * load only when the Scholar runtime is the active public runtime.
 *
 * Version-target: V1. Does not invent school-only IA for non-education orgs.
 */
export type OrgPublicRuntime = "none" | "scholar";

export type OrgPublicSectionId =
  | "identity"
  | "hero"
  | "about"
  | "programs"
  | "people"
  | "events"
  | "announcements"
  | "resources"
  | "contact"
  | "policies"
  | "admissions"
  | "faculty"
  | "facilities"
  | "gallery";

export interface OrgPublicSection {
  readonly id: OrgPublicSectionId;
  readonly label: string;
  readonly runtime: OrgPublicRuntime | "any";
  readonly enabled: boolean;
}

export interface OrgPublicExperience {
  readonly runtime: OrgPublicRuntime;
  readonly orgName: string;
  readonly sections: readonly OrgPublicSection[];
}

export interface OrgPublicInput {
  readonly orgName: string;
  readonly runtime: OrgPublicRuntime;
  readonly flags: Readonly<Record<string, boolean | undefined>>;
}

function flag(flags: OrgPublicInput["flags"], key: string, fallback = true): boolean {
  return flags[key] !== false;
}

/**
 * Resolve the public section list. Generic sections always may appear.
 * Scholar sections (admissions, faculty, facilities) require runtime:scholar.
 */
export function resolveOrgPublicExperience(input: OrgPublicInput): OrgPublicExperience {
  const scholar = input.runtime === "scholar";
  const sections: OrgPublicSection[] = [
    { id: "identity", label: "Identity", runtime: "any", enabled: true },
    { id: "hero", label: "Hero", runtime: "any", enabled: true },
    { id: "about", label: "About", runtime: "any", enabled: flag(input.flags, "section_about_enabled") },
    { id: "programs", label: "Programs", runtime: "any", enabled: flag(input.flags, "section_programs_enabled") },
    { id: "people", label: "People", runtime: "any", enabled: flag(input.flags, "section_faculty_enabled") },
    {
      id: "faculty",
      label: "Faculty",
      runtime: "scholar",
      enabled: scholar && flag(input.flags, "section_faculty_enabled"),
    },
    {
      id: "facilities",
      label: "Facilities",
      runtime: "scholar",
      enabled: scholar && flag(input.flags, "section_facilities_enabled"),
    },
    {
      id: "admissions",
      label: "Admissions",
      runtime: "scholar",
      enabled: scholar && flag(input.flags, "section_admissions_enabled"),
    },
    { id: "gallery", label: "Gallery", runtime: "any", enabled: true },
    { id: "events", label: "Events", runtime: "any", enabled: flag(input.flags, "section_news_enabled") },
    { id: "announcements", label: "Announcements", runtime: "any", enabled: flag(input.flags, "section_news_enabled") },
    { id: "resources", label: "Resources", runtime: "any", enabled: flag(input.flags, "section_blog_enabled") },
    { id: "contact", label: "Contact", runtime: "any", enabled: flag(input.flags, "section_contact_enabled") },
    { id: "policies", label: "Policies", runtime: "any", enabled: true },
  ];

  return {
    runtime: input.runtime,
    orgName: input.orgName,
    sections: sections.filter((section) => section.enabled && (section.runtime === "any" || section.runtime === input.runtime)),
  };
}
