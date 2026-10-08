/**
 * Public school marketing site — composer.
 *
 * Renders the per-tenant navbar + footer plus every enabled section.
 * Section bodies live in ./sections.tsx, shared atoms in ./_shared.tsx.
 */
import type { SchoolRow } from "@/contexts/app-context";
import { composeOrganizationPublicExperience } from "@/lib/experience/organization-public";
import { INSTALLED_RUNTIME_ID } from "@/lib/runtime/installed-runtimes";
import { SCHOLAR_PUBLIC_SECTION_CONTRIBUTION } from "@/lib/scholar/experience/organization-public-scholar";
import { Navbar, Footer, useSocialLinks } from "./_shared";
import {
  HeroSection,
  AboutSection,
  WhyUsSection,
  ProgramsSection,
  FacilitiesSection,
  SportsSection,
  MealsSection,
  TransportSection,
  StaffSection,
  NewsEventsSection,
  TestimonialsSection,
  BlogSection,
  AdmissionsCtaSection,
  FaqsSection,
  ContactSection,
  FindUsMapSection,
  GallerySection,
} from "./sections";

export function PublicSchoolSite({ school }: { school: SchoolRow }) {
  const socials = useSocialLinks(school);
  const on = (k: keyof SchoolRow) => school[k] !== false;
  const experience = composeOrganizationPublicExperience({
    identity: {
      name: school.name,
      tagline: (school.motto as string | null) ?? null,
      logoUrl: (school.logo_url as string | null) ?? null,
      primaryColor: (school.primary_color as string | null) ?? null,
      secondaryColor: (school.secondary_color as string | null) ?? null,
    },
    runtimeId: INSTALLED_RUNTIME_ID,
    enabledFlags: {
      about: on("section_about_enabled" as keyof SchoolRow),
      services: on("section_programs_enabled" as keyof SchoolRow),
      people: on("section_faculty_enabled" as keyof SchoolRow),
      events: on("section_news_enabled" as keyof SchoolRow),
      news: on("section_news_enabled" as keyof SchoolRow),
      contact: on("section_contact_enabled" as keyof SchoolRow),
      admissions: on("section_admissions_enabled" as keyof SchoolRow),
    },
    runtimeContributions: [SCHOLAR_PUBLIC_SECTION_CONTRIBUTION],
  });
  const scholarRuntime = experience.runtimeId === "runtime:scholar";
  return (
    <div className="relative min-h-dvh bg-[#0a0f1e] text-white">
      <Navbar school={school} socials={socials} />
      <main id="main-content" className="public-sections">
        <HeroSection school={school} />
        {on("section_about_enabled" as keyof SchoolRow) && <AboutSection school={school} />}
        {on("section_why_us_enabled" as keyof SchoolRow) && <WhyUsSection school={school} />}
        {on("section_programs_enabled" as keyof SchoolRow) && <ProgramsSection school={school} />}
        {on("section_facilities_enabled" as keyof SchoolRow) && (
          <FacilitiesSection school={school} />
        )}
        {on("section_facilities_enabled" as keyof SchoolRow) && <SportsSection school={school} />}
        {on("section_facilities_enabled" as keyof SchoolRow) && <MealsSection school={school} />}
        {on("section_facilities_enabled" as keyof SchoolRow) && (
          <TransportSection school={school} />
        )}
        {on("section_faculty_enabled" as keyof SchoolRow) && <StaffSection school={school} />}
        <GallerySection school={school} />
        {on("section_news_enabled" as keyof SchoolRow) && <NewsEventsSection school={school} />}
        {on("section_testimonials_enabled" as keyof SchoolRow) && (
          <TestimonialsSection school={school} />
        )}
        {on("section_blog_enabled" as keyof SchoolRow) && <BlogSection school={school} />}
        {scholarRuntime && on("section_admissions_enabled" as keyof SchoolRow) && (
          <AdmissionsCtaSection school={school} />
        )}
        {on("section_faqs_enabled" as keyof SchoolRow) && <FaqsSection school={school} />}
        {on("section_contact_enabled" as keyof SchoolRow) && <ContactSection school={school} />}
        <FindUsMapSection school={school} />
      </main>
      <Footer school={school} socials={socials} />
    </div>
  );
}
