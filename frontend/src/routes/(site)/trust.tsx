import { createFileRoute, Link } from "@tanstack/react-router";
import { publicHead } from "@/lib/public-site/seo";
import { publishedCompliance } from "@/lib/public-site/compliance";
import { MarketingPage } from "@/components/public/marketing-page";
import { Callout, FeatureCard, PageContainer, Section } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/trust")({
  component: TrustPage,
  head: () =>
    publicHead({
      title: "Trust center",
      description:
        "Sherivs trust center: security principles, privacy, vulnerability reporting. No invented certifications.",
      path: "/trust",
    }),
});

function TrustPage() {
  const claims = publishedCompliance();
  return (
    <MarketingPage
      eyebrow="Trust"
      title="Trust center"
      lead="Only principles and reports we can evidence. Certification badges stay unpublished until the owner supplies them."
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/trust", label: "Trust center" },
      ]}
    >
      <Section labelledBy="trust-body">
        <PageContainer className="space-y-8 py-16">
          <h2 id="trust-body" className="sr-only">
            Trust topics
          </h2>
          <Callout title="No fabricated attestations" tone="warning">
            SOC 2, ISO 27001, and similar registrations are not displayed. If your procurement
            process requires them, ask during a demo.
          </Callout>
          <ul className="grid gap-4 sm:grid-cols-2">
            {claims.map((claim) => (
              <li key={claim.id}>
                <FeatureCard title={claim.name}>{claim.summary}</FeatureCard>
              </li>
            ))}
            <li>
              <FeatureCard title="Privacy" href="/privacy-policy">
                How organizational and personal data is handled at the level the product implements.
              </FeatureCard>
            </li>
            <li>
              <FeatureCard title="Security" href="/security">
                Identity, tenancy, authorization, and audit.
              </FeatureCard>
            </li>
            <li>
              <FeatureCard title="Vulnerability reporting" href="/security/disclosure">
                How to report a suspected issue.
              </FeatureCard>
            </li>
            <li>
              <FeatureCard title="Responsible AI">
                AI output is untrusted by default. Workers operate inside permissions and human
                oversight. Unlimited autonomy is not offered.
              </FeatureCard>
            </li>
            <li>
              <FeatureCard title="Data residency">
                A public residency statement is not on file. Do not infer a region from this page.
              </FeatureCard>
            </li>
            <li>
              <FeatureCard title="Accessibility" href="/accessibility">
                WCAG 2.2 AA is the design objective for this public site.
              </FeatureCard>
            </li>
          </ul>
          <p className="text-sm text-sherivs-muted">
            Subprocessors and a data-processing addendum are unpublished until owner approval. See{" "}
            <Link to="/legal/subprocessors" className="text-sherivs-cyan underline-offset-4 hover:underline">
              subprocessors
            </Link>
            .
          </p>
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
