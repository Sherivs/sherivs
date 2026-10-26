import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { SiteHeader } from "@/components/public/site-header";

/**
 * Sherivs public site — pathless layout group `(site)`.
 *
 * Functional public chrome only. The Lovable marketing prototype (story
 * sections, pricing, platform narrative) was removed so the company site can
 * be rebuilt. Remaining pages are real routes: auth, legal, contact, status,
 * and operational tools.
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
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-sm sm:px-6">
          <p className="font-display font-bold">{PLATFORM_NAME}</p>
          <nav aria-label="Legal" className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link
              to="/contact"
              className="text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Contact
            </Link>
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
      </footer>
    </div>
  );
}
