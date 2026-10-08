/**
 * Sherivs public shell — header, mobile navigation, footer.
 *
 * Navigation and footer are DERIVED from the public route registry (LIVE
 * entries only), so a deferred page can never be a dead link. There are no
 * social links because no verified Sherivs accounts exist to link to.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown, Menu } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/theme-toggle";
import { SHERIVS_BRAND } from "@/lib/experience-system/sherivs-brand";
import { liveRoutesIn, type PublicNavGroup } from "@/lib/experience-system/public-routes";
import { PUBLISHED_CONTENT, publicContent } from "@/lib/experience-system/content";
import { cn } from "@/lib/utils";
import { SherivsLockup } from "./brand";
import { Container, LinkButton, SvLink } from "./primitives";

const hasPublishedResources = publicContent(PUBLISHED_CONTENT, new Date()).length > 0;

const PRIMARY_LINKS: ReadonlyArray<{ to: string; label: string }> = [
  { to: "/solutions", label: "Solutions" },
  { to: "/security", label: "Security" },
  { to: "/pricing", label: "Pricing" },
  ...(hasPublishedResources ? [{ to: "/resources", label: "Resources" }] : []),
];

const NAV_LINK =
  "sv-pressable sv-touch inline-flex h-10 items-center rounded-[var(--sv-radius-md)] px-3 text-sv-text-muted no-underline hover:bg-sv-surface-3 hover:text-sv-text";

function PlatformMenu() {
  const [open, setOpen] = useState(false);
  const items = liveRoutesIn("platform");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(NAV_LINK, "gap-1.5")}
        aria-label="Platform menu"
      >
        Platform
        <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", open && "rotate-180")} />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={10}
        className="sv-root w-[min(46rem,calc(100vw-2rem))] border-sv-border bg-sv-surface-1 p-3 text-sv-text shadow-sv-lg"
      >
        <ul className="grid gap-1 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.path}>
              <SvLink
                to={item.path}
                onClick={() => setOpen(false)}
                className="block rounded-[var(--sv-radius-md)] p-3 no-underline hover:bg-sv-surface-3"
              >
                <span className="block font-medium text-sv-text">
                  {item.path === "/platform" ? "Platform overview" : item.title}
                </span>
                <span className="sv-small mt-0.5 block text-sv-text-muted">{item.description}</span>
              </SvLink>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function MobileNav() {
  const [open, setOpen] = useState(false);
  const platform = liveRoutesIn("platform");
  const close = () => setOpen(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className="sv-touch inline-flex size-11 items-center justify-center rounded-[var(--sv-radius-md)] text-sv-text hover:bg-sv-surface-3 lg:hidden"
        aria-label="Open navigation"
      >
        <Menu aria-hidden="true" className="size-5" />
      </SheetTrigger>
      <SheetContent side="right" className="sv-root w-[min(22rem,100vw)] border-sv-border bg-sv-canvas p-0 text-sv-text">
        <SheetTitle className="sr-only">Sherivs navigation</SheetTitle>
        <SheetDescription className="sr-only">Primary site navigation</SheetDescription>
        <nav aria-label="Primary" className="flex h-full flex-col gap-6 overflow-y-auto p-6 pt-16">
          <div>
            <p className="sv-label mb-2 text-sv-text-subtle">Platform</p>
            <ul>
              {platform.map((item) => (
                <li key={item.path}>
                  <SvLink to={item.path} onClick={close} className="sv-touch flex h-11 items-center text-lg no-underline">
                    {item.path === "/platform" ? "Overview" : item.title}
                  </SvLink>
                </li>
              ))}
            </ul>
          </div>
          <ul>
            {PRIMARY_LINKS.map((l) => (
              <li key={l.to}>
                <SvLink to={l.to} onClick={close} className="sv-touch flex h-11 items-center text-lg no-underline">
                  {l.label}
                </SvLink>
              </li>
            ))}
          </ul>
          <div className="mt-auto grid gap-2">
            <LinkButton to="/auth" variant="primary">Create account</LinkButton>
            <LinkButton to="/auth" variant="secondary">Sign in</LinkButton>
          </div>
        </nav>
      </SheetContent>
    </Sheet>
  );
}

export function PublicHeader() {
  return (
    <header className="sticky top-0 z-[var(--sv-z-sticky)] border-b border-sv-border bg-sv-canvas/90 backdrop-blur supports-[backdrop-filter]:bg-sv-canvas/75">
      <Container className="flex h-[var(--sv-layout-header)] items-center justify-between gap-4">
        <SvLink to="/" aria-label="Sherivs home" className="no-underline text-sv-text">
          <SherivsLockup />
        </SvLink>

        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          <PlatformMenu />
          {PRIMARY_LINKS.map((l) => (
            <SvLink key={l.to} to={l.to} className={NAV_LINK} activeProps={{ "aria-current": "page" }}>
              {l.label}
            </SvLink>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle className="hidden sm:inline-flex" />
          <SvLink to="/auth" className={cn(NAV_LINK, "hidden sm:inline-flex")}>
            Sign in
          </SvLink>
          <LinkButton to="/auth" className="hidden h-10 sm:inline-flex">
            Create account
          </LinkButton>
          <MobileNav />
        </div>
      </Container>
    </header>
  );
}

const FOOTER_COLUMNS: ReadonlyArray<{ title: string; group: PublicNavGroup; skip?: readonly string[] }> = [
  { title: "Platform", group: "platform" },
  { title: "Solutions", group: "solutions" },
  { title: "Trust", group: "trust" },
  { title: "Product", group: "product" },
  { title: "Legal", group: "legal" },
];

export function PublicFooter() {
  return (
    <footer className="border-t border-sv-border bg-sv-surface-sunken">
      <Container className="py-14">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_repeat(5,minmax(0,1fr))]">
          <div className="max-w-xs">
            <SherivsLockup />
            <p className="sv-small mt-4 text-sv-text-muted">{SHERIVS_BRAND.category}.</p>
            <p className="sv-caption mt-3 text-sv-text-subtle">
              The education runtime on the Sherivs platform: Sherivs Scholar.
            </p>
          </div>
          {FOOTER_COLUMNS.map((col) => {
            const items = liveRoutesIn(col.group).filter((r) => r.path !== "/");
            if (items.length === 0 && col.group !== "product") return null;
            return (
              <nav key={col.group} aria-label={col.title}>
                <h2 className="sv-label mb-3 text-sv-text-subtle">{col.title}</h2>
                <ul className="grid gap-1">
                  {items.map((item) => (
                    <li key={item.path}>
                      <SvLink to={item.path} className="sv-small inline-block py-1 text-sv-text-muted no-underline hover:text-sv-text hover:underline">
                        {item.path === "/platform" ? "Overview" : item.title}
                      </SvLink>
                    </li>
                  ))}
                  {col.group === "product" && (
                    <li>
                      <SvLink to="/auth" className="sv-small inline-block py-1 text-sv-text-muted no-underline hover:text-sv-text hover:underline">
                        Sign in
                      </SvLink>
                    </li>
                  )}
                </ul>
              </nav>
            );
          })}
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-sv-border pt-6 sv-caption text-sv-text-subtle">
          <p>© {new Date().getFullYear()} {SHERIVS_BRAND.name}. All rights reserved.</p>
          <SvLink to="/status" className="sv-state text-sv-text-subtle no-underline hover:text-sv-text">
            System status
          </SvLink>
        </div>
      </Container>
    </footer>
  );
}

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="sv-root flex min-h-dvh flex-col">
      <PublicHeader />
      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
