import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME, PLATFORM_PAGE_DESCRIPTION, PLATFORM_TAGLINE } from "@/lib/platform";
import { POSITIONING_RETHINKING } from "@/lib/public-site/company";
import {
  INSTALLED_RUNTIME_PROOFS,
  SECURITY_GUARANTEES,
  SITE_CAPABILITIES,
} from "./-content/site-content";
import { MARKETING_TIERS, formatTierPrice } from "./-content/pricing-tiers";
import { publicHead } from "@/lib/public-site/seo";
import { PageContainer, Section, SectionHeading, FeatureCard, StatusBadge } from "@/components/public/ui";
import { ArchitectureDiagram } from "@/components/public/architecture-diagram";

/**
 * Sherivs public platform-detail page at /sherivs (the former /coregrid path
 * redirects here).
 *
 * Static marketing presentation of the platform. Every interactive element
 * links to a real route (/request-demo to engage, /auth to sign in).
 */

export const Route = createFileRoute("/(site)/sherivs")({
  component: SherivsPlatformPage,
  head: () =>
    publicHead({
      title: `${PLATFORM_NAME} — ${PLATFORM_TAGLINE}`,
      description: PLATFORM_PAGE_DESCRIPTION,
      path: "/sherivs",
    }),
});

function SherivsPlatformPage() {
  return (
    <>
      <section aria-labelledby="coregrid-hero" className="border-b border-[var(--sherivs-border)]">
        <PageContainer className="py-16 sm:py-24">
          <p className="sherivs-kicker">{PLATFORM_TAGLINE}</p>
          <h1
            id="coregrid-hero"
            className="sherivs-display mt-3 max-w-3xl text-4xl font-bold sm:text-5xl"
          >
            {PLATFORM_NAME}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-sherivs-muted sm:text-lg">
            {PLATFORM_PAGE_DESCRIPTION}
          </p>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-sherivs-muted sm:text-base">
            {POSITIONING_RETHINKING}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Link
              to="/request-demo"
              className="rounded-md bg-sherivs-blue px-5 py-2.5 text-center text-sm font-semibold text-white hover:opacity-90"
            >
              Request a demo
            </Link>
            <Link
              to="/auth"
              className="rounded-md border border-[var(--sherivs-border-strong)] px-5 py-2.5 text-center text-sm font-semibold hover:bg-white/5"
            >
              Sign in
            </Link>
            <Link
              to="/"
              className="text-sm font-semibold text-sherivs-muted underline-offset-4 hover:text-foreground hover:underline"
            >
              Back to the platform overview →
            </Link>
          </div>
        </PageContainer>
      </section>

      <section id="capabilities" aria-labelledby="capabilities-heading" className="border-b border-[var(--sherivs-border)]">
        <PageContainer className="py-16">
          <SectionHeading
            id="capabilities-heading"
            eyebrow="What Sherivs provides"
            title="One operating environment, six capabilities"
            lead="Everything an organization needs to run — represented, coordinated, and governed in one place."
          />
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SITE_CAPABILITIES.map((capability) => (
              <li key={capability.id}>
                <FeatureCard title={capability.title}>{capability.description}</FeatureCard>
              </li>
            ))}
          </ul>
        </PageContainer>
      </section>

      <Section labelledBy="architecture-heading" tone="muted">
        <PageContainer className="py-16">
          <SectionHeading
            id="architecture-heading"
            eyebrow="Architecture"
            title="Eight layers, labelled by availability"
            lead="Explore each layer. Internal engineering views at /platform are not part of this public story."
          />
          <div className="mt-10">
            <ArchitectureDiagram />
          </div>
        </PageContainer>
      </Section>

      <section id="runtimes" aria-labelledby="runtimes-heading" className="border-b border-[var(--sherivs-border)]">
        <PageContainer className="py-16">
          <SectionHeading
            id="runtimes-heading"
            eyebrow="Industry runtimes"
            title="One platform, adapted to your industry"
            lead="Sherivs adapts to industries through domain runtimes — complete operating experiences built on the same platform. Education is the first; more are on the way."
          />
          <div className="mt-10 grid gap-4 lg:grid-cols-2">
            {INSTALLED_RUNTIME_PROOFS.map((runtime) => (
              <article
                key={runtime.manifestId}
                className="rounded-xl border border-[var(--sherivs-border)] bg-[var(--sherivs-midnight)] p-6"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-lg font-semibold">Sherivs {runtime.name}</h3>
                  <StatusBadge status="available" />
                </div>
                <p className="mt-1 text-sm font-medium">{runtime.description}</p>
              </article>
            ))}
            <article className="rounded-xl border border-dashed border-[var(--sherivs-border)] p-6">
              <h3 className="font-display text-lg font-semibold">
                Commerce, Healthcare, Government
              </h3>
              <p className="mt-1 text-sm font-medium">Future industry runtimes</p>
              <p className="mt-3 text-sm leading-relaxed text-sherivs-muted">
                The same platform, adapted to other kinds of organizations over time.
              </p>
            </article>
          </div>
        </PageContainer>
      </section>

      <section id="security" aria-labelledby="security-heading" className="border-b border-[var(--sherivs-border)] bg-[color-mix(in_oklab,var(--sherivs-midnight)_70%,transparent)]">
        <PageContainer className="py-16">
          <SectionHeading
            id="security-heading"
            eyebrow="Security & governance"
            title="Correct, secure, explainable, auditable"
            lead="Security is continuous: observe, evaluate, decide, enforce, audit, re-evaluate. These guarantees are enforced by the platform itself, not by any single application on it."
          />
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SECURITY_GUARANTEES.map((guarantee) => (
              <li key={guarantee.id}>
                <FeatureCard title={guarantee.title}>{guarantee.description}</FeatureCard>
              </li>
            ))}
          </ul>
        </PageContainer>
      </section>

      <section id="pricing" aria-labelledby="pricing-heading" className="border-b border-[var(--sherivs-border)]">
        <PageContainer className="py-16">
          <SectionHeading
            id="pricing-heading"
            eyebrow="Pricing"
            title="Plans that scale with your organization"
            lead="Prices are shown in ₦ and mirror the platform's commercial tier catalog. Entitlements are enforced by the platform after activation — never by this page."
          />
          <ul className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {MARKETING_TIERS.map((tier) => (
              <li
                key={tier.id}
                className={`flex flex-col rounded-xl border p-6 ${
                  tier.featured
                    ? "border-sherivs-blue bg-[var(--sherivs-midnight)]"
                    : "border-[var(--sherivs-border)] bg-[var(--sherivs-midnight)]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-lg font-semibold">{tier.name}</h3>
                  {tier.featured ? (
                    <span className="rounded-full bg-sherivs-blue px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-white">
                      Recommended
                    </span>
                  ) : null}
                </div>
                <p className="mt-3 font-display text-2xl font-bold">
                  {formatTierPrice(tier.monthlyPrice)}
                  {tier.monthlyPrice !== null ? (
                    <span className="text-sm font-medium text-sherivs-muted">/month</span>
                  ) : null}
                </p>
                {tier.monthlyPrice !== null &&
                tier.annualPrice !== null &&
                tier.monthlyPrice > 0 ? (
                  <p className="mt-1 text-xs text-sherivs-muted">
                    or {formatTierPrice(tier.annualPrice)}/year
                  </p>
                ) : null}
                <p className="mt-3 text-sm text-sherivs-muted">{tier.summary}</p>
                <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                  {tier.highlights.map((highlight) => (
                    <li key={highlight} className="flex items-start gap-2">
                      <span aria-hidden="true" className="mt-0.5 text-sherivs-cyan">
                        ✓
                      </span>
                      {highlight}
                    </li>
                  ))}
                </ul>
                <Link
                  to="/request-demo"
                  className={`mt-6 rounded-md px-4 py-2 text-center text-sm font-semibold ${
                    tier.featured
                      ? "bg-sherivs-blue text-white hover:opacity-90"
                      : "border border-[var(--sherivs-border-strong)] hover:bg-white/5"
                  }`}
                >
                  {tier.ctaLabel}
                </Link>
              </li>
            ))}
          </ul>
        </PageContainer>
      </section>

      <section aria-labelledby="cta-heading">
        <PageContainer className="py-16 sm:py-20">
          <div className="sherivs-glass rounded-2xl p-8 text-center sm:p-12">
            <h2 id="cta-heading" className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              Bring your organization onto one operating environment
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-sherivs-muted sm:text-base">
              Request a demo and we&apos;ll show you how Sherivs would work for how your
              organization operates — or sign in if you already have a workspace.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/request-demo"
                className="rounded-md bg-sherivs-blue px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
              >
                Request a demo
              </Link>
              <Link
                to="/auth"
                className="rounded-md border border-[var(--sherivs-border-strong)] px-5 py-2.5 text-sm font-semibold hover:bg-white/5"
              >
                Sign in
              </Link>
            </div>
          </div>
        </PageContainer>
      </section>
    </>
  );
}
