/**
 * Organization public sections.
 *
 * The organization site is generic. Education-only sections render only when
 * the education runtime is installed. They are not the default shape of every
 * organization.
 */

export const EDUCATION_PUBLIC_SECTION_IDS = ["academics", "admissions-cta"] as const;

export type EducationPublicSectionId = (typeof EDUCATION_PUBLIC_SECTION_IDS)[number];

export function isEducationPublicSection(id: string): boolean {
  return (EDUCATION_PUBLIC_SECTION_IDS as readonly string[]).includes(id);
}

export function filterOrganizationPublicSections<T extends { id: string }>(
  sections: readonly T[],
  options: { educationRuntime: boolean },
): T[] {
  if (options.educationRuntime) return [...sections];
  return sections.filter((section) => !isEducationPublicSection(section.id));
}
