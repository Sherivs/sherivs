/**
 * Public pages that exist because the platform can say something true.
 *
 * A page is registered only with an evidence note pointing at a real
 * contract, route, or content module. Unpublished ideas are absent.
 */

export interface PublicLink {
  readonly href: string;
  readonly label: string;
  readonly detail: string;
}

export interface PublicDefinition {
  readonly term: string;
  readonly detail: string;
}

export interface PublicStep {
  readonly label: string;
  readonly detail: string;
}

export type PublicBlock =
  | { readonly type: "prose"; readonly paragraphs: readonly string[] }
  | { readonly type: "definitions"; readonly items: readonly PublicDefinition[] }
  | { readonly type: "process"; readonly steps: readonly PublicStep[] }
  | { readonly type: "links"; readonly items: readonly PublicLink[] };

export interface PublicPage {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly kicker: string;
  readonly navLabel: string | null;
  readonly footerGroup: "Platform" | "Solutions" | "Resources" | "Legal" | null;
  readonly evidence: string;
  readonly blocks: readonly PublicBlock[];
}

const AUTH: PublicLink = {
  href: "/auth",
  label: "Create an account",
  detail: "Evaluation starts at the real account surface. There is no separate demo form.",
};

export const PUBLIC_PAGES: readonly PublicPage[] = [
  {
    id: "platform-reality",
    path: "/platform/reality",
    title: "Reality",
    description:
      "Sherivs keeps verified organizational records separate from predictions and AI interpretations.",
    kicker: "Platform",
    navLabel: null,
    footerGroup: "Platform",
    evidence: "SITE_CAPABILITIES reality-model; canonical truth law",
    blocks: [
      {
        type: "prose",
        paragraphs: [
          "An organization is not a dashboard. It is people, records, relationships, events and decisions that have to stay true when software is wrong.",
          "Sherivs treats verified records as canonical truth. Predictions, recommendations and model output sit beside that truth. They do not replace it.",
        ],
      },
      {
        type: "definitions",
        items: [
          { term: "People", detail: "Identities with owners, roles and relationships." },
          { term: "Records", detail: "Transactions, state and history that can be audited." },
          { term: "Events", detail: "What happened, when, and under which policy." },
          { term: "Intelligence", detail: "Derived understanding, labeled as derived." },
        ],
      },
    ],
  },
  {
    id: "platform-memory",
    path: "/platform/memory",
    title: "Memory",
    description:
      "Organizational memory is retrieved only with identity, tenant and a declared scope. Every access is audited.",
    kicker: "Platform",
    navLabel: null,
    footerGroup: "Platform",
    evidence: "frontend/src/lib/memory/memory-store.ts",
    blocks: [
      {
        type: "prose",
        paragraphs: [
          "Memory is platform-owned data. An AI worker does not own it and cannot widen it.",
          "A retrieval that lacks identity, tenant or declared scope is denied before any record is read. Writes outside the declared scope are rejected, not silently trimmed. Withheld records are written into an access ledger.",
        ],
      },
      {
        type: "definitions",
        items: [
          { term: "Scope", detail: "Tenant, mission, actor, domain and sensitivity ceiling." },
          { term: "Provenance", detail: "Who wrote the record, when, and from which source." },
          { term: "Denial", detail: "Missing context fails closed. Similarity search is not a bypass." },
        ],
      },
    ],
  },
  {
    id: "platform-workforce",
    path: "/platform/ai-workforce",
    title: "AI workforce",
    description:
      "AI workers are governed identities with owners, permissions and a lifecycle. They are untrusted by default.",
    kicker: "Platform",
    navLabel: null,
    footerGroup: "Platform",
    evidence: "SITE_CAPABILITIES ai-workforce; workforce registry contracts",
    blocks: [
      {
        type: "prose",
        paragraphs: [
          "Sherivs AI Workforce is not a cast of autonomous characters. A worker is an identity: owner, purpose, tools, model, permissions, tenant scope and lifecycle.",
          "Workers move through proposed, reviewed, approved, deployed, monitored, suspended and retired states. They cannot increase their own permissions or deploy themselves.",
        ],
      },
    ],
  },
  {
    id: "platform-missions",
    path: "/platform/missions",
    title: "Missions",
    description:
      "A mission is assigned, leased, evidenced and independently verified. Completion by a worker is not verification.",
    kicker: "Platform",
    navLabel: null,
    footerGroup: "Platform",
    evidence: "frontend/src/lib/missions/mission-execution.ts EXECUTION_PATH_STAGES",
    blocks: [
      {
        type: "prose",
        paragraphs: [
          "Work that matters is a mission: an owner, an assignment, evidence and a verifier who is not the worker.",
          "The execution path implemented today is assigned, then leased, then evidenced, then verified. Failure can requeue until attempts are exhausted. An admission denial ends the path.",
        ],
      },
      {
        type: "process",
        steps: [
          { label: "Assigned", detail: "An authorized actor gives the mission to a worker." },
          { label: "Leased", detail: "The worker holds a time-bounded lease. Expiry returns the work." },
          { label: "Evidenced", detail: "The outcome carries who, when, source and an integrity binding." },
          { label: "Verified", detail: "An independent verifier accepts or rejects. The worker cannot self-verify." },
        ],
      },
    ],
  },
  {
    id: "platform-intelligence",
    path: "/platform/intelligence",
    title: "Intelligence",
    description:
      "Sherivs distinguishes observation, inference, recommendation and action. Model output stays untrusted until it is checked.",
    kicker: "Platform",
    navLabel: null,
    footerGroup: "Platform",
    evidence: "AI output trust law; canonical truth separation",
    blocks: [
      {
        type: "definitions",
        items: [
          { term: "Observation", detail: "What the system recorded." },
          { term: "Inference", detail: "What a model concluded. Labeled as inference." },
          { term: "Recommendation", detail: "A proposed next step. Not yet an action." },
          { term: "Action", detail: "Execution after validation, policy and, where required, approval." },
          { term: "Evidence", detail: "The record that lets someone else check the action." },
          { term: "Verification", detail: "An independent decision that the evidence holds." },
        ],
      },
    ],
  },
  {
    id: "platform-governance",
    path: "/platform/governance",
    title: "Governance",
    description:
      "Every request is identity, tenant, role, relationship, resource, action, policy, context and risk.",
    kicker: "Platform",
    navLabel: null,
    footerGroup: "Platform",
    evidence: "SECURITY_GUARANTEES; authorization model",
    blocks: [
      {
        type: "prose",
        paragraphs: [
          "Authorization is layered: roles, attributes, policy, relationships and row-level security. The interface hiding a button is not the control.",
          "Decisions resolve to allow, deny, redact, escalate or require approval. Server functions authenticate, resolve the tenant, authorize, validate, execute, audit, and return only permitted data.",
        ],
      },
    ],
  },
  {
    id: "platform-integrations",
    path: "/platform/integrations",
    title: "Integrations",
    description:
      "External providers sit behind adapters. A Paystack webhook is implemented. Live delivery depends on configured credentials.",
    kicker: "Platform",
    navLabel: null,
    footerGroup: "Platform",
    evidence: "communication-providers.ts; routes/api/public/webhooks/paystack.ts",
    blocks: [
      {
        type: "prose",
        paragraphs: [
          "Sherivs does not scatter vendor calls through product code. Communication, payments and storage are adapters. Credentials are references, not values stored in the product catalog.",
          "A Paystack webhook endpoint verifies signatures before it accepts a payment event. Other providers in the communication registry are adapter targets. They are not a claim that every named vendor is connected in this deployment.",
        ],
      },
      {
        type: "links",
        items: [
          {
            href: "/developers",
            label: "Developer surface",
            detail: "Authentication, webhooks, health and what is not published.",
          },
        ],
      },
    ],
  },
  {
    id: "solutions",
    path: "/solutions",
    title: "Solutions",
    description:
      "Sherivs is one kernel. Organizations install the runtime they need. Education is the runtime installed today.",
    kicker: "Solutions",
    navLabel: "Solutions",
    footerGroup: "Solutions",
    evidence: "INSTALLED_RUNTIMES; organization classes in the operator console",
    blocks: [
      {
        type: "prose",
        paragraphs: [
          "The same kernel can hold a school, a company, an agency or a community institution. The workspace they see is projected from roles and policies, not from a fixed product template.",
          "One domain runtime is installed: the education runtime. Other organization classes can be provisioned as data. They do not imply a second finished vertical.",
        ],
      },
      {
        type: "links",
        items: [
          { href: "/solutions/organizations", label: "Organizations", detail: "Capability-driven workspaces." },
          { href: "/solutions/education", label: "Education", detail: "The installed education runtime." },
          { href: "/solutions/enterprise", label: "Enterprise", detail: "Isolation, audit and control." },
          { href: "/solutions/operations", label: "Operations", detail: "Missions as the unit of work." },
          { href: "/solutions/ai-workforce", label: "AI workforce", detail: "Governed workers beside people." },
        ],
      },
    ],
  },
  {
    id: "solutions-organizations",
    path: "/solutions/organizations",
    title: "Organizations",
    description: "An organization workspace shows only the capabilities that organization has turned on.",
    kicker: "Solutions",
    navLabel: null,
    footerGroup: "Solutions",
    evidence: "workspace navigation engine; shell capability filter",
    blocks: [
      {
        type: "prose",
        paragraphs: [
          "Navigation is not a catalog of every module Sherivs could ever grow. A section appears when the installed runtime contributes it and the person's capabilities include it.",
          "Overview, people, work, missions, memory, calendar, workforce and governance are universal candidates. Education-only sections stay inside the education runtime.",
        ],
      },
    ],
  },
  {
    id: "solutions-enterprise",
    path: "/solutions/enterprise",
    title: "Enterprise",
    description:
      "Tenant isolation is enforced in the database. Audit records are append-only. The interface is not the security boundary.",
    kicker: "Solutions",
    navLabel: null,
    footerGroup: "Solutions",
    evidence: "SECURITY_GUARANTEES tenant isolation and immutable audit",
    blocks: [
      {
        type: "prose",
        paragraphs: [
          "Enterprise here means control, not a badge. Each tenant is a governed environment. Row Level Security applies to tenant-sensitive data so one organization cannot read another even if application code fails.",
          "Sherivs does not publish a compliance certification on this page. What is implemented is isolation, layered authorization, audit and an agent lifecycle that cannot expand itself.",
        ],
      },
    ],
  },
  {
    id: "solutions-education",
    path: "/solutions/education",
    title: "Education",
    description:
      "The installed education runtime consumes the kernel. Removing it leaves the kernel valid.",
    kicker: "Solutions",
    navLabel: null,
    footerGroup: "Solutions",
    evidence: "INSTALLED_RUNTIME_PROOFS runtime:scholar",
    blocks: [
      {
        type: "prose",
        paragraphs: [
          "Education is a runtime installed on Sherivs, not the identity of the platform. It brings academic structure, admissions and the public sections a school turns on. The kernel keeps identity, tenancy, missions, workforce, evidence and policy.",
          "A public school site is that organization's site. Admissions, programs and academic navigation load only when that runtime is active for the organization.",
        ],
      },
      {
        type: "links",
        items: [
          { href: "/coregrid#runtimes", label: "Installed runtime", detail: "The public proof of runtime neutrality." },
        ],
      },
    ],
  },
  {
    id: "solutions-operations",
    path: "/solutions/operations",
    title: "Operations",
    description: "Operational work is a mission with a lease, evidence and an independent verifier.",
    kicker: "Solutions",
    navLabel: null,
    footerGroup: "Solutions",
    evidence: "mission execution path",
    blocks: [
      {
        type: "prose",
        paragraphs: [
          "Operations on Sherivs are not a board of anonymous tasks. A mission has an owner, a worker, a lease and evidence. Verification is a separate act.",
        ],
      },
      {
        type: "links",
        items: [{ href: "/platform/missions", label: "Mission path", detail: "The stages the platform actually runs." }],
      },
    ],
  },
  {
    id: "solutions-workforce",
    path: "/solutions/ai-workforce",
    title: "AI workforce",
    description: "People and governed AI workers share missions. Authority stays with the organization.",
    kicker: "Solutions",
    navLabel: null,
    footerGroup: "Solutions",
    evidence: "AI workforce capability",
    blocks: [
      {
        type: "links",
        items: [
          {
            href: "/platform/ai-workforce",
            label: "How workers are governed",
            detail: "Identity, lifecycle and the refusal to self-authorize.",
          },
        ],
      },
    ],
  },
  {
    id: "security",
    path: "/security",
    title: "Security",
    description:
      "Isolation, authorization, canonical truth, untrusted AI output, audit and agent lifecycle.",
    kicker: "Security",
    navLabel: "Security",
    footerGroup: "Platform",
    evidence: "SECURITY_GUARANTEES",
    blocks: [
      {
        type: "prose",
        paragraphs: [
          "Security is a lifecycle: observe, evaluate, check policy, decide, enforce, audit, re-evaluate. It is not a page of badges.",
        ],
      },
    ],
  },
  {
    id: "enterprise",
    path: "/enterprise",
    title: "Enterprise architecture",
    description:
      "Sherivs is a kernel with registries, events, policies and runtimes. Domain logic does not call vendors directly.",
    kicker: "Enterprise",
    navLabel: null,
    footerGroup: "Platform",
    evidence: "platform kernel page /platform; adapter law",
    blocks: [
      {
        type: "prose",
        paragraphs: [
          "The public description stops at the boundary an operator needs: tenants, identity, policy, evidence and runtimes. Internal control-plane routes are not linked from the customer site.",
          "Domain logic depends on platform contracts. Supabase, payment providers, messaging providers and model providers sit behind adapters.",
        ],
      },
      {
        type: "links",
        items: [
          { href: "/platform", label: "Kernel detail", detail: "The existing platform capability surface." },
          { href: "/security", label: "Security", detail: "What the controls actually are." },
        ],
      },
    ],
  },
  {
    id: "pricing",
    path: "/pricing",
    title: "Pricing",
    description: "Commercial tiers in naira, mirrored from the platform catalog. Enforcement is not this page.",
    kicker: "Pricing",
    navLabel: "Pricing",
    footerGroup: "Platform",
    evidence: "MARKETING_TIERS and subscription-tiers catalog",
    blocks: [
      {
        type: "prose",
        paragraphs: [
          "Prices below are the commercial catalog: Trial, Starter, Growth, Professional and Enterprise. Choosing a tier on this page does not grant features. Access is decided by the feature-access contract for the signed-in tenant.",
          "Enterprise is quoted as a custom contract. The other tiers publish monthly and annual prices in naira.",
        ],
      },
      {
        type: "links",
        items: [{ ...AUTH }, { href: "/coregrid#pricing", label: "Full tier table", detail: "The existing pricing section." }],
      },
    ],
  },
  {
    id: "resources",
    path: "/resources",
    title: "Resources",
    description:
      "What is published: platform pages, the security posture, system health, and organization-owned sites.",
    kicker: "Resources",
    navLabel: "Resources",
    footerGroup: "Resources",
    evidence: "existing public routes only",
    blocks: [
      {
        type: "prose",
        paragraphs: [
          "Sherivs does not publish a platform blog, case-study library or changelog feed yet. Those routes are omitted rather than filled with placeholders.",
          "An organization's own news and articles are published on that organization's site when the organization has turned publishing on.",
        ],
      },
      {
        type: "links",
        items: [
          { href: "/platform", label: "Platform", detail: "Kernel capabilities." },
          { href: "/security", label: "Security", detail: "Controls, not certifications." },
          { href: "/status", label: "Status", detail: "The machine health endpoint." },
          { href: "/developers", label: "Developers", detail: "APIs that exist." },
        ],
      },
    ],
  },
  {
    id: "about",
    path: "/about",
    title: "About",
    description: "Sherivs is institutional intelligence infrastructure. CoreGrid is the technical kernel name.",
    kicker: "About",
    navLabel: null,
    footerGroup: "Resources",
    evidence: "brand identity module",
    blocks: [
      {
        type: "prose",
        paragraphs: [
          "Sherivs is the product people see. The category is institutional intelligence infrastructure: a governed layer for organizational reality, intelligence, action and evidence.",
          "CoreGrid remains the name of the technical kernel — schemas, migrations and internal contracts. That name is preserved so existing systems keep working. It is not the public brand.",
          "This page does not invent a founding story, a headcount, an office or a customer list.",
        ],
      },
    ],
  },
  {
    id: "contact",
    path: "/contact",
    title: "Contact",
    description: "There is no public inbox on this site. Account access is the live path.",
    kicker: "Contact",
    navLabel: null,
    footerGroup: "Resources",
    evidence: "auth route; no contact persistence API",
    blocks: [
      {
        type: "prose",
        paragraphs: [
          "A contact form that does not store a message would be theatre. This site does not pretend to have one.",
          "To evaluate Sherivs, create an account. Password reset is available from the same screen. Organization staff sign in to the organization they belong to.",
        ],
      },
      {
        type: "links",
        items: [AUTH, { href: "/auth", label: "Sign in", detail: "Existing accounts, including password reset." }],
      },
    ],
  },
  {
    id: "status",
    path: "/status",
    title: "Status",
    description: "Machine health is published at /health.json. This page does not invent uptime.",
    kicker: "Status",
    navLabel: null,
    footerGroup: "Resources",
    evidence: "routes/health[.]json.ts",
    blocks: [
      {
        type: "prose",
        paragraphs: [
          "Load balancers read /health.json. The payload is a fixed report: status, time, uptime, memory, version and check results. It does not include environment variables, connection strings or stack traces.",
          "A failing instance responds 503. A degraded instance still responds 200 because it is serving. This page does not display a fabricated uptime percentage.",
        ],
      },
      {
        type: "links",
        items: [{ href: "/health.json", label: "health.json", detail: "The probe document." }],
      },
    ],
  },
  {
    id: "developers",
    path: "/developers",
    title: "Developers",
    description:
      "Session authentication, a verified Paystack webhook, health, and organization API keys issued inside a workspace.",
    kicker: "Developers",
    navLabel: null,
    footerGroup: "Resources",
    evidence: "auth, paystack webhook, health.json, admin api-keys route",
    blocks: [
      {
        type: "definitions",
        items: [
          { term: "Authentication", detail: "Accounts use the session established at /auth. There is no anonymous API key mint on this page." },
          { term: "API keys", detail: "Authorized organization administrators manage keys inside the workspace." },
          { term: "Webhooks", detail: "Paystack notifications hit a signature-checked endpoint." },
          { term: "Health", detail: "/health.json is the unauthenticated probe." },
          { term: "SDKs", detail: "No public SDK package is published from this product surface." },
        ],
      },
    ],
  },
  {
    id: "legal-privacy",
    path: "/legal/privacy",
    title: "Privacy",
    description: "How Sherivs handles tenant data in the system that is implemented. Not a substitute for counsel.",
    kicker: "Legal",
    navLabel: null,
    footerGroup: "Legal",
    evidence: "tenant isolation, audit minimization, AI privacy law",
    blocks: [
      {
        type: "prose",
        paragraphs: [
          "This is a product disclosure of system behavior, not a law-firm privacy policy and not a claim about a specific legal entity's registered address.",
          "Tenant-sensitive data is isolated with row-level security. Application screens are not the only control. Logs are required to omit passwords, tokens, secrets and unnecessary private data.",
          "AI receives only authorized, minimized context. Model output is untrusted until it is validated. An organization's own public privacy page, when configured, is served on that organization's site.",
        ],
      },
    ],
  },
  {
    id: "legal-terms",
    path: "/legal/terms",
    title: "Terms",
    description: "Use of Sherivs is bound by tenant, role and policy. This page states product boundaries.",
    kicker: "Legal",
    navLabel: null,
    footerGroup: "Legal",
    evidence: "authorization and tenant laws",
    blocks: [
      {
        type: "prose",
        paragraphs: [
          "This page states product boundaries. It is not a negotiated customer agreement.",
          "Access follows identity, tenant and policy. A person does not gain another tenant's data by changing a client-supplied identifier. AI workers do not gain authority by producing a confident answer.",
          "Commercial tiers are described on the pricing page. Paying, where payments are enabled, is confirmed by the payment provider's signed webhook, not by the browser.",
        ],
      },
    ],
  },
  {
    id: "legal-cookies",
    path: "/legal/cookies",
    title: "Cookies",
    description: "The site stores a theme preference and a session. It does not describe a third-party advertising network.",
    kicker: "Legal",
    navLabel: null,
    footerGroup: "Legal",
    evidence: "theme localStorage key uos:theme; Supabase session",
    blocks: [
      {
        type: "prose",
        paragraphs: [
          "A theme choice is stored in local storage under the key uos:theme so the next visit can match it. Sign-in uses the session cookie established by the authentication client.",
          "This product surface does not ship an advertising cookie network. If an organization later enables analytics, that organization must disclose it on its own site.",
        ],
      },
    ],
  },
  {
    id: "legal-accessibility",
    path: "/legal/accessibility",
    title: "Accessibility",
    description: "Target is WCAG 2.2 AA where practical: keyboard, focus, contrast, reduced motion, skip links.",
    kicker: "Legal",
    navLabel: null,
    footerGroup: "Legal",
    evidence: "skip link in root shell; focus-visible; prefers-reduced-motion",
    blocks: [
      {
        type: "prose",
        paragraphs: [
          "The public site uses semantic headings, a skip link, visible focus, and motion that yields to prefers-reduced-motion. Body text and signal buttons are checked against WCAG contrast ratios in the token contract.",
          "This is a target and a set of implemented controls, not a completed third-party audit.",
        ],
      },
    ],
  },
];

const BY_ID = new Map(PUBLIC_PAGES.map((page) => [page.id, page]));
const BY_PATH = new Map(PUBLIC_PAGES.map((page) => [page.path, page]));

export function publicPageById(id: string): PublicPage {
  const page = BY_ID.get(id);
  if (!page) throw new Error(`Unknown public page: ${id}`);
  return page;
}

export function publicPageByPath(path: string): PublicPage | undefined {
  return BY_PATH.get(path);
}

export function publicNavPages(): readonly PublicPage[] {
  return PUBLIC_PAGES.filter((page) => page.navLabel !== null);
}

export function publicFooterGroups(): ReadonlyMap<string, readonly PublicPage[]> {
  const groups = new Map<string, PublicPage[]>();
  for (const page of PUBLIC_PAGES) {
    if (!page.footerGroup) continue;
    const list = groups.get(page.footerGroup) ?? [];
    list.push(page);
    groups.set(page.footerGroup, list);
  }
  return groups;
}

/** Paths safe to list in the sitemap: registered public pages plus home, auth, platform. */
export function publicSitemapPaths(): readonly string[] {
  return ["/", "/auth", "/platform", "/coregrid", ...PUBLIC_PAGES.map((page) => page.path)];
}
