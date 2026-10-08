/**
 * CoreGrid Scholar — Experience engine: catalog (data).
 *
 * Public digital presence and internal application are GENERATED from an
 * organization's reality. This module is the data behind that generation:
 * which sections exist, which components they bundle, which reality gives a
 * section a home, and who may see it. Nothing here branches on institution type.
 */

import type { RoleWorkspaceKey } from "../roles/role-workspaces";

export const EXPERIENCE_AUDIENCES = [
  "public_visitor",
  "parent",
  "student",
  "teacher",
  "leadership",
  "staff",
  "regulator",
] as const;
export type ExperienceAudience = (typeof EXPERIENCE_AUDIENCES)[number];

export const SITE_SECTIONS = [
  "home",
  "about",
  "leadership",
  "admissions",
  "programs",
  "curriculum",
  "departments",
  "campus",
  "facilities",
  "student_life",
  "boarding_life",
  "religious_life",
  "skills_training",
  "agriculture",
  "news",
  "events",
  "gallery",
  "contact",
  "parent_portal",
  "student_portal",
] as const;
export type SiteSection = (typeof SITE_SECTIONS)[number];

export const SITE_COMPONENTS = [
  "hero",
  "programme_display",
  "campus_display",
  "staff_directory",
  "admission_form",
  "event_calendar",
  "news_feed",
  "gallery",
  "facilities_display",
  "curriculum_display",
  "ai_assistant",
  "contact_system",
  "application_portal",
] as const;
export type SiteComponent = (typeof SITE_COMPONENTS)[number];

export interface SectionTemplate {
  section: SiteSection;
  label: string;
  order: number;
  components: readonly SiteComponent[];
  /** Existing institution feature keys that give the section a home. */
  featureKeys?: readonly string[];
  /** Existing institution template ids the section belongs to. */
  templateRefs?: readonly string[];
  /** Audiences allowed to see the section (public_visitor = marketing site). */
  audiences: readonly ExperienceAudience[];
  /** Section content is authored or proposed and needs human approval to publish. */
  requiresApproval?: boolean;
}

const PUBLIC: readonly ExperienceAudience[] = [
  "public_visitor",
  "parent",
  "student",
  "teacher",
  "leadership",
  "staff",
  "regulator",
];

export const SECTION_TEMPLATES: readonly SectionTemplate[] = [
  {
    section: "home",
    label: "Home",
    order: 10,
    components: ["hero", "programme_display", "news_feed", "ai_assistant"],
    audiences: PUBLIC,
  },
  { section: "about", label: "About", order: 20, components: ["hero"], audiences: PUBLIC },
  {
    section: "leadership",
    label: "Leadership",
    order: 30,
    components: ["staff_directory"],
    audiences: PUBLIC,
  },
  {
    section: "admissions",
    label: "Admissions",
    order: 40,
    components: ["admission_form", "application_portal"],
    featureKeys: ["curriculum.core"],
    audiences: PUBLIC,
    requiresApproval: true,
  },
  {
    section: "programs",
    label: "Programmes",
    order: 50,
    components: ["programme_display"],
    featureKeys: ["curriculum.core"],
    audiences: PUBLIC,
  },
  {
    section: "curriculum",
    label: "Curriculum",
    order: 60,
    components: ["curriculum_display"],
    featureKeys: ["curriculum.core"],
    audiences: PUBLIC,
  },
  {
    section: "departments",
    label: "Departments",
    order: 70,
    components: ["staff_directory"],
    featureKeys: ["curriculum.core"],
    audiences: PUBLIC,
  },
  {
    section: "campus",
    label: "Campus",
    order: 80,
    components: ["campus_display"],
    featureKeys: ["curriculum.core", "site.multi_campus"],
    audiences: PUBLIC,
  },
  {
    section: "facilities",
    label: "Facilities",
    order: 90,
    components: ["facilities_display", "gallery"],
    audiences: PUBLIC,
  },
  {
    section: "student_life",
    label: "Student life",
    order: 100,
    components: ["gallery", "news_feed"],
    featureKeys: ["curriculum.core"],
    audiences: PUBLIC,
  },
  {
    section: "boarding_life",
    label: "Boarding life",
    order: 110,
    components: ["gallery", "news_feed"],
    featureKeys: ["schedule.boarding"],
    templateRefs: ["boarding_school"],
    audiences: PUBLIC,
    requiresApproval: true,
  },
  {
    section: "religious_life",
    label: "Faith & values",
    order: 120,
    components: ["news_feed", "gallery"],
    featureKeys: ["curriculum.religious"],
    templateRefs: ["religious_christian", "islamic_madrassa"],
    audiences: PUBLIC,
    requiresApproval: true,
  },
  {
    section: "skills_training",
    label: "Skills training",
    order: 130,
    components: ["programme_display", "facilities_display"],
    featureKeys: ["curriculum.vocational", "curriculum.technical"],
    templateRefs: ["vocational_tvet", "technical_institute"],
    audiences: PUBLIC,
  },
  {
    section: "agriculture",
    label: "Agriculture",
    order: 140,
    components: ["programme_display", "gallery"],
    featureKeys: ["curriculum.agricultural"],
    templateRefs: ["agricultural_school"],
    audiences: PUBLIC,
  },
  {
    section: "news",
    label: "News",
    order: 150,
    components: ["news_feed"],
    audiences: PUBLIC,
  },
  {
    section: "events",
    label: "Events",
    order: 160,
    components: ["event_calendar"],
    audiences: PUBLIC,
  },
  { section: "gallery", label: "Gallery", order: 170, components: ["gallery"], audiences: PUBLIC },
  {
    section: "contact",
    label: "Contact",
    order: 180,
    components: ["contact_system"],
    audiences: PUBLIC,
  },
  {
    section: "parent_portal",
    label: "Parent portal",
    order: 190,
    components: ["application_portal"],
    audiences: ["parent", "leadership", "staff"],
  },
  {
    section: "student_portal",
    label: "Student portal",
    order: 200,
    components: ["application_portal"],
    audiences: ["student", "leadership", "staff", "parent"],
  },
];

/** Internal application workspaces are the role engine's workspace keys. */
export type AppWorkspaceKey = RoleWorkspaceKey;
