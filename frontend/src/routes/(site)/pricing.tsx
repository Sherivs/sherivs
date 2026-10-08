import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { PageHeader, Section } from "@/components/sherivs/public-shell";
import { publicHead } from "@/lib/sherivs/page-head";
import { MARKETING_TIERS, formatTierPrice } from "./-content/pricing-tiers";

export const Route = createFileRoute("/(site)/pricing")({
  component: PricingPage,
  head: () =>
    publicHead({
      path: "/pricing",
      title: "Pricing",
      description: "Sherivs commercial plans, from a 30-day trial to custom enterprise contracts.",
      breadcrumbs: true,
    }),
});

function PricingPage() {
  return (
    <>
      <PageHeader
        path="/pricing"
        eyebrow="Pricing"
        title="Plans that grow with the organization."
        lead="Prices are in Nigerian naira (₦). Plans mirror the platform's commercial catalog; entitlements are enforced by the product after sign-in, never by this page."
      />
      <Section id="plans" title="Plans">
        <ul className="grid gap-px overflow-hidden rounded-[var(--sv-radius-lg)] border border-[color:var(--sv-line)] bg-[color:var(--sv-line)] md:grid-cols-2 xl:grid-cols-5">
          {MARKETING_TIERS.map((tier) => (
            <li key={tier.id} className="sv-ground grid content-start gap-5 p-6">
              <div className="grid gap-1">
                <h3 className="sv-h3">{tier.name}</h3>
                {tier.featured ? (
                  <p className="sv-label" style={{ color: "var(--sv-signal)" }}>
                    Recommended
                  </p>
                ) : null}
              </div>
              <p>
                <span className="sv-metric">{formatTierPrice(tier.monthlyPrice)}</span>
                {tier.monthlyPrice !== null && tier.monthlyPrice > 0 ? (
                  <span className="sv-small sv-muted"> / month</span>
                ) : null}
              </p>
              {tier.annualPrice !== null && tier.annualPrice > 0 ? (
                <p className="sv-caption sv-muted">{formatTierPrice(tier.annualPrice)} billed annually</p>
              ) : null}
              <p className="sv-small sv-muted">{tier.summary}</p>
              <ul className="grid gap-2">
                {tier.highlights.map((h) => (
                  <li key={h} className="sv-small flex gap-2">
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-[color:var(--sv-kind-verification)]" />
                    {h}
                  </li>
                ))}
              </ul>
              <Link to="/auth" className={`sv-btn ${tier.featured ? "sv-btn-primary" : ""}`}>
                {tier.ctaLabel}
                <span className="sr-only"> — {tier.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
