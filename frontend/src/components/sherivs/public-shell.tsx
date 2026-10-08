import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import { SherivsLockup } from "@/components/sherivs/sherivs-logo";
import {
  SHERIVS_FOOTER_COLUMNS,
  SHERIVS_PRIMARY_NAV,
  SHERIVS_SOCIAL_LINKS,
} from "@/components/sherivs/public-registry";
import { SHERIVS_NAME } from "@/lib/sherivs-brand";

/**
 * Sherivs public shell (V1).
 *
 * Shared header + enterprise footer for unauthenticated public surfaces.
 * Landmarks, skip target, keyboard-visible focus, and a real mobile menu
 * (no dead controls). Footer renders only verified destinations from the
 * public registry; social row renders only when verified accounts exist.
 */
export function SherivsPublicShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sherivs-public-header sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            to="/sherivs"
            aria-label={`${SHERIVS_NAME} home`}
            className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <SherivsLockup />
          </Link>

          <nav aria-label="Primary" className="hidden items-center gap-x-5 text-sm lg:flex">
            {SHERIVS_PRIMARY_NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <nav aria-label="Account" className="hidden items-center gap-2 text-sm lg:flex">
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
              Request demo
            </Link>
          </nav>

          <button
            type="button"
            className="grid size-10 place-items-center rounded-md border border-border lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="sherivs-public-menu"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>

        {menuOpen && (
          <nav
            id="sherivs-public-menu"
            aria-label="Mobile"
            className="border-t border-border px-4 py-3 lg:hidden"
          >
            <ul className="grid gap-1 text-sm">
              {SHERIVS_PRIMARY_NAV.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    onClick={() => setMenuOpen(false)}
                    className="block rounded-md px-2 py-2.5 font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
              <li className="mt-2 flex gap-2">
                <Link
                  to="/auth"
                  onClick={() => setMenuOpen(false)}
                  className="flex-1 rounded-md border border-border px-3 py-2.5 text-center font-semibold"
                >
                  Sign in
                </Link>
                <Link
                  to="/request-demo"
                  onClick={() => setMenuOpen(false)}
                  className="flex-1 rounded-md bg-primary px-3 py-2.5 text-center font-semibold text-primary-foreground"
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

      <footer className="border-t border-border">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 text-sm sm:grid-cols-2 sm:px-6 lg:grid-cols-6">
          <div className="lg:col-span-1">
            <SherivsLockup compact />
            <p className="mt-3 text-muted-foreground">Institutional intelligence infrastructure.</p>
            <p className="mt-3 text-xs text-muted-foreground">
              <Link to="/status" className="underline-offset-4 hover:underline">
                Platform status
              </Link>
            </p>
          </div>
          {SHERIVS_FOOTER_COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={`Footer — ${column.heading}`}>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {column.heading}
              </p>
              <ul className="mt-3 grid gap-2">
                {column.links.map((link) => (
                  <li key={`${link.label}${link.to}`}>
                    <FooterLink to={link.to} label={link.label} />
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        {SHERIVS_SOCIAL_LINKS.length > 0 && (
          <div className="border-t border-border">
            <div className="mx-auto flex w-full max-w-6xl gap-4 px-4 py-4 sm:px-6">
              {SHERIVS_SOCIAL_LINKS.map((link) => (
                <a key={link.to} href={link.to} rel="me noopener">
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        )}
        <div className="border-t border-border">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:px-6">
            <span>© 2026 {SHERIVS_NAME}. All rights reserved.</span>
            <span className="flex flex-wrap gap-x-4 gap-y-1">
              <Link to="/legal/privacy" className="hover:text-foreground">
                Privacy
              </Link>
              <Link to="/legal/terms" className="hover:text-foreground">
                Terms
              </Link>
              <Link to="/legal/accessibility" className="hover:text-foreground">
                Accessibility
              </Link>
              <Link to="/contact" className="hover:text-foreground">
                Contact
              </Link>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FooterLink({ to, label }: { to: string; label: string }) {
  if (to.includes("#")) {
    const [path, hash] = to.split("#");
    return (
      <a
        href={`${path}#${hash}`}
        className="text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {label}
      </a>
    );
  }
  return (
    <Link
      to={to}
      className="text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {label}
    </Link>
  );
}
