/**
 * Sherivs platform public site — marketing pricing tier catalog.
 *
 * Presentation-only data for the (site) public route group. Values mirror the
 * platform's commercial tier catalog (frontend/src/lib/subscription-tiers.ts),
 * which is frozen for new consumers — this module is a typed marketing view,
 * not an access-decision surface. Entitlement enforcement remains with the
 * canonical feature-access contract surface, never with this page.
 *
 * Truth audit 2026-11-17: no public page renders this catalog today, and
 * there is no self-serve checkout (Paystack is in test mode). Highlights say
 * "(coming)" for anything not live in production. Every call to action is
 * "Talk to us" until the founder confirms public prices.
 */

export interface MarketingTier {
  /** Stable identifier, mirrors the commercial catalog tier key. */
  id: string;
  name: string;
  /** Monthly price in ₦; null when the tier is quoted as a custom contract. */
  monthlyPrice: number | null;
  /** Annual price in ₦; null when the tier is quoted as a custom contract. */
  annualPrice: number | null;
  summary: string;
  /** Tier rendered as the recommended plan on the pricing section. */
  featured: boolean;
  highlights: readonly string[];
  ctaLabel: string;
}

const NAIRA = "₦";

/** Formats a tier price for the pricing section, e.g. "₦15,000" or "Custom". */
export function formatTierPrice(price: number | null): string {
  if (price === null) return "Custom";
  return `${NAIRA}${price.toLocaleString("en-US")}`;
}

export const MARKETING_TIERS: readonly MarketingTier[] = [
  {
    id: "trial",
    name: "Trial",
    monthlyPrice: 0,
    annualPrice: 0,
    summary: "A 30-day evaluation, arranged with the Sherivs team.",
    featured: false,
    highlights: [
      "30-day evaluation",
      "Up to 50 members",
      "One workspace",
      "Shared workspace and roles",
    ],
    ctaLabel: "Talk to us",
  },
  {
    id: "starter",
    name: "Starter",
    monthlyPrice: 15_000,
    annualPrice: 150_000,
    summary: "For a small organization starting on Sherivs.",
    featured: false,
    highlights: [
      "Up to 200 members",
      "Role-based workspace",
      "Fee payments and receipts (coming)",
      "Email notifications (coming)",
    ],
    ctaLabel: "Talk to us",
  },
  {
    id: "growth",
    name: "Growth",
    monthlyPrice: 35_000,
    annualPrice: 350_000,
    summary: "For organizations that are growing.",
    featured: true,
    highlights: [
      "Up to 500 members",
      "AI suggestions (coming)",
      "SMS and WhatsApp messages (coming)",
      "Advanced reports (coming)",
    ],
    ctaLabel: "Talk to us",
  },
  {
    id: "professional",
    name: "Professional",
    monthlyPrice: 75_000,
    annualPrice: 750_000,
    summary: "For larger organizations.",
    featured: false,
    highlights: [
      "Up to 1,000 members",
      "AI agents that suggest work for approval (coming)",
      "Custom domain for your public website (coming)",
      "Priority support (coming)",
    ],
    ctaLabel: "Talk to us",
  },
  {
    id: "enterprise",
    name: "Enterprise",
    monthlyPrice: null,
    annualPrice: null,
    summary: "For groups of institutions with several branches.",
    featured: false,
    highlights: [
      "Unlimited members",
      "Dedicated database (coming)",
      "API access (coming)",
      "Multi-branch management (coming)",
    ],
    ctaLabel: "Talk to us",
  },
];
