import { createFileRoute } from "@tanstack/react-router";
import { PLATFORM_NAME, PLATFORM_TAGLINE } from "@/lib/platform";
import {
  ACCEPTING_CUSTOMERS,
  COMPANY_LOCATION_LINE,
  LEGAL_ENTITY_NAME,
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
      description:
        "Sherivs Technologies Limited builds Sherivs, an AI-native institutional computing platform, from Maiduguri, Borno State, Nigeria.",
      path: "/about",
    }),
});

function AboutPage() {
  return (
    <MarketingPage
      eyebrow="About"
      title={PLATFORM_NAME}
      lead={`${LEGAL_ENTITY_NAME} builds Sherivs — an AI-native institutional computing platform designed to connect people, organizations, AI agents, and digital twins through a shared, governed environment.`}
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
          <p>
            Organizations deserve an operating environment that understands how they actually work:
            identity, records, workflows, and intelligence in one governed place. Education is an
            important domain — the first installed runtime is Scholar — but the platform is
            intended for a broader range of institutions. It is not a chatbot, a generic SaaS
            template, or a model marketplace.
          </p>
          {ACCEPTING_CUSTOMERS ? (
            <p>
              Sherivs is accepting customers. New organizations currently onboard onto Scholar.
              Request a demonstration if you want a walkthrough of what is available today versus
              what remains in development.
            </p>
          ) : null}
          <p className="font-medium text-sherivs-white">{PLATFORM_TAGLINE}</p>
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
