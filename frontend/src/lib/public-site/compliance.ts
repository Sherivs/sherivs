/**
 * Public compliance and certification claims.
 *
 * Only `published: true` entries may appear as badges or “certified”
 * statements. Registration numbers and certificate scans stay unpublished
 * and must not be requested as a website prerequisite. Obtained-but-undisclosed
 * matters stay unpublished until exact public terminology is confirmed.
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
      "Sherivs Technologies Limited is the legal entity. CAC registration identifiers and certificate scans are not published (owner restriction).",
    ownerContext: "Owner 002: company name may be shown; registration numbers and certificate scans must not be published or requested as a website prerequisite.",
    publishWhen: "Remain unpublished. Do not request the registration number.",
  },
  {
    id: "tin",
    name: "Tax Identification Number (FIRS)",
    status: "unpublished",
    published: false,
    publicDisclosure: "omit",
    summary: "Tax identification numbers are not published on the marketing site (owner restriction).",
    ownerContext: "Owner 002: do not publish TIN, certificate scans, or request the identifier as a website prerequisite.",
    publishWhen: "Remain unpublished. Do not request the TIN.",
  },
  {
    id: "nscdc",
    name: "NSCDC-related compliance",
    status: "unpublished",
    published: false,
    publicDisclosure: "omit",
    summary:
      "The owner states that relevant NSCDC-related compliance matters have been obtained. Certificate details and the exact public terminology (registration, compliance status, certification, accreditation, or approval) are not disclosed here.",
    ownerContext:
      "Owner 002: obtained; do not disclose certificates; do not invent a certification name or treat this as a public badge.",
    publishWhen:
      "Owner confirms exact public wording. Do not request certificate numbers. Do not describe as pending.",
  },
  {
    id: "ndpa",
    name: "NDPA-related compliance",
    status: "unpublished",
    published: false,
    publicDisclosure: "omit",
    summary:
      "The owner states that relevant NDPA-related compliance matters have been obtained. Certificate details and the exact public terminology are not disclosed. This is not shown as an NDPA certification badge.",
    ownerContext:
      "Owner 002: obtained; do not disclose certificates; do not claim “NDPA certified” without confirmed terminology.",
    publishWhen:
      "Owner confirms exact public wording distinguishing registration, compliance, certification, accreditation, or approval. Do not request certificate numbers.",
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
