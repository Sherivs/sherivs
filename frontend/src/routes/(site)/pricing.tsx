import { createFileRoute, Link } from "@tanstack/react-router";
import { MARKETING_TIERS, formatTierPrice } from "./-content/pricing-tiers";
import { PLATFORM_NAME } from "@/lib/platform";

export const Route = createFileRoute("/(site)/pricing")({
  component: PricingPage,
  head: () => ({
    meta: [
      { title: `Pricing — ${PLATFORM_NAME}` },
      {
        name: "description",
        content:
          "Commercial tiers mirrored from the platform catalog. Entitlements are enforced after activation — never by this page.",
      },
    ],
  }),
});

function PricingPage() {
  return (
    <article>
      <header className="sv-public-wrap border-b border-border py-16 sm:py-20">
        <p className="sv-kicker">Pricing</p>
        <h1 className="sv-display mt-3">Plans that scale with the institution</h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">
          Prices are shown in ₦ and mirror the platform commercial catalog. This page does not grant
          access. Feature-access contracts enforce entitlements after activation.
        </p>
      </header>
      <div className="sv-public-wrap py-16">
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {MARKETING_TIERS.map((tier) => (
            <li
              key={tier.id}
              className={`flex flex-col border p-6 ${
                tier.featured ? "border-[color:var(--sv-signal)] bg-[color:var(--sv-surface-raised)]" : "border-border"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-lg font-semibold">{tier.name}</h2>
                {tier.featured && (
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-[color:var(--sv-signal)]">
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
                  <li key={highlight}>{highlight}</li>
                ))}
              </ul>
              <Link
                to="/auth"
                className={`mt-6 rounded-md px-4 py-2 text-center text-sm font-semibold ${
                  tier.featured ? "sv-btn-signal" : "border border-border hover:bg-accent"
                }`}
              >
                {tier.ctaLabel}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
