import { Link } from "@tanstack/react-router";
import { PLATFORM_NAME, PLATFORM_TAGLINE } from "@/lib/platform";
import { SherivsLogo } from "@/components/brand/sherivs-logo";

/**
 * Sherivs public site header.
 *
 * Shared by the (site) layout and the homepage (which renders outside the
 * layout group so tenant hosts can serve a different public site at `/`).
 * Chrome only: brand + the real /auth surface. Marketing story links from the
 * Lovable prototype are gone.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link
          to="/"
          aria-label={`${PLATFORM_NAME} home`}
          className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <SherivsLogo size={30} wordmarkClassName="text-lg" />
        </Link>

        <nav aria-label="Account" className="flex items-center gap-2 text-sm">
          <Link
            to="/auth"
            className="rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Sign in
          </Link>
        </nav>
      </div>
      <p className="sr-only">{PLATFORM_TAGLINE}</p>
    </header>
  );
}
