import { createFileRoute } from "@tanstack/react-router";
import { PLATFORM_NAME, PLATFORM_TAGLINE } from "@/lib/platform";
import {
  COMPANY_LOCATION_LINE,
  COMPANY_MISSION,
  COMPANY_VISION,
  LEGAL_ENTITY_NAME,
  POSITIONING_PROGRAMMABLE,
  POSITIONING_RETHINKING,
  POSITIONING_STATEMENT,
} from "@/lib/public-site/company";
import { publicHead } from "@/lib/public-site/seo";
import { MarketingPage } from "@/components/public/marketing-page";
import { PageContainer, PublicButton, Section } from "@/components/public/ui";

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
        <PageContainer className="max-w-3xl space-y-4 py-16 text-sm leading-relaxed text-sherivs-muted sm:text-base">
          <h2 id="about-body" className="sr-only">
            About Sherivs
          </h2>
          <p>
            The public brand and customer-facing product are Sherivs. {LEGAL_ENTITY_NAME} is the
            company that operates them. We are based in {COMPANY_LOCATION_LINE}. This page does not
            invent a street address, telephone number, or registration identifier.
          </p>
          <p>{POSITIONING_RETHINKING}</p>
          <p>{POSITIONING_PROGRAMMABLE}</p>
          <p>
            <span className="font-medium text-sherivs-white">Mission.</span> {COMPANY_MISSION}
          </p>
          <p>
            <span className="font-medium text-sherivs-white">Vision.</span> {COMPANY_VISION}
          </p>
          <p>
            Education is an important domain — the first installed runtime is Scholar — but the
            platform is intended for a broader range of institutions. It is not a chatbot, a
            generic SaaS template, or a model marketplace. Directional language on this site
            (“is building”, “is developing”) describes the work in progress, not a claim that every
            capability is generally available today.
          </p>
          <p className="font-medium text-sherivs-white">{PLATFORM_TAGLINE}.</p>
          <div className="flex flex-wrap gap-3 pt-4">
            <PublicButton href="/request-demo">Request a demo</PublicButton>
            <PublicButton href="/contact" variant="secondary">
              Contact us
            </PublicButton>
          </div>
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
