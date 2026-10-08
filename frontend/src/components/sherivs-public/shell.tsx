import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { PLATFORM_NAME, PLATFORM_TAGLINE } from "@/lib/platform";
import { PUBLIC_FOOTER_NAV, PUBLIC_PRIMARY_NAV } from "@/lib/experience/sherivs-public-ia";
import { SherivsBrandMark } from "./brand";

interface SherivsPublicShellProps {
  readonly children: React.ReactNode;
}

export function SherivsPublicShell({ children }: SherivsPublicShellProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="sv-public flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sv-public-header sticky top-0 z-40">
        <div className="sv-public-wrap flex items-center justify-between gap-3 py-3">
          <Link
            to="/"
            className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <SherivsBrandMark />
            <span className="sr-only">{PLATFORM_NAME} home</span>
          </Link>

          <nav aria-label="Site" className="hidden items-center gap-6 text-sm lg:flex">
            {PUBLIC_PRIMARY_NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              to="/auth"
              className="hidden rounded-md px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground sm:inline-flex focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Sign in
            </Link>
            <Link
              to="/request-demo"
              className="sv-btn-signal hidden rounded-md px-3 py-1.5 text-sm font-semibold sm:inline-flex focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Request demo
            </Link>
            <button
              type="button"
              className="inline-flex size-10 items-center justify-center rounded-md border border-border lg:hidden"
              aria-expanded={open}
              aria-controls="sv-mobile-nav"
              onClick={() => setOpen((value) => !value)}
            >
              <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
              <span aria-hidden="true" className="text-lg leading-none">
                {open ? "×" : "☰"}
              </span>
            </button>
          </div>
        </div>

        {open && (
          <nav
            id="sv-mobile-nav"
            aria-label="Mobile"
            className="border-t border-border px-4 py-4 lg:hidden"
          >
            <ul className="grid gap-2 text-sm">
              {PUBLIC_PRIMARY_NAV.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    className="block rounded-md px-2 py-2 hover:bg-accent"
                    onClick={() => setOpen(false)}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
              <li>
                <Link to="/auth" className="block rounded-md px-2 py-2 hover:bg-accent" onClick={() => setOpen(false)}>
                  Sign in
                </Link>
              </li>
              <li>
                <Link
                  to="/request-demo"
                  className="block rounded-md px-2 py-2 font-semibold hover:bg-accent"
                  onClick={() => setOpen(false)}
                >
                  Request demo
                </Link>
              </li>
            </ul>
          </nav>
        )}
      </header>

      <main id="main-content" className="flex-1">
        {children}
      </main>

      <footer className="sv-public-footer mt-auto border-t border-border">
        <div className="sv-public-wrap grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <SherivsBrandMark size="sm" />
            <p className="mt-3 max-w-sm text-sm text-muted-foreground">{PLATFORM_TAGLINE}</p>
            <p className="mt-4 text-xs text-muted-foreground">
              Domain runtimes consume the platform. They never own it.
            </p>
          </div>
          {Object.entries(PUBLIC_FOOTER_NAV).map(([group, links]) => (
            <nav key={group} aria-label={group} className="grid gap-2 content-start">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {group}
              </p>
              {links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {link.label}
                </a>
              ))}
            </nav>
          ))}
        </div>
        <div className="border-t border-border">
          <div className="sv-public-wrap flex flex-wrap items-center justify-between gap-3 py-4 text-xs text-muted-foreground">
            <p>© {new Date().getFullYear()} {PLATFORM_NAME}</p>
            <p className="flex flex-wrap gap-x-4 gap-y-1">
              <a href="/status">Status</a>
              <a href="/legal/privacy">Privacy</a>
              <a href="/legal/terms">Terms</a>
              <a href="/legal/accessibility">Accessibility</a>
              <a href="/legal/cookies">Cookies</a>
              <a href="/contact">Contact</a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
