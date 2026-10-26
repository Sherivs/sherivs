import { createFileRoute } from "@tanstack/react-router";
import { PLATFORM_NAME, PLATFORM_TAGLINE } from "@/lib/platform";
import { publicHead } from "@/lib/public-site/seo";
import { MarketingPage } from "@/components/public/marketing-page";
import { PageContainer, PublicButton, Section } from "@/components/public/ui";

/**
 * Public About page — truthful company information only. No fabricated
 * history, customers, headcount, offices, or certifications.
 */

export const Route = createFileRoute("/(site)/about")({
  component: AboutPage,
  head: () =>
    publicHead({
      title: `About — ${PLATFORM_NAME}`,
      description:
        "Sherivs is an enterprise technology company building intelligent operating infrastructure for organizations.",
      path: "/about",
    }),
});

function AboutPage() {
  return (
    <MarketingPage
      eyebrow="About"
      title={PLATFORM_NAME}
      lead="Sherivs is an enterprise technology company building intelligent operating infrastructure for organizations."
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
            We believe organizations deserve an operating environment that understands how they
            actually work: one place where people, knowledge, workflows, communications, and data
            live together — where an AI workforce operates inside defined responsibilities and
            verification boundaries, and where operations continuously improve on evidence rather
            than intuition.
          </p>
          <p>
            Sherivs adapts to industries through domain runtimes — complete operating experiences
            built on the same platform. The first is Sherivs Scholar, our education runtime.
          </p>
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
