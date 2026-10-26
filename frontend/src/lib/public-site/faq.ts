import { POSITIONING_STATEMENT } from "@/lib/public-site/company";
import { THINKTECH_DESCRIPTION } from "@/lib/public-site/partners";

export interface FaqItem {
  id: string;
  category: string;
  question: string;
  answer: string;
  related: readonly { href: string; label: string }[];
}

export const FAQ_CATEGORIES = [
  "About Sherivs",
  "Product availability",
  "AI workforce",
  "Digital twins",
  "Security",
  "Onboarding",
  "Integrations",
] as const;

export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    id: "what-is-sherivs",
    category: "About Sherivs",
    question: "What is Sherivs?",
    answer: `${POSITIONING_STATEMENT} Education through Scholar can be used today; other capabilities described here are in development and are not claimed as generally available.`,
    related: [
      { href: "/sherivs", label: "Platform overview" },
      { href: "/company/vision", label: "Vision" },
    ],
  },
  {
    id: "who-sherivs-serves",
    category: "About Sherivs",
    question: "Who does Sherivs serve?",
    answer:
      "Sherivs is built for institutions that need shared identity, records, and governed intelligence — schools first, through Sherivs Scholar, and other organizations as additional runtimes mature. Sherivs Technologies Limited is based in Maiduguri, Borno State, Nigeria. Education is an important domain; it is not the definition of the company.",
    related: [
      { href: "/about", label: "About" },
      { href: "/solutions", label: "Solutions" },
    ],
  },
  {
    id: "not-a-chatbot",
    category: "About Sherivs",
    question: "How is Sherivs different from a conventional AI assistant?",
    answer:
      "An assistant replies in a side panel. Sherivs is designed as institutional computing: people, organizations, agents, and twins share identity, policy, and state. AI workers are bounded identities with owners and oversight, not a single unbounded chatbot. Unlimited autonomous execution is not offered.",
    related: [
      { href: "/sherivs", label: "Platform" },
      { href: "/product/ai-workforce", label: "AI workforce" },
    ],
  },
  {
    id: "institutional-computing",
    category: "About Sherivs",
    question: "What does institutional computing mean?",
    answer:
      "Institutional computing is a shared, governed environment where an organization's people, records, agents, and twins operate together instead of across disconnected tools. Canonical records stay separate from derived intelligence. See the insights article for a fuller definition.",
    related: [
      { href: "/insights/what-is-institutional-computing", label: "Article" },
      { href: "/product/institutional-computing", label: "Institutional computing" },
    ],
  },
  {
    id: "available-today",
    category: "Product availability",
    question: "What can an organization use today?",
    answer:
      "Organizations can create an account, form an organization, and use Sherivs Scholar — the education runtime. Tenant public websites, identity, membership, and school operations in Scholar are real product surfaces. Other industry runtimes, a public developer SDK, and a finished digital-twin product are not generally available.",
    related: [
      { href: "/solutions/education", label: "Sherivs Scholar" },
      { href: "/solutions", label: "Solutions" },
    ],
  },
  {
    id: "coregrid",
    category: "About Sherivs",
    question: "What is CoreGrid?",
    answer:
      "CoreGrid is a historical internal architecture identifier. The public brand and product are Sherivs. You will not be asked to “sign in to CoreGrid.”",
    related: [{ href: "/about", label: "About Sherivs" }],
  },
  {
    id: "ai-workforce-limits",
    category: "AI workforce",
    question: "Does Sherivs run unlimited autonomous agents?",
    answer:
      "No. AI workers are designed as governed identities with owners, permissions, and human oversight. They must not expand their own access. Some worker features require platform model credentials and are still in development. Sherivs does not promise unattended, unlimited execution.",
    related: [{ href: "/product/ai-workforce", label: "AI workforce" }],
  },
  {
    id: "twins-today",
    category: "Digital twins",
    question: "Are digital twins a shipping product?",
    answer:
      "Digital twins are part of the Sherivs architecture: persistent identity, state, relationships, and events. Administrative surfaces exist. A complete twin runtime — especially device and IoT twins — is not a generally available product, and hardware scope is frozen in the current execution profile.",
    related: [{ href: "/product/digital-twins", label: "Digital twins" }],
  },
  {
    id: "security-certified",
    category: "Security",
    question: "Is Sherivs SOC 2 or ISO 27001 certified?",
    answer:
      "Sherivs does not display SOC 2, ISO 27001, or similar certification badges. Registration numbers and tax identifiers are not published. NSCDC- and NDPA-related statuses are not shown as named certifications; public wording is awaiting owner approval of the exact official instrument. Certificate details stay unpublished. Engineering principles on this site (tenant isolation, audit) are not certificates.",
    related: [
      { href: "/security", label: "Security" },
      { href: "/trust", label: "Trust center" },
    ],
  },
  {
    id: "how-to-start",
    category: "Onboarding",
    question: "How do we get started?",
    answer:
      "Request a demo (hello@sherivs.com) for a walkthrough. Sherivs creates your organization's admin account; that admin then invites users by email with login credentials. There is no self-service sign-up and no public demo passwords on the website.",
    related: [
      { href: "/request-demo", label: "Request a demo" },
      { href: "/onboarding", label: "Request an admin account" },
      { href: "/auth", label: "Sign in" },
    ],
  },
  {
    id: "thinktech",
    category: "About Sherivs",
    question: "Who is ThinkTech?",
    answer: `${THINKTECH_DESCRIPTION} ThinkTech is a published technology partner — not a commercial customer reference, and not the same as configured integrations such as Paystack or WhatsApp.`,
    related: [
      { href: "/company/partners", label: "Partners" },
      { href: "/integrations", label: "Integrations" },
    ],
  },
  {
    id: "integrations",
    category: "Integrations",
    question: "Which integrations are real?",
    answer:
      "Paystack can be used for Scholar fee payments when configured. WhatsApp Cloud webhooks exist when Meta credentials are configured. Listing a technology here means Sherivs can integrate with it — not that the vendor has a commercial partnership with Sherivs.",
    related: [{ href: "/integrations", label: "Integrations" }],
  },
  {
    id: "developer-api",
    category: "Product availability",
    question: "Is there a public API or SDK?",
    answer:
      "Not as a published customer product. A developer platform (API catalog, explorer, SDK) is planned. Today, developers work through the web application after signing in. Do not treat internal contract packages in the repository as a public SDK.",
    related: [
      { href: "/developers", label: "Developers" },
      { href: "/docs", label: "Docs" },
    ],
  },
  {
    id: "data-residency",
    category: "Security",
    question: "Where is data stored?",
    answer:
      "A public, owner-approved data-residency statement is not on file. This site will not invent regions or transfer clauses. Ask during a demo or write to info@sherivs.com if residency is a requirement for your organization.",
    related: [{ href: "/privacy-policy", label: "Privacy policy" }],
  },
  {
    id: "support-path",
    category: "Onboarding",
    question: "How do we get support?",
    answer:
      "Existing customers can write to support@sherivs.com or use in-workspace support where it is enabled. The public support form opens your email client; it does not create a ticket in a helpdesk unless that mail is received.",
    related: [
      { href: "/support", label: "Support" },
      { href: "/help", label: "Help center" },
    ],
  },
  {
    id: "status",
    category: "Onboarding",
    question: "Where is system status?",
    answer:
      "The public status page at /status reads a leak-free /health.json report. It does not expose internal diagnostics or customer data.",
    related: [{ href: "/status", label: "Status" }],
  },
];

export const FAQ_PREVIEW_IDS = [
  "what-is-sherivs",
  "not-a-chatbot",
  "available-today",
  "ai-workforce-limits",
  "twins-today",
  "support-path",
] as const;
