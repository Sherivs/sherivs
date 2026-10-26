import { Link } from "@tanstack/react-router";
import { PLATFORM_NAME, PLATFORM_TAGLINE } from "@/lib/platform";
import { SiteHeader } from "@/components/public/site-header";

/**
 * Sherivs public company homepage (PLANE 1 — sherivs.com).
 *
 * The Lovable marketing prototype was removed so the company site can be
 * rebuilt. This surface is a blank canvas: brand identity and a real sign-in
 * route only. It must never expose internal architecture, registries,
 * credentials, or a domain runtime as the company.
 */
export function SherivsHome() {
  return (
    <>
      <SiteHeader />
      <main id="main-content">
        <section aria-labelledby="sherivs-hero" className="border-b border-border">
          <div className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-6">
            <h1
              id="sherivs-hero"
              className="font-display text-3xl font-bold tracking-tight sm:text-5xl"
            >
              {PLATFORM_NAME}
            </h1>
            <p className="mt-4 max-w-xl text-sm text-muted-foreground sm:text-base">
              {PLATFORM_TAGLINE}
            </p>
            <div className="mt-8">
              <Link
                to="/auth"
                className="inline-flex rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
