import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { PLATFORM_NAME, PLATFORM_TAGLINE } from "@/lib/platform";
import { SiteHeader } from "@/components/public/site-header";

/**
 * Sherivs public site — pathless layout group `(site)`.
 *
 * Presents the company and platform to visitors: what Sherivs is, what it
 * provides, security posture, and real routes into engagement (request a demo,
 * sign in at /auth). Presentation only — no tenant context, no database
 * reads, no fake submissions; every interactive element links to a real route.
 * Internal architecture (phases, kernel contracts, registries) stays behind
 * authentication in the internal Sherivs operating environment.
 */

export const Route = createFileRoute("/(site)")({
  component: SiteLayout,
});

function SiteLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <SiteHeader />

      <main id="main-content" className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-10 text-sm sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          <div>
            <p className="font-display font-bold">{PLATFORM_NAME}</p>
            <p className="mt-1 text-muted-foreground">{PLATFORM_TAGLINE}</p>
          </div>
          <nav aria-label="Platform" className="grid gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Platform
            </p>
            <Link
              to="/"
              className="text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Overview
            </Link>
            <Link
              to="/coregrid"
              className="text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Platform detail
            </Link>
            <Link
              to="/request-demo"
              className="text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Request a demo
            </Link>
          </nav>
          <nav aria-label="Company" className="grid gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Company
            </p>
            <Link
              to="/about"
              className="text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              About
            </Link>
            <Link
              to="/contact"
              className="text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Contact
            </Link>
          </nav>
          <nav aria-label="Legal" className="grid gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Legal
            </p>
            <Link
              to="/privacy-policy"
              className="text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Privacy policy
            </Link>
            <Link
              to="/terms"
              className="text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Terms of service
            </Link>
            <Link
              to="/auth"
              className="text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Sign in
            </Link>
          </nav>
        </div>
        <div className="border-t border-border py-4 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} {PLATFORM_NAME}. Intelligent operating infrastructure for
          organizations.
        </div>
      </footer>
    </div>
  );
}
