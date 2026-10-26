import { createFileRoute, Link } from "@tanstack/react-router";
import { publicHead } from "@/lib/public-site/seo";
import { MarketingPage } from "@/components/public/marketing-page";
import { FeatureCard, PageContainer, Section } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/docs")({
  component: DocsPage,
  head: () =>
    publicHead({
      title: "Documentation",
      description: "Public documentation currently covers the product help center, FAQs, and honest developer status.",
      path: "/docs",
    }),
});

function DocsPage() {
  return (
    <MarketingPage
      eyebrow="Documentation"
      title="Documentation"
      lead="Public docs today are product guides and FAQs. Engineering runbooks in the repository are not a customer documentation site."
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/docs", label: "Docs" },
      ]}
    >
      <Section labelledBy="doc-links">
        <PageContainer className="grid gap-4 py-16 sm:grid-cols-2">
          <h2 id="doc-links" className="sr-only">
            Documentation links
          </h2>
          <FeatureCard title="Help center" href="/help">
            Instructions that match implemented functionality.
          </FeatureCard>
          <FeatureCard title="FAQs" href="/faq">
            Product availability, twins, agents, security, and onboarding.
          </FeatureCard>
          <FeatureCard title="Developers" href="/developers">
            What exists today — without an invented SDK.
          </FeatureCard>
          <FeatureCard title="System status" href="/status">
            Public health from /health.json.
          </FeatureCard>
          <p className="sm:col-span-2 text-sm text-sherivs-muted">
            Looking for the application?{" "}
            <Link to="/auth" className="text-sherivs-cyan underline-offset-4 hover:underline">
              Sign in
            </Link>
            .
          </p>
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
