import { Link, Outlet } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { PLATFORM_NAME, PLATFORM_PUBLIC_DOMAIN, PLATFORM_TAGLINE } from "@/lib/platform";
import { SHERIVS_PUBLIC_ROUTES } from "@/lib/experience/public-catalog";
import { SherivsLockup } from "@/components/experience/sherivs-mark";

const PLATFORM_LINKS = SHERIVS_PUBLIC_ROUTES.filter(
  (route) => route.group === "platform" && route.inFooter && route.path !== "/security",
);
const SOLUTION_LINKS = SHERIVS_PUBLIC_ROUTES.filter((route) => route.group === "solutions" && route.inFooter);
const RESOURCE_LINKS = SHERIVS_PUBLIC_ROUTES.filter((route) => route.group === "resources" && route.inFooter);
const COMPANY_LINKS = SHERIVS_PUBLIC_ROUTES.filter(
  (route) => (route.group === "company" || route.path === "/security" || route.path === "/pricing") && route.inFooter,
);
const LEGAL_LINKS = SHERIVS_PUBLIC_ROUTES.filter((route) => route.group === "legal" && route.inFooter);

export function PublicShell({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="sherivs-public flex min-h-dvh flex-col bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-foreground focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-background"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <a
            href="/"
            className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <SherivsLockup compact />
          </a>

          <nav aria-label="Site" className="hidden items-center gap-6 text-sm lg:flex">
            <a className="text-muted-foreground hover:text-foreground" href="/platform">
              Platform
            </a>
            <a className="text-muted-foreground hover:text-foreground" href="/solutions">
              Solutions
            </a>
            <a className="text-muted-foreground hover:text-foreground" href="/security">
              Security
            </a>
            <a className="text-muted-foreground hover:text-foreground" href="/pricing">
              Pricing
            </a>
            <a className="text-muted-foreground hover:text-foreground" href="/resources">
              Resources
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <Link
              to="/auth"
              className="hidden rounded-md border border-border px-3 py-1.5 text-sm font-semibold sm:inline-flex focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Sign in
            </Link>
            <a
              href="/request-demo"
              className="rounded-md bg-foreground px-3 py-1.5 text-sm font-semibold text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Request access
            </a>
            <button
              type="button"
              className="inline-flex size-10 items-center justify-center rounded-md border border-border lg:hidden"
              aria-expanded={open}
              aria-controls="sherivs-mobile-nav"
              onClick={() => setOpen((value) => !value)}
            >
              <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
              <span aria-hidden="true" className="font-mono text-xs">
                {open ? "✕" : "☰"}
              </span>
            </button>
          </div>
        </div>
        {open ? (
          <nav
            id="sherivs-mobile-nav"
            aria-label="Mobile"
            className="border-t border-border px-4 py-4 lg:hidden"
          >
            <ul className="grid gap-3 text-sm">
              {[
                ["/platform", "Platform"],
                ["/solutions", "Solutions"],
                ["/security", "Security"],
                ["/pricing", "Pricing"],
                ["/resources", "Resources"],
                ["/about", "About"],
                ["/auth", "Sign in"],
              ].map(([href, label]) => (
                <li key={href}>
                  <a href={href} className="block py-1" onClick={() => setOpen(false)}>
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </header>

      <main id="main-content" className="flex-1">
        {children ?? <Outlet />}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <SherivsLockup />
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">{PLATFORM_TAGLINE}</p>
            <p className="mt-4 font-mono text-[0.7rem] text-muted-foreground">{PLATFORM_PUBLIC_DOMAIN}</p>
          </div>
          <FooterColumn title="Platform" links={PLATFORM_LINKS} />
          <FooterColumn title="Solutions" links={SOLUTION_LINKS} />
          <FooterColumn title="Company" links={COMPANY_LINKS} />
          <FooterColumn title="Legal" links={LEGAL_LINKS} extra={RESOURCE_LINKS} />
        </div>
        <div className="border-t border-border">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 text-xs text-muted-foreground sm:px-6">
            <p>
              © {new Date().getFullYear()} {PLATFORM_NAME}. No social profiles are published in this
              product surface.
            </p>
            <p>
              <a href="/status" className="hover:text-foreground">
                Status
              </a>
              <span aria-hidden="true"> · </span>
              <a href="/legal/privacy" className="hover:text-foreground">
                Privacy
              </a>
              <span aria-hidden="true"> · </span>
              <a href="/legal/accessibility" className="hover:text-foreground">
                Accessibility
              </a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FooterColumn({
  title,
  links,
  extra = [],
}: {
  title: string;
  links: typeof SHERIVS_PUBLIC_ROUTES;
  extra?: typeof SHERIVS_PUBLIC_ROUTES;
}) {
  const items = [...links, ...extra];
  return (
    <nav aria-label={title} className="grid gap-2 content-start">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{title}</p>
      {items.map((item) => (
        <a
          key={item.path}
          href={item.path}
          className="text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {item.navLabel ?? item.title}
        </a>
      ))}
    </nav>
  );
}
