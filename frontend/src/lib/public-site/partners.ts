/**
 * Approved public partner, customer, and integration records.
 *
 * Distinguishes commercial partners from technology integrations. Entries
 * without `published: true` must not render. Do not invent relationships.
 */
export type PartnerKind =
  | "commercial"
  | "strategic"
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
    id: "paystack",
    name: "Paystack",
    kind: "technology_integration",
    href: "https://paystack.com",
    summary:
      "Fee payments in Sherivs Scholar can settle through Paystack when an organization configures it. This is a supported integration path, not a published commercial partnership.",
    published: true,
    notes: "Code: frontend/src/lib paystack functions and public webhook.",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    kind: "technology_integration",
    summary:
      "WhatsApp Cloud webhooks exist in the product when Meta credentials are configured. Delivery is not claimed as always-on.",
    published: true,
    notes: "Code: api/public/webhooks/whatsapp.ts.",
  },
];

export const publishedPartners = (kind?: PartnerKind) =>
  PUBLIC_PARTNERS.filter((p) => p.published && (kind ? p.kind === kind : true));
