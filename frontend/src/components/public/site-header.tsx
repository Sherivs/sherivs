import { Link } from "@tanstack/react-router";
import { PLATFORM_NAME, PLATFORM_TAGLINE } from "@/lib/platform";

/**
 * Sherivs public site header (Plane A chrome).
 *
 * Single source for the company-site navigation — used by the (site) layout
 * AND the homepage component (which renders outside the layout group so
 * tenant hosts can render a different public site at the same path).
 *
 * Navigation per refoundation §7: platform story sections, real routes only.
 * The Account nav offers Sign in (the platform auth surface) and Request a
 * demo — never Scholar-specific entry points, never credentials.
 */
const SECTION_LINKS = [
  { href: "/#platform", label: "Platform" },
  { href: "/#ai-workforce", label: "AI Workforce" },
  { href: "/#solutions", label: "Solutions" },
  { href: "/#enterprise", label: "Enterprise" },
  { href: "/#security", label: "Security" },
] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link
          to="/"
          className="font-display text-lg font-bold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {PLATFORM_NAME}
        </Link>

        <nav aria-label="Site" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {SECTION_LINKS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <nav aria-label="Account" className="flex items-center gap-2 text-sm">
          <Link
            to="/auth"
            className="rounded-md border border-border px-3 py-1.5 font-semibold transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Sign in
          </Link>
          <Link
            to="/request-demo"
            className="rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Request a demo
          </Link>
        </nav>
      </div>
      <p className="sr-only">{PLATFORM_TAGLINE}</p>
    </header>
  );
}
