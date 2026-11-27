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
        "Integrations Sherivs is building, such as Paystack and WhatsApp. Neither is live for customers yet. These are not partnership announcements.",
      path: "/integrations",
    }),
});

function IntegrationsPage() {
  const tech = publishedPartners("technology_integration");
  return (
    <MarketingPage
      eyebrow="Integrations"
      title="Integrations in progress"
      lead="A technology listed here is one Sherivs has started to connect to. Each card says whether it is live. A listing is not evidence of a commercial partnership."
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
          <ul className="sherivs-stagger grid gap-4 sm:grid-cols-2">
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
