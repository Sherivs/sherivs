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
  label: string;
  href: string;
  handle?: string;
  published: boolean;
  /** company = footer/contact; founder = About only; none = never public. */
  surface: PublicSocialSurface;
  notes: string;
}

/**
 * Owner-supplied social destinations (2026-10-26, mission 002).
 * GitHub is stored only so it cannot be published by accident.
 * X uses the owner-supplied public profile https://x.com/sherivs_.
 */
export const PUBLIC_SOCIAL_LINKS: readonly PublicSocialLink[] = [
  {
    id: "instagram",
    label: "Instagram",
    href: "https://www.instagram.com/sherivs_?xtok=dXY1ZjhjYnZnYmd3",
    published: true,
    surface: "company",
    notes:
      "Owner-supplied destination preserved until a canonical public profile URL is verified. Tracking query is as supplied.",
  },
  {
    id: "facebook",
    label: "Facebook",
    href: "https://www.facebook.com/share/1EhQZoG9X7/",
    published: true,
    surface: "company",
    notes: "Owner-supplied share destination preserved until a canonical page URL is verified.",
  },
  {
    id: "x",
    label: "X",
    href: "https://x.com/sherivs_",
    handle: "@sherivs_",
    published: true,
    surface: "company",
    notes: "Owner-supplied public profile URL. Footer and contact icons route here.",
  },
  {
    id: "linkedin",
    label: "Founder on LinkedIn",
    href: "https://www.linkedin.com/in/muhammad-sheriff-yusuf-wasili-84a771434?utm_source=share_via&utm_content=profile&utm_medium=member_android",
    published: true,
    surface: "founder",
    notes:
      "Personal profile. Must not be presented as an official Sherivs company page. Tracking query is as supplied.",
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

/** Company socials for footer, contact, and Organization JSON-LD. Never GitHub. */
export function publishedCompanySocial() {
  return PUBLIC_SOCIAL_LINKS.filter(
    (item) =>
      item.published &&
      item.href.length > 0 &&
      item.surface === "company" &&
      item.id !== "github",
  );
}

/** Founder profile links for About. Never presented as the company page. */
export function publishedFounderSocial() {
  return PUBLIC_SOCIAL_LINKS.filter(
    (item) => item.published && item.href.length > 0 && item.surface === "founder" && item.id !== "github",
  );
}
