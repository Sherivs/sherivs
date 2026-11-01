/**
 * Legal publication gate. Pages exist as professional layouts; only
 * Documents with `status: "published"` are treated as current public policy.
 * Unreviewed drafts are noindex and labelled as pending owner/legal review.
 */
export type LegalStatus = "published" | "draft_pending_review";

export interface LegalDocument {
  id: string;
  slug: string;
  title: string;
  status: LegalStatus;
  lastUpdated?: string;
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
    slug: "/privacy",
    title: "Privacy notice",
    status: "published",
    lastUpdated: "1 November 2026",
    indexable: true,
    summary:
      "How Sherivs Technologies Limited handles information about schools, staff, students, guardians, and website visitors.",
    unresolvedFacts: [],
    sections: [
      {
        heading: "Who we are and who this notice covers",
        body: [
          'Sherivs Technologies Limited ("Sherivs", "we", or "us"), based in Maiduguri, Borno State, Nigeria, operates Sherivs Scholar and the Sherivs websites. This notice applies to those services; a school\'s own public website may have a separate privacy notice.',
          "For school records about students, guardians, and staff that a school places in Sherivs Scholar, the school will generally decide why and how the information is used and act as the data controller. Sherivs generally processes those records for the school on its instructions. Sherivs acts as a controller for information it uses for its own account administration, website, support, security, and business operations. The exact role depends on the processing.",
          "For a WhatsApp or other communication directly with Sherivs, Sherivs is the controller for the information it uses to respond to and administer that interaction.",
        ],
      },
      {
        heading: "Information we may process",
        body: [
          "School and organization information, including institution details, memberships, roles, and workspace settings.",
          "Staff and account information, which may include names, work contact details, account identifiers, authentication and session records, and assigned responsibilities.",
          "Student information that a school chooses to enter, which may include student names and identifiers, class or enrollment details, attendance, assessments, and other educational or operational records.",
          "Guardian information, which may include names, contact details, and the relationship or permissions associated with a student.",
          "Support and security information, such as messages you send us, audit and access events, and technical information needed to operate and protect the service.",
          "Where an organization enables a relevant feature, records may include additional information it submits. Schools should only submit information they are authorized to use and that is necessary for the school purpose.",
        ],
      },
      {
        heading: "WhatsApp, SMS, and voice communications",
        body: [
          "If a school enables communications, Sherivs may process recipient names, phone numbers, school or guardian relationships, message content, call instructions, and delivery or failure details to send or manage WhatsApp messages, SMS, or voice calls on that school's behalf.",
          "Messages and calls may pass through the relevant messaging providers, telephone carriers, or other service providers. Those providers may process information under their own terms. For voice services, audio or transcripts may also be processed where the school's configured provider and feature support recording or transcription; Sherivs does not promise that every call is recorded or transcribed.",
          "The school is responsible for deciding whether it may contact each recipient, providing required notices, and managing communication preferences. Contact the school that sent a message to update preferences or stop school communications.",
        ],
      },
      {
        heading: "How information is used and the applicable law",
        body: [
          "We use information to provide and maintain the service, manage accounts and school workspaces, support users, deliver school-authorized communications, protect the service, and meet applicable legal obligations.",
          "The Nigeria Data Protection Act 2023 (NDPA) and other applicable data-protection requirements inform how we handle personal data. The lawful basis depends on the purpose and the party acting as controller. A school is responsible for determining and communicating the lawful basis for its school records; Sherivs assesses the basis applicable to processing for which it is the controller.",
          "When an AI feature is enabled, information authorized for that feature may be sent to a model provider through the platform's AI gateway. The provider and routing depend on configuration; AI output is not treated as an authoritative school record without validation.",
          "Product analytics on the public site load only after consent. Student accounts are not tracked by that analytics feature.",
        ],
      },
      {
        heading: "Who information may be shared with",
        body: [
          "School administrators and other users receive access according to the school's configuration and their authorized roles. Sherivs may also share the information needed with infrastructure, identity, communications, support, analytics, or other service providers that help deliver the service, and with public authorities where the law requires it.",
          "Service providers may process information in Nigeria or another country. The provider and processing location depend on the service configuration. Contact us for information relevant to a particular school or request.",
        ],
      },
      {
        heading: "Retention",
        body: [
          "We keep personal information only for as long as it is needed for the purpose for which it was collected, the school's documented instructions and agreement with Sherivs, applicable legal obligations, and the establishment or defence of legal claims.",
          "For school records, the school sets or instructs the applicable retention period. When an organization ends its use of the service or requests deletion, Sherivs handles the records according to the applicable agreement and law. Some records may remain for a period in backups, security logs, or records that must be retained by law; the period depends on the system and legal requirement.",
        ],
      },
      {
        heading: "Your data-protection rights",
        body: [
          "Subject to the NDPA and other applicable law, you may be entitled to request access to personal data, correction, deletion, restriction of processing, portability where applicable, or object to certain processing. Where processing is based on consent, you may withdraw consent; this does not affect processing that took place before withdrawal.",
          "For information held by a school, contact that school first because it generally determines how those records are used. Sherivs will support the school with requests as required. You may also contact us about information Sherivs processes as a controller. You may lodge a complaint with the Nigeria Data Protection Commission (NDPC).",
          "We may need to verify identity and authority before acting on a request, especially where it concerns a student or another person.",
        ],
      },
      {
        heading: "How to request deletion, including WhatsApp data",
        body: [
          'To request deletion of information associated with a Sherivs account or a WhatsApp interaction with Sherivs, email info@sherivs.com with the subject "Data deletion request". Include the account email or WhatsApp phone number, the school or organization name if relevant, and a short description of the information or interaction you want deleted.',
          "For a student's or staff member's school record, contact the school administrator and ask the school to submit or authorize the request. For school messages, contact the school that sent them to request that it stop future communications and review the underlying record.",
          "Do not email identity documents or sensitive records unless we specifically request them through an appropriate channel. We may ask for information needed to verify your identity or authority. After verification, we will handle the request under applicable law and any school instructions. Information that must be retained by law or for security, dispute, or backup purposes may not be removed immediately.",
        ],
      },
      {
        heading: "Contact",
        body: [
          "Privacy and data-protection requests: info@sherivs.com. General support: support@sherivs.com. Sherivs Technologies Limited is based in Maiduguri, Borno State, Nigeria.",
        ],
      },
    ],
  },
  {
    id: "terms",
    slug: "/terms",
    title: "Terms of service",
    status: "published",
    lastUpdated: "1 November 2026",
    indexable: true,
    summary: "Terms for organizations and people who access Sherivs websites and Sherivs Scholar.",
    unresolvedFacts: [],
    sections: [
      {
        heading: "About these terms and the service",
        body: [
          'These terms apply to your use of Sherivs websites and Sherivs Scholar, operated by Sherivs Technologies Limited ("Sherivs", "we", or "us") in Nigeria.',
          "Sherivs Scholar provides web-based tools for schools and their authorized communities. Available features may vary by organization and configuration. Features described as in development are not generally available.",
          "If Sherivs and your organization have a separate written agreement for a service, that agreement applies to the extent it conflicts with these general terms.",
        ],
      },
      {
        heading: "Accounts and organization responsibilities",
        body: [
          "You must provide accurate account information, keep your sign-in credentials confidential, and promptly tell your organization or Sherivs if you suspect unauthorized access. Accounts are for the authorized user; do not share access or impersonate another person.",
          "An organization is responsible for the people it invites, the permissions it grants, the accuracy and lawful use of information it submits, and notices or permissions required from staff, students, guardians, or other data subjects.",
          "Schools must ensure that any communication they ask Sherivs to send, including WhatsApp, SMS, or voice communications, is authorized and complies with applicable law and recipient preferences.",
        ],
      },
      {
        heading: "Acceptable use",
        body: [
          "Use the service only for lawful purposes and in accordance with your organization's instructions and permissions. Do not attempt to access another organization's workspace, bypass access controls, interfere with service security, or use the service to harm or exploit a child.",
          "Do not use the service to send unlawful, deceptive, or unsolicited communications, upload malicious content, or violate another person's rights. Additional rules may be set out in the Acceptable Use Policy.",
        ],
      },
      {
        heading: "Privacy and information",
        body: [
          "The Privacy Notice at /privacy explains how personal information is handled. For school records, the school generally acts as controller and Sherivs processes information on the school's instructions. Each party must meet its responsibilities under applicable data-protection law, including the NDPA 2023.",
          "You must not submit personal information unless you have authority to do so and it is necessary for the relevant service. Contact the school for requests about school records.",
        ],
      },
      {
        heading: "Service changes and availability",
        body: [
          "We may update or change features to maintain or improve the service, comply with law, or address security and operational needs. We do not promise uninterrupted availability or a particular service level unless a separate written agreement says otherwise.",
          "We may limit or suspend access where reasonably necessary to protect users or the service, comply with law, or address a material breach. Where practical, we will provide notice to the organization.",
        ],
      },
      {
        heading: "Fees and third-party services",
        body: [
          "Any fees, payment terms, or service commitments apply only where agreed with your organization in a separate order or written agreement. These general terms do not create an unlisted price, refund policy, or service-level commitment.",
          "Some features may rely on third-party services, including messaging providers and telephone carriers. Their own terms and charges may apply, and Sherivs does not control their networks or guarantee delivery of a message or call.",
        ],
      },
      {
        heading: "Intellectual property",
        body: [
          "Sherivs and its licensors retain rights in the service, software, and Sherivs branding. Your organization retains rights in information it submits, subject to the permissions needed for Sherivs to provide the service. These terms do not transfer ownership of either party's intellectual property.",
        ],
      },
      {
        heading: "Contact",
        body: [
          "Questions about these terms: info@sherivs.com. Support: support@sherivs.com. Sherivs Technologies Limited is based in Maiduguri, Borno State, Nigeria.",
        ],
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
