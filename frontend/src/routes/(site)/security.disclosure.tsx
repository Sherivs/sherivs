import { createFileRoute } from "@tanstack/react-router";
import { publicHead } from "@/lib/public-site/seo";
import { PUBLIC_CONTACTS } from "@/lib/public-site/contacts";
import { MarketingPage } from "@/components/public/marketing-page";
import { GlassPanel, PageContainer, Section } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/security/disclosure")({
  component: DisclosurePage,
  head: () =>
    publicHead({
      title: "Vulnerability disclosure",
      description:
        "Report suspected security issues in Sherivs to the privacy and legal mailboxes.",
      path: "/security/disclosure",
    }),
});

function DisclosurePage() {
  return (
    <MarketingPage
      eyebrow="Security"
      title="Vulnerability disclosure"
      lead="Report suspected issues. Do not access another tenant or exfiltrate data to prove a point."
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/security", label: "Security" },
        { href: "/security/disclosure", label: "Disclosure" },
      ]}
    >
      <Section labelledBy="disc-body">
        <PageContainer className="py-16">
          <GlassPanel className="mx-auto max-w-3xl space-y-4 text-sm leading-relaxed text-sherivs-muted">
            <h2
              id="disc-body"
              className="font-display text-xl font-semibold text-[var(--sherivs-ink)]"
            >
              How to report
            </h2>
            <p>
              Email{" "}
              <a
                className="text-sherivs-cyan underline-offset-4 hover:underline"
                href={`mailto:${PUBLIC_CONTACTS.info}`}
              >
                {PUBLIC_CONTACTS.info}
              </a>{" "}
              with a factual description. Include affected host and time. Do not include secrets
              from other organizations.
            </p>
            <p>
              This page is not a paid bug-bounty program. Terms for such a program will appear only
              if the owner publishes them.
            </p>
          </GlassPanel>
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
