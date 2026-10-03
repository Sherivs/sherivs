/**
 * CoreGrid platform public site — marketing pricing tier catalog.
 *
 * Presentation-only data for the (site) public route group. Values mirror the
 * platform's commercial tier catalog (frontend/src/lib/subscription-tiers.ts),
 * which is frozen for new consumers — this module is a typed marketing view,
 * not an access-decision surface. Entitlement enforcement remains with the
 * canonical feature-access contract surface, never with this page.
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
    summary: "Evaluate the full platform core free for 30 days.",
    featured: false,
    highlights: [
      "30-day evaluation",
      "Up to 50 members",
      "One workspace",
      "Core profiles and calendar",
    ],
    ctaLabel: "Start free",
  },
  {
    id: "starter",
    name: "Starter",
    monthlyPrice: 15_000,
    annualPrice: 150_000,
    summary: "Everything a small organization needs to run on CoreGrid.",
    featured: false,
    highlights: [
      "Up to 200 members",
      "Five role workspaces",
      "Payments and receipts",
      "Email notifications",
    ],
    ctaLabel: "Choose Starter",
  },
  {
    id: "growth",
    name: "Growth",
    monthlyPrice: 35_000,
    annualPrice: 350_000,
    summary: "Advanced intelligence for organizations that are scaling.",
    featured: true,
    highlights: [
      "Up to 500 members",
      "AI scheduling and insights",
      "SMS and WhatsApp notifications",
      "Advanced analytics",
    ],
    ctaLabel: "Choose Growth",
  },
  {
    id: "professional",
    name: "Professional",
    monthlyPrice: 75_000,
    annualPrice: 750_000,
    summary: "Full governed autonomy: AI workforce, twins and API access.",
    featured: false,
    highlights: [
      "Up to 1,000 members",
      "AI workforce and Digital Twin",
      "White-label and custom domain",
      "Priority support",
    ],
    ctaLabel: "Choose Professional",
  },
  {
    id: "enterprise",
    name: "Enterprise",
    monthlyPrice: null,
    annualPrice: null,
    summary: "Unlimited scale for groups of institutions and multi-branch operations.",
    featured: false,
    highlights: [
      "Unlimited members",
      "Dedicated database",
      "Full API and webhook surface",
      "Fleet and branch management",
    ],
    ctaLabel: "Talk to sales",
  },
];