import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME, PLATFORM_TAGLINE } from "@/lib/platform";
import {
  INSTALLED_RUNTIME_PROOFS,
  SECURITY_GUARANTEES,
  SITE_CAPABILITIES,
} from "./-content/site-content";
import { MARKETING_TIERS, formatTierPrice } from "./-content/pricing-tiers";

/**
 * CoreGrid platform public site — landing page at /coregrid.
 *
 * Static marketing presentation of the platform: what CoreGrid is, its
 * capabilities, installed runtimes, security posture and commercial tiers.
 * All content is typed and database-free; every interactive element links to
 * a real route (/auth for sign up and sign in, /platform for kernel detail).
 * Sign-up and sign-in resolve to the platform's single auth surface at /auth,
 * where account creation is the "Create account" mode.
 */

export const Route = createFileRoute("/(site)/coregrid")({
  component: CoreGridSitePage,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} — ${PLATFORM_TAGLINE}` },
      {
        name: "description",
        content:
          "CoreGrid is the AI-native institutional operating system: a governed kernel with reality models, missions, an AI workforce, evidence and policy — plus the domain runtimes organizations install on it.",
      },
      { property: "og:title", content: `${PLATFORM_NAME} — ${PLATFORM_TAGLINE}` },
      {
        property: "og:description",
        content:
          "One governed platform for institutions: reality model, missions, AI workforce, evidence, governance and workspace.",
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
      {lead && <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">{lead}</p>}
    </div>
  );
}

function CoreGridSitePage() {
  return (
    <>
      {/* Hero — what CoreGrid is */}
      <section aria-labelledby="coregrid-hero" className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {PLATFORM_TAGLINE}
          </p>
          <h1
            id="coregrid-hero"
            className="mt-3 max-w-3xl font-display text-4xl font-bold tracking-tight sm:text-5xl"
          >
            The AI-native institutional operating system
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            CoreGrid unifies organizations, people, places, devices, workflows, knowledge,
            payments and automation into one governed ecosystem — a kernel with registries,
            events, policies and evidence, on which institutions install the domain runtimes
            they actually need.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/auth"
              className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Create your account
            </Link>
            <Link
              to="/auth"
              className="rounded-md border border-border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Sign in
            </Link>
            <Link
              to="/platform"
              className="text-sm font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Explore the kernel →
            </Link>
          </div>
        </div>
      </section>

      {/* Platform capabilities */}
      <section id="capabilities" aria-labelledby="capabilities-heading" className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <SectionHeading
            id="capabilities-heading"
            eyebrow="Platform capabilities"
            title="One governed core, six capabilities"
            lead="Every capability is owned by a platform phase, enforced by contracts, and consumed by the runtimes and workspaces an organization installs."
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
      <section id="runtimes" aria-labelledby="runtimes-heading" className="border-b border-border bg-muted/20">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <SectionHeading
            id="runtimes-heading"
            eyebrow="Domain runtimes"
            title="Runtimes extend the platform — they are never its identity"
            lead="A runtime is an application installed on the kernel: it consumes platform primitives and brings only its own domain. The platform remains fully valid without any one of them."
          />
          <div className="mt-10 grid gap-4 lg:grid-cols-2">
            {INSTALLED_RUNTIME_PROOFS.map((runtime) => (
              <article key={runtime.manifestId} className="rounded-xl border border-border bg-background p-6">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-display text-lg font-semibold">{runtime.name}</h3>
                  <span className="rounded-full border border-border bg-muted/30 px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
                    {runtime.manifestId}
                  </span>
                </div>
                <p className="mt-1 text-sm font-medium">{runtime.description}</p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{runtime.proof}</p>
              </article>
            ))}
          </div>
          <p className="mt-6 max-w-3xl text-xs text-muted-foreground">
            Adding a runtime is a line in the installed-runtime registry plus its own contribution
            catalogs and adapters — the kernel, its contracts and its governance never change for
            one application.
          </p>
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
      <section id="pricing" aria-labelledby="pricing-heading" className="border-b border-border bg-muted/20">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <SectionHeading
            id="pricing-heading"
            eyebrow="Pricing"
            title="Plans that scale with your institution"
            lead="Prices are shown in ₦ and mirror the platform's commercial tier catalog. Entitlements are enforced by the platform's feature-access contracts after activation — never by this page."
          />
          <ul className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {MARKETING_TIERS.map((tier) => (
              <li
                key={tier.id}
                className={`flex flex-col rounded-xl border p-6 ${
                  tier.featured ? "border-primary bg-background shadow-sm" : "border-border bg-background"
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
                {tier.monthlyPrice !== null && tier.annualPrice !== null && tier.monthlyPrice > 0 && (
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
                  to="/auth"
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
            <h2 id="cta-heading" className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              Put your institution on governed rails
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              Create an account on the platform's real auth surface, and an administrator links
              your identity to your organization's tenant — with roles, policies and workspaces
              projected from the governed core.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/auth"
                className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Sign up
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