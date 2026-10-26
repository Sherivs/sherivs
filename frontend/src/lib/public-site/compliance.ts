/**
 * Public compliance and certification claims.
 *
 * Only `published: true` entries may appear as badges or “certified”
 * statements. Missing evidence stays unpublished.
 */
export interface ComplianceClaim {
  id: string;
  name: string;
  status: "unpublished" | "implemented_principle" | "certified";
  published: boolean;
  summary: string;
}

export const COMPLIANCE_CLAIMS: readonly ComplianceClaim[] = [
  {
    id: "soc2",
    name: "SOC 2",
    status: "unpublished",
    published: false,
    summary: "No verified SOC 2 report is on file for public display.",
  },
  {
    id: "iso27001",
    name: "ISO/IEC 27001",
    status: "unpublished",
    published: false,
    summary: "No verified ISO/IEC 27001 certificate is on file for public display.",
  },
  {
    id: "tenant-isolation",
    name: "Tenant isolation",
    status: "implemented_principle",
    published: true,
    summary:
      "Tenant-sensitive data is designed to be isolated with PostgreSQL Row Level Security. Application UI is not the only control.",
  },
  {
    id: "audit",
    name: "Auditable actions",
    status: "implemented_principle",
    published: true,
    summary:
      "Important platform actions are intended to leave an audit trail of actor, action, and time. This is an engineering principle, not a certified control report.",
  },
];

export const publishedCompliance = () => COMPLIANCE_CLAIMS.filter((c) => c.published);
