import { createFileRoute, Link } from "@tanstack/react-router";
import { SherivsPublicShell } from "@/components/sherivs/public-shell";
import { MARKETING_TIERS, formatTierPrice } from "@/routes/(site)/-content/pricing-tiers";
import { SHERIVS_PUBLIC_ORIGIN } from "@/lib/sherivs-brand";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
  head: () => ({
    meta: [
      { title: "Sherivs pricing" },
      {
        name: "description",
        content:
          "Sherivs plans that scale with your institution. Entitlements are enforced by platform contracts after activation — never by this page.",
      },
      { property: "og:title", content: "Sherivs pricing" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SHERIVS_PUBLIC_ORIGIN}/pricing` },
    ],
    links: [{ rel: "canonical", href: `${SHERIVS_PUBLIC_ORIGIN}/pricing` }],
  }),
});

function PricingPage() {
  return (
    <SherivsPublicShell>
      <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Pricing
        </p>
        <h1 className="mt-3 max-w-3xl font-display text-3xl font-bold tracking-tight text-balance sm:text-5xl">
          Plans that scale with your institution.
        </h1>
        <p className="mt-5 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          Prices are shown in ₦ and mirror the platform&apos;s commercial tier catalog. Entitlements
          are enforced by platform contracts after activation — this page describes them, it does
          not grant them.
        </p>
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
                <h2 className="font-display text-lg font-semibold">{tier.name}</h2>
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
                className={`mt-6 rounded-md px-4 py-2 text-center text-sm font-semibold transition-opacity ${
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
    </SherivsPublicShell>
  );
}
