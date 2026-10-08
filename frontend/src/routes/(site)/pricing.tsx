import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { Chip, Panel } from "@/components/sherivs/primitives";
import { PublicPageIntro, PublicSection } from "@/components/sherivs/public/public-shell";
import { canonicalUrl, pageTitle } from "@/lib/experience/brand";
import { MARKETING_TIERS, formatTierPrice } from "@/lib/experience/public-content";
import { cn } from "@/lib/utils";

const DESCRIPTION =
  "Commercial tiers mirrored from the platform's tier catalog. Entitlements are enforced by the platform after activation, never by this page.";

export const Route = createFileRoute("/(site)/pricing")({
  component: PricingPage,
  head: () => ({
    meta: [
      { title: pageTitle("Pricing") },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: pageTitle("Pricing") },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: canonicalUrl("/pricing") },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/pricing") }],
  }),
});

function PricingPage() {
  return (
    <>
      <PublicPageIntro eyebrow="Pricing" title="Five tiers. One platform core on every one of them." lead={DESCRIPTION} />

      <PublicSection labelledBy="tiers-heading">
        <h2 id="tiers-heading" className="sr-only">
          Tiers
        </h2>
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {MARKETING_TIERS.map((tier) => (
            <li key={tier.id} className="flex">
              <Panel
                raised={tier.featured}
                tone={tier.featured ? "action" : undefined}
                className={cn("flex w-full flex-col", tier.featured && "ring-1 ring-signal/40")}
                aria-labelledby={`tier-${tier.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p id={`tier-${tier.id}`} className="sh-h4">
                    {tier.name}
                  </p>
                  {tier.featured && <Chip tone="action">Recommended</Chip>}
                </div>
                <p className="sh-metric mt-4 text-ink-1">{formatTierPrice(tier.monthlyPrice)}</p>
                <p className="sh-caption mt-1">
                  {tier.monthlyPrice === null
                    ? "Custom contract"
                    : tier.monthlyPrice === 0
                      ? "Free for 30 days"
                      : `per month · ${formatTierPrice(tier.annualPrice)} per year`}
                </p>
                <p className="sh-small mt-4 text-ink-2">{tier.summary}</p>
                <ul className="sh-small mt-5 mb-6 grid gap-2 text-ink-2">
                  {tier.highlights.map((highlight) => (
                    <li key={highlight} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-signal" aria-hidden="true" />
                      <span>{highlight}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  to="/auth"
                  className={cn(
                    "sh-interactive sh-focus sh-small mt-auto pt-0 inline-flex h-10 items-center justify-center rounded-[var(--sh-radius-md)] px-4 font-semibold",
                    tier.featured
                      ? "bg-signal text-signal-on hover:bg-signal-strong"
                      : "border border-line-2 bg-plane-2 text-ink-1",
                  )}
                >
                  {tier.ctaLabel}
                </Link>
              </Panel>
            </li>
          ))}
        </ul>
        <p className="sh-caption mt-6">
          Prices are in Nigerian naira and mirror the platform's subscription catalog. Choosing a
          tier takes you to account creation; activation and entitlements are handled by the
          platform after your organization is linked.
        </p>
      </PublicSection>
    </>
  );
}
