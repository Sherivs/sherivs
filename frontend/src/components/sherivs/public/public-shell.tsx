/**
 * Sherivs public shell — header, footer and page scaffolds for sherivs.com
 * (SHERIVS_COMPONENT_CATALOG.md §NAVIGATION, §LAYOUT).
 *
 * The shell renders ONLY what the route-architecture contract declares LIVE:
 * primary navigation and footer groups come from `publicPrimaryNav()` and
 * `publicFooterGroups()`. There is no social row (no fabricated accounts),
 * no newsletter form (no fake submission), no customer logos.
 */
import { Link, useRouterState } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import { SherivsLockup } from "@/components/sherivs/mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { BRAND } from "@/lib/experience/brand";
import { publicFooterGroups, publicPrimaryNav } from "@/lib/experience/route-architecture";
import { cn } from "@/lib/utils";

const PRIMARY_NAV = publicPrimaryNav();
const FOOTER_GROUPS = publicFooterGroups();

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-plane-0 text-ink-1">
      <PublicHeader />
      <main id="main-content" className="flex-1" tabIndex={-1}>
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}

/* ── Header ───────────────────────────────────────────────────────── */

function PublicHeader() {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className="sh-glass sticky top-0 z-[var(--sh-z-header)] border-x-0 border-t-0"
    >
      <div className="sh-container-wide flex h-14 items-center justify-between gap-4 sm:h-16">
        <Link to="/" className="sh-focus rounded-[var(--sh-radius-sm)]" aria-label={`${BRAND.name} home`}>
          <SherivsLockup />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {PRIMARY_NAV.map((route) => (
            <Link
              key={route.path}
              to={route.path}
              className="sh-focus sh-small rounded-[var(--sh-radius-sm)] px-3 py-2 font-medium text-ink-2 transition-colors duration-[var(--sh-duration-fast)] hover:text-ink-1 data-[status=active]:text-ink-1"
              activeOptions={{ exact: false }}
            >
              {route.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <nav aria-label="Account" className="hidden items-center gap-2 md:flex">
            <Link
              to="/auth"
              className="sh-interactive sh-focus sh-small inline-flex h-9 items-center rounded-[var(--sh-radius-md)] border border-line-2 bg-plane-2 px-3.5 font-semibold text-ink-1"
            >
              Sign in
            </Link>
            <Link
              to="/auth"
              className="sh-interactive sh-focus sh-small inline-flex h-9 items-center rounded-[var(--sh-radius-md)] bg-signal px-3.5 font-semibold text-signal-on hover:bg-signal-strong"
            >
              Create account
            </Link>
          </nav>
          <button
            type="button"
            className="sh-interactive sh-focus sh-touch inline-flex items-center justify-center rounded-[var(--sh-radius-md)] border border-line-1 bg-plane-2 text-ink-1 md:hidden"
            aria-expanded={open}
            aria-controls={menuId}
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
          </button>
        </div>
      </div>

      <div
        id={menuId}
        hidden={!open}
        className="border-t border-line-1 bg-plane-1 md:hidden"
      >
        <nav aria-label="Primary (mobile)" className="sh-container-wide flex flex-col gap-1 py-3">
          {PRIMARY_NAV.map((route) => (
            <Link
              key={route.path}
              to={route.path}
              className="sh-focus sh-touch sh-body flex items-center rounded-[var(--sh-radius-md)] px-3 font-medium text-ink-2 hover:bg-plane-2 hover:text-ink-1 data-[status=active]:text-ink-1"
            >
              {route.label}
            </Link>
          ))}
          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-line-1 pt-3">
            <Link
              to="/auth"
              className="sh-interactive sh-focus sh-touch sh-small inline-flex items-center justify-center rounded-[var(--sh-radius-md)] border border-line-2 bg-plane-2 font-semibold text-ink-1"
            >
              Sign in
            </Link>
            <Link
              to="/auth"
              className="sh-interactive sh-focus sh-touch sh-small inline-flex items-center justify-center rounded-[var(--sh-radius-md)] bg-signal font-semibold text-signal-on"
            >
              Create account
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}

/* ── Footer ───────────────────────────────────────────────────────── */

function PublicFooter() {
  return (
    <footer className="border-t border-line-1 bg-plane-1">
      <div className="sh-container-wide grid gap-10 py-12 lg:grid-cols-[1.4fr_repeat(var(--sh-footer-groups),1fr)]" style={{ "--sh-footer-groups": FOOTER_GROUPS.length } as CSSProperties}>
        <div className="max-w-sm">
          <SherivsLockup />
          <p className="sh-small mt-4 text-ink-2">{BRAND.category}</p>
          <p className="sh-caption mt-2">
            {BRAND.name} runs the organization's governed core. Domain runtimes — including the
            education runtime — are installed on it, never the other way round.
          </p>
        </div>
        {FOOTER_GROUPS.map((group) => (
          <nav key={group.key} aria-label={group.label} className="grid content-start gap-2">
            <p className="sh-label">{group.label}</p>
            {group.routes.map((route) => (
              <Link
                key={route.path}
                to={route.path}
                className="sh-focus sh-small w-fit rounded-[var(--sh-radius-xs)] text-ink-2 hover:text-ink-1"
              >
                {route.label}
              </Link>
            ))}
          </nav>
        ))}
      </div>
      <div className="border-t border-line-1">
        <div className="sh-container-wide flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="sh-caption">
            © {new Date().getFullYear()} {BRAND.name}. {BRAND.domain}
          </p>
          <p className="sh-caption">Every runtime is a tenant of the kernel, never its owner.</p>
        </div>
      </div>
    </footer>
  );
}

/* ── Page scaffolds ───────────────────────────────────────────────── */

/** Standard public page opening: eyebrow, h1, lead. */
export function PublicPageIntro({
  eyebrow,
  title,
  lead,
  children,
  className,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("sh-atmosphere border-b border-line-1", className)} aria-labelledby="page-title">
      <div className="sh-container sh-section-tight">
        <p className="sh-label text-signal">{eyebrow}</p>
        <h1 id="page-title" className="sh-h1 mt-3 max-w-4xl">
          {title}
        </h1>
        {lead && <p className="sh-body-lg sh-prose mt-5 text-ink-2">{lead}</p>}
        {children && <div className="mt-8 flex flex-wrap gap-3">{children}</div>}
      </div>
    </section>
  );
}

export function PublicSection({
  id,
  className,
  tight = false,
  children,
  labelledBy,
}: {
  id?: string;
  className?: string;
  tight?: boolean;
  children: ReactNode;
  labelledBy?: string;
}) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={cn("border-b border-line-1 last:border-b-0", className)}>
      <div className={cn("sh-container", tight ? "sh-section-tight" : "sh-section")}>{children}</div>
    </section>
  );
}

/** Route-link styled as the primary or secondary call to action. */
export function CtaLink({
  to,
  children,
  variant = "primary",
  className,
}: {
  to: "/" | "/platform" | "/solutions" | "/security" | "/pricing" | "/auth" | "/status" | "/platform/kernel" | "/legal/accessibility";
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "sh-interactive sh-focus sh-small inline-flex h-11 items-center gap-2 rounded-[var(--sh-radius-md)] px-5 font-semibold",
        variant === "primary" && "bg-signal text-signal-on hover:bg-signal-strong",
        variant === "secondary" && "border border-line-2 bg-plane-2 text-ink-1",
        variant === "ghost" && "text-ink-2 hover:text-ink-1",
        className,
      )}
    >
      {children}
    </Link>
  );
}
