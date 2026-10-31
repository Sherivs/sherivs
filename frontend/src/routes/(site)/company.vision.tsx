import { createFileRoute } from "@tanstack/react-router";
import {
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
import { GlassPanel, PageContainer, Section } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/company/vision")({
  component: VisionPage,
  head: () =>
    publicHead({
      title: "Vision and mission",
      description: PUBLIC_EDITORIAL_VISION,
      path: "/company/vision",
    }),
});

function VisionPage() {
  return (
    <MarketingPage
      eyebrow="Company"
      title="Vision and mission"
      lead={PUBLIC_EDITORIAL_VISION}
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/about", label: "Company" },
        { href: "/company/vision", label: "Vision" },
      ]}
    >
      <Section labelledBy="mission-heading">
        <PageContainer className="py-16">
          <div className="sherivs-stagger mx-auto grid max-w-3xl gap-4 text-sm leading-relaxed text-sherivs-muted sm:text-base">
            <GlassPanel className="space-y-3">
              <h2
                id="mission-heading"
                className="font-display text-xl font-semibold text-[var(--sherivs-ink)]"
              >
                Mission
              </h2>
              <p>{PUBLIC_EDITORIAL_MISSION}</p>
            </GlassPanel>
            <GlassPanel className="space-y-3">
              <h2 className="font-display text-xl font-semibold text-[var(--sherivs-ink)]">
                Vision
              </h2>
              <p>{PUBLIC_EDITORIAL_VISION}</p>
            </GlassPanel>
            <GlassPanel className="space-y-3">
              <h2 className="font-display text-xl font-semibold text-[var(--sherivs-ink)]">
                Our approach
              </h2>
              <p>{PUBLIC_EDITORIAL_APPROACH}</p>
            </GlassPanel>
            <GlassPanel className="space-y-3">
              <h2 className="font-display text-xl font-semibold text-[var(--sherivs-ink)]">
                What that means today
              </h2>
              <p>{POSITIONING_STATEMENT}</p>
              <p>{POSITIONING_RETHINKING}</p>
              <p>{POSITIONING_PROGRAMMABLE}</p>
              <p>
                {PRODUCT_NAME} is the first product. Organization records and a shared workspace are
                in the product. AI assistants, campus management screens, and supported automated
                actions are in development.
              </p>
            </GlassPanel>
          </div>
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
