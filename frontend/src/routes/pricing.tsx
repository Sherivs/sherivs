import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { MARKETING_TIERS, formatTierPrice } from "./(site)/-content/pricing-tiers";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} — Commercial Tiers & Infrastructure Licensing` },
      {
        name: "description",
        content: "Transparent, institutional-grade commercial tiers for modern institutions and enterprise deployments.",
      },
    ],
  }),
});

function PricingPage() {
  return (
    <div className="min-h-screen bg-[color:var(--surface-1)] text-foreground">
      <header className="border-b border-border bg-[color:var(--surface-1)]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
          <Link to="/" className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            <span>Home</span>
          </Link>
          <div className="font-mono text-xs text-cyan-400">Commercial Tiers</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-12">
        <div className="max-w-3xl text-center mx-auto">
          <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">Institutional Licensing</span>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Transparent, Predictable Infrastructure
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            Deploy {PLATFORM_NAME} with transparent, capability-aligned commercial licensing. No hidden API surcharges, no unexpected compute lock-in.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-8">
          {MARKETING_TIERS.map((tier) => (
            <div
              key={tier.id}
              className={`sherivs-card p-6 flex flex-col justify-between ${
                tier.featured ? "border-cyan-500/40 shadow-[0_0_30px_rgba(0,240,255,0.1)] relative" : ""
              }`}
            >
              {tier.featured && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-cyan-500 text-black text-[10px] font-bold uppercase tracking-wider">
                  Recommended Tier
                </span>
              )}
              <div>
                <h3 className="font-display font-bold text-xl text-foreground">{tier.name}</h3>
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{tier.summary}</p>
                <div className="mt-6 flex items-baseline gap-2">
                  <span className="font-display text-3xl font-extrabold text-foreground">
                    {formatTierPrice(tier.monthlyPrice)}
                  </span>
                  {tier.monthlyPrice !== null && (
                    <span className="text-xs text-muted-foreground">/ month</span>
                  )}
                </div>

                <div className="mt-6 pt-6 border-t border-border space-y-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Included Capabilities</div>
                  {tier.highlights.map((highlight) => (
                    <div key={highlight} className="flex items-start gap-2 text-xs text-foreground/90">
                      <CheckCircle2 className="size-3.5 text-cyan-400 shrink-0 mt-0.5" />
                      <span>{highlight}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-border">
                <Link
                  to="/request-demo"
                  className={`w-full py-2.5 rounded-lg text-center font-semibold text-xs transition-all block ${
                    tier.featured
                      ? "bg-cyan-500 hover:bg-cyan-400 text-black shadow-[0_0_15px_rgba(0,240,255,0.25)]"
                      : "border border-border hover:bg-accent text-foreground"
                  }`}
                >
                  {tier.ctaLabel}
                </Link>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
