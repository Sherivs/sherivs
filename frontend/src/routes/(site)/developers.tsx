import { createFileRoute, Link } from "@tanstack/react-router";
import { publicHead } from "@/lib/public-site/seo";
import { MarketingPage } from "@/components/public/marketing-page";
import { Callout, PageContainer, Section, StatusBadge } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/developers")({
  component: DevelopersPage,
  head: () =>
    publicHead({
      title: "Developers",
      description:
        "Developer entry points that exist today: the Sherivs web application, authentication, and organization onboarding. A public API and SDK are planned.",
      path: "/developers",
    }),
});

function DevelopersPage() {
  return (
    <MarketingPage
      eyebrow="Developers"
      title="Build on what is actually published"
      lead="Sherivs does not currently publish a customer API catalog, explorer, or SDK. The working entry point is the web application after sign-in."
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/developers", label: "Developers" },
      ]}
      actions={<StatusBadge status="planned" />}
    >
      <Section labelledBy="dev-today">
        <PageContainer className="max-w-3xl space-y-4 py-16 text-sm leading-relaxed text-sherivs-muted sm:text-base">
          <h2 id="dev-today" className="font-display text-xl font-semibold text-sherivs-white">
            Available today
          </h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <Link to="/auth" className="text-sherivs-cyan underline-offset-4 hover:underline">
                Sign in
              </Link>{" "}
              at sherivs.com/auth or app.sherivs.com
            </li>
            <li>Create an organization (the selectable runtime is Scholar)</li>
            <li>
              Public webhooks that the platform already implements for configured providers (for
              example Paystack), which are not a general-purpose developer platform
            </li>
          </ul>
          <Callout title="Not published">
            A documented REST or GraphQL surface, official SDK, and API explorer are planned. Do not
            treat internal repository packages as a public SDK.
          </Callout>
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
