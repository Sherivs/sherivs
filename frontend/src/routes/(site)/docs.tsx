import { createFileRoute, Link } from "@tanstack/react-router";
import { publicHead } from "@/lib/public-site/seo";
import { MarketingPage } from "@/components/public/marketing-page";
import { FeatureCard, PageContainer, Section } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/docs")({
  component: DocsPage,
  head: () =>
    publicHead({
      title: "Documentation",
      description:
        "Public documentation currently covers the product help center and FAQs for Sherivs Scholar.",
      path: "/docs",
    }),
});

function DocsPage() {
  return (
    <MarketingPage
      eyebrow="Documentation"
      title="Documentation"
      lead="Public docs today are product guides and FAQs for Sherivs Scholar. Engineering runbooks in the repository are not a customer documentation site."
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/docs", label: "Docs" },
      ]}
    >
      <Section labelledBy="doc-links">
        <PageContainer className="sherivs-stagger grid gap-4 py-16 sm:grid-cols-2">
          <h2 id="doc-links" className="sr-only">
            Documentation links
          </h2>
          <FeatureCard title="Help center" href="/help">
            Instructions that match implemented functionality.
          </FeatureCard>
          <FeatureCard title="FAQs" href="/faq">
            Sherivs Scholar, onboarding, parent access, privacy, and support.
          </FeatureCard>
          <FeatureCard title="Support" href="/support">
            Write to support@sherivs.com. The form opens your email client.
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
