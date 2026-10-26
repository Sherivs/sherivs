/**
 * Verified public contact channels. Do not invent addresses, phones, or offices.
 */
export const PUBLIC_CONTACTS = {
  sales: "hello@sherivs.com",
  support: "support@sherivs.com",
  privacy: "privacy@sherivs.com",
  legal: "legal@sherivs.com",
} as const;

export const PUBLIC_SOCIAL_LINKS: readonly {
  label: string;
  href: string;
  published: boolean;
}[] = [];
