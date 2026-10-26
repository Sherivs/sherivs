import { ARCHITECTURE_LAYERS } from "@/lib/public-site/capabilities";
import { LAYER_PAGES } from "@/lib/public-site/layer-copy";
import { MarketingPage } from "@/components/public/marketing-page";
import { FeatureCard, PageContainer, Section } from "@/components/public/ui";

export function ProductLayerPage({ pageKey }: { pageKey: keyof typeof LAYER_PAGES }) {
  const page = LAYER_PAGES[pageKey];
  return (
    <MarketingPage
      eyebrow={page.eyebrow}
      title={page.title}
      lead={page.lead}
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/sherivs", label: "Platform" },
        { href: page.path, label: page.eyebrow },
      ]}
    >
      <Section labelledBy="layer-detail-heading">
        <PageContainer className="space-y-4 py-16">
          <h2 id="layer-detail-heading" className="sr-only">
            Layer detail
          </h2>
          {page.extra.map((paragraph) => (
            <p key={paragraph} className="max-w-3xl text-sm leading-relaxed text-sherivs-muted sm:text-base">
              {paragraph}
            </p>
          ))}
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {ARCHITECTURE_LAYERS.map((layer) => (
              <li key={layer.id}>
                <FeatureCard title={layer.title} status={layer.status}>
                  {layer.summary}
                </FeatureCard>
              </li>
            ))}
          </ul>
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
