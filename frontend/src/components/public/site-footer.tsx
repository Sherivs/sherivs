import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { LEGAL_ENTITY_NAME, BRAND_STATEMENT, BRAND_SUPPORTING } from "@/lib/public-site/company";
import { FOOTER_GROUPS } from "@/lib/public-site/navigation";
import { PUBLIC_CONTACTS } from "@/lib/public-site/contacts";
import { SherivsLogo } from "@/components/brand/sherivs-logo";
import { CompanySocialLinks } from "@/components/public/company-social-links";
import { PublicLink } from "@/components/public/public-link";

export function SiteFooter() {
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  return (
    <footer className="sherivs-chrome relative z-[1] border-t pb-[max(0px,env(safe-area-inset-bottom))]">
      <div className="mx-auto grid w-full max-w-[var(--sherivs-container-wide)] gap-10 px-[var(--sherivs-gutter)] py-12 md:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)] md:gap-12 lg:py-16">
        <div>
          <SherivsLogo size={28} lettering="brand" />
          <p className="mt-4 max-w-xs text-sm font-medium text-[var(--sherivs-ink)]">
            {BRAND_STATEMENT}
          </p>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-sherivs-muted">
            {BRAND_SUPPORTING}
          </p>
          <p className="mt-5 text-sm text-sherivs-muted">{LEGAL_ENTITY_NAME}</p>
          <p className="mt-4 text-sm text-sherivs-muted">
            Support{" "}
            <a
              className="text-sherivs-cyan underline-offset-4 hover:underline"
              href={`mailto:${PUBLIC_CONTACTS.support}`}
            >
              {PUBLIC_CONTACTS.support}
            </a>
          </p>
          <CompanySocialLinks className="mt-6" />
        </div>

        <div className="grid content-start md:grid-cols-2 lg:grid-cols-5 md:gap-6">
          {FOOTER_GROUPS.map((group) => {
            const expanded = openGroup === group.id;
            const panelId = `footer-${group.id}`;
            return (
              <nav
                key={group.id}
                aria-label={group.label}
                className="border-b border-[var(--sherivs-border)] md:border-0"
              >
                <button
                  type="button"
                  className="flex min-h-12 w-full items-center justify-between gap-3 py-3 text-left text-xs font-semibold uppercase tracking-widest text-sherivs-muted md:hidden"
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  onClick={() =>
                    setOpenGroup((current) => (current === group.id ? null : group.id))
                  }
                >
                  {group.label}
                  <ChevronDown
                    size={16}
                    aria-hidden="true"
                    className="sherivs-disclosure-icon pointer-events-none shrink-0"
                  />
                </button>
                <p className="hidden text-xs font-semibold uppercase tracking-widest text-sherivs-muted md:block">
                  {group.label}
                </p>
                <ul
                  id={panelId}
                  className={
                    expanded
                      ? "grid gap-2 pb-4 md:mt-4 md:pb-0"
                      : "hidden gap-2 pb-4 md:mt-4 md:grid md:pb-0"
                  }
                >
                  {group.items.map((item) => (
                    <li key={`${group.id}-${item.href}-${item.label}`}>
                      <PublicLink
                        href={item.href}
                        className="block py-1 text-sm text-[var(--sherivs-ink-muted)] hover:text-[var(--sherivs-ink)]"
                      >
                        {item.label}
                      </PublicLink>
                    </li>
                  ))}
                </ul>
              </nav>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col items-start justify-between gap-3 border-t border-[var(--sherivs-border)] px-[var(--sherivs-gutter)] py-4 text-xs text-sherivs-muted sm:flex-row sm:items-center">
        <p>
          © {new Date().getFullYear()} {LEGAL_ENTITY_NAME}. All rights reserved.
        </p>
        <p className="flex flex-wrap gap-x-4 gap-y-2">
          <PublicLink href="/privacy-policy" className="hover:text-[var(--sherivs-ink)]">
            Privacy
          </PublicLink>
          <PublicLink href="/terms" className="hover:text-[var(--sherivs-ink)]">
            Terms
          </PublicLink>
          <a href="#main-content" className="hover:text-[var(--sherivs-ink)]">
            Back to top
          </a>
        </p>
      </div>
    </footer>
  );
}
