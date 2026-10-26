import { createFileRoute } from "@tanstack/react-router";
import { publicHead } from "@/lib/public-site/seo";
import { MarketingPage } from "@/components/public/marketing-page";
import { Callout, PageContainer, Section, StatusBadge } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/solutions/research")({
  component: ResearchPage,
  head: () =>
    publicHead({
      title: "Research and innovation",
      description:
        "A directional Sherivs offering for research institutions. Not a generally available product.",
      path: "/solutions/research",
    }),
});

function ResearchPage() {
  return (
    <MarketingPage
      eyebrow="Research"
      title="Research and innovation"
      lead="Research organizations need governed identity, durable state, and intelligence that can be cited. This page describes direction, not a shipping SKU."
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/solutions", label: "Solutions" },
        { href: "/solutions/research", label: "Research" },
      ]}
      actions={<StatusBadge status="planned" />}
    >
      <Section labelledBy="research-detail">
        <PageContainer className="py-16">
          <h2 id="research-detail" className="sr-only">
            Research availability
          </h2>
          <Callout title="Planned" tone="warning">
            There is no separate research runtime to select at onboarding. If this is your context,
            request a demo and we will talk about what is actually available.
          </Callout>
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
