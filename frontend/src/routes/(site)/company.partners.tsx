import { createFileRoute } from "@tanstack/react-router";
import { publicHead } from "@/lib/public-site/seo";
import { publishedPartners } from "@/lib/public-site/partners";
import { MarketingPage } from "@/components/public/marketing-page";
import { Callout, PageContainer, PartnerCard, Section } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/company/partners")({
  component: PartnersPage,
  head: () =>
    publicHead({
      title: "Partners",
      description:
        "Sherivs publishes only approved partner relationships. ThinkTech is listed as a technology partner. Integrations are listed separately.",
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
      lead="Approved relationships only. Technology partners are not commercial partners, customers, or product integrations unless that is separately established."
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/about", label: "Company" },
        { href: "/company/partners", label: "Partners" },
      ]}
    >
      <Section labelledBy="partner-list">
        <PageContainer className="space-y-10 py-16">
          <h2 id="partner-list" className="sr-only">
            Partner lists
          </h2>
          <div>
            <h3 className="font-display text-lg font-semibold">Technology partners</h3>
            <ul className="mt-4 grid gap-4 sm:grid-cols-2">
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
              empty rather than filled with placeholders.
            </Callout>
          ) : null}
          <Callout title="Not an integration directory">
            Paystack and WhatsApp appear on the{" "}
            <a className="text-sherivs-cyan underline-offset-4 hover:underline" href="/integrations">
              integrations
            </a>{" "}
            page as configured technology paths. They are not listed here as partners.
          </Callout>
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
