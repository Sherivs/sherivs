import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { PLATFORM_NAME, PLATFORM_TAGLINE } from "@/lib/platform";
import { SherivsLogo } from "@/components/brand/sherivs-logo";
import { HEADER_GROUPS } from "@/lib/public-site/navigation";
import { PUBLIC_ANNOUNCEMENT } from "@/lib/public-site/announcement";
import { PublicButton } from "@/components/public/ui";

/**
 * Sherivs public site header (Plane A chrome).
 *
 * Navigation links only to public routes. Internal /platform engineering
 * surfaces and console hosts are never linked from this header.
 */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const menuId = useId();

  return (
    <header className="sticky top-0 z-[var(--sherivs-z-nav)] border-b border-[var(--sherivs-border)] bg-[color-mix(in_oklab,var(--sherivs-obsidian)_78%,transparent)] backdrop-blur-xl">
      {PUBLIC_ANNOUNCEMENT.published && PUBLIC_ANNOUNCEMENT.text ? (
        <div className="border-b border-[var(--sherivs-border)] bg-[var(--sherivs-midnight)] px-4 py-2 text-center text-xs text-sherivs-muted">
          {PUBLIC_ANNOUNCEMENT.href ? (
            <a href={PUBLIC_ANNOUNCEMENT.href} className="text-sherivs-cyan underline-offset-4 hover:underline">
              {PUBLIC_ANNOUNCEMENT.text}
            </a>
          ) : (
            PUBLIC_ANNOUNCEMENT.text
          )}
        </div>
      ) : null}

      <div className="mx-auto flex w-full max-w-[var(--sherivs-container-wide)] items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link
          to="/"
          aria-label={`${PLATFORM_NAME} home`}
          className="rounded-md"
        >
          <SherivsLogo size={30} wordmarkClassName="text-lg" />
        </Link>

        <nav aria-label="Site" className="hidden items-center gap-1 lg:flex">
          {HEADER_GROUPS.map((group) => (
            <details
              key={group.id}
              className="group relative"
              onToggle={(event) => {
                if (!event.currentTarget.open) return;
                const root = event.currentTarget.closest("nav");
                root?.querySelectorAll("details[open]").forEach((node) => {
                  if (node !== event.currentTarget) node.removeAttribute("open");
                });
              }}
            >
              <summary className="cursor-pointer list-none rounded-md px-3 py-2 text-sm text-sherivs-muted hover:bg-white/5 hover:text-sherivs-white [&::-webkit-details-marker]:hidden">
                {group.label}
              </summary>
              <div className="sherivs-glass absolute left-0 top-full z-[var(--sherivs-z-overlay)] mt-2 w-72 rounded-[var(--sherivs-radius)] p-2">
                <ul>
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        to={item.href as never}
                        className="block rounded-md px-3 py-2 hover:bg-white/5"
                      >
                        <span className="block text-sm font-medium">{item.label}</span>
                        {item.description ? (
                          <span className="mt-0.5 block text-xs leading-snug text-sherivs-muted">
                            {item.description}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          ))}
        </nav>

        <nav aria-label="Account" className="hidden items-center gap-2 text-sm lg:flex">
          <Link
            to="/sherivs"
            className="rounded-md px-3 py-1.5 font-semibold text-sherivs-muted hover:text-sherivs-white"
          >
            Platform
          </Link>
          <Link
            to="/auth"
            className="rounded-md border border-[var(--sherivs-border-strong)] px-3 py-1.5 font-semibold hover:bg-white/5"
          >
            Sign in
          </Link>
          <Link
            to="/request-demo"
            className="inline-flex min-h-11 items-center justify-center rounded-[var(--sherivs-radius-sm)] bg-sherivs-blue px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            Request a demo
          </Link>
          <PublicButton href="/auth" variant="secondary">
            Get started
          </PublicButton>
        </nav>

        <button
          type="button"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-[var(--sherivs-border)] lg:hidden"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
          <span aria-hidden="true">{open ? "×" : "☰"}</span>
        </button>
      </div>

      {open ? (
        <div id={menuId} className="border-t border-[var(--sherivs-border)] px-4 py-4 lg:hidden">
          <nav aria-label="Mobile">
            {HEADER_GROUPS.map((group) => (
              <details key={group.id} className="border-b border-[var(--sherivs-border)] py-2">
                <summary className="cursor-pointer py-2 text-sm font-semibold">{group.label}</summary>
                <ul className="pb-2">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        to={item.href as never}
                        className="block py-2 text-sm text-sherivs-muted"
                        onClick={() => setOpen(false)}
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </nav>
          <div className="mt-4 flex flex-col gap-2">
            <PublicButton href="/auth" variant="secondary">
              Sign in
            </PublicButton>
            <PublicButton href="/request-demo">Request a demo</PublicButton>
            <PublicButton href="/auth" variant="secondary">
              Get started
            </PublicButton>
          </div>
        </div>
      ) : null}
      <p className="sr-only">{PLATFORM_TAGLINE}</p>
    </header>
  );
}
