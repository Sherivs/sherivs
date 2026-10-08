/**
 * Sherivs public shell — header, primary navigation, mobile navigation and footer for
 * the Sherivs public experience (sherivs.com). Organization public sites use their own
 * shell; this one never renders organization branding.
 *
 * Navigation and footer are data (content/sherivs/site-map.ts), so every link here
 * resolves to a route that exists.
 */
import { useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import * as NavigationMenu from "@radix-ui/react-navigation-menu";
import { ChevronDown, Menu, X } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/theme-toggle";
import { FOOTER_COLUMNS, PRIMARY_NAV, type NavGroup } from "@/content/sherivs/site-map";
import { PLATFORM_DOMAIN, PLATFORM_NAME, PLATFORM_TAGLINE } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { SherivsLockup, SherivsMark } from "./brand";

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function DesktopNav({ pathname }: { pathname: string }) {
  return (
    <NavigationMenu.Root aria-label="Site" className="relative hidden lg:block" delayDuration={80}>
      <NavigationMenu.List className="flex items-center gap-1">
        {PRIMARY_NAV.map((group) => (
          <NavigationMenu.Item key={group.href}>
            {group.links ? (
              <>
                <NavigationMenu.Trigger
                  className={cn(
                    "group sx-button sx-button-quiet min-h-9 gap-1 px-3 text-[0.9375rem]",
                    isActivePath(pathname, group.href) && "text-sx-strong",
                  )}
                >
                  {group.label}
                  <ChevronDown
                    aria-hidden="true"
                    className="size-3.5 text-sx-muted transition-transform duration-200 group-data-[state=open]:rotate-180"
                  />
                </NavigationMenu.Trigger>
                <NavigationMenu.Content className="absolute left-0 top-0 w-[min(46rem,calc(100vw-4rem))] data-[motion=from-start]:animate-in data-[motion=from-start]:fade-in data-[motion=from-end]:animate-in data-[motion=from-end]:fade-in">
                  <MegaPanel group={group} />
                </NavigationMenu.Content>
              </>
            ) : (
              <NavigationMenu.Link asChild active={isActivePath(pathname, group.href)}>
                <Link
                  to={group.href}
                  className="sx-button sx-button-quiet min-h-9 px-3 text-[0.9375rem] data-[active]:text-sx-strong"
                >
                  {group.label}
                </Link>
              </NavigationMenu.Link>
            )}
          </NavigationMenu.Item>
        ))}
      </NavigationMenu.List>
      <div className="absolute left-0 top-full pt-3">
        <NavigationMenu.Viewport className="relative h-[var(--radix-navigation-menu-viewport-height)] w-[var(--radix-navigation-menu-viewport-width)] overflow-hidden rounded-[6px] border border-sx-line-strong bg-sx-surface-1 shadow-[0_24px_60px_-24px_rgb(7_9_12/0.35)] transition-[width,height] duration-200" />
      </div>
    </NavigationMenu.Root>
  );
}

function MegaPanel({ group }: { group: NavGroup }) {
  return (
    <div className="grid grid-cols-[12rem_1fr]">
      <div className="border-r border-sx-line bg-sx-surface-2 p-5">
        <p className="sx-label">{group.label}</p>
        <NavigationMenu.Link asChild>
          <Link to={group.href} className="sx-link mt-4 inline-block text-sm font-medium">
            {group.label} overview
          </Link>
        </NavigationMenu.Link>
      </div>
      <ul className="grid grid-cols-2 gap-px bg-sx-line p-px">
        {group.links?.map((link) => (
          <li key={link.href} className="bg-sx-surface-1">
            <NavigationMenu.Link asChild>
              <Link
                to={link.href}
                className="block h-full p-4 transition-colors duration-150 hover:bg-sx-surface-2 focus-visible:bg-sx-surface-2"
              >
                <span className="block text-sm font-semibold text-sx-strong">{link.label}</span>
                {link.description && (
                  <span className="mt-1 block text-[0.8125rem] leading-snug text-sx-muted">
                    {link.description}
                  </span>
                )}
              </Link>
            </NavigationMenu.Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="sx-button sx-button-quiet min-h-11 min-w-11 px-0 lg:hidden"
          aria-label="Open navigation"
        >
          <Menu aria-hidden="true" className="size-5" />
        </button>
      </SheetTrigger>
      <SheetContent
        side="right"
        data-sx=""
        className="flex w-full max-w-sm flex-col gap-0 overflow-y-auto border-l border-sx-line p-0 sm:max-w-sm [&>button:last-child]:hidden"
      >
        <div className="flex items-center justify-between border-b border-sx-line px-5 py-4">
          <SheetTitle className="flex items-center gap-2 text-sx-strong">
            <SherivsMark />
            <span className="sx-label text-sx-strong">Navigation</span>
          </SheetTitle>
          <SheetClose asChild>
            <button
              type="button"
              className="sx-button sx-button-quiet min-h-11 min-w-11 px-0"
              aria-label="Close navigation"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          </SheetClose>
        </div>
        <nav aria-label="Site" className="flex-1 px-5 py-4">
          <ul className="grid gap-6">
            {PRIMARY_NAV.map((group) => (
              <li key={group.href}>
                <Link
                  to={group.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-11 items-center text-lg font-semibold text-sx-strong"
                >
                  {group.label}
                </Link>
                {group.links && (
                  <ul className="mt-1 grid border-l border-sx-line pl-4">
                    {group.links.map((link) => (
                      <li key={link.href}>
                        <Link
                          to={link.href}
                          onClick={() => setOpen(false)}
                          className="flex min-h-11 items-center text-[0.9375rem] text-sx-text"
                        >
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </nav>
        <div className="grid gap-2 border-t border-sx-line px-5 py-5">
          <Link to="/auth" onClick={() => setOpen(false)} className="sx-button sx-button-primary">
            Create an account
          </Link>
          <Link to="/auth" onClick={() => setOpen(false)} className="sx-button sx-button-secondary">
            Sign in
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function SherivsPublicHeader() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <header className="sx-veil sticky top-0 z-[var(--sx-z-header)] border-b border-sx-line">
      <div className="sx-container flex h-16 items-center justify-between gap-6">
        <div className="flex items-center gap-8">
          <Link to="/" aria-label={`${PLATFORM_NAME} home`} className="rounded-[2px]">
            <SherivsLockup />
          </Link>
          <DesktopNav pathname={pathname} />
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          <Link
            to="/auth"
            className="sx-button sx-button-quiet hidden min-h-9 px-3 text-[0.9375rem] sm:inline-flex"
          >
            Sign in
          </Link>
          <Link
            to="/auth"
            className="sx-button sx-button-primary hidden min-h-9 px-4 text-[0.9375rem] sm:inline-flex"
          >
            Create an account
          </Link>
          <MobileNav />
        </div>
      </div>
    </header>
  );
}

export function SherivsPublicFooter() {
  const year = new Date().getFullYear();
  return (
    <footer data-sx-plane="ink" className="border-t border-sx-line bg-sx-surface-0 text-sx-text">
      <div className="sx-container grid gap-14 py-16 lg:grid-cols-12 lg:py-20">
        <div className="lg:col-span-4">
          <SherivsLockup descriptor />
          <p className="sx-small mt-6 max-w-xs text-sx-muted">
            One governed layer for an organization's reality, its knowledge, and the people and AI
            workers that act on it.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-10 sm:grid-cols-4 lg:col-span-8">
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.heading}>
              <p className="sx-label">{column.heading}</p>
              <ul className="mt-4 grid gap-2.5">
                {column.links.map((link) => (
                  <li key={`${column.heading}-${link.label}`}>
                    <Link
                      to={link.href}
                      className="text-sm text-sx-text transition-colors duration-150 hover:text-sx-signal"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="border-t border-sx-line">
        <div className="sx-container flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="sx-caption">
            © {year} {PLATFORM_NAME} · {PLATFORM_TAGLINE} · {PLATFORM_DOMAIN}
          </p>
          <div className="flex items-center gap-4">
            <Link to="/status" className="sx-caption transition-colors hover:text-sx-signal">
              System status
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </footer>
  );
}

/** Full public chrome: skip target, header, main landmark and footer. */
export function SherivsPublicShell({ children }: { children: ReactNode }) {
  return (
    <div data-sx="" className="flex min-h-dvh flex-col">
      <SherivsPublicHeader />
      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      <SherivsPublicFooter />
    </div>
  );
}
