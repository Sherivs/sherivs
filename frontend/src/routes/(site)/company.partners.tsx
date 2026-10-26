import { createFileRoute } from "@tanstack/react-router";
import { publicHead } from "@/lib/public-site/seo";
import { publishedPartners } from "@/lib/public-site/partners";
import { MarketingPage } from "@/components/public/marketing-page";
import { Callout, FeatureCard, PageContainer, Section } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/company/partners")({
  component: PartnersPage,
  head: () =>
    publicHead({
      title: "Partners",
      description:
        "Sherivs publishes only approved partner relationships. Technology integrations are listed separately from commercial partners.",
      path: "/company/partners",
    }),
});

function PartnersPage() {
  const commercial = publishedPartners("commercial");
  const strategic = publishedPartners("strategic");
  const tech = publishedPartners("technology_integration");
  return (
    <MarketingPage
      eyebrow="Company"
      title="Partners"
      lead="We do not invent logos. Commercial and strategic partners appear only when the company owner supplies approved names."
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/about", label: "Company" },
        { href: "/company/partners", label: "Partners" },
      ]}
    >
      <Section labelledBy="partner-list">
        <PageContainer className="space-y-8 py-16">
          <h2 id="partner-list" className="sr-only">
            Partner lists
          </h2>
          {commercial.length === 0 && strategic.length === 0 ? (
            <Callout title="No published commercial partners" tone="warning">
              Approved names and logos have not been supplied. This section stays empty rather than
              filled with placeholders that look like customers.
            </Callout>
          ) : null}
          <div>
            <h3 className="font-display text-lg font-semibold">Technology integrations</h3>
            <ul className="mt-4 grid gap-4 sm:grid-cols-2">
              {tech.map((item) => (
                <li key={item.id}>
                  <FeatureCard title={item.name}>{item.summary}</FeatureCard>
                </li>
              ))}
            </ul>
          </div>
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
