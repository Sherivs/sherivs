/**
 * Public pages that correspond to real platform capabilities or to an
 * explicit empty/notice state. Nothing in this module invents customers,
 * metrics, legal instruments, or social accounts.
 */
import { SHERIVS_BRAND } from "@/lib/sherivs/brand";

export type PageKind = "article" | "empty" | "notice" | "pricing" | "docs-index" | "doc" | "status";

export interface PageSection {
  id: string;
  heading: string;
  paragraphs: readonly string[];
}

export interface PublicPage {
  id: string;
  path: string;
  /** TanStack route id. Omitted for the dynamic document route. */
  routeId?: string;
  title: string;
  description: string;
  kicker: string;
  lede: string;
  kind: PageKind;
  framed: boolean;
  sections: readonly PageSection[];
}

const site = (page: PublicPage): PublicPage => page;

export const DOCUMENTS: readonly PublicPage[] = [
  site({
    id: "doc-reality",
    path: "/resources/docs/reality-and-intelligence",
    title: "Reality and intelligence",
    description: "How Sherivs separates verified records from AI interpretation.",
    kicker: "Documentation",
    lede: "Verified records and derived intelligence are different objects. The platform does not let the second overwrite the first.",
    kind: "doc",
    framed: false,
    sections: [
      {
        id: "records",
        heading: "What counts as a record",
        paragraphs: [
          "A record is something the organization has accepted as true: a membership, a payment, an attendance mark, a policy decision. It has an actor, a time, and a tenant.",
          "A forecast, a summary, or a model suggestion is not a record. It can sit beside the record. It cannot replace it without a validation step that a person or a policy authorizes.",
        ],
      },
      {
        id: "labels",
        heading: "How intelligence is labeled",
        paragraphs: [
          "Observation, inference, recommendation, action, evidence, and verification are different states. The interface is required to keep them visually distinct wherever AI output is shown.",
          "If the system is not processing, the interface must not animate a thinking state.",
        ],
      },
    ],
  }),
  site({
    id: "doc-authorization",
    path: "/resources/docs/authorization",
    title: "How a request is authorized",
    description:
      "The decision inputs Sherivs uses before it allows, denies, redacts, or escalates.",
    kicker: "Documentation",
    lede: "Authorization is a decision, not a hidden button. The same inputs apply to people and to AI workers.",
    kind: "doc",
    framed: false,
    sections: [
      {
        id: "inputs",
        heading: "Decision inputs",
        paragraphs: [
          "Identity, tenant, role, relationship, resource, action, policy, context, and risk. Client-supplied tenant ids and roles are not trusted.",
          "Server functions authenticate, resolve the tenant, authorize, validate, execute, audit, and return only the data the decision permits.",
        ],
      },
      {
        id: "outcomes",
        heading: "Outcomes",
        paragraphs: [
          "Allow, deny, redact, escalate, or require approval. A command palette is still subject to the same decision. The palette is not a bypass.",
        ],
      },
    ],
  }),
  site({
    id: "doc-runtimes",
    path: "/resources/docs/runtimes",
    title: "Runtimes and the platform",
    description:
      "How an installed runtime relates to Sherivs, using the education runtime as the worked example.",
    kicker: "Documentation",
    lede: "A runtime consumes Sherivs. The platform does not take its name from the runtime.",
    kind: "doc",
    framed: false,
    sections: [
      {
        id: "install",
        heading: "What installation means",
        paragraphs: [
          "An installed runtime contributes navigation, domain records, and public sections. The kernel keeps identity, tenancy, policy, evidence, and audit.",
          "The education runtime currently installed is named Scholar. Its public sections, including academics and admissions, appear on an organization site only because that runtime is active.",
        ],
      },
      {
        id: "sign-in",
        heading: "Where sign-in lands",
        paragraphs: [
          "After authentication, Sherivs opens the workspace the actor's membership grants. It does not assume an education workspace.",
        ],
      },
    ],
  }),
];

export function documentBySlug(slug: string): PublicPage | undefined {
  return DOCUMENTS.find((page) => page.path === `/resources/docs/${slug}`);
}

export const PUBLIC_PAGES: readonly PublicPage[] = [
  site({
    id: "platform-reality",
    path: "/platform/reality",
    routeId: "/platform/reality",
    title: "Reality",
    description:
      "How Sherivs represents organizational reality without confusing it with prediction.",
    kicker: "Platform",
    lede: "Reality in Sherivs is the verified structure of an organization: people, relationships, events, state, and the history of how that state changed.",
    kind: "article",
    framed: true,
    sections: [
      {
        id: "separate",
        heading: "Separate from intelligence",
        paragraphs: [
          "Predictions and AI interpretations are derived. They are stored and shown as derived. They do not overwrite a verified record unless a validation path accepts them.",
          "The kernel registry on the platform page lists the capabilities that implement this separation. This page does not restate a phase count the kernel owns.",
        ],
      },
    ],
  }),
  site({
    id: "platform-memory",
    path: "/platform/memory",
    routeId: "/platform/memory",
    title: "Memory",
    description:
      "What Sherivs means by memory: retained context under a retention and authorization rule.",
    kicker: "Platform",
    lede: "Memory is retained context. It is not a license to keep everything, and it is not a second source of truth.",
    kind: "article",
    framed: true,
    sections: [
      {
        id: "rule",
        heading: "What is retained",
        paragraphs: [
          "A memory entry answers the provenance questions: source, actor, time, verification, and whether an AI produced it. If those cannot be answered, it is not ready to be treated as memory.",
          "Customer-facing memory browsers are not a finished workspace. The contract is in force; a general memory product surface is not claimed as complete.",
        ],
      },
    ],
  }),
  site({
    id: "platform-workforce",
    path: "/platform/ai-workforce",
    routeId: "/platform/ai-workforce",
    title: "AI workforce",
    description: "Governed AI workers on Sherivs: identity, authority, tools, and lifecycle.",
    kicker: "Platform",
    lede: "An AI worker is an identity with an owner, a purpose, permissions, and a lifecycle. It is untrusted by default.",
    kind: "article",
    framed: true,
    sections: [
      {
        id: "bounds",
        heading: "What a worker may not do",
        paragraphs: [
          "A worker cannot grant itself a new permission, open a new tenant, or deploy itself. Tools are attached explicitly. Model choice is recorded with the work.",
          "Launching a worker mission is an administrative operation. It is not exposed in customer navigation.",
        ],
      },
    ],
  }),
  site({
    id: "platform-missions",
    path: "/platform/missions",
    routeId: "/platform/missions",
    title: "Missions",
    description: "Missions as the unit of governed work on Sherivs.",
    kicker: "Platform",
    lede: "A mission names an objective, an owner, the workforce allowed to pursue it, and the evidence required to close it.",
    kind: "article",
    framed: true,
    sections: [
      {
        id: "object",
        heading: "What is shipped",
        paragraphs: [
          "The mission model, worker launch for platform administrators, and the evidence and audit expectations around that launch are implemented as operator surfaces.",
          "A complete customer mission studio — planning, live logs, cost, rollback, and a timeline for every organization — is not claimed as finished.",
        ],
      },
    ],
  }),
  site({
    id: "platform-intelligence",
    path: "/platform/intelligence",
    routeId: "/platform/intelligence",
    title: "Intelligence",
    description:
      "How Sherivs treats AI output: observation, inference, recommendation, action, evidence, verification.",
    kicker: "Platform",
    lede: "Intelligence is a reading of reality. It becomes an action only after authority and verification.",
    kind: "article",
    framed: true,
    sections: [
      {
        id: "states",
        heading: "States that must stay distinct",
        paragraphs: [
          "Observation reports what a source said. Inference draws a conclusion. A recommendation proposes. An action changes state and must be authorized. Evidence supports the claim. Verification accepts or rejects the evidence.",
          "The education runtime exposes intelligence views inside an organization workspace where that runtime is installed. Those views are not the whole of Sherivs.",
        ],
      },
    ],
  }),
  site({
    id: "platform-governance",
    path: "/platform/governance",
    routeId: "/platform/governance",
    title: "Governance",
    description: "Authorization, tenant isolation, and audit on Sherivs.",
    kicker: "Platform",
    lede: "Governance is the set of rules that decide whether an action may happen and how it will be explained later.",
    kind: "article",
    framed: true,
    sections: [
      {
        id: "layers",
        heading: "Layers",
        paragraphs: [
          "Role, attribute, policy, and relationship checks compose one decision. Row-level security on tenant data is mandatory. The interface is not a security boundary.",
          "The security page lists the guarantees the platform enforces. This page is the map; that page is the control list.",
        ],
      },
    ],
  }),
  site({
    id: "platform-integrations",
    path: "/platform/integrations",
    routeId: "/platform/integrations",
    title: "Integrations",
    description: "How Sherivs connects to providers without making a vendor the architecture.",
    kicker: "Platform",
    lede: "Providers are adapters. Payments, messaging, and models are reached through governed integrations, not by scattering vendor calls through the product.",
    kind: "article",
    framed: true,
    sections: [
      {
        id: "live",
        heading: "What is actually wired",
        paragraphs: [
          "Paystack payment webhooks are verified and applied to fee records for the education runtime. Transactional email has been proven on the sherivs.com domain through the messaging adapter. Push notifications use the web app manifest and service worker.",
          "A public integration marketplace with install buttons for arbitrary vendors is not offered. API keys for an organization are managed inside that organization's workspace, under authorization, not on this page.",
        ],
      },
    ],
  }),
  site({
    id: "solutions",
    path: "/solutions",
    routeId: "/(site)/solutions",
    title: "Solutions",
    description:
      "How Sherivs serves different organizations without pretending they share one portal.",
    kicker: "Solutions",
    lede: "Sherivs fits the organization that is provisioned. It does not assume a school, a company, or a ministry until that organization says so.",
    kind: "article",
    framed: false,
    sections: [
      {
        id: "classes",
        heading: "Organization classes the platform can provision",
        paragraphs: [
          "The operator provisioning surface recognizes schools, universities, companies, government agencies, community institutions, non-profits, and networks. Those classes are data. They are not six separate products.",
          "Choose the page that matches the question you have. Education-specific behavior is described only on the education page.",
        ],
      },
    ],
  }),
  site({
    id: "solutions-organizations",
    path: "/solutions/organizations",
    routeId: "/(site)/solutions/organizations",
    title: "Organizations",
    description:
      "What every Sherivs organization receives before any domain runtime is considered.",
    kicker: "Solutions",
    lede: "Every organization receives identity, tenancy, a workspace projected from its own roles, policy, and audit. Domain features arrive with a runtime.",
    kind: "article",
    framed: false,
    sections: [
      {
        id: "base",
        heading: "The base",
        paragraphs: [
          "People join by membership, not by a hardcoded portal. Navigation follows the capabilities that membership holds. Settings, security, and public pages are composed from the organization's own records.",
        ],
      },
    ],
  }),
  site({
    id: "solutions-enterprise",
    path: "/solutions/enterprise",
    routeId: "/(site)/solutions/enterprise",
    title: "Enterprise",
    description: "The enterprise commercial tier and the controls that matter at that scale.",
    kicker: "Solutions",
    lede: "Enterprise is a custom contract in the published tier catalog. It is not a self-serve checkout.",
    kind: "article",
    framed: false,
    sections: [
      {
        id: "contract",
        heading: "What the catalog says",
        paragraphs: [
          "Trial, Starter, Growth, and Professional publish prices in naira. Enterprise is quoted. Entitlements are enforced by the platform's feature-access contracts after activation, not by the pricing page.",
          "Isolation, audit, and approval requirements do not relax because a contract is larger.",
        ],
      },
    ],
  }),
  site({
    id: "solutions-education",
    path: "/solutions/education",
    routeId: "/(site)/solutions/education",
    title: "Education",
    description: "The installed education runtime on Sherivs, and the limit of what it covers.",
    kicker: "Solutions",
    lede: "Education is a runtime installed on Sherivs. The runtime's name is Scholar. The platform's name remains Sherivs.",
    kind: "article",
    framed: false,
    sections: [
      {
        id: "scope",
        heading: "What the runtime adds",
        paragraphs: [
          "Where an organization has installed the education runtime, workspaces can include academic operations, admissions, finance for fees, and a public site whose sections follow that organization's own flags.",
          "Academics and admissions are omitted from the public site when the education runtime is not active. A company does not inherit a school navigation by signing in.",
        ],
      },
    ],
  }),
  site({
    id: "solutions-operations",
    path: "/solutions/operations",
    routeId: "/(site)/solutions/operations",
    title: "Operations",
    description: "How operational work is represented on Sherivs today.",
    kicker: "Solutions",
    lede: "Operations are the work an organization performs. Sherivs represents that work through workspaces, calendars, tasks, and missions — to the extent the installed runtime and the actor's permissions expose them.",
    kind: "article",
    framed: false,
    sections: [
      {
        id: "honest",
        heading: "What not to infer",
        paragraphs: [
          "There is no separate operations product with a universal control room for every tenant. Education operations ship inside the education runtime. Other organization classes receive the base workspace and only the capabilities they are granted.",
        ],
      },
    ],
  }),
  site({
    id: "solutions-workforce",
    path: "/solutions/ai-workforce",
    routeId: "/(site)/solutions/ai-workforce",
    title: "AI workforce",
    description: "Using governed AI workers as part of an organization's operations.",
    kicker: "Solutions",
    lede: `${SHERIVS_BRAND.aiWorkforce} is the name for governed workers operating under the same authorization rules as people.`,
    kind: "article",
    framed: false,
    sections: [
      {
        id: "use",
        heading: "How an organization should think about it",
        paragraphs: [
          "Assign a worker to a mission. Constrain its tools. Require evidence. Review the audit. Do not treat a fluent answer as completion.",
          "See the platform page for the boundary that is actually implemented.",
        ],
      },
    ],
  }),
  site({
    id: "security",
    path: "/security",
    routeId: "/(site)/security",
    title: "Security",
    description: "The security guarantees Sherivs enforces, and the ones it does not advertise.",
    kicker: "Security",
    lede: "Security is continuous: observe, evaluate, check policy, decide, enforce, audit, and re-evaluate. The guarantees below are the ones the platform is built to enforce.",
    kind: "article",
    framed: false,
    sections: [
      {
        id: "guarantees",
        heading: "Enforced guarantees",
        paragraphs: [
          "Tenant isolation is a database concern. Row-level security is mandatory for tenant-sensitive data. Application checks are not the only layer.",
          "Server functions authenticate, resolve the tenant, authorize, validate, execute, and audit. AI proposals are untrusted until validation, policy, and, where required, approval.",
          "Logs must not contain passwords, tokens, or unnecessary private data. This page does not publish a penetration-test certificate, a compliance attestation, or an uptime figure. None of those documents are attached here.",
        ],
      },
    ],
  }),
  site({
    id: "enterprise",
    path: "/enterprise",
    routeId: "/(site)/enterprise",
    title: "Enterprise",
    description: "Enterprise engagement on Sherivs: custom contract, same security model.",
    kicker: "Enterprise",
    lede: "Enterprise is the custom tier in the published catalog. The security model does not change with the contract.",
    kind: "article",
    framed: false,
    sections: [
      {
        id: "path",
        heading: "How to proceed",
        paragraphs: [
          "Read the pricing page for the published tiers. Create an account if you are ready to be provisioned. There is no enterprise logo wall on this site because no customer list is published.",
        ],
      },
    ],
  }),
  site({
    id: "pricing",
    path: "/pricing",
    routeId: "/(site)/pricing",
    title: "Pricing",
    description:
      "Published Sherivs commercial tiers, in naira, mirrored from the platform catalog.",
    kicker: "Pricing",
    lede: "These tiers mirror the platform's commercial catalog. The page does not grant entitlements. Feature access is decided after activation, per tenant and actor.",
    kind: "pricing",
    framed: false,
    sections: [],
  }),
  site({
    id: "resources",
    path: "/resources",
    routeId: "/(site)/resources",
    title: "Resources",
    description: "Documentation and the publishing shelves Sherivs has not filled.",
    kicker: "Resources",
    lede: "Documentation that describes the running platform is published. Essays, guides, case studies, and a changelog are shelves with nothing on them yet.",
    kind: "article",
    framed: false,
    sections: [
      {
        id: "shelves",
        heading: "Shelves",
        paragraphs: [
          "Start with the documentation. The other shelves exist so the information architecture is honest about what is absent, rather than filled with placeholder articles.",
        ],
      },
    ],
  }),
  site({
    id: "docs",
    path: "/resources/docs",
    routeId: "/(site)/resources/docs",
    title: "Documentation",
    description: "Short documents about reality, authorization, and runtimes on Sherivs.",
    kicker: "Documentation",
    lede: "Three documents. Each one describes behavior that exists in the platform. Search filters this list only.",
    kind: "docs-index",
    framed: false,
    sections: [],
  }),
  site({
    id: "blog",
    path: "/resources/blog",
    routeId: "/(site)/resources/blog",
    title: "Essays",
    description: "The Sherivs essay shelf. Nothing is published.",
    kicker: "Essays",
    lede: "No essays are published.",
    kind: "empty",
    framed: false,
    sections: [],
  }),
  site({
    id: "guides",
    path: "/resources/guides",
    routeId: "/(site)/resources/guides",
    title: "Guides",
    description: "The Sherivs guide shelf. Nothing is published.",
    kicker: "Guides",
    lede: "No guides are published.",
    kind: "empty",
    framed: false,
    sections: [],
  }),
  site({
    id: "cases",
    path: "/resources/case-studies",
    routeId: "/(site)/resources/case-studies",
    title: "Case studies",
    description: "The Sherivs case study shelf. Nothing is published.",
    kicker: "Case studies",
    lede: "No case studies are published. Sherivs does not display customer logos or invented outcomes.",
    kind: "empty",
    framed: false,
    sections: [],
  }),
  site({
    id: "changelog",
    path: "/resources/changelog",
    routeId: "/(site)/resources/changelog",
    title: "Changelog",
    description: "The public Sherivs changelog. No public release notes are published here yet.",
    kicker: "Changelog",
    lede: "No public release notes are published on this shelf yet.",
    kind: "empty",
    framed: false,
    sections: [],
  }),
  site({
    id: "about",
    path: "/about",
    routeId: "/(site)/about",
    title: "About",
    description: "What Sherivs is. No invented company history.",
    kicker: "Company",
    lede: `${SHERIVS_BRAND.name} builds ${SHERIVS_BRAND.category.toLowerCase()}. The public site is ${SHERIVS_BRAND.origin}.`,
    kind: "article",
    framed: false,
    sections: [
      {
        id: "identity",
        heading: "Identity",
        paragraphs: [
          "Sherivs is the customer-facing brand. The technical substrate retains its existing identifiers so databases, migrations, and packages stay compatible. The education runtime keeps the name Scholar. Jarvis is the name of the executive intelligence contracts.",
          "A founding story, a headcount, an office address, and a leadership page are not published because those facts are not maintained as public content in this repository.",
        ],
      },
    ],
  }),
  site({
    id: "careers",
    path: "/careers",
    routeId: "/(site)/careers",
    title: "Careers",
    description: "Sherivs is not publishing roles on this site.",
    kicker: "Careers",
    lede: "No roles are published.",
    kind: "empty",
    framed: false,
    sections: [],
  }),
  site({
    id: "contact",
    path: "/contact",
    routeId: "/(site)/contact",
    title: "Contact",
    description: "How to reach Sherivs without a fabricated inbox.",
    kicker: "Contact",
    lede: "This site does not publish a monitored public inbox. Account access is the sign-in surface. Organization provisioning is performed by an authorized operator after an account exists.",
    kind: "notice",
    framed: false,
    sections: [
      {
        id: "path",
        heading: "What you can do from here",
        paragraphs: [
          "Create an account or sign in. Read the security page before you send data anywhere. Do not email credentials to anyone who asks for them outside the sign-in surface.",
        ],
      },
    ],
  }),
  site({
    id: "demo",
    path: "/request-demo",
    routeId: "/(site)/request-demo",
    title: "Request access",
    description: "How access to Sherivs is requested. There is no demo form.",
    kicker: "Access",
    lede: "There is no demo request form. A form that does not reach an operator would be a false promise.",
    kind: "notice",
    framed: false,
    sections: [
      {
        id: "steps",
        heading: "The real path",
        paragraphs: [
          "Create an account. An authorized operator provisions the organization, assigns membership, and the workspace that membership allows. Enterprise pricing is a custom contract, listed on the pricing page, not collected on this one.",
        ],
      },
    ],
  }),
  site({
    id: "status",
    path: "/status",
    routeId: "/(site)/status",
    title: "Status",
    description: "Live liveness of this Sherivs instance. No invented uptime history.",
    kicker: "Status",
    lede: "This page reads the instance health endpoint and shows its status word. It does not chart a history it does not have.",
    kind: "status",
    framed: false,
    sections: [],
  }),
  site({
    id: "legal-privacy",
    path: "/legal/privacy",
    routeId: "/(site)/legal/privacy",
    title: "Privacy",
    description:
      "Privacy notice status and the controls Sherivs implements. Not a legal instrument.",
    kicker: "Legal",
    lede: "This is not a legal instrument. A counsel-authored privacy notice has not been published.",
    kind: "notice",
    framed: false,
    sections: [
      {
        id: "controls",
        heading: "Controls that are implemented",
        paragraphs: [
          "Tenant data is isolated with row-level security. AI context is minimized to what the actor is authorized to use. A signed-in person can opt out of digital-twin references to their data from account settings.",
          "The platform must not log passwords, tokens, or unnecessary private data. A data-export and account-deletion flow is not offered from the account surface.",
        ],
      },
    ],
  }),
  site({
    id: "legal-terms",
    path: "/legal/terms",
    routeId: "/(site)/legal/terms",
    title: "Terms",
    description: "Terms of use are not published. This page is not a contract.",
    kicker: "Legal",
    lede: "This is not a legal instrument. Terms of use have not been published.",
    kind: "notice",
    framed: false,
    sections: [
      {
        id: "use",
        heading: "What this page will not do",
        paragraphs: [
          "It will not invent a contract, a governing law, or a liability clause. Access to an organization is granted by that organization's operators under the platform's authorization rules.",
        ],
      },
    ],
  }),
  site({
    id: "legal-cookies",
    path: "/legal/cookies",
    routeId: "/(site)/legal/cookies",
    title: "Cookies",
    description: "What this Sherivs site stores in the browser. Not a legal instrument.",
    kicker: "Legal",
    lede: "This is not a legal instrument. It describes the browser storage the product actually uses.",
    kind: "notice",
    framed: false,
    sections: [
      {
        id: "storage",
        heading: "Storage",
        paragraphs: [
          "The theme preference is stored locally so the next visit can honor light, dark, or system. The identity provider stores the session required to stay signed in. The service worker caches the app shell for offline fallback.",
          "There is no advertising cookie and no third-party marketing pixel on this site.",
        ],
      },
    ],
  }),
  site({
    id: "legal-a11y",
    path: "/legal/accessibility",
    routeId: "/(site)/legal/accessibility",
    title: "Accessibility",
    description: "The accessibility commitments implemented on the Sherivs public site.",
    kicker: "Legal",
    lede: "This is not a legal instrument and not a conformance certificate. It is the list of accessibility behavior this experience implements, aimed at WCAG 2.2 AA where the control is practical.",
    kind: "notice",
    framed: false,
    sections: [
      {
        id: "implemented",
        heading: "Implemented on the public experience",
        paragraphs: [
          "Skip to main content. Semantic headings. Keyboard-reachable navigation, including the mobile disclosure. Visible focus. Text that meets contrast on the paper and ink surfaces. A reduced-motion preference that collapses animation and transition timing.",
          "Touch targets on primary controls are sized for a thumb. The public site does not rely on color alone to convey the mission sequence or the health status word.",
        ],
      },
    ],
  }),
];

export function pageById(id: string): PublicPage | undefined {
  return PUBLIC_PAGES.find((page) => page.id === id) ?? DOCUMENTS.find((page) => page.id === id);
}

export function pageByPath(path: string): PublicPage | undefined {
  return (
    PUBLIC_PAGES.find((page) => page.path === path) ??
    documentBySlug(path.replace("/resources/docs/", ""))
  );
}

/** Paths that belong in the public sitemap, excluding the dynamic document pattern. */
export function publicSitemapPaths(): string[] {
  const staticPaths = PUBLIC_PAGES.map((page) => page.path);
  const docPaths = DOCUMENTS.map((page) => page.path);
  return ["/", "/coregrid", "/platform", ...staticPaths, ...docPaths];
}
