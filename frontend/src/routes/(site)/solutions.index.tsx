import { createFileRoute } from "@tanstack/react-router";
import { PRODUCT_FAMILIES } from "@/lib/public-site/capabilities";
import { publicHead } from "@/lib/public-site/seo";
import { MarketingPage } from "@/components/public/marketing-page";
import { FeatureCard, PageContainer, Section } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/solutions/")({
  component: SolutionsPage,
  head: () =>
    publicHead({
      title: "Solutions",
      description:
        "Education through Sherivs Scholar — available today. Enterprise, intelligence, twins, and developer offerings are labelled by actual availability.",
      path: "/solutions",
    }),
});

function SolutionsPage() {
  return (
    <MarketingPage
      eyebrow="Solutions"
      title="Institutional solutions"
      lead="Product families follow the current product and roadmap. Unavailable offerings are labelled, not implied."
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/solutions", label: "Solutions" },
      ]}
    >
      <Section labelledBy="families-heading">
        <PageContainer className="py-16">
          <h2 id="families-heading" className="sr-only">
            Product families
          </h2>
          <ul className="grid gap-4 lg:grid-cols-2">
            {PRODUCT_FAMILIES.map((family) => (
              <li key={family.id}>
                <FeatureCard title={family.name} href={family.href} status={family.status}>
                  {family.summary}
                </FeatureCard>
              </li>
            ))}
          </ul>
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
