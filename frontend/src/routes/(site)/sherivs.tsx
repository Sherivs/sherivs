import { createFileRoute } from "@tanstack/react-router";
import { PLATFORM_NAME, PLATFORM_PAGE_DESCRIPTION } from "@/lib/platform";
import { PRODUCT_NAME } from "@/lib/public-site/company";
import {
  INSTALLED_RUNTIME_PROOFS,
  SECURITY_GUARANTEES,
  SITE_CAPABILITIES,
} from "./-content/site-content";
import { publicHead } from "@/lib/public-site/seo";
import {
  GlassPanel,
  PageContainer,
  Section,
  SectionHeading,
  FeatureCard,
  PublicButton,
} from "@/components/public/ui";

/**
 * Dedicated Sherivs Scholar product overview at /sherivs.
 * The former /coregrid path redirects here. Nested architecture marketing
 * pages redirect to this product overview.
 */

export const Route = createFileRoute("/(site)/sherivs")({
  component: SherivsPlatformPage,
  head: () =>
    publicHead({
      title: `${PRODUCT_NAME} overview`,
      description: PLATFORM_PAGE_DESCRIPTION,
      path: "/sherivs",
    }),
});

function SherivsPlatformPage() {
  const [runtime] = INSTALLED_RUNTIME_PROOFS;

  return (
    <>
      <section aria-labelledby="scholar-hero">
        <PageContainer className="py-16 sm:py-20">
          <GlassPanel enter className="mx-auto max-w-3xl px-6 py-10 sm:px-10 sm:py-14">
            <p className="sherivs-kicker">{PRODUCT_NAME}</p>
            <h1
              id="scholar-hero"
              className="sherivs-display sherivs-enter-2 mt-4 max-w-[18ch] text-3xl font-bold sm:text-5xl"
            >
              Your school. One intelligent operating environment.
            </h1>
            <p className="sherivs-enter-3 mt-5 max-w-2xl text-sm leading-relaxed text-sherivs-muted sm:text-lg">
              Bring your school&apos;s people, responsibilities, operations, and institutional
              knowledge into one connected digital environment—designed around how your organization
              actually works.
            </p>
            <div className="sherivs-enter-4 mt-8 flex flex-col gap-3 sm:flex-row">
              <PublicButton href="/onboarding">Get started</PublicButton>
              <PublicButton href="/auth" variant="secondary">
                Sign in
              </PublicButton>
            </div>
          </GlassPanel>
        </PageContainer>
      </section>

      <Section id="capabilities" labelledBy="capabilities-heading">
        <PageContainer className="py-16 sm:py-20">
          <SectionHeading
            id="capabilities-heading"
            eyebrow="Product capabilities"
            title="Everything your school needs to stay in sync."
            lead="Organization records and a shared workspace are in the product. Separate applications for each role, campus screens, and AI assistants are in development."
          />
          <ul className="sherivs-stagger mt-10 grid gap-4 md:grid-cols-2">
            {SITE_CAPABILITIES.map((capability) => (
              <li key={capability.id}>
                <FeatureCard title={capability.title}>{capability.description}</FeatureCard>
              </li>
            ))}
          </ul>
        </PageContainer>
      </Section>

      <Section id="community" labelledBy="community-heading" tone="muted">
        <PageContainer className="py-16 sm:py-20">
          <SectionHeading
            id="community-heading"
            eyebrow="The product"
            title={`${PLATFORM_NAME} ${runtime.name}`}
            lead={runtime.description}
          />
          <GlassPanel className="mt-6 max-w-2xl">
            <p className="text-sm leading-relaxed text-sherivs-muted">{runtime.description}</p>
            <p className="mt-3 text-sm leading-relaxed text-sherivs-muted">
              Role-specific AI assistants, multi-campus management screens, and supported automated
              actions are in development. They are not operational.
            </p>
          </GlassPanel>
        </PageContainer>
      </Section>

      <Section id="security" labelledBy="security-heading">
        <PageContainer className="py-16 sm:py-20">
          <SectionHeading
            id="security-heading"
            eyebrow="Responsibility"
            title="Built with responsibility in mind."
            lead="School information deserves careful handling. These practices describe the access model implemented in the product — not certifications or independent audits."
          />
          <ul className="sherivs-stagger mt-10 grid gap-4 sm:grid-cols-2">
            {SECURITY_GUARANTEES.map((item) => (
              <li key={item.id}>
                <FeatureCard title={item.title}>{item.description}</FeatureCard>
              </li>
            ))}
          </ul>
        </PageContainer>
      </Section>
    </>
  );
}
