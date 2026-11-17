export interface HelpArticle {
  slug: string;
  category: string;
  title: string;
  summary: string;
  status: "available" | "in_development";
  /** When false, the article stays in the catalog but is omitted from the public index. */
  listed?: boolean;
  body: readonly { heading?: string; paragraphs: readonly string[] }[];
}

export const HELP_CATEGORIES = [
  "Getting started",
  "Accounts and identity",
  "Organizations",
  "Team management",
  "AI workforce",
  "Personal twins",
  "Integrations",
  "Security",
  "Billing",
  "Troubleshooting",
] as const;

export const HELP_ARTICLES: readonly HelpArticle[] = [
  {
    slug: "getting-started",
    category: "Getting started",
    title: "Create an organization",
    summary: "How a new organization starts on Sherivs today.",
    status: "available",
    body: [
      {
        paragraphs: [
          "Request a demo at hello@sherivs.com or on the public website. The Sherivs team creates the organization's admin account. There is no self-service sign-up on app.sherivs.com and no public demo passwords.",
          "After the admin account is provisioned, that admin invites the other users. Invited users sign in on app.sherivs.com — they do not create their own accounts.",
        ],
      },
      {
        heading: "If you already have an invitation",
        paragraphs: [
          "Use the email and password from your invitation. Membership is granted by your organization's admin, not by this public website.",
        ],
      },
    ],
  },
  {
    slug: "accounts",
    category: "Accounts and identity",
    title: "Accounts, sign-in, and recovery",
    summary: "How identity works on the public and application hosts.",
    status: "available",
    body: [
      {
        paragraphs: [
          "Sherivs uses authenticated accounts. Sign in at /auth. Password recovery is at /forgot-password.",
          "The same application serves sherivs.com (public site), app.sherivs.com (customer application), and console.sherivs.com (protected internal operations). Console is not a public product entry and is not linked from public navigation.",
        ],
      },
    ],
  },
  {
    slug: "organizations",
    category: "Organizations",
    title: "Organizations and membership",
    summary: "An organization is the tenant boundary.",
    status: "available",
    body: [
      {
        paragraphs: [
          "Your work lives inside an organization. Tenant-sensitive records are restricted at the data layer. Row-level security is enabled widely and is not forced on every table.",
          "If you belong to more than one organization, switch from the organization selector after sign-in. The public marketing site never selects a tenant for you.",
        ],
      },
    ],
  },
  {
    slug: "team",
    category: "Team management",
    title: "People and roles",
    summary: "Roles are granted inside the organization.",
    status: "available",
    body: [
      {
        paragraphs: [
          "In Scholar, invited people sign in to one workspace. Membership and role decide what they can open. There are no separate teacher, parent, or student applications.",
          "Invite only people who should have access. Revoking membership is the organization's responsibility.",
        ],
      },
    ],
  },
  {
    slug: "ai-workforce",
    category: "AI workforce",
    title: "Using AI workers safely",
    summary: "AI workers are governed capabilities, not unrestricted operators.",
    status: "in_development",
    listed: false,
    body: [
      {
        paragraphs: [
          "No AI worker runs today. AI workers exist only as written definitions, and they are limited to suggesting work.",
          "When they are switched on, each worker will have an owner, a purpose, and permissions, and a person will approve what it suggests. Workers should not be treated as administrators. Sherivs does not offer unlimited autonomous execution.",
        ],
      },
    ],
  },
  {
    slug: "digital-twins",
    category: "Personal twins",
    title: "Personal twins in the product",
    summary: "What exists today and what does not.",
    status: "in_development",
    listed: false,
    body: [
      {
        paragraphs: [
          "A personal twin is a stored record of a person's role and context. Today personal twins exist only as data and a short brief panel. They do not act on their own.",
          "Device and IoT twins are not part of the product.",
        ],
      },
    ],
  },
  {
    slug: "integrations",
    category: "Integrations",
    title: "Payments and messaging",
    summary: "What is live today and what is not yet.",
    status: "in_development",
    body: [
      {
        paragraphs: [
          "Paystack fee payments run in test mode only. Schools cannot take real payments through Sherivs yet.",
          "SMS, WhatsApp, and email sending are not switched on for customers yet. The code exists and is being finished.",
        ],
      },
    ],
  },
  {
    slug: "security",
    category: "Security",
    title: "How access is enforced",
    summary: "Authorization is a platform concern.",
    status: "available",
    body: [
      {
        paragraphs: [
          "Sign-in establishes identity. Organization membership and role decide what you may do. Tenant-sensitive tables are designed to use Row Level Security so the database — not only the UI — enforces isolation.",
          "Report a suspected vulnerability through the disclosure page. Do not probe other tenants.",
        ],
      },
    ],
  },
  {
    slug: "billing",
    category: "Billing",
    title: "Plans and billing",
    summary: "Prices are not published yet.",
    status: "available",
    body: [
      {
        paragraphs: [
          "Prices are not published on the website yet, and there is no online checkout. Entitlements are enforced in the product after activation, not by the marketing page.",
          "For procurement, request a demo or write to hello@sherivs.com. This help article does not state refund terms or an SLA.",
        ],
      },
    ],
  },
  {
    slug: "troubleshooting",
    category: "Troubleshooting",
    title: "When something fails",
    summary: "Status, support, and common sign-in issues.",
    status: "available",
    body: [
      {
        paragraphs: [
          "Check /status. It reads /health.json and does not expose customer data.",
          "If you cannot sign in, use password recovery. If you cannot see an organization, you may be unlinked — ask an administrator to invite you.",
          "Public support is email to support@sherivs.com. The public form opens your mail client; it does not confirm that a ticket exists until that message is received.",
        ],
      },
    ],
  },
];

export function helpBySlug(slug: string) {
  return HELP_ARTICLES.find((article) => article.slug === slug);
}

export function listedHelpArticles() {
  return HELP_ARTICLES.filter((article) => article.listed !== false);
}
