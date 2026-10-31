import { createFileRoute } from "@tanstack/react-router";
import { publicHead } from "@/lib/public-site/seo";
import {
  THINKTECH_DESCRIPTION,
  THINKTECH_HEADLINE,
  THINKTECH_HONESTY,
  publishedPartners,
} from "@/lib/public-site/partners";
import { MarketingPage } from "@/components/public/marketing-page";
import { Callout, GlassPanel, PageContainer, PartnerCard, Section } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/company/partners")({
  component: PartnersPage,
  head: () =>
    publicHead({
      title: "Partners",
      description: THINKTECH_DESCRIPTION,
      path: "/company/partners",
    }),
});

function PartnersPage() {
  const commercial = publishedPartners("commercial");
  const strategic = publishedPartners("strategic");
  const technologyPartners = publishedPartners("technology_partner");
  return (
    <MarketingPage
      eyebrow="Company"
      title="Partners"
      lead={THINKTECH_HEADLINE}
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/about", label: "Company" },
        { href: "/company/partners", label: "Partners" },
      ]}
    >
      <Section labelledBy="thinktech-heading">
        <PageContainer className="space-y-10 py-16">
          <GlassPanel className="max-w-3xl space-y-4 text-sm leading-relaxed text-sherivs-muted sm:text-base">
            <h2
              id="thinktech-heading"
              className="font-display text-xl font-semibold text-[var(--sherivs-ink)]"
            >
              Sherivs and ThinkTech
            </h2>
            <p>{THINKTECH_DESCRIPTION}</p>
          </GlassPanel>
          <div>
            <h3 id="partner-list" className="font-display text-lg font-semibold">
              Technology partners
            </h3>
            <ul className="sherivs-stagger mt-4 grid gap-4 sm:grid-cols-2">
              {technologyPartners.map((item) => (
                <li key={item.id}>
                  <PartnerCard
                    name={item.name}
                    summary={item.summary}
                    href={item.href}
                    logoSrc={item.logoSrc}
                    kindLabel="Technology partner"
                  />
                </li>
              ))}
            </ul>
          </div>
          {commercial.length === 0 && strategic.length === 0 ? (
            <Callout title="No published commercial or strategic partners">
              Approved commercial and strategic names have not been supplied. This section stays
              empty rather than filled with placeholders. ThinkTech is a technology partner, not a
              commercial customer reference.
            </Callout>
          ) : null}
          <Callout title="Not an integration directory">
            Paystack and WhatsApp appear on the{" "}
            <a
              className="text-sherivs-cyan underline-offset-4 hover:underline"
              href="/integrations"
            >
              integrations
            </a>{" "}
            page as configured technology paths. They are not listed here as partners.
          </Callout>
          <Callout title="What this page does not claim">{THINKTECH_HONESTY}</Callout>
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
