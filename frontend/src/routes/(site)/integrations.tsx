import { createFileRoute } from "@tanstack/react-router";
import { publicHead } from "@/lib/public-site/seo";
import { publishedPartners } from "@/lib/public-site/partners";
import { MarketingPage } from "@/components/public/marketing-page";
import { Callout, FeatureCard, PageContainer, Section } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/integrations")({
  component: IntegrationsPage,
  head: () =>
    publicHead({
      title: "Integrations",
      description:
        "Verified Sherivs integration paths such as Paystack and WhatsApp when configured. These are not commercial partnership announcements.",
      path: "/integrations",
    }),
});

function IntegrationsPage() {
  const tech = publishedPartners("technology_integration");
  return (
    <MarketingPage
      eyebrow="Integrations"
      title="Verified integration paths"
      lead="A technology listed here is something Sherivs can connect to when credentials and entitlements exist. It is not evidence of a commercial partnership."
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/integrations", label: "Integrations" },
      ]}
    >
      <Section labelledBy="int-list">
        <PageContainer className="space-y-6 py-16">
          <h2 id="int-list" className="sr-only">
            Integration list
          </h2>
          <Callout title="No invented partners">
            Commercial and strategic partners will appear only after the company owner supplies
            approved names and logos.
          </Callout>
          <ul className="grid gap-4 sm:grid-cols-2">
            {tech.map((item) => (
              <li key={item.id}>
                <FeatureCard title={item.name}>{item.summary}</FeatureCard>
              </li>
            ))}
          </ul>
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
