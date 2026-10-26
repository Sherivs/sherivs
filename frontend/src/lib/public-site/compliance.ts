/**
 * Public compliance and certification claims.
 *
 * Only `published: true` entries may appear as named certifications.
 * Owner-asserted certified statuses whose official title is unconfirmed
 * stay unpublished behind `wordingGate: "awaiting_owner_approved_wording"`.
 * Registration numbers and certificate scans stay unpublished and must not
 * be requested as a website prerequisite.
 */
export type ComplianceWordingGate = "approved" | "awaiting_owner_approved_wording" | "not_applicable";

export interface ComplianceClaim {
  id: string;
  name: string;
  status: "unpublished" | "pending" | "implemented_principle" | "certified";
  published: boolean;
  publicDisclosure: "omit" | "principle" | "entity_only";
  wordingGate: ComplianceWordingGate;
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
    wordingGate: "not_applicable",
    summary:
      "Sherivs Technologies Limited is the legal entity. CAC registration identifiers and certificate scans are not published (owner restriction).",
    ownerContext:
      "Owner 003: company name may be shown; registration numbers and certificate scans must not be published or requested as a website prerequisite.",
    publishWhen: "Remain unpublished. Do not request the registration number.",
  },
  {
    id: "tin",
    name: "Tax Identification Number (FIRS)",
    status: "unpublished",
    published: false,
    publicDisclosure: "omit",
    wordingGate: "not_applicable",
    summary: "Tax identification numbers are not published on the marketing site (owner restriction).",
    ownerContext: "Owner 003: do not publish TIN, certificate scans, or request the identifier as a website prerequisite.",
    publishWhen: "Remain unpublished. Do not request the TIN.",
  },
  {
    id: "nscdc",
    name: "NSCDC-related status",
    status: "certified",
    published: false,
    publicDisclosure: "omit",
    wordingGate: "awaiting_owner_approved_wording",
    summary:
      "Public wording for this status is awaiting owner approval. Certificate numbers, scans, validity periods, and a specific certification title are not published.",
    ownerContext:
      "Owner 003: NSCDC-related status certified. The Nigeria Security and Civil Defence Corps (NSCDC) is the named agency; the exact official instrument (for example a private-guard licence versus another status) is not confirmed for publication. Do not invent a certificate title.",
    publishWhen:
      "Owner supplies the exact official certification or licence title and confirms it may be published. Do not request certificate numbers. Do not describe as pending.",
  },
  {
    id: "ndpa",
    name: "NDPA-related status",
    status: "certified",
    published: false,
    publicDisclosure: "omit",
    wordingGate: "awaiting_owner_approved_wording",
    summary:
      "Public wording for this status is awaiting owner approval. Certificate numbers, scans, validity periods, and a specific certification title are not published.",
    ownerContext:
      "Owner 003: NDPA-related status certified. The statute is the Nigeria Data Protection Act 2023; the regulator is the Nigeria Data Protection Commission (NDPC). NDPC instruments include DCPMI registration, DPCO licensing, and DPO certification — they are not interchangeable. Do not publish a generic “NDPA certified” badge until the exact instrument is confirmed.",
    publishWhen:
      "Owner confirms the exact public instrument (registration, licence, certification, accreditation, or approval) and wording. Do not request certificate numbers. Do not treat a generic NDPA-related status as a named certification.",
  },
  {
    id: "soc2",
    name: "SOC 2",
    status: "unpublished",
    published: false,
    publicDisclosure: "omit",
    wordingGate: "not_applicable",
    summary: "No verified SOC 2 report is on file for public display.",
    publishWhen: "Independent report supplied and owner-approved for publication.",
  },
  {
    id: "iso27001",
    name: "ISO/IEC 27001",
    status: "unpublished",
    published: false,
    publicDisclosure: "omit",
    wordingGate: "not_applicable",
    summary: "No verified ISO/IEC 27001 certificate is on file for public display.",
    publishWhen: "Certificate supplied and owner-approved for publication.",
  },
  {
    id: "tenant-isolation",
    name: "Tenant isolation",
    status: "implemented_principle",
    published: true,
    publicDisclosure: "principle",
    wordingGate: "approved",
    summary:
      "Tenant-sensitive data is designed to be isolated with PostgreSQL Row Level Security. Application UI is not the only control.",
  },
  {
    id: "audit",
    name: "Auditable actions",
    status: "implemented_principle",
    published: true,
    publicDisclosure: "principle",
    wordingGate: "approved",
    summary:
      "Important platform actions are intended to leave an audit trail of actor, action, and time. This is an engineering principle, not a certified control report.",
  },
];

export const publishedCompliance = () => COMPLIANCE_CLAIMS.filter((c) => c.published);

/** Visual placeholders only — never named certifications until wording is approved. */
export const awaitingWordingCompliance = () =>
  COMPLIANCE_CLAIMS.filter((c) => !c.published && c.wordingGate === "awaiting_owner_approved_wording");
