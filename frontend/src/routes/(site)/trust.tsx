import { createFileRoute, Link } from "@tanstack/react-router";
import { publicHead } from "@/lib/public-site/seo";
import { awaitingWordingCompliance, publishedCompliance } from "@/lib/public-site/compliance";
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
  const wordingGate = awaitingWordingCompliance();
  return (
    <MarketingPage
      eyebrow="Trust"
      title="Trust center"
      lead="Only principles we can evidence. Certification badges, registration numbers, and certificate scans stay unpublished."
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
            SOC 2, ISO 27001, and similar certification badges are not displayed. Sherivs
            Technologies Limited is the operating company. Registration numbers, tax identifiers,
            and certificate scans are not published. NSCDC- and NDPA-related statuses stay behind an
            owner wording gate until the exact official instrument is confirmed. If procurement
            requires a specific report, ask during a demo.
          </Callout>
          {wordingGate.length > 0 ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-sherivs-muted">
                Compliance statements
              </p>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {wordingGate.map((claim) => (
                  <li
                    key={claim.id}
                    className="sherivs-glass-card rounded-[var(--sherivs-radius)] p-4"
                  >
                    <p className="font-display text-base font-semibold">{claim.name}</p>
                    <p className="mt-2 inline-flex rounded-full border border-[var(--sherivs-border-strong)] bg-white/5 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-sherivs-muted">
                      Awaiting owner-approved wording
                    </p>
                    <p className="mt-3 text-sm leading-relaxed text-sherivs-muted">
                      {claim.summary}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <ul className="sherivs-stagger grid gap-4 sm:grid-cols-2">
            {claims.map((claim) => (
              <li key={claim.id}>
                <FeatureCard title={claim.name}>{claim.summary}</FeatureCard>
              </li>
            ))}
            <li>
              <FeatureCard title="Privacy" href="/privacy">
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
            <Link
              to="/legal/subprocessors"
              className="text-sherivs-cyan underline-offset-4 hover:underline"
            >
              subprocessors
            </Link>
            .
          </p>
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
