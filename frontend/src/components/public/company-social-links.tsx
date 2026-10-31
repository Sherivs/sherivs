import type { ReactNode } from "react";
import type { PublicSocialId, PublicSocialLink } from "@/lib/public-site/contacts";
import {
  publishedCompanySocial,
  socialAriaLabel,
  socialVisibleCaption,
} from "@/lib/public-site/contacts";
import { cn } from "@/lib/utils";

function InstagramMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current">
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" strokeWidth="1.75" />
      <circle cx="12" cy="12" r="4.15" strokeWidth="1.75" />
      <circle cx="17.35" cy="6.65" r="1.05" fill="currentColor" stroke="none" />
    </svg>
  );
}

function FacebookMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-current">
      <path d="M14.2 8.4V6.7c0-.7.5-1.1 1.2-1.1h1.4V3.2h-2.4c-2.5 0-4.1 1.6-4.1 4.2v2H8.2v2.6h2.1V21h3.9v-7.8h2.6l.4-2.6h-3Z" />
    </svg>
  );
}

function XMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-current">
      <path d="M17.6 3.2h2.7l-5.9 6.7 6.9 9h-5.4l-4.2-5.5-4.8 5.5H4.1l6.3-7.2-6.6-8.5h5.5l3.8 5 4.5-5Zm-1 14.2h1.5L7.5 4.7H5.9l10.7 12.7Z" />
    </svg>
  );
}

function LinkedInMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-current">
      <path d="M6.5 9.2H4V20h2.5V9.2ZM5.25 4A1.55 1.55 0 1 0 5.26 7.1 1.55 1.55 0 0 0 5.25 4ZM20 20h-2.5v-5.7c0-1.36-.03-3.1-1.9-3.1-1.9 0-2.19 1.48-2.19 3v5.8H11V9.2h2.4v1.47h.03c.33-.63 1.15-1.3 2.37-1.3 2.54 0 3.2 1.67 3.2 3.84V20Z" />
    </svg>
  );
}

const COMPANY_SOCIAL_ICONS: Partial<Record<PublicSocialId, () => ReactNode>> = {
  instagram: InstagramMark,
  facebook: FacebookMark,
  x: XMark,
  linkedin: LinkedInMark,
};

function caption(item: PublicSocialLink) {
  return socialVisibleCaption(item);
}

export function CompanySocialLinks({
  variant = "icons",
  className,
}: {
  variant?: "icons" | "list";
  className?: string;
}) {
  const social = publishedCompanySocial();
  if (social.length === 0) return null;

  if (variant === "list") {
    return (
      <ul className={cn("space-y-2", className)}>
        {social.map((item) => {
          const Icon = COMPANY_SOCIAL_ICONS[item.id];
          return (
            <li key={item.id}>
              <a
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-sherivs-cyan underline-offset-4 hover:underline"
              >
                {Icon ? <Icon /> : null}
                <span>{caption(item)}</span>
              </a>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <nav
      aria-label="Sherivs on social media"
      className={cn("flex flex-wrap items-center gap-3", className)}
    >
      {social.map((item) => {
        const Icon = COMPANY_SOCIAL_ICONS[item.id];
        return (
          <a
            key={item.id}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={socialAriaLabel(item)}
            className="sherivs-btn-secondary inline-flex h-10 w-10 items-center justify-center rounded-full text-[var(--sherivs-ink)] transition-colors hover:text-sherivs-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sherivs-focus)]"
          >
            {Icon ? <Icon /> : <span className="text-xs font-semibold">{item.label}</span>}
          </a>
        );
      })}
    </nav>
  );
}
