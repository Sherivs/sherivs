/**
 * Public school marketing site — composer.
 *
 * Renders the per-tenant navbar + footer plus every enabled section.
 * Section bodies live in ./sections.tsx, shared atoms in ./_shared.tsx.
 */
import type { SchoolRow } from "@/contexts/app-context";
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
        {on("section_admissions_enabled" as keyof SchoolRow) && (
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
