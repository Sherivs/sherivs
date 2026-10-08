import { createFileRoute, Link } from "@tanstack/react-router";
import { publicPageHead } from "@/content/sherivs/seo";
import { PageHero, Plane, SectionHeading } from "@/components/sherivs/primitives";
import { MARKETING_TIERS, formatTierPrice } from "./-content/pricing-tiers";

/**
 * Sherivs pricing at /pricing — a ruled ledger of plans, not a card wall. Prices come
 * from the typed tier module; entitlements are enforced by the platform after
 * activation, never by this page. Every call to action is the real auth surface.
 */
export const Route = createFileRoute("/(site)/pricing")({
  component: PricingPage,
  head: () => publicPageHead("/pricing"),
});

function PricingPage() {
  return (
    <>
      <PageHero
        id="pricing-heading"
        label="Pricing"
        title="Plans priced in naira, enforced by the platform."
        lead="Start with a free evaluation. Move between plans as the organization grows. What a plan includes is decided by the platform's entitlement engine after activation, not by this page."
      />

      <Plane labelledBy="plans-heading">
        <SectionHeading
          id="plans-heading"
          label="Plans"
          title="Five plans, one platform"
          lead="Every plan runs on the same governed core: tenancy, layered authorization, audit and the AI gateway. Plans differ in scale and in which product surfaces are switched on."
        />
        <ol className="mt-16 border-t border-sx-line-strong">
          {MARKETING_TIERS.map((tier) => (
            <li
              key={tier.id}
              aria-labelledby={`tier-${tier.id}`}
              className={
                tier.featured
                  ? "relative grid gap-6 border-b border-sx-line bg-sx-surface-2 px-4 py-10 md:grid-cols-12 md:gap-10 md:px-6"
                  : "grid gap-6 border-b border-sx-line py-10 md:grid-cols-12 md:gap-10"
              }
            >
              {tier.featured && (
                <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-sx-signal" />
              )}
              <div className="md:col-span-3">
                <h3 id={`tier-${tier.id}`} className="sx-h3">
                  {tier.name}
                </h3>
                {tier.featured && <p className="sx-label mt-2 text-sx-signal">Recommended</p>}
                <p className="sx-small mt-3 text-sx-muted">{tier.summary}</p>
              </div>
              <div className="md:col-span-3">
                <p className="sx-metric">
                  {formatTierPrice(tier.monthlyPrice)}
                  {tier.monthlyPrice !== null && <span className="sx-small ml-1 text-sx-muted">/ month</span>}
                </p>
                <p className="sx-caption mt-2">
                  {tier.annualPrice === null
                    ? "Quoted as a contract"
                    : tier.annualPrice === 0
                      ? "No payment details required"
                      : `${formatTierPrice(tier.annualPrice)} billed annually`}
                </p>
              </div>
              <ul className="grid content-start gap-2 md:col-span-4">
                {tier.highlights.map((highlight) => (
                  <li key={highlight} className="flex gap-3 text-sm text-sx-text">
                    <span aria-hidden="true" className="mt-2 h-px w-3 shrink-0 bg-sx-line-strong" />
                    {highlight}
                  </li>
                ))}
              </ul>
              <div className="md:col-span-2 md:justify-self-end">
                <Link
                  to="/auth"
                  aria-label={`${tier.ctaLabel} — ${tier.name} plan`}
                  className={tier.featured ? "sx-button sx-button-primary" : "sx-button sx-button-secondary"}
                >
                  {tier.ctaLabel}
                </Link>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-10 grid gap-4 sx-small text-sx-muted lg:ml-[33.333%]">
          <p>
            Prices are in Nigerian naira (₦). Payment events are accepted only when the provider's
            signature verifies, and plan state is never taken from the browser.
          </p>
          <p>
            Some plan features depend on platform layers marked <strong>Foundation</strong> on the{" "}
            <Link to="/platform" className="sx-link">
              platform page
            </Link>
            ; they switch on as those layers reach service.
          </p>
        </div>
      </Plane>
    </>
  );
}
