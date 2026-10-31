import { createFileRoute, Link } from "@tanstack/react-router";
import { PRODUCT_NAME } from "@/lib/public-site/company";
import { SCHOLAR_AUDIENCES, SCHOLAR_CAPABILITIES } from "@/lib/public-site/scholar";
import { publicHead } from "@/lib/public-site/seo";
import { MarketingPage } from "@/components/public/marketing-page";
import {
  FeatureCard,
  GlassPanel,
  PageContainer,
  PublicButton,
  Section,
  SectionHeading,
} from "@/components/public/ui";

export const Route = createFileRoute("/(site)/solutions/education")({
  component: EducationPage,
  head: () =>
    publicHead({
      title: PRODUCT_NAME,
      description:
        "Sherivs Scholar, the institutional operating environment for schools. Role-specific applications, campus screens, and AI assistants are in development.",
      path: "/solutions/education",
    }),
});

function EducationPage() {
  return (
    <MarketingPage
      eyebrow="Product"
      title={PRODUCT_NAME}
      lead="The institutional operating environment from Sherivs. Built around the school as an organization, with access shaped by membership and role."
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/solutions", label: "Solutions" },
        { href: "/solutions/education", label: "Schools" },
      ]}
      actions={
        <>
          <PublicButton href="/onboarding">Get started</PublicButton>
          <PublicButton href="/auth" variant="secondary">
            Sign in
          </PublicButton>
        </>
      }
    >
      <Section labelledBy="scholar-detail">
        <PageContainer className="py-16">
          <GlassPanel className="mx-auto max-w-3xl space-y-4 text-sm leading-relaxed text-sherivs-muted sm:text-base">
            <h2
              id="scholar-detail"
              className="font-display text-xl font-semibold text-[var(--sherivs-ink)]"
            >
              What is in the product
            </h2>
            <p>
              A school requests an organization through onboarding. That request opens an email. It
              does not create the organization by itself. Invited people sign in to one workspace.
              What they can open follows membership and role.
            </p>
            <p>
              There are no separate teacher, parent, or bursar applications. Campus management
              screens and role-specific AI assistants are in development. The signed-in AI page is
              explanatory copy and is not connected to the AI gateway.
            </p>
            <p>
              Payments through Paystack and messaging through configured providers are available
              when those integrations are set up — they are not automatic for every organization.
              Schools can publish a public website on their own host.
            </p>
          </GlassPanel>
        </PageContainer>
      </Section>

      <Section id="administration" labelledBy="capabilities-heading" tone="muted">
        <PageContainer className="py-16">
          <SectionHeading
            id="capabilities-heading"
            eyebrow="Capabilities"
            title="Practical school operations, in one environment."
          />
          <ul className="sherivs-stagger mt-10 grid gap-4 md:grid-cols-2">
            {SCHOLAR_CAPABILITIES.map((card) => (
              <li key={card.id} id={card.id === "administration" ? undefined : card.id}>
                <FeatureCard title={card.title}>{card.body}</FeatureCard>
              </li>
            ))}
          </ul>
        </PageContainer>
      </Section>

      <Section id="academic" labelledBy="community-heading">
        <PageContainer className="py-16">
          <SectionHeading
            id="community-heading"
            eyebrow="School community"
            title="One school. A more connected experience."
          />
          <ul className="sherivs-stagger mt-10 grid gap-4 sm:grid-cols-2">
            {SCHOLAR_AUDIENCES.map((audience) => (
              <li key={audience.id}>
                <FeatureCard title={audience.title}>{audience.body}</FeatureCard>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-sm text-sherivs-muted">
            Already invited?{" "}
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
