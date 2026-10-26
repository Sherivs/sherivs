import { createFileRoute, Link } from "@tanstack/react-router";
import { publicHead } from "@/lib/public-site/seo";
import { MarketingPage } from "@/components/public/marketing-page";
import { PageContainer, Section, StatusBadge } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/solutions/education")({
  component: EducationPage,
  head: () =>
    publicHead({
      title: "Sherivs Scholar",
      description:
        "Sherivs Scholar — the education runtime on the Sherivs platform, available for schools to create an organization and run academic operations.",
      path: "/solutions/education",
    }),
});

function EducationPage() {
  return (
    <MarketingPage
      eyebrow="Education"
      title="Sherivs Scholar"
      lead="The first installed runtime is Scholar. It is an education operating environment on Sherivs, not the definition of the company."
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/solutions", label: "Solutions" },
        { href: "/solutions/education", label: "Education" },
      ]}
      actions={<StatusBadge status="available" />}
    >
      <Section labelledBy="scholar-detail">
        <PageContainer className="max-w-3xl space-y-4 py-16 text-sm leading-relaxed text-sherivs-muted sm:text-base">
          <h2 id="scholar-detail" className="font-display text-xl font-semibold text-sherivs-white">
            What schools can do today
          </h2>
          <p>
            Create an organization, invite people, and run Scholar workspaces for administrators,
            teachers, families, and students. Schools can publish a public website on their own
            host.
          </p>
          <p>
            Payments through Paystack and messaging through configured providers are available when
            those integrations are set up — they are not automatic for every organization.
          </p>
          <p>
            Start from{" "}
            <Link to="/auth" className="text-sherivs-cyan underline-offset-4 hover:underline">
              Sign in
            </Link>{" "}
            or{" "}
            <Link to="/request-demo" className="text-sherivs-cyan underline-offset-4 hover:underline">
              request a demo
            </Link>
            .
          </p>
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
