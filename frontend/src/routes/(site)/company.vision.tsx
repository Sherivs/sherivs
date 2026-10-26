import { createFileRoute } from "@tanstack/react-router";
import {
  COMPANY_MISSION,
  COMPANY_VISION,
  POSITIONING_FOUNDATIONS,
  POSITIONING_PROGRAMMABLE,
  POSITIONING_RETHINKING,
  POSITIONING_STATEMENT,
} from "@/lib/public-site/company";
import { publicHead } from "@/lib/public-site/seo";
import { MarketingPage } from "@/components/public/marketing-page";
import { PageContainer, Section } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/company/vision")({
  component: VisionPage,
  head: () =>
    publicHead({
      title: "Vision and mission",
      description: COMPANY_VISION,
      path: "/company/vision",
    }),
});

function VisionPage() {
  return (
    <MarketingPage
      eyebrow="Company"
      title="Vision and mission"
      lead={COMPANY_VISION}
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/about", label: "Company" },
        { href: "/company/vision", label: "Vision" },
      ]}
    >
      <Section labelledBy="mission-heading">
        <PageContainer className="max-w-3xl space-y-8 py-16 text-sm leading-relaxed text-sherivs-muted sm:text-base">
          <div className="space-y-3">
            <h2 id="mission-heading" className="font-display text-xl font-semibold text-sherivs-white">
              Mission
            </h2>
            <p>{COMPANY_MISSION}</p>
          </div>
          <div className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-sherivs-white">Vision</h2>
            <p>{COMPANY_VISION}</p>
            <p>{POSITIONING_PROGRAMMABLE}</p>
          </div>
          <div className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-sherivs-white">How we think about it</h2>
            <p>{POSITIONING_STATEMENT}</p>
            <p>{POSITIONING_RETHINKING}</p>
            <p>{POSITIONING_FOUNDATIONS}</p>
          </div>
          <p>
            We distinguish that ambition from the current product. Education through Scholar can be
            used today. Other runtimes, a public developer platform, and a complete twin runtime are
            not claimed as generally available. Unlimited autonomous execution is not offered.
          </p>
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
