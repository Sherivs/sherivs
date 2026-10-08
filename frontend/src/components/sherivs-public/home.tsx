import { Link } from "@tanstack/react-router";
import { PLATFORM_NAME, PLATFORM_TAGLINE } from "@/lib/platform";
import {
  INSTALLED_RUNTIME_PROOFS,
  SECURITY_GUARANTEES,
  SITE_CAPABILITIES,
} from "@/routes/(site)/-content/site-content";
import { HOME_NARRATIVE, SPATIAL_PLANES } from "@/routes/(site)/-content/narrative";

export function SherivsHomePage() {
  const brand = HOME_NARRATIVE[0];
  const rest = HOME_NARRATIVE.slice(1);

  return (
    <>
      <section aria-labelledby="sherivs-hero" className="sv-hero border-b border-border">
        <div className="sv-public-wrap grid gap-12 py-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(16rem,0.85fr)] lg:py-24">
          <div>
            <p className="sv-kicker">{brand.eyebrow}</p>
            <h1 id="sherivs-hero" className="sv-display mt-4 max-w-3xl">
              {brand.title}
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              {brand.body}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/request-demo"
                className="sv-btn-signal rounded-md px-5 py-2.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Request a demo
              </Link>
              <Link
                to="/platform"
                className="rounded-md border border-border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Explore the platform
              </Link>
              <Link
                to="/auth"
                className="text-sm font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Sign in
              </Link>
            </div>
          </div>
          <aside className="sv-plane-stack" aria-label="Experience planes">
            {SPATIAL_PLANES.map((plane, index) => (
              <div key={plane.id} className={`sv-plane sv-plane-${plane.id}`}>
                <span className="sv-kicker">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <p className="mt-2 font-display text-lg font-semibold">{plane.label}</p>
                <p className="mt-1 text-sm text-muted-foreground">{plane.description}</p>
              </div>
            ))}
          </aside>
        </div>
      </section>

      {rest.map((beat) => (
        <section
          key={beat.id}
          id={beat.id}
          aria-labelledby={`${beat.id}-heading`}
          className="border-b border-border"
        >
          <div className="sv-public-wrap grid gap-8 py-16 lg:grid-cols-[7rem_minmax(0,1fr)] lg:py-20">
            <p className="sv-index" aria-hidden="true">
              {beat.index}
            </p>
            <div>
              <p className="sv-kicker">{beat.eyebrow}</p>
              <h2 id={`${beat.id}-heading`} className="sv-title mt-2">
                {beat.title}
              </h2>
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                {beat.body}
              </p>
              {beat.id === "cta" && (
                <div className="mt-8 flex flex-wrap gap-3">
                  <Link
                    to="/request-demo"
                    className="sv-btn-signal rounded-md px-5 py-2.5 text-sm font-semibold"
                  >
                    Request a demo
                  </Link>
                  <Link
                    to="/platform"
                    className="rounded-md border border-border px-5 py-2.5 text-sm font-semibold hover:bg-accent"
                  >
                    Explore the platform
                  </Link>
                </div>
              )}
              {beat.points && beat.id === "missions" && (
                <ol className="sv-mission-path mt-8">
                  {beat.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ol>
              )}
              {beat.points && beat.id !== "missions" && (
                <ul className="sv-plane-list mt-8">
                  {beat.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              )}
              {beat.id === "runtimes" && (
                <div className="mt-10 grid gap-4 lg:grid-cols-2">
                  {INSTALLED_RUNTIME_PROOFS.map((runtime) => (
                    <article key={runtime.manifestId} className="sv-runtime-proof">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="font-display text-lg font-semibold">{runtime.name}</h3>
                        <span className="rounded-full border border-border px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
                          {runtime.manifestId}
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-medium">{runtime.description}</p>
                      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                        {runtime.proof}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      ))}

      <section id="capabilities" aria-labelledby="capabilities-heading" className="border-b border-border">
        <div className="sv-public-wrap py-16 sm:py-20">
          <p className="sv-kicker">Capabilities</p>
          <h2 id="capabilities-heading" className="sv-title mt-2">
            Six platform capabilities, one governed core
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            These are not product tiles. They are the operating primitives every installed runtime consumes.
          </p>
          <dl className="sv-capability-rail mt-10">
            {SITE_CAPABILITIES.map((capability) => (
              <div key={capability.id} id={capability.id}>
                <dt className="font-display text-base font-semibold">{capability.title}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {capability.description}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="security" aria-labelledby="security-heading" className="border-b border-border">
        <div className="sv-public-wrap py-16 sm:py-20">
          <p className="sv-kicker">Governance</p>
          <h2 id="security-heading" className="sv-title mt-2">
            Trust is visible
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            {PLATFORM_NAME} enforces tenant isolation, layered authorization, canonical truth and agent lifecycle — in the platform, not in the UI.
          </p>
          <ul className="sv-guarantee-list mt-10">
            {SECURITY_GUARANTEES.map((guarantee) => (
              <li key={guarantee.id}>
                <h3 className="font-display text-base font-semibold">{guarantee.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {guarantee.description}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-8">
            <Link to="/security" className="text-sm font-semibold underline-offset-4 hover:underline">
              Full security architecture →
            </Link>
          </p>
        </div>
      </section>

      <section id="pricing" aria-labelledby="pricing-heading">
        <div className="sv-public-wrap py-16 sm:py-20">
          <p className="sv-kicker">Commercial</p>
          <h2 id="pricing-heading" className="sv-title mt-2">
            Plans that follow the real catalog
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            {PLATFORM_TAGLINE} is sold as commercial tiers with entitlements enforced after activation — never by this page. Prices are listed on the pricing surface.
          </p>
          <Link
            to="/pricing"
            className="sv-btn-signal mt-8 inline-flex rounded-md px-5 py-2.5 text-sm font-semibold"
          >
            View pricing
          </Link>
        </div>
      </section>
    </>
  );
}
