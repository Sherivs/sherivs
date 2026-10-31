import { useEffect, useId, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Menu } from "lucide-react";
import { PLATFORM_NAME, PLATFORM_TAGLINE } from "@/lib/platform";
import { SherivsLogo } from "@/components/brand/sherivs-logo";
import { HEADER_GROUPS, type NavGroup } from "@/lib/public-site/navigation";
import { PUBLIC_ANNOUNCEMENT } from "@/lib/public-site/announcement";
import { PublicButton } from "@/components/public/ui";
import { PublicLink } from "@/components/public/public-link";
import { MobileNavigation } from "@/components/public/mobile-navigation";

/**
 * Sherivs public marketing header.
 *
 * One authoritative chrome for every public marketing page. Navigation
 * links only to public routes or homepage anchors. Internal /platform
 * surfaces and console hosts are never linked from this header.
 */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [desktopGroup, setDesktopGroup] = useState<string | null>(null);
  const menuId = useId();
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!desktopGroup) return;
    const onPointer = (event: MouseEvent) => {
      if (!navRef.current?.contains(event.target as Node)) setDesktopGroup(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDesktopGroup(null);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [desktopGroup]);

  return (
    <header className="sherivs-chrome sticky top-0 z-[var(--sherivs-z-nav)] border-b">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[calc(var(--sherivs-z-nav)+1)] focus:rounded-md focus:bg-sherivs-blue focus:px-3 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>
      {PUBLIC_ANNOUNCEMENT.published && PUBLIC_ANNOUNCEMENT.text ? (
        <div className="border-b border-[var(--sherivs-border)] px-4 py-2 text-center text-xs text-[var(--sherivs-ink-muted)]">
          {PUBLIC_ANNOUNCEMENT.href ? (
            <a
              href={PUBLIC_ANNOUNCEMENT.href}
              className="text-sherivs-cyan underline-offset-4 hover:underline"
            >
              {PUBLIC_ANNOUNCEMENT.text}
            </a>
          ) : (
            PUBLIC_ANNOUNCEMENT.text
          )}
        </div>
      ) : null}

      <div className="mx-auto flex w-full max-w-[var(--sherivs-container-wide)] items-center justify-between gap-3 px-[var(--sherivs-gutter)] py-3">
        <Link to="/" aria-label={`${PLATFORM_NAME} home`} className="rounded-md">
          <SherivsLogo size={28} lettering="brand" />
        </Link>

        <nav ref={navRef} aria-label="Site" className="hidden items-center gap-0.5 lg:flex">
          {HEADER_GROUPS.map((group, index) => (
            <DesktopNavGroup
              key={group.id}
              group={group}
              align={index >= HEADER_GROUPS.length - 2 ? "end" : "start"}
              open={desktopGroup === group.id}
              onClose={() => setDesktopGroup(null)}
              onToggle={() =>
                setDesktopGroup((current) => (current === group.id ? null : group.id))
              }
            />
          ))}
        </nav>

        <nav aria-label="Account" className="hidden items-center gap-2 text-sm lg:flex">
          <Link
            to="/auth"
            className="rounded-md px-3 py-1.5 font-semibold text-[var(--sherivs-ink-muted)] transition-colors hover:text-[var(--sherivs-ink)]"
          >
            Sign in
          </Link>
          <PublicButton href="/onboarding">Get started</PublicButton>
        </nav>

        <button
          type="button"
          className="sherivs-btn-secondary inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--sherivs-radius-sm)] lg:hidden"
          aria-expanded={open}
          aria-controls={menuId}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          <span className="sr-only">Open menu</span>
          <Menu size={18} aria-hidden="true" className="pointer-events-none" />
        </button>
      </div>

      <MobileNavigation open={open} onOpenChange={setOpen} menuId={menuId} />
      <p className="sr-only">{PLATFORM_TAGLINE}</p>
    </header>
  );
}

function DesktopNavGroup({
  group,
  align,
  open,
  onClose,
  onToggle,
}: {
  group: NavGroup;
  align: "start" | "end";
  open: boolean;
  onClose: () => void;
  onToggle: () => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        className={`inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm transition-colors hover:bg-white/50 hover:text-[var(--sherivs-ink)] ${open ? "bg-white/60 text-[var(--sherivs-ink)]" : "text-[var(--sherivs-ink-muted)]"}`}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={`${group.id}-menu`}
        onClick={onToggle}
      >
        {group.label}
        <ChevronDown
          size={14}
          aria-hidden="true"
          className="sherivs-disclosure-icon pointer-events-none shrink-0"
        />
      </button>
      {open ? (
        <div
          id={`${group.id}-menu`}
          className={`sherivs-nav-panel sherivs-glass-card absolute top-full z-[var(--sherivs-z-overlay)] mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-[var(--sherivs-radius)] p-2 ${align === "end" ? "right-0" : "left-0"}`}
        >
          <ul>
            {group.items.map((item) => (
              <li key={`${group.id}-${item.href}-${item.label}`}>
                <PublicLink
                  href={item.href}
                  className="block rounded-[var(--sherivs-radius-sm)] px-3 py-2.5 hover:bg-white/50"
                  onNavigate={onClose}
                >
                  <span className="block text-sm font-medium text-[var(--sherivs-ink)]">
                    {item.label}
                  </span>
                  {item.description ? (
                    <span className="mt-0.5 block text-xs leading-snug text-sherivs-muted">
                      {item.description}
                    </span>
                  ) : null}
                </PublicLink>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
