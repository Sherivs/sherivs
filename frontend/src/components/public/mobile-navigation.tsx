import { useEffect, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { PLATFORM_NAME } from "@/lib/platform";
import { SherivsLogo } from "@/components/brand/sherivs-logo";
import { HEADER_GROUPS } from "@/lib/public-site/navigation";
import { PublicButton } from "@/components/public/ui";
import { PublicLink } from "@/components/public/public-link";

/**
 * Modal drawer for public marketing navigation on small viewports.
 *
 * Uses dialog semantics, focus restoration, background scroll lock, and
 * history state so the browser back button can close the panel.
 */
export function MobileNavigation({
  open,
  onOpenChange,
  menuId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  menuId: string;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<Element | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (window.history.state?.sherivsNav === true) window.history.back();
        else onOpenChange(false);
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusables = [
        ...panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((node) => !node.hasAttribute("disabled"));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onPop = () => onOpenChange(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("popstate", onPop);
    if (window.history.state?.sherivsNav !== true) {
      window.history.pushState({ sherivsNav: true }, "");
    }

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
      if (restoreRef.current instanceof HTMLElement) restoreRef.current.focus();
    };
  }, [open, onOpenChange]);

  const close = (restoreHistory = true) => {
    onOpenChange(false);
    if (window.history.state?.sherivsNav === true) {
      if (restoreHistory) window.history.back();
      else window.history.replaceState({}, "", window.location.href);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[var(--sherivs-z-overlay)] lg:hidden" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-[color-mix(in_oklab,black_58%,transparent)] backdrop-blur-sm"
        aria-label="Close menu"
        onClick={() => close()}
      />
      <div
        id={menuId}
        role="dialog"
        aria-modal="true"
        aria-label={`${PLATFORM_NAME} menu`}
        ref={panelRef}
        className="sherivs-glass-card sherivs-nav-drawer absolute inset-y-0 right-0 left-0 flex h-dvh flex-col rounded-none sm:left-auto sm:w-[22.5rem] sm:border-l"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--sherivs-border)] px-4 py-3">
          <SherivsLogo size={26} lettering="brand" />
          <button
            ref={closeRef}
            type="button"
            className="sherivs-btn-secondary inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--sherivs-radius-sm)]"
            onClick={() => close()}
          >
            <span className="sr-only">Close menu</span>
            <X size={18} aria-hidden="true" className="pointer-events-none" />
          </button>
        </div>

        <nav aria-label="Mobile" className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {HEADER_GROUPS.map((group) => {
            const isOpen = expanded === group.id;
            const panelId = `${menuId}-${group.id}`;
            return (
              <div key={group.id} className="border-b border-[var(--sherivs-border)]">
                <button
                  type="button"
                  className="flex min-h-12 w-full items-center justify-between gap-3 px-2 py-3 text-left text-sm font-semibold"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setExpanded((current) => (current === group.id ? null : group.id))}
                >
                  {group.label}
                  <ChevronDown
                    size={16}
                    aria-hidden="true"
                    className="sherivs-disclosure-icon pointer-events-none shrink-0 text-sherivs-muted"
                  />
                </button>
                {isOpen ? (
                  <ul id={panelId} className="pb-3">
                    {group.items.map((item) => (
                      <li key={`${group.id}-${item.href}-${item.label}`}>
                        <PublicLink
                          href={item.href}
                          className="block rounded-[var(--sherivs-radius-sm)] px-3 py-2.5 text-sm text-[var(--sherivs-ink-muted)] hover:bg-white/50 hover:text-[var(--sherivs-ink)]"
                          onNavigate={() => close(false)}
                        >
                          {item.label}
                        </PublicLink>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </nav>

        <div className="grid gap-2 border-t border-[var(--sherivs-border)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <PublicButton
            href="/auth"
            variant="secondary"
            className="w-full"
            onClick={() => close(false)}
          >
            Sign in
          </PublicButton>
          <PublicButton href="/onboarding" className="w-full" onClick={() => close(false)}>
            Get started
          </PublicButton>
        </div>
      </div>
    </div>
  );
}
