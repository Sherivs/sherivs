import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME, PLATFORM_TAGLINE } from "@/lib/platform";
import {
  INSTALLED_RUNTIME_PROOFS,
  SECURITY_GUARANTEES,
  SITE_CAPABILITIES,
} from "./-content/site-content";
import { MARKETING_TIERS, formatTierPrice } from "./-content/pricing-tiers";

/**
 * Sherivs public platform-detail page at /coregrid (historical path kept for
 * compatibility — the URL is a technical identifier, the brand is Sherivs).
 *
 * Static marketing presentation of the platform: what Sherivs is, what it
 * provides, the industry runtimes it serves, security posture and commercial
 * tiers. All content is typed and database-free; every interactive element
 * links to a real route (/request-demo to engage, /auth to sign in).
 * Internal architecture (phases, kernel contracts, runtime bindings,
 * registries) is never presented on this surface — it lives in the internal
 * Sherivs operating environment behind authentication.
 */

export const Route = createFileRoute("/(site)/coregrid")({
  component: SherivsPlatformPage,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} — ${PLATFORM_TAGLINE}` },
      {
        name: "description",
        content:
          "Sherivs is an intelligent operating platform for organizations: one environment that understands how your organization works, coordinates people and an AI workforce, and continuously improves operations.",
      },
      { property: "og:title", content: `${PLATFORM_NAME} — ${PLATFORM_TAGLINE}` },
      {
        property: "og:description",
        content:
          "One intelligent operating environment for organizations: people, knowledge, workflows, AI workforce, operations — governed by design.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
});

function SectionHeading({
  id,
  eyebrow,
  title,
  lead,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead?: string;
}) {
  return (
    <div className="max-w-3xl">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {eyebrow}
      </p>
      <h2 id={id} className="mt-2 font-display text-2xl font-bold tracking-tight sm:text-3xl">
        {title}
      </h2>
      {lead && (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">{lead}</p>
      )}
    </div>
  );
}

function SherivsPlatformPage() {
  return (
    <>
      {/* Hero — what Sherivs is */}
      <section aria-labelledby="coregrid-hero" className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {PLATFORM_TAGLINE}
          </p>
          <h1
            id="coregrid-hero"
            className="mt-3 max-w-3xl font-display text-4xl font-bold tracking-tight sm:text-5xl"
          >
            The intelligent operating platform for organizations
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Sherivs connects your organization&apos;s people, knowledge, workflows, communications,
            data, and AI workforce into one intelligent operating environment — one that understands
            how your organization works and continuously improves it.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Link
              to="/request-demo"
              className="rounded-md bg-primary px-5 py-2.5 text-center text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Request a demo
            </Link>
            <Link
              to="/auth"
              className="rounded-md border border-border px-5 py-2.5 text-center text-sm font-semibold transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Sign in
            </Link>
            <Link
              to="/"
              className="text-sm font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Back to the platform overview →
            </Link>
          </div>
        </div>
      </section>

      {/* Platform capabilities */}
      <section
        id="capabilities"
        aria-labelledby="capabilities-heading"
        className="border-b border-border"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <SectionHeading
            id="capabilities-heading"
            eyebrow="What Sherivs provides"
            title="One operating environment, six capabilities"
            lead="Everything an organization needs to run — represented, coordinated, and governed in one place."
          />
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SITE_CAPABILITIES.map((capability) => (
              <li
                key={capability.id}
                className="rounded-xl border border-border p-5 transition-colors hover:bg-muted/30"
              >
                <h3 className="font-display text-base font-semibold">{capability.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {capability.description}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Domain runtimes */}
      <section
        id="runtimes"
        aria-labelledby="runtimes-heading"
        className="border-b border-border bg-muted/20"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
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
                className="rounded-xl border border-border bg-background p-6"
              >
                <h3 className="font-display text-lg font-semibold">Sherivs {runtime.name}</h3>
                <p className="mt-1 text-sm font-medium">{runtime.description}</p>
              </article>
            ))}
            <article className="rounded-xl border border-dashed border-border p-6">
              <h3 className="font-display text-lg font-semibold">
                Commerce, Healthcare, Government
              </h3>
              <p className="mt-1 text-sm font-medium">Future industry runtimes</p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                The same platform, adapted to other kinds of organizations over time.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* Security & governance */}
      <section id="security" aria-labelledby="security-heading" className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <SectionHeading
            id="security-heading"
            eyebrow="Security & governance"
            title="Correct, secure, explainable, auditable"
            lead="Security is continuous: observe, evaluate, decide, enforce, audit, re-evaluate. These guarantees are enforced by the platform itself, not by any single application on it."
          />
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SECURITY_GUARANTEES.map((guarantee) => (
              <li
                key={guarantee.id}
                className="rounded-xl border border-border p-5 transition-colors hover:bg-muted/30"
              >
                <h3 className="font-display text-base font-semibold">{guarantee.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {guarantee.description}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Pricing */}
      <section
        id="pricing"
        aria-labelledby="pricing-heading"
        className="border-b border-border bg-muted/20"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
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
                    ? "border-primary bg-background shadow-sm"
                    : "border-border bg-background"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-lg font-semibold">{tier.name}</h3>
                  {tier.featured && (
                    <span className="rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-primary-foreground">
                      Recommended
                    </span>
                  )}
                </div>
                <p className="mt-3 font-display text-2xl font-bold">
                  {formatTierPrice(tier.monthlyPrice)}
                  {tier.monthlyPrice !== null && (
                    <span className="text-sm font-medium text-muted-foreground">/month</span>
                  )}
                </p>
                {tier.monthlyPrice !== null &&
                  tier.annualPrice !== null &&
                  tier.monthlyPrice > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      or {formatTierPrice(tier.annualPrice)}/year
                    </p>
                  )}
                <p className="mt-3 text-sm text-muted-foreground">{tier.summary}</p>
                <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                  {tier.highlights.map((highlight) => (
                    <li key={highlight} className="flex items-start gap-2">
                      <span aria-hidden="true" className="mt-0.5 text-primary">
                        ✓
                      </span>
                      {highlight}
                    </li>
                  ))}
                </ul>
                <Link
                  to="/request-demo"
                  className={`mt-6 rounded-md px-4 py-2 text-center text-sm font-semibold transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                    tier.featured
                      ? "bg-primary text-primary-foreground hover:opacity-90"
                      : "border border-border hover:bg-accent"
                  }`}
                >
                  {tier.ctaLabel}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Final CTA */}
      <section aria-labelledby="cta-heading">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="rounded-2xl border border-border bg-muted/20 p-8 text-center sm:p-12">
            <h2
              id="cta-heading"
              className="font-display text-2xl font-bold tracking-tight sm:text-3xl"
            >
              Bring your organization onto one operating environment
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              Request a demo and we&apos;ll show you how Sherivs would work for how your
              organization operates — or sign in if you already have a workspace.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/request-demo"
                className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Request a demo
              </Link>
              <Link
                to="/auth"
                className="rounded-md border border-border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
