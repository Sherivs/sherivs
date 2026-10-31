import { createFileRoute } from "@tanstack/react-router";
import { publicHead } from "@/lib/public-site/seo";
import { SECURITY_GUARANTEES } from "@/routes/(site)/-content/site-content";
import { MarketingPage } from "@/components/public/marketing-page";
import { FeatureCard, PageContainer, Section } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/security/")({
  component: SecurityPage,
  head: () =>
    publicHead({
      title: "Security",
      description:
        "Sherivs security principles: tenant isolation, layered authorization, audit, and governed AI. Not a certification claim.",
      path: "/security",
    }),
});

function SecurityPage() {
  return (
    <MarketingPage
      eyebrow="Security"
      title="Security and trust"
      lead="These are implemented engineering principles. They are not a substitute for an independent audit report."
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/security", label: "Security" },
      ]}
    >
      <Section labelledBy="sec-list">
        <PageContainer className="py-16">
          <h2 id="sec-list" className="sr-only">
            Security principles
          </h2>
          <ul className="sherivs-stagger grid gap-4 sm:grid-cols-2">
            {SECURITY_GUARANTEES.map((item) => (
              <li key={item.id}>
                <FeatureCard title={item.title}>{item.description}</FeatureCard>
              </li>
            ))}
          </ul>
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
