import { createFileRoute } from "@tanstack/react-router";
import { publicHead } from "@/lib/public-site/seo";
import { MarketingPage } from "@/components/public/marketing-page";
import { Callout, PageContainer, Section, StatusBadge } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/solutions/enterprise")({
  component: EnterprisePage,
  head: () =>
    publicHead({
      title: "Sherivs Enterprise",
      description:
        "Sherivs Enterprise is the same institutional platform for organizations beyond education. Additional industry runtimes are not selectable at onboarding yet.",
      path: "/solutions/enterprise",
    }),
});

function EnterprisePage() {
  return (
    <MarketingPage
      eyebrow="Enterprise"
      title="Sherivs for organizations beyond education"
      lead="The platform is built to serve more than schools. Commerce, healthcare, and government runtimes are in development and are not offered as generally available products on this site."
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/solutions", label: "Solutions" },
        { href: "/solutions/enterprise", label: "Enterprise" },
      ]}
      actions={<StatusBadge status="in_development" />}
    >
      <Section labelledBy="enterprise-detail">
        <PageContainer className="max-w-3xl space-y-4 py-16">
          <h2 id="enterprise-detail" className="sr-only">
            Enterprise availability
          </h2>
          <Callout title="Honest availability">
            You can talk to Sherivs about organizational use. Onboarding today still selects Scholar
            as the available runtime. Do not assume a second industry runtime is live.
          </Callout>
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
