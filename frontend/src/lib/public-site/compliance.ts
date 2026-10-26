/**
 * Public compliance and certification claims.
 *
 * Only `published: true` entries may appear as badges or “certified”
 * statements. Owner-stated registrations without public identifiers stay
 * unpublished. Pending matters must never render as completed.
 */
export interface ComplianceClaim {
  id: string;
  name: string;
  status: "unpublished" | "pending" | "implemented_principle" | "certified";
  published: boolean;
  publicDisclosure: "omit" | "principle" | "entity_only";
  summary: string;
  ownerContext?: string;
  publishWhen?: string;
}

export const COMPLIANCE_CLAIMS: readonly ComplianceClaim[] = [
  {
    id: "cac",
    name: "Corporate Affairs Commission (CAC)",
    status: "unpublished",
    published: false,
    publicDisclosure: "entity_only",
    summary:
      "The owner states that Sherivs Technologies Limited holds a CAC company registration certificate. The registration number, issue date, and certificate identifier are not published until the owner confirms the exact public-facing details.",
    ownerContext: "Owner-provided: CAC company registration certificate exists.",
    publishWhen: "Owner supplies the exact public registration identifier and approves publication.",
  },
  {
    id: "tin",
    name: "Tax Identification Number (FIRS)",
    status: "unpublished",
    published: false,
    publicDisclosure: "omit",
    summary:
      "The owner states that FIRS has issued a TIN. The TIN is not published on the marketing site.",
    ownerContext: "Owner-provided: TIN issued by FIRS. Default: keep off the public footer.",
    publishWhen: "Owner explicitly approves publication of the TIN for a legitimate purpose.",
  },
  {
    id: "nscdc",
    name: "NSCDC-related compliance",
    status: "pending",
    published: false,
    publicDisclosure: "omit",
    summary: "Pending. Not a completed registration or certification.",
    ownerContext: "Owner-provided: pending. Do not display as approved or certified.",
    publishWhen: "Owner confirms whether and how pending status should be disclosed, with evidence.",
  },
  {
    id: "ndpa",
    name: "NDPA-related compliance",
    status: "pending",
    published: false,
    publicDisclosure: "omit",
    summary:
      "Pending. NDPA is not treated as a generic certification badge. Do not claim NDPA certified.",
    ownerContext: "Owner-provided: pending. Nigeria Data Protection Act context, not a badge.",
    publishWhen: "Owner confirms public wording with evidence. Never as a fake certification mark.",
  },
  {
    id: "soc2",
    name: "SOC 2",
    status: "unpublished",
    published: false,
    publicDisclosure: "omit",
    summary: "No verified SOC 2 report is on file for public display.",
    publishWhen: "Independent report supplied and owner-approved for publication.",
  },
  {
    id: "iso27001",
    name: "ISO/IEC 27001",
    status: "unpublished",
    published: false,
    publicDisclosure: "omit",
    summary: "No verified ISO/IEC 27001 certificate is on file for public display.",
    publishWhen: "Certificate supplied and owner-approved for publication.",
  },
  {
    id: "tenant-isolation",
    name: "Tenant isolation",
    status: "implemented_principle",
    published: true,
    publicDisclosure: "principle",
    summary:
      "Tenant-sensitive data is designed to be isolated with PostgreSQL Row Level Security. Application UI is not the only control.",
  },
  {
    id: "audit",
    name: "Auditable actions",
    status: "implemented_principle",
    published: true,
    publicDisclosure: "principle",
    summary:
      "Important platform actions are intended to leave an audit trail of actor, action, and time. This is an engineering principle, not a certified control report.",
  },
];

export const publishedCompliance = () => COMPLIANCE_CLAIMS.filter((c) => c.published);
