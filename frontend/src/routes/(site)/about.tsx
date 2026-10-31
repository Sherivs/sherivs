import { createFileRoute } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import {
  COMPANY_LOCATION_LINE,
  LEGAL_ENTITY_NAME,
  POSITIONING_PROGRAMMABLE,
  POSITIONING_RETHINKING,
  POSITIONING_STATEMENT,
  PRODUCT_NAME,
  PUBLIC_EDITORIAL_APPROACH,
  PUBLIC_EDITORIAL_MISSION,
  PUBLIC_EDITORIAL_VISION,
} from "@/lib/public-site/company";
import { publicHead } from "@/lib/public-site/seo";
import { MarketingPage } from "@/components/public/marketing-page";
import { GlassPanel, PageContainer, PublicButton, Section } from "@/components/public/ui";

/**
 * Public About page — owner-provided company facts only. No fabricated
 * history, customers, headcount, street addresses, or certifications.
 */

export const Route = createFileRoute("/(site)/about")({
  component: AboutPage,
  head: () =>
    publicHead({
      title: `About — ${PLATFORM_NAME}`,
      description: POSITIONING_STATEMENT,
      path: "/about",
    }),
});

function AboutPage() {
  return (
    <MarketingPage
      eyebrow="About"
      title={PLATFORM_NAME}
      lead={POSITIONING_STATEMENT}
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/about", label: "About" },
      ]}
    >
      <Section labelledBy="about-body">
        <PageContainer className="py-16">
          <GlassPanel className="mx-auto max-w-3xl space-y-4 text-sm leading-relaxed text-sherivs-muted sm:text-base">
            <h2 id="about-body" className="sr-only">
              About Sherivs
            </h2>
            <p>
              The public brand is Sherivs. {PRODUCT_NAME} is the first product. {LEGAL_ENTITY_NAME}{" "}
              is the company that operates them. We are based in {COMPANY_LOCATION_LINE}. This page
              does not invent a street address, telephone number, or registration identifier.
            </p>
            <p>{POSITIONING_RETHINKING}</p>
            <p>{POSITIONING_PROGRAMMABLE}</p>
            <p>
              <span className="font-medium text-[var(--sherivs-ink)]">Mission.</span>{" "}
              {PUBLIC_EDITORIAL_MISSION}
            </p>
            <p>
              <span className="font-medium text-[var(--sherivs-ink)]">Vision.</span>{" "}
              {PUBLIC_EDITORIAL_VISION}
            </p>
            <p>
              <span className="font-medium text-[var(--sherivs-ink)]">Our approach.</span>{" "}
              {PUBLIC_EDITORIAL_APPROACH}
            </p>
            <div className="flex flex-wrap gap-3 pt-4">
              <PublicButton href="/onboarding">Get started</PublicButton>
              <PublicButton href="/contact" variant="secondary">
                Contact us
              </PublicButton>
            </div>
          </GlassPanel>
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
