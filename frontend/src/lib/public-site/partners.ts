/**
 * Approved public partner, customer, and integration records.
 *
 * Distinguishes technology partners from commercial partners and from
 * technology integrations. Entries without `published: true` must not render.
 * Do not invent relationships, logos, exclusive terms, or partnership scope.
 */

/**
 * Owner-approved ThinkTech copy (mission 002, 2026-10-26).
 * Describes published collaboration scope — not a commercial customer
 * reference, exclusive deal, joint-venture filing, joint product, or a
 * claim that every listed activity is generally available today.
 */
export const THINKTECH_HEADLINE = "Building the next generation of intelligent technology";
export const THINKTECH_DESCRIPTION =
  "Sherivs and ThinkTech collaborate across technology development, infrastructure, consulting, integration, and marketing to advance the Sherivs platform. Their work focuses on developing technology foundations, supporting integrations, and growing the Sherivs ecosystem.";
export const THINKTECH_HONESTY =
  "This is the owner-approved collaboration description. It does not invent joint products, customer outcomes, revenue figures, exclusive terms, equity, or that every listed activity is a generally available product.";

export type PartnerKind =
  | "commercial"
  | "strategic"
  | "technology_partner"
  | "technology_integration"
  | "customer"
  | "community";

export interface PublicPartner {
  id: string;
  name: string;
  kind: PartnerKind;
  href?: string;
  logoSrc?: string;
  summary?: string;
  published: boolean;
  notes?: string;
}

export const PUBLIC_PARTNERS: readonly PublicPartner[] = [
  {
    id: "thinktech",
    name: "ThinkTech",
    kind: "technology_partner",
    href: "https://www.thinktech.com",
    logoSrc: "/partners/thinktech.png",
    summary: THINKTECH_DESCRIPTION,
    published: true,
    notes:
      "Owner-supplied website and logo (cropped from the provided plate; not redrawn). Tagline spelling is as supplied. TLS to thinktech.com could not be verified from this environment (handshake failure); the URL is still published as supplied.",
  },
  {
    id: "paystack",
    name: "Paystack",
    kind: "technology_integration",
    href: "https://paystack.com",
    summary:
      "Code for fee payments through Paystack exists, but it runs in test mode only. Schools cannot take real payments through Sherivs yet. This is an integration, not a commercial partnership.",
    published: true,
    notes: "Code: frontend/src/lib paystack functions and public webhook.",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    kind: "technology_integration",
    summary:
      "Code for WhatsApp messages exists, but WhatsApp sending is not switched on for customers yet. This is an integration, not a commercial partnership.",
    published: true,
    notes: "Code: api/public/webhooks/whatsapp.ts.",
  },
];

export const publishedPartners = (kind?: PartnerKind) =>
  PUBLIC_PARTNERS.filter((p) => p.published && (kind ? p.kind === kind : true));
