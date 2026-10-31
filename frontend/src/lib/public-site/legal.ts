/**
 * Legal publication gate. Pages exist as professional layouts; only
 * `published: true` documents are treated as current public policy.
 * Unreviewed drafts are noindex and labelled as pending owner/legal review.
 */
export type LegalStatus = "published_placeholder" | "draft_pending_review";

export interface LegalDocument {
  id: string;
  slug: string;
  title: string;
  status: LegalStatus;
  /** If false, keep out of sitemap and mark noindex. */
  indexable: boolean;
  summary: string;
  unresolvedFacts: readonly string[];
  sections: readonly { heading: string; body: readonly string[] }[];
}

const SHARED_UNRESOLVED = [
  "Registration numbers, TIN, and certificate scans are not published (owner restriction — not requested as a website prerequisite)",
  "Street address and telephone number (not supplied; locality is Maiduguri, Borno State, Nigeria)",
  "Formal privacy lawful bases and retention schedules",
  "Cross-border transfer arrangements",
  "Data-processing addendum countersigned by counsel",
  "Subprocessor list approved for public display",
  "Refund, SLA, and certification language",
  "Dedicated privacy@ and legal@ mailboxes (currently routed to info@sherivs.com)",
] as const;

export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  {
    id: "privacy",
    slug: "/privacy-policy",
    title: "Privacy policy",
    status: "published_placeholder",
    indexable: true,
    summary: "How Sherivs handles organizational and personal data at the level the product currently implements.",
    unresolvedFacts: SHARED_UNRESOLVED,
    sections: [
      {
        heading: "Who this covers",
        body: [
          "This notice describes the Sherivs platform at sherivs.com, app.sherivs.com, and related customer workspaces operated by Sherivs Technologies Limited, Maiduguri, Borno State, Nigeria. Organization public websites on tenant hosts may publish their own policies.",
          "It is a product-accurate summary, not a substitute for a counsel-reviewed privacy policy. Unresolved legal facts are listed on this page.",
        ],
      },
      {
        heading: "What we process",
        body: [
          "Account data: name, work email, authentication credentials held by the identity provider.",
          "Organization data: membership, roles, and the records an organization chooses to store in its workspace (for education organizations this may include academic and operational records).",
          "Operational data: audit logs, health checks, and — only after consent — anonymous product analytics via PostHog.",
          "We do not require government ID numbers, payment-card PAN, or other sensitive personal data on public contact forms.",
        ],
      },
      {
        heading: "Tenant isolation",
        body: [
          "Each organization's data is designed to be isolated at the database layer with Row Level Security. Access is authorized from identity, membership, and policy — not from hidden UI controls.",
        ],
      },
      {
        heading: "AI processing",
        body: [
          "When AI features are enabled for an organization, prompts and authorized context may be sent to a model provider through the platform's AI gateway. AI output is untrusted by default and is not treated as canonical organizational truth without validation.",
          "We do not claim that a specific model provider is used for every tenant; routing depends on configuration.",
        ],
      },
      {
        heading: "Analytics",
        body: [
          "Product analytics load only after consent. Student accounts are never tracked. Browsers that send Do Not Track are not asked. See the cookie notice for details.",
        ],
      },
      {
        heading: "Contact",
        body: ["Privacy questions: info@sherivs.com (a dedicated privacy mailbox has not been owner-confirmed)."],
      },
    ],
  },
  {
    id: "terms",
    slug: "/terms",
    title: "Terms of service",
    status: "published_placeholder",
    indexable: true,
    summary: "The current product terms for using Sherivs. Formal commercial terms remain subject to legal review.",
    unresolvedFacts: SHARED_UNRESOLVED,
    sections: [
      {
        heading: "The service",
        body: [
          "Sherivs provides a web application for organizations. Education organizations can use Sherivs Scholar. Other industry runtimes are in development and are not offered as generally available products on this site.",
        ],
      },
      {
        heading: "Accounts",
        body: [
          "You must provide accurate account information and keep credentials confidential. Organizations are responsible for the people they invite and the permissions they grant, including to AI workers.",
        ],
      },
      {
        heading: "Acceptable use",
        body: [
          "Use of the service is also governed by the Acceptable use policy. We may suspend access that threatens other tenants, children, or the integrity of the platform.",
        ],
      },
      {
        heading: "No invented guarantees",
        body: [
          "This page does not state a service-level agreement, refund policy, or certification. Those terms will appear only after owner and legal approval.",
        ],
      },
      {
        heading: "Contact",
        body: ["Legal contact: info@sherivs.com (a dedicated legal mailbox has not been owner-confirmed)."],
      },
    ],
  },
  {
    id: "aup",
    slug: "/legal/acceptable-use",
    title: "Acceptable use policy",
    status: "draft_pending_review",
    indexable: false,
    summary: "Draft rules for using Sherivs. Pending legal review.",
    unresolvedFacts: SHARED_UNRESOLVED,
    sections: [
      {
        heading: "Draft — not finalized",
        body: [
          "This draft is published so the policy structure exists. It is not a finalized legal instrument.",
        ],
      },
      {
        heading: "Prohibited use",
        body: [
          "Do not attempt to access another organization's tenant, bypass authorization, probe for secrets, or use the platform to harm children.",
          "Do not run AI workers with instructions that violate these rules or applicable law.",
          "Do not use public forms to send malware, spam, or deceptive content.",
        ],
      },
    ],
  },
  {
    id: "cookies",
    slug: "/legal/cookies",
    title: "Cookie policy",
    status: "draft_pending_review",
    indexable: false,
    summary: "Draft cookie notice matching implemented analytics consent.",
    unresolvedFacts: ["Formal cookie table approved by counsel", ...SHARED_UNRESOLVED],
    sections: [
      {
        heading: "Draft — not finalized",
        body: [
          "This notice describes cookies and similar storage actually used by the public site. It awaits legal review before being treated as a finalized policy.",
        ],
      },
      {
        heading: "Strictly necessary",
        body: [
          "Authentication and security cookies required to sign in and keep a session. These are not optional if you use the application.",
        ],
      },
      {
        heading: "Analytics (optional)",
        body: [
          "PostHog analytics cookies load only after you accept the consent banner. They are not loaded for student accounts or when Do Not Track is set. You can refuse analytics and still use the public site.",
        ],
      },
    ],
  },
  {
    id: "dpa",
    slug: "/legal/data-processing",
    title: "Data-processing terms",
    status: "draft_pending_review",
    indexable: false,
    summary: "Placeholder for a future data-processing addendum. Not in force.",
    unresolvedFacts: SHARED_UNRESOLVED,
    sections: [
      {
        heading: "Not in force",
        body: [
          "Sherivs has not published a counsel-reviewed data-processing addendum. This page exists so the route is stable when that document is approved.",
          "Do not treat this page as contractual terms.",
        ],
      },
    ],
  },
  {
    id: "subprocessors",
    slug: "/legal/subprocessors",
    title: "Subprocessors",
    status: "draft_pending_review",
    indexable: false,
    summary: "No approved public subprocessors list is on file.",
    unresolvedFacts: ["Owner-approved subprocessors with regions and purpose"],
    sections: [
      {
        heading: "Unpublished",
        body: [
          "A public subprocessors list will appear here only after the company owner approves names, regions, and purposes. Infrastructure vendors used in production are not listed until that approval exists.",
        ],
      },
    ],
  },
];

export function legalBySlug(slug: string) {
  return LEGAL_DOCUMENTS.find((doc) => doc.slug === slug);
}
