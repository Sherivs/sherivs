/**
 * Sherivs public shell — header, navigation, footer and page scaffolding for the
 * PUBLIC plane (no identity, no tenant, no database reads).
 *
 * Navigation and footer are derived from the governed route registry
 * (lib/sherivs/routes.ts): a route that is not `live` can never be linked.
 */
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronDown, Menu, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { SherivsLockup } from "@/components/sherivs/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { BRAND_CATEGORY, BRAND_NAME, BRAND_SOCIAL_PROFILES } from "@/lib/sherivs/brand";
import {
  breadcrumbsFor,
  navGroup,
  navLabel,
  type Crumb,
  type NavGroup,
  type PublicRouteSpec,
} from "@/lib/sherivs/routes";
import { cn } from "@/lib/utils";

/* ───────────── link primitive ───────────── */

/** Registry paths are validated by tests; `to` is typed loosely here by design. */
function RegistryLink({
  route,
  className,
  children,
  onNavigate,
}: {
  route: PublicRouteSpec;
  className?: string;
  children?: ReactNode;
  onNavigate?: () => void;
}) {
  return (
    <Link
      to={route.path as string}
      onClick={onNavigate}
      className={className}
      activeOptions={{ exact: true }}
    >
      {children ?? navLabel(route)}
    </Link>
  );
}

/* ───────────── header ───────────── */

const MENU_GROUPS: ReadonlyArray<{ group: NavGroup; label: string; hub: string }> = [
  { group: "platform", label: "Platform", hub: "/platform" },
  { group: "solutions", label: "Solutions", hub: "/solutions" },
  { group: "resources", label: "Resources", hub: "/resources" },
];

function NavDisclosure({ group, label }: { group: NavGroup; label: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const items = navGroup(group);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        ref.current?.querySelector<HTMLButtonElement>("button[aria-expanded]")?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="sv-focusable inline-flex min-h-9 items-center gap-1 rounded-[var(--sv-radius-sm)] px-3 text-sm text-[color:var(--sv-text-2)] transition-colors hover:text-[color:var(--sv-text)] aria-expanded:text-[color:var(--sv-text)]"
      >
        {label}
        <ChevronDown
          aria-hidden
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
        />
      </button>
      <div
        id={id}
        hidden={!open}
        className="sv-overlay absolute left-0 top-full z-[var(--sv-z-dropdown)] mt-2 w-[22rem] p-2"
      >
        <ul className="grid gap-0.5">
          {items.map((route) => (
            <li key={route.path}>
              <RegistryLink
                route={route}
                onNavigate={() => setOpen(false)}
                className="sv-focusable grid gap-0.5 rounded-[var(--sv-radius-md)] px-3 py-2.5 hover:bg-[color:color-mix(in_oklab,var(--sv-text)_6%,transparent)]"
              >
                <span className="sv-h4">{navLabel(route)}</span>
                <span className="sv-caption sv-muted">{route.summary}</span>
              </RegistryLink>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function MobileMenu() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const close = useCallback(() => setOpen(false), []);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    close();
  }, [pathname, close]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
        className="sv-btn size-11 !p-0"
      >
        {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="fixed inset-x-0 bottom-0 top-[var(--sv-header-h)] z-[var(--sv-z-overlay)] overflow-y-auto bg-[color:var(--sv-canvas)] px-4 pb-10 pt-4"
      >
        <nav aria-label="Mobile" className="mx-auto grid max-w-lg gap-6">
          {MENU_GROUPS.map(({ group, label }) => (
            <div key={group}>
              <p className="sv-label sv-faint mb-2">{label}</p>
              <ul className="grid">
                {navGroup(group).map((route) => (
                  <li key={route.path} className="sv-rule">
                    <RegistryLink
                      route={route}
                      onNavigate={close}
                      className="sv-focusable flex min-h-12 items-center sv-body"
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <ul className="grid">
            {navGroup("primary").map((route) => (
              <li key={route.path} className="sv-rule">
                <RegistryLink
                  route={route}
                  onNavigate={close}
                  className="sv-focusable flex min-h-12 items-center sv-body"
                />
              </li>
            ))}
          </ul>
          <div className="grid gap-3">
            <Link to="/auth" className="sv-btn sv-btn-primary sv-btn-lg" onClick={close}>
              Get started
            </Link>
            <Link to="/auth" className="sv-btn sv-btn-lg" onClick={close}>
              Sign in
            </Link>
          </div>
        </nav>
      </div>
    </div>
  );
}

export function PublicHeader() {
  return (
    <header
      className="sticky top-0 z-[var(--sv-z-header)] border-b border-[color:var(--sv-line)] bg-[color:var(--sv-canvas)]"
      style={{ height: "var(--sv-header-h)" }}
    >
      <div className="sv-page-wide flex h-full items-center justify-between gap-4">
        <div className="flex items-center gap-8">
          <Link to="/" aria-label={`${BRAND_NAME} home`} className="sv-focusable rounded-[var(--sv-radius-sm)]">
            <SherivsLockup size={26} />
          </Link>
          <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
            {MENU_GROUPS.map(({ group, label }) => (
              <NavDisclosure key={group} group={group} label={label} />
            ))}
            {navGroup("primary").map((route) => (
              <RegistryLink
                key={route.path}
                route={route}
                className="sv-focusable inline-flex min-h-9 items-center rounded-[var(--sv-radius-sm)] px-3 text-sm text-[color:var(--sv-text-2)] transition-colors hover:text-[color:var(--sv-text)] [&.active]:text-[color:var(--sv-text)]"
              />
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle className="hidden sm:inline-flex" />
          <Link to="/auth" className="sv-btn hidden sm:inline-flex">
            Sign in
          </Link>
          <Link to="/auth" className="sv-btn sv-btn-primary hidden sm:inline-flex">
            Get started
          </Link>
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}

/* ───────────── footer ───────────── */

const FOOTER_COLUMNS: ReadonlyArray<{ title: string; groups: readonly NavGroup[] }> = [
  { title: "Platform", groups: ["platform"] },
  { title: "Solutions", groups: ["solutions"] },
  { title: "Resources", groups: ["resources"] },
  { title: "Company", groups: ["primary", "company"] },
  { title: "Legal", groups: ["legal"] },
];

export function PublicFooter() {
  return (
    <footer className="sv-rule bg-[color:var(--sv-ground)]">
      <div className="sv-page-wide grid gap-12 py-14 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,3fr)]">
        <div className="grid content-start gap-4">
          <SherivsLockup size={28} />
          <p className="sv-label sv-muted">{BRAND_CATEGORY}</p>
          <p className="sv-small sv-muted max-w-xs">
            One governed platform for an organization&rsquo;s people, work, knowledge and AI workforce — with
            evidence, authority and audit.
          </p>
          {BRAND_SOCIAL_PROFILES.length > 0 ? (
            <ul aria-label="Sherivs on social networks" className="flex flex-wrap gap-3">
              {BRAND_SOCIAL_PROFILES.map((p) => (
                <li key={p.url}>
                  <a className="sv-link sv-small" href={p.url} rel="noopener noreferrer me" target="_blank">
                    {p.network}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-5">
          {FOOTER_COLUMNS.map((col) => {
            const routes = col.groups.flatMap((g) => navGroup(g));
            if (routes.length === 0) return null;
            return (
              <div key={col.title}>
                <p className="sv-label sv-faint mb-3">{col.title}</p>
                <ul className="grid gap-2">
                  {routes.map((route) => (
                    <li key={route.path}>
                      <RegistryLink route={route} className="sv-link sv-small no-underline hover:underline" />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
      </div>
      <div className="sv-rule">
        <div className="sv-page-wide flex flex-col gap-2 py-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="sv-caption sv-faint">
            &copy; {new Date().getUTCFullYear()} {BRAND_NAME}. All rights reserved.
          </p>
          <p className="sv-caption sv-faint">
            <Link to="/auth" className="sv-link">
              Sign in
            </Link>
            {" · "}
            <a className="sv-link" href="/sitemap.xml">
              Sitemap
            </a>
            {" · "}
            <a className="sv-link" href="/rss.xml">
              RSS
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}

/* ───────────── shell ───────────── */

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="sv-canvas flex min-h-dvh flex-col" data-plane="public">
      <PublicHeader />
      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}

/* ───────────── page scaffolding ───────────── */

export function Breadcrumbs({ path, trail }: { path?: string; trail?: readonly Crumb[] }) {
  const crumbs = trail ?? (path ? breadcrumbsFor(path) : []);
  if (crumbs.length < 2) return null;
  return (
    <nav aria-label="Breadcrumb" className="sv-caption sv-muted">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={`${c.label}-${i}`} className="inline-flex items-center gap-2">
              {c.href && !last ? (
                <Link to={c.href} className="sv-link no-underline hover:underline">
                  {c.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={last ? "text-[color:var(--sv-text)]" : undefined}>
                  {c.label}
                </span>
              )}
              {!last ? <span aria-hidden>/</span> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function PageHeader({
  eyebrow,
  title,
  lead,
  path,
  children,
  headingId = "page-title",
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  path?: string;
  children?: ReactNode;
  headingId?: string;
}) {
  return (
    <section aria-labelledby={headingId} className="sv-blueprint border-b border-[color:var(--sv-line)]">
      <div className="sv-page-wide grid gap-6 pb-14 pt-10 sm:pb-20 sm:pt-14">
        {path ? <Breadcrumbs path={path} /> : null}
        <div className="grid max-w-4xl gap-5">
          {eyebrow ? <p className="sv-label sv-muted">{eyebrow}</p> : null}
          <h1 id={headingId} className="sv-hero">
            {title}
          </h1>
          {lead ? <p className="sv-body sv-muted max-w-2xl text-lg">{lead}</p> : null}
          {children}
        </div>
      </div>
    </section>
  );
}

export function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
  className,
  tone = "canvas",
}: {
  id: string;
  eyebrow?: string;
  title: string;
  lead?: string;
  children?: ReactNode;
  className?: string;
  tone?: "canvas" | "ground";
}) {
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn("sv-section border-b border-[color:var(--sv-line)]", tone === "ground" && "sv-ground", className)}
    >
      <div className="sv-page-wide grid gap-10">
        <header className="grid max-w-3xl gap-3">
          {eyebrow ? <p className="sv-label sv-muted">{eyebrow}</p> : null}
          <h2 id={headingId} className="sv-h1">
            {title}
          </h2>
          {lead ? <p className="sv-body sv-muted text-lg">{lead}</p> : null}
        </header>
        {children}
      </div>
    </section>
  );
}

/** Evidence disclosure: repo paths that implement a public claim. */
export function EvidenceList({ paths }: { paths: readonly string[] }) {
  if (paths.length === 0) return null;
  return (
    <details className="sv-inset group px-4 py-3">
      <summary className="sv-focusable sv-label sv-muted cursor-pointer list-none">
        <span className="sv-kind-label" style={{ ["--kind" as string]: "var(--sv-kind-evidence)" }}>
          Evidence in the codebase ({paths.length})
        </span>
      </summary>
      <ul className="sv-code sv-muted mt-3 grid gap-1 break-all">
        {paths.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </details>
  );
}
