/**
 * Sherivs public experience (Plane A) — company/platform home.
 *
 * Calm enterprise presentation. No fabricated customers, logos, metrics,
 * or certifications. CTAs land on the real auth surface.
 */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { PLATFORM_NAME, PLATFORM_TAGLINE, PLATFORM_CATEGORY } from "@/lib/platform";
import {
  INSTALLED_RUNTIME_PROOFS,
  SECURITY_GUARANTEES,
  SITE_CAPABILITIES,
} from "@/routes/(site)/-content/site-content";
import { MARKETING_TIERS, formatTierPrice } from "@/routes/(site)/-content/pricing-tiers";

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

export function SherivsPublicHome() {
  return (
    <>
      <section aria-labelledby="sherivs-hero" className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {PLATFORM_CATEGORY}
          </p>
          <h1
            id="sherivs-hero"
            className="mt-3 max-w-3xl font-display text-4xl font-bold tracking-tight sm:text-5xl"
          >
            {PLATFORM_NAME}
          </h1>
          <p className="mt-3 max-w-2xl font-display text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {PLATFORM_TAGLINE}
          </p>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Organizations operate across fragmented systems, people, documents, workflows, and
            decisions. {PLATFORM_NAME} holds a persistent organizational reality model above those
            systems and coordinates humans and AI workers against it — with authority, evidence, and
            verification.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/auth"
              className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Request a demo
            </Link>
            <a
              href="#capabilities"
              className="rounded-md border border-border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Explore the platform
            </a>
            <Link
              to="/platform"
              className="text-sm font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Platform detail →
            </Link>
          </div>
        </div>
      </section>

      <section id="problem" aria-labelledby="problem-heading" className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <SectionHeading
            id="problem-heading"
            eyebrow="The problem"
            title="Fragmentation is the operating condition"
            lead="People, systems, documents, communications, workflows, policies, and data rarely share one authorized model of what is true."
          />
        </div>
      </section>

      <section id="capabilities" aria-labelledby="capabilities-heading" className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <SectionHeading
            id="capabilities-heading"
            eyebrow="Platform pillars"
            title="Reality, memory, workforce, missions, experience, governance"
            lead="Every pillar maps onto shipped platform capabilities. Nothing here is a marketing abstraction without an implementation."
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

      <section
        id="runtimes"
        aria-labelledby="runtimes-heading"
        className="border-b border-border bg-muted/20"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <SectionHeading
            id="runtimes-heading"
            eyebrow="Domain runtimes"
            title="Sherivs Scholar — first installed runtime, not the definition of Sherivs"
            lead="A runtime installs on the platform. The platform remains valid without any one of them. Future domains do not rewrite the substrate."
          />
          <div className="mt-10 grid gap-4 lg:grid-cols-2">
            {INSTALLED_RUNTIME_PROOFS.map((runtime) => (
              <article
                key={runtime.manifestId}
                className="rounded-xl border border-border bg-background p-6"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-display text-lg font-semibold">
                    {runtime.name === "Scholar" ? "Sherivs Scholar" : runtime.name}
                  </h3>
                  <span className="rounded-full border border-border bg-muted/30 px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
                    {runtime.manifestId}
                  </span>
                </div>
                <p className="mt-1 text-sm font-medium">{runtime.description}</p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{runtime.proof}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="pricing"
        aria-labelledby="pricing-heading"
        className="border-b border-border bg-muted/20"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <SectionHeading
            id="pricing-heading"
            eyebrow="Plans"
            title="Commercial tiers from the live catalog"
            lead="Prices mirror the platform commercial catalog. Entitlements are enforced after activation — never by this page."
          />
          <ul className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {MARKETING_TIERS.map((tier) => (
              <li
                key={tier.id}
                className={`flex flex-col rounded-xl border p-6 ${
                  tier.featured ? "border-primary bg-background shadow-sm" : "border-border bg-background"
                }`}
              >
                <h3 className="font-display text-lg font-semibold">{tier.name}</h3>
                <p className="mt-3 font-display text-2xl font-bold">
                  {formatTierPrice(tier.monthlyPrice)}
                  {tier.monthlyPrice !== null && (
                    <span className="text-sm font-medium text-muted-foreground">/month</span>
                  )}
                </p>
                <p className="mt-3 text-sm text-muted-foreground">{tier.summary}</p>
                <Link
                  to="/auth"
                  className={`mt-6 rounded-md px-4 py-2 text-center text-sm font-semibold ${
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

      <section id="security" aria-labelledby="security-heading" className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <SectionHeading
            id="security-heading"
            eyebrow="Security & governance"
            title="Default deny. Evidence after action. Humans retain authority."
            lead="AI output is never authority. Critical operations require policy, verification, and audit."
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

      <section aria-labelledby="cta-heading">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="rounded-2xl border border-border bg-muted/20 p-8 text-center sm:p-12">
            <h2
              id="cta-heading"
              className="font-display text-2xl font-bold tracking-tight sm:text-3xl"
            >
              See {PLATFORM_NAME} against your organization
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              Request a demo on the real sign-in surface. No invented customers, no fabricated
              metrics — a governed walkthrough of reality, missions, workforce, and verification.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/auth"
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

export function SherivsPublicChrome({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            to="/"
            className="font-display text-lg font-bold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {PLATFORM_NAME}
          </Link>
          <nav aria-label="Site" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <a href="#capabilities" className="text-muted-foreground hover:text-foreground">
              Platform
            </a>
            <a href="#runtimes" className="text-muted-foreground hover:text-foreground">
              Runtimes
            </a>
            <a href="#security" className="text-muted-foreground hover:text-foreground">
              Security
            </a>
            <Link to="/platform" className="text-muted-foreground hover:text-foreground">
              Detail
            </Link>
          </nav>
          <nav aria-label="Account" className="flex items-center gap-2 text-sm">
            <Link
              to="/auth"
              className="rounded-md border border-border px-3 py-1.5 font-semibold hover:bg-accent"
            >
              Sign in
            </Link>
            <Link
              to="/auth"
              className="rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground hover:opacity-90"
            >
              Request a demo
            </Link>
          </nav>
        </div>
      </header>
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        {PLATFORM_NAME} · {PLATFORM_TAGLINE} · domain runtimes are tenants of the platform, never its
        owner.
      </footer>
    </div>
  );
}
