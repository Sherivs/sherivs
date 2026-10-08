import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { PLATFORM_TAGLINE } from "@/lib/platform";
import { SherivsLockup } from "@/components/sherivs/sherivs-logo";
import { SHERIVS_FOOTER_COLUMNS, SHERIVS_PRIMARY_NAV } from "@/components/sherivs/public-registry";

/**
 * Sherivs platform public site — pathless layout group `(site)`.
 *
 * Presents the platform itself to visitors: what Sherivs is, its
 * capabilities, security posture, pricing, and real routes into the product
 * (sign up / sign in at /auth). Presentation only — no tenant context, no
 * database reads, no fake submissions; every interactive element links to a
 * real route.
 */

export const Route = createFileRoute("/(site)")({
  component: SiteLayout,
});

function SiteLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            to="/sherivs"
            aria-label="Sherivs home"
            className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <SherivsLockup />
          </Link>

          <nav
            aria-label="Site"
            className="hidden flex-wrap items-center gap-x-4 gap-y-2 text-sm md:flex"
          >
            {SHERIVS_PRIMARY_NAV.slice(0, 4).map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {item.label}
              </Link>
            ))}
            <Link
              to="/platform"
              className="text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Kernel detail
            </Link>
          </nav>

          <nav aria-label="Account" className="flex items-center gap-2 text-sm">
            <Link
              to="/auth"
              className="rounded-md border border-border px-3 py-1.5 font-semibold transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Sign in
            </Link>
            <Link
              to="/auth"
              className="rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Sign up
            </Link>
          </nav>
        </div>
      </header>

      <main id="main-content" className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-10 text-sm sm:grid-cols-2 sm:px-6 lg:grid-cols-6">
          <div>
            <SherivsLockup compact />
            <p className="mt-2 text-muted-foreground">{PLATFORM_TAGLINE}</p>
          </div>
          {SHERIVS_FOOTER_COLUMNS.slice(0, 4).map((column) => (
            <nav
              key={column.heading}
              aria-label={column.heading}
              className="grid content-start gap-2"
            >
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {column.heading}
              </p>
              {column.links.map((link) =>
                link.to.includes("#") ? (
                  <a
                    key={`${link.label}${link.to}`}
                    href={link.to}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link
                    key={`${link.label}${link.to}`}
                    to={link.to}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                ),
              )}
            </nav>
          ))}
          <nav aria-label="Account" className="grid content-start gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Account
            </p>
            <Link
              to="/auth"
              className="text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Sign in
            </Link>
            <Link
              to="/auth"
              className="text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Create account
            </Link>
          </nav>
        </div>
        <div className="border-t border-border py-4 text-center text-xs text-muted-foreground">
          Sherivs · every runtime is a tenant of the kernel, never its owner.
        </div>
      </footer>
    </div>
  );
}
