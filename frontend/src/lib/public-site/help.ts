export interface HelpArticle {
  slug: string;
  category: string;
  title: string;
  summary: string;
  status: "available" | "in_development";
  body: readonly { heading?: string; paragraphs: readonly string[] }[];
}

export const HELP_CATEGORIES = [
  "Getting started",
  "Accounts and identity",
  "Organizations",
  "Team management",
  "AI workforce",
  "Digital twins",
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
          "Go to app.sherivs.com and choose Create Account, or request a demo at hello@sherivs.com. The Sherivs team creates the organization's admin account. There is no self-service sign-up and no public demo passwords.",
          "After the admin account is provisioned, that admin invites every other user by email with login credentials. Invited users sign in on app.sherivs.com — they do not create their own accounts.",
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
          "Your work lives inside an organization. Data for that organization is intended to be isolated from other organizations at the database layer.",
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
          "In Scholar, people work through role workspaces such as administrator, teacher, parent, or student. What someone sees follows from membership and role — not from hiding a button.",
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
    body: [
      {
        paragraphs: [
          "Where AI workers are enabled, they operate with an owner, a purpose, and permissions. They should not be treated as administrators.",
          "Some worker features require the platform's model credentials to be configured. If a worker surface is marked planned inside the product, it is not available for production use. Sherivs does not offer unlimited autonomous execution.",
        ],
      },
    ],
  },
  {
    slug: "digital-twins",
    category: "Digital twins",
    title: "Digital twins in the product",
    summary: "What exists today versus the long-term runtime.",
    status: "in_development",
    body: [
      {
        paragraphs: [
          "A digital twin is a governed digital model: identity, state, relationships, and events. Administrative screens exist in the application.",
          "A complete event-driven twin runtime, including device and IoT twins, is not a generally available customer product in the current execution profile.",
        ],
      },
    ],
  },
  {
    slug: "integrations",
    category: "Integrations",
    title: "Payments and messaging",
    summary: "Integrations that exist in code when configured.",
    status: "available",
    body: [
      {
        paragraphs: [
          "Scholar fee collection can use Paystack when the organization and platform have configured it. If Paystack is not configured, checkout will not run.",
          "WhatsApp Cloud webhooks exist when Meta credentials are present. Email and SMS delivery depend on configured providers and are not claimed as always-on from this help article.",
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
    summary: "Public prices are a catalog view, not a checkout contract.",
    status: "available",
    body: [
      {
        paragraphs: [
          "The platform-detail page shows a commercial catalog in Nigerian naira, including a trial and quoted enterprise pricing. Entitlements are enforced in the product after activation, not by the marketing page.",
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
