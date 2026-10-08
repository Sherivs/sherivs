import { createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { PageTitle } from "@/components/sherivs/page-chrome";
import { Container, LinkButton } from "@/components/sherivs/primitives";
import { publicHead } from "@/lib/experience-system/seo";
import { MARKETING_TIERS, formatTierPrice } from "./-content/pricing-tiers";

export const Route = createFileRoute("/(site)/pricing")({
  component: PricingPage,
  head: () => publicHead({ path: "/pricing" }),
});

function PricingPage() {
  return (
    <>
      <PageTitle
        path="/pricing"
        eyebrow="Pricing"
        title="Plans that scale with your organization."
        lead="Prices are shown in ₦ and mirror the platform's commercial tier catalog. Entitlements are enforced by the platform after activation — never by this page."
      />
      <Container wide className="py-12 sm:py-16">
        <ul className="grid gap-px bg-sv-border md:grid-cols-2 xl:grid-cols-5">
          {MARKETING_TIERS.map((tier) => (
            <li
              key={tier.id}
              aria-label={`${tier.name} plan`}
              className="flex flex-col bg-sv-surface-1 p-6"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="sv-h3">{tier.name}</h2>
                {tier.featured && (
                  <span className="sv-label border border-sv-accent px-2 py-0.5 text-sv-accent-text rounded-[var(--sv-radius-sm)]">
                    Recommended
                  </span>
                )}
              </div>
              <p className="sv-h2 mt-4">
                {formatTierPrice(tier.monthlyPrice)}
                {tier.monthlyPrice !== null && tier.monthlyPrice > 0 && (
                  <span className="sv-small text-sv-text-muted"> / month</span>
                )}
              </p>
              {tier.monthlyPrice !== null && tier.annualPrice !== null && tier.monthlyPrice > 0 && (
                <p className="sv-small text-sv-text-subtle">or {formatTierPrice(tier.annualPrice)} / year</p>
              )}
              <p className="sv-small mt-3 text-sv-text-muted">{tier.summary}</p>
              <ul className="mt-5 grid flex-1 gap-2 sv-small">
                {tier.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2">
                    <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-sv-success" />
                    {h}
                  </li>
                ))}
              </ul>
              {tier.monthlyPrice === null ? (
                <p className="sv-small mt-6 text-sv-text-subtle">
                  Agreed per contract. No online intake channel is available yet.
                </p>
              ) : (
                <LinkButton to="/auth" variant={tier.featured ? "primary" : "secondary"} className="mt-6">
                  {tier.ctaLabel}
                </LinkButton>
              )}
            </li>
          ))}
        </ul>
      </Container>
    </>
  );
}
