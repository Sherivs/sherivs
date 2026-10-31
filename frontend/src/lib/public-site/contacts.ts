import { EMAIL_ROUTING } from "@/lib/public-site/company";

/**
 * Verified public contact channels. Owner-provided mailboxes only.
 * Dedicated privacy@ and legal@ addresses are not confirmed — legal and
 * privacy topics route to info@ until the owner supplies separate inboxes.
 */
export const PUBLIC_CONTACTS = {
  info: EMAIL_ROUTING.info.address,
  hello: EMAIL_ROUTING.hello.address,
  /** Alias used by demo / prospect forms. */
  sales: EMAIL_ROUTING.hello.address,
  support: EMAIL_ROUTING.support.address,
  privacy: EMAIL_ROUTING.info.address,
  legal: EMAIL_ROUTING.info.address,
} as const;

export type PublicSocialId = "linkedin" | "facebook" | "x" | "instagram" | "github";
export type PublicSocialSurface = "company" | "founder" | "none";

export interface PublicSocialLink {
  id: PublicSocialId;
  /** Network display name (Instagram, Facebook, X). */
  label: string;
  href: string;
  /** Public handle, shown instead of the destination URL when present. */
  handle?: string;
  /** Public page name, shown instead of the destination URL when present. */
  pageName?: string;
  published: boolean;
  /** company = footer/contact; founder = About only; none = never public. */
  surface: PublicSocialSurface;
  notes: string;
}

/**
 * Owner-supplied social destinations (2026-10-26, mission 003).
 * Single source for footer, contact, About, and Organization JSON-LD.
 * GitHub is stored only so it cannot be published by accident.
 * LinkedIn is reserved for an approved company URL and stays unpublished.
 * X uses the verified public profile https://x.com/sherivs_.
 */
export const PUBLIC_SOCIAL_LINKS: readonly PublicSocialLink[] = [
  {
    id: "instagram",
    label: "Instagram",
    href: "https://www.instagram.com/sherivs_?xtok=dXY1ZjhjYnZnYmd3",
    handle: "@sherivs_",
    published: true,
    surface: "company",
    notes:
      "Owner-supplied destination preserved until a canonical public profile URL is verified. Display the handle, not the full URL. Tracking query is as supplied.",
  },
  {
    id: "facebook",
    label: "Facebook",
    href: "https://www.facebook.com/share/1EhQZoG9X7/",
    pageName: "Sherivs Team",
    published: true,
    surface: "company",
    notes:
      "Owner-supplied share destination preserved until a canonical page URL is verified. Public label is Sherivs Team.",
  },
  {
    id: "x",
    label: "X",
    href: "https://x.com/sherivs_",
    handle: "@sherivs_",
    published: true,
    surface: "company",
    notes:
      "Owner-supplied handle @sherivs_. Destination verified 2026-10-26: profile title Muhammad sheriff Yusuf-wasili (@sherivs_), og:url https://x.com/sherivs_. Footer and contact icons route here.",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    href: "",
    published: false,
    surface: "company",
    notes:
      "Sherivs business page is under review (mission 003). Keep this slot for the approved company URL. Do not publish a personal LinkedIn profile as the company page. Do not render a disabled or placeholder link.",
  },
  {
    id: "github",
    label: "GitHub",
    href: "",
    published: false,
    surface: "none",
    notes: "Owner explicitly does not want GitHub displayed on the public website.",
  },
];

/** Visible caption: handle or page name, never the raw destination URL. */
export function socialVisibleCaption(item: PublicSocialLink): string {
  if (item.handle) {
    return `${item.label} ${item.handle}`;
  }
  if (item.pageName) {
    return `${item.label} — ${item.pageName}`;
  }
  return item.label;
}

export function socialAriaLabel(item: PublicSocialLink): string {
  if (item.pageName) {
    return `${item.pageName} on ${item.label}`;
  }
  if (item.handle) {
    return `Sherivs on ${item.label} (${item.handle})`;
  }
  return `Sherivs on ${item.label}`;
}

/** Company socials for footer, contact, and Organization JSON-LD. Never GitHub. Never empty hrefs. */
export function publishedCompanySocial() {
  return PUBLIC_SOCIAL_LINKS.filter(
    (item) =>
      item.published &&
      item.href.length > 0 &&
      item.surface === "company" &&
      item.id !== "github",
  );
}

/** Founder profile links for About. Empty while LinkedIn remains unpublished. */
export function publishedFounderSocial() {
  return PUBLIC_SOCIAL_LINKS.filter(
    (item) => item.published && item.href.length > 0 && item.surface === "founder" && item.id !== "github",
  );
}
