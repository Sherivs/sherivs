import type { ReactNode } from "react";
import { PLATFORM_NAME, PRODUCT_JARVIS, PRODUCT_AI_WORKFORCE } from "@/lib/platform";
import { INSTALLED_RUNTIME_PRODUCT } from "@/lib/runtime/installed-runtimes";
import { MARKETING_TIERS, formatTierPrice } from "@/routes/(site)/-content/pricing-tiers";
import { PUBLIC_CAPABILITIES, PUBLIC_SECURITY, type LegalSlug, type PlatformSlug, type ResourceSlug, type SolutionSlug } from "@/lib/experience/public-catalog";
import { BreadcrumbTrail } from "@/components/experience/editorial";
import { EmptyCatalog } from "@/components/experience/system-states";
import { IntelligenceKindBadge } from "@/components/experience/evidence";

export function PublicArticle({
  eyebrow,
  title,
  lead,
  crumbs,
  children,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  crumbs: readonly { href?: string; label: string }[];
  children: ReactNode;
}) {
  return (
    <article>
      <header className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <BreadcrumbTrail items={[{ href: "/", label: PLATFORM_NAME }, ...crumbs]} />
          <p className="mt-6 text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {eyebrow}
          </p>
          <h1 className="mt-3 max-w-3xl font-serif text-4xl tracking-tight sm:text-5xl">{title}</h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">{lead}</p>
        </div>
      </header>
      <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">{children}</div>
    </article>
  );
}

export function PlatformIndexPage() {
  return (
    <PublicArticle
      eyebrow="Platform"
      title="A governed kernel. Installed runtimes. No fake category fog."
      lead="Sherivs exposes identity, tenancy, workspace, missions, AI, evidence and policy as platform primitives. Organizations consume the capabilities they are authorized to use."
      crumbs={[{ label: "Platform" }]}
    >
      <ol className="divide-y divide-border border-y border-border">
        {PUBLIC_CAPABILITIES.map((capability) => (
          <li key={capability.id} className="grid gap-2 py-6 md:grid-cols-[14rem_1fr]">
            <a href={`/platform/${capability.id === "reality-model" ? "reality" : capability.id === "ai-workforce" ? "ai-workforce" : capability.id === "workspace" ? "../solutions/organizations" : capability.id}`} className="font-display text-lg font-semibold hover:underline">
              {capability.title}
            </a>
            <p className="text-sm leading-relaxed text-muted-foreground">{capability.description}</p>
          </li>
        ))}
      </ol>
      <p className="mt-10 text-sm">
        Kernel capability registry:{" "}
        <a className="font-semibold underline-offset-4 hover:underline" href="/platform#kernel">
          fifty owned capabilities
        </a>
        . Deep listing remains on this route’s original kernel catalog below when rendered from
        the kernel page.
      </p>
    </PublicArticle>
  );
}

const PLATFORM_COPY: Record<PlatformSlug, { title: string; lead: string; body: string[] }> = {
  reality: {
    title: "Reality is verified system truth.",
    lead: "People, records, events, payments and operational state are canonical. Predictions do not overwrite them.",
    body: [
      PUBLIC_CAPABILITIES.find((item) => item.id === "reality-model")?.description ?? "",
      "Digital twins and device telemetry that would expand into frozen V2/V3 scope are not claimed as V1 product surfaces here.",
    ],
  },
  memory: {
    title: "Memory is scoped, purpose-limited, and authorized.",
    lead: "Sherivs does not dump an organization’s archive into a model. Context is classified, minimized, and tenant-bound before it reaches AI.",
    body: [
      "Organizational knowledge exists as records, files, communications and mission evidence. AI context is assembled only after identity, authorization, classification and purpose checks.",
      "There is no unrestricted private memory product in V1. What exists is governed retrieval plus session and tenant isolation.",
    ],
  },
  "ai-workforce": {
    title: `${PRODUCT_AI_WORKFORCE} is a governed operator class.`,
    lead: "Workers have identity, owner, tools, authority, lifecycle and audit. They cannot promote themselves.",
    body: [
      PUBLIC_CAPABILITIES.find((item) => item.id === "ai-workforce")?.description ?? "",
      "Existing surfaces include worker registry contracts, launch authorization, and super-admin worker missions. Workers are not depicted as autonomous mascots.",
    ],
  },
  missions: {
    title: "A mission is a first-class organizational object.",
    lead: "Work is proposed, assigned, executed, evidenced, verified and recorded. Untracked tasks are not the model.",
    body: [
      PUBLIC_CAPABILITIES.find((item) => item.id === "missions")?.description ?? "",
      "Mission list, detail and launch exist for authorized operators. Command UI cannot bypass policy.",
    ],
  },
  intelligence: {
    title: `${PRODUCT_JARVIS} is executive intelligence — not a generic chatbot panel.`,
    lead: "Observation, inference, recommendation, action, evidence and verification are visually and contractually distinct.",
    body: [
      "Jarvis briefing and escalation contracts exist in V1. Role assistants exist inside authorized Scholar workspaces. All AI output is untrusted until validation, policy and, where required, approval.",
      "The interface must never animate “thinking” unless the backend is actually processing.",
    ],
  },
  governance: {
    title: "Governance is the product, not a footer link.",
    lead: "Layered authorization, tenant isolation, evidence and immutable audit are platform law.",
    body: PUBLIC_SECURITY.map((item) => `${item.title}: ${item.description}`),
  },
  integrations: {
    title: "Integrations are adapters, not a logo wall.",
    lead: "Sherivs stays provider-agnostic. Only wired providers are named.",
    body: [
      "Identity and session: Supabase Auth.",
      "Data: PostgreSQL with Row Level Security.",
      "Payments: Paystack adapter with signature validation.",
      "Communication: provider adapters for outbound messaging.",
      "Storage: service-role storage client for authorized blobs.",
      "Push: Web Push / VAPID where configured.",
      "No invented partner ecosystem is listed.",
    ],
  },
};

export function PlatformSlugPage({ slug }: { slug: PlatformSlug }) {
  const copy = PLATFORM_COPY[slug];
  return (
    <PublicArticle
      eyebrow="Platform"
      title={copy.title}
      lead={copy.lead}
      crumbs={[{ href: "/platform", label: "Platform" }, { label: copy.title }]}
    >
      <div className="max-w-prose space-y-5 text-base leading-7 text-muted-foreground">
        {copy.body.map((paragraph) => (
          <p key={paragraph.slice(0, 48)}>{paragraph}</p>
        ))}
      </div>
    </PublicArticle>
  );
}

const SOLUTION_COPY: Record<SolutionSlug, { title: string; lead: string; body: string[] }> = {
  organizations: {
    title: "Every request has an organization context.",
    lead: "Tenants, members, workspaces, roles and public presence are V1 primitives.",
    body: [
      "Sherivs is multi-tenant. Application code is never the only security layer: PostgreSQL RLS enforces tenant boundaries.",
      "Workspaces are projected from authorized capabilities. They are not a fixed school portal pack.",
    ],
  },
  enterprise: {
    title: "Enterprise means isolation, policy, and evidence.",
    lead: "Not a decorative pricing badge. Entitlements still resolve through contracts after authentication.",
    body: [
      "Commercial tiers exist in the live catalog. Custom enterprise pricing is a contract, not a self-serve toggle on this page.",
      "This site does not claim ISO/SOC badges that are not evidenced in the repository.",
    ],
  },
  education: {
    title: `${INSTALLED_RUNTIME_PRODUCT} is the installed education runtime.`,
    lead: "It consumes platform primitives and brings only the education domain.",
    body: [
      "Scholar currently contributes navigation, public organization sections such as admissions, and education workspaces.",
      "Remove Scholar and the kernel remains valid. Sherivs is not a school-management brand.",
    ],
  },
  operations: {
    title: "Operations run on platform primitives.",
    lead: "Calendar, files, communications, tasks, reports and audit already exist as V1 surfaces where authorized.",
    body: [
      "Domain runtimes may extend calendar and records. They do not replace tenancy, identity or policy.",
    ],
  },
  "ai-workforce": {
    title: "Human members and AI workers share a governed workplace.",
    lead: `${PRODUCT_AI_WORKFORCE} appears only where policy allows, with evidence attached to action.`,
    body: [
      "Suggested actions remain proposals until authorization. The command palette cannot create a backdoor.",
    ],
  },
};

export function SolutionSlugPage({ slug }: { slug: SolutionSlug }) {
  const copy = SOLUTION_COPY[slug];
  return (
    <PublicArticle
      eyebrow="Solutions"
      title={copy.title}
      lead={copy.lead}
      crumbs={[{ href: "/solutions", label: "Solutions" }, { label: copy.title }]}
    >
      <div className="max-w-prose space-y-5 text-base leading-7 text-muted-foreground">
        {copy.body.map((paragraph) => (
          <p key={paragraph.slice(0, 48)}>{paragraph}</p>
        ))}
      </div>
    </PublicArticle>
  );
}

export function SolutionsIndexPage() {
  return (
    <PublicArticle
      eyebrow="Solutions"
      title="One platform. Organizations install the runtime they need."
      lead="Education is available because the Scholar runtime is installed. It is not the default identity of every visitor."
      crumbs={[{ label: "Solutions" }]}
    >
      <ul className="divide-y divide-border border-y border-border">
        {(
          [
            ["/solutions/organizations", "Organizations"],
            ["/solutions/enterprise", "Enterprise"],
            ["/solutions/education", "Education / Scholar"],
            ["/solutions/operations", "Operations"],
            ["/solutions/ai-workforce", "AI workforce"],
          ] as const
        ).map(([href, label]) => (
          <li key={href} className="py-4">
            <a href={href} className="font-display text-lg font-semibold hover:underline">
              {label}
            </a>
          </li>
        ))}
      </ul>
    </PublicArticle>
  );
}

export function PricingPage() {
  return (
    <PublicArticle
      eyebrow="Pricing"
      title="Tiers from the commercial catalog."
      lead="Prices are shown in ₦. This page does not authorize features."
      crumbs={[{ label: "Pricing" }]}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="py-3">Tier</th>
              <th className="py-3">Monthly</th>
              <th className="py-3">Annual</th>
              <th className="py-3">Includes</th>
            </tr>
          </thead>
          <tbody>
            {MARKETING_TIERS.map((tier) => (
              <tr key={tier.id} className="border-b border-border align-top">
                <th className="py-4 font-display">{tier.name}</th>
                <td className="py-4 font-mono">{formatTierPrice(tier.monthlyPrice)}</td>
                <td className="py-4 font-mono">{formatTierPrice(tier.annualPrice)}</td>
                <td className="py-4 text-muted-foreground">{tier.highlights.join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-8 text-sm">
        <a href="/auth" className="font-semibold underline-offset-4 hover:underline">
          Create an account
        </a>
      </p>
    </PublicArticle>
  );
}

export function SecurityPage() {
  return (
    <PublicArticle
      eyebrow="Security"
      title="Tenant isolation by database. Authorization by contract."
      lead="Sherivs does not publish a decoration of locks. These guarantees are the ones the platform actually encodes."
      crumbs={[{ label: "Security" }]}
    >
      <ul className="divide-y divide-border border-y border-border">
        {PUBLIC_SECURITY.map((item) => (
          <li key={item.id} className="grid gap-2 py-6 md:grid-cols-[16rem_1fr]">
            <h2 className="font-display text-base font-semibold">{item.title}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{item.description}</p>
          </li>
        ))}
      </ul>
    </PublicArticle>
  );
}

export function ResourcesIndexPage() {
  return (
    <PublicArticle
      eyebrow="Resources"
      title="Documentation that exists. Catalogs that are empty stay empty."
      lead="Sherivs will not invent a blog, case studies, or customer logos to look established."
      crumbs={[{ label: "Resources" }]}
    >
      <ul className="divide-y divide-border border-y border-border text-sm">
        <li className="py-4">
          <a className="font-display text-lg font-semibold hover:underline" href="/resources/docs">
            Documentation
          </a>
          <p className="mt-1 text-muted-foreground">Live platform routes and kernel capabilities.</p>
        </li>
        <li className="py-4">
          <a className="font-display text-lg font-semibold hover:underline" href="/resources/blog">
            Blog
          </a>
          <p className="mt-1 text-muted-foreground">No platform posts published.</p>
        </li>
        <li className="py-4">
          <a className="font-display text-lg font-semibold hover:underline" href="/resources/guides">
            Guides
          </a>
          <p className="mt-1 text-muted-foreground">None authored yet.</p>
        </li>
        <li className="py-4">
          <a className="font-display text-lg font-semibold hover:underline" href="/resources/case-studies">
            Case studies
          </a>
          <p className="mt-1 text-muted-foreground">None published.</p>
        </li>
      </ul>
    </PublicArticle>
  );
}

export function ResourceSlugPage({ slug }: { slug: ResourceSlug }) {
  if (slug === "docs") {
    return (
      <PublicArticle
        eyebrow="Documentation"
        title="Start from live surfaces."
        lead="Internal ADRs and phase proofs are engineering records, not a public docs site."
        crumbs={[{ href: "/resources", label: "Resources" }, { label: "Docs" }]}
      >
        <ul className="space-y-3 text-sm">
          <li>
            <a className="font-semibold hover:underline" href="/platform">
              Platform kernel
            </a>
          </li>
          <li>
            <a className="font-semibold hover:underline" href="/security">
              Security guarantees
            </a>
          </li>
          <li>
            <a className="font-semibold hover:underline" href="/solutions/education">
              Scholar runtime
            </a>
          </li>
          <li>
            <a className="font-semibold hover:underline" href="/legal/privacy">
              Privacy
            </a>
          </li>
        </ul>
      </PublicArticle>
    );
  }
  const titles: Record<Exclude<ResourceSlug, "docs">, string> = {
    blog: "Blog",
    guides: "Guides",
    "case-studies": "Case studies",
  };
  return (
    <PublicArticle
      eyebrow="Resources"
      title={titles[slug]}
      lead="This catalog is empty."
      crumbs={[{ href: "/resources", label: "Resources" }, { label: titles[slug] }]}
    >
      <EmptyCatalog
        title="Nothing is published here yet"
        body="Sherivs does not fabricate articles, customers, or metrics. Tenant organization blogs continue to live on organization public sites at /blog when that organization enables them."
      />
    </PublicArticle>
  );
}

const LEGAL_COPY: Record<LegalSlug, { title: string; body: string[] }> = {
  privacy: {
    title: "Privacy notice",
    body: [
      "Sherivs processes account, organization and operational data to provide the service you request: authentication, tenancy, workspaces, communications, files, payments where enabled, and governed AI assistance.",
      "Tenant data is isolated. Row Level Security is the database control. Application UI is not a privacy boundary.",
      "AI features receive only authorized, purpose-limited context. Model output is untrusted and is not written over canonical records without validation.",
      "Organization-specific policies (for example a school privacy policy) are published by that organization on its public site and are not replaced by this notice.",
      "Contact for privacy requests starts from an authenticated account or the contact route. This notice is not legal advice and will be revised as the service expands.",
    ],
  },
  terms: {
    title: "Terms of use",
    body: [
      "Access to Sherivs requires an account. Some capabilities require an organization membership, a runtime, and a paid tier.",
      "You may not attempt to bypass authorization, tenant isolation, or audit controls. Command interfaces and UI hiding are not permission grants.",
      "Domain runtimes such as Scholar add domain rules on top of these terms; they do not weaken platform security.",
      "The software is provided as a governed service. Availability is described by the live /status endpoint for this instance, not by invented SLAs on this page.",
    ],
  },
  cookies: {
    title: "Cookies and local storage",
    body: [
      "Sherivs uses essential session cookies or tokens for authentication.",
      "Local storage is used for theme, motion/density/contrast preferences, and command-palette recents. These do not grant access.",
      "A service worker may cache the application shell for offline use when push or PWA features are enabled.",
      "This page does not claim an advertising cookie stack. If analytics is configured in a given environment, it is an operations concern and must not send unnecessary private data.",
    ],
  },
  accessibility: {
    title: "Accessibility",
    body: [
      "The target is WCAG 2.2 AA where practical: semantic structure, keyboard access, skip links, visible focus, text scaling, and reduced motion.",
      "Known gaps are tracked in the experience program rather than hidden. If a surface blocks assistive use, that is a defect.",
      "Personal accessibility controls (motion, contrast, density) live in account settings and do not replace correct markup.",
    ],
  },
};

export function LegalSlugPage({ slug }: { slug: LegalSlug }) {
  const copy = LEGAL_COPY[slug];
  return (
    <PublicArticle
      eyebrow="Legal"
      title={copy.title}
      lead={`How ${PLATFORM_NAME} describes this obligation today.`}
      crumbs={[{ label: copy.title }]}
    >
      <div className="max-w-prose space-y-5 text-base leading-7 text-muted-foreground">
        {copy.body.map((paragraph) => (
          <p key={paragraph.slice(0, 40)}>{paragraph}</p>
        ))}
      </div>
    </PublicArticle>
  );
}

export function AboutPage() {
  return (
    <PublicArticle
      eyebrow="About"
      title={`${PLATFORM_NAME} is institutional intelligence infrastructure.`}
      lead="The public product family is Sherivs, Scholar, Jarvis, and the AI workforce. CoreGrid is the internal kernel name."
      crumbs={[{ label: "About" }]}
    >
      <div className="max-w-prose space-y-5 text-base leading-7 text-muted-foreground">
        <p>
          Sherivs unifies organizations, people, knowledge, communication, payments, workflows and
          governed intelligence in one operating layer. It is not a school-management brand and not
          an AI wrapper.
        </p>
        <p>
          This page does not publish headcount, offices, investors, or customer logos. Those claims
          are absent because they are not evidenced here.
        </p>
      </div>
    </PublicArticle>
  );
}

export function CompanyPage() {
  return (
    <PublicArticle
      eyebrow="Company"
      title="The company presents the platform — not a lifestyle brand."
      lead="Company information on this site is limited to what the product actually is."
      crumbs={[{ label: "Company" }]}
    >
      <ul className="space-y-3 text-sm">
        <li>
          <a className="font-semibold hover:underline" href="/about">
            About
          </a>
        </li>
        <li>
          <a className="font-semibold hover:underline" href="/careers">
            Careers
          </a>
        </li>
        <li>
          <a className="font-semibold hover:underline" href="/contact">
            Contact
          </a>
        </li>
        <li>
          <a className="font-semibold hover:underline" href="/security">
            Security
          </a>
        </li>
      </ul>
    </PublicArticle>
  );
}

export function CareersPage() {
  return (
    <PublicArticle
      eyebrow="Careers"
      title="Open roles"
      lead="No public listings are published in this repository."
      crumbs={[{ href: "/company", label: "Company" }, { label: "Careers" }]}
    >
      <EmptyCatalog
        title="There are no open roles listed"
        body="When roles are published, they will appear here. This page will not invent positions."
      />
    </PublicArticle>
  );
}

export function ContactPage() {
  return (
    <PublicArticle
      eyebrow="Contact"
      title="Start from a real account surface."
      lead="There is no decorative contact form that discards messages."
      crumbs={[{ label: "Contact" }]}
    >
      <div className="space-y-4 text-sm">
        <p className="max-w-prose text-muted-foreground">
          Create or sign in to a Sherivs account to operate inside an organization. Demo and
          provisioning remain on authenticated or operator routes.
        </p>
        <p>
          <a className="font-semibold hover:underline" href="/auth">
            Sign in / create account
          </a>
        </p>
        <p>
          <a className="font-semibold hover:underline" href="/request-demo">
            Request a demo
          </a>
        </p>
      </div>
    </PublicArticle>
  );
}

export function RequestDemoPage() {
  return (
    <PublicArticle
      eyebrow="Request a demo"
      title="Use the real authentication and provisioning flows."
      lead="Sherivs does not simulate a sales CRM on this page."
      crumbs={[{ label: "Request a demo" }]}
    >
      <div className="flex flex-wrap gap-3">
        <a href="/auth" className="rounded-md bg-foreground px-5 py-2.5 text-sm font-semibold text-background">
          Create account
        </a>
        <a href="/provision" className="rounded-md border border-border px-5 py-2.5 text-sm font-semibold">
          Provision an organization
        </a>
      </div>
      <div className="mt-10 flex gap-2">
        <IntelligenceKindBadge kind="action" />
        <p className="text-sm text-muted-foreground">
          Account creation and org provisioning are live routes, not mock funnels.
        </p>
      </div>
    </PublicArticle>
  );
}

export function EnterprisePage() {
  return (
    <PublicArticle
      eyebrow="Enterprise"
      title="Adopt the platform without turning the homepage into a control plane."
      lead="Isolation, policy, audit, commercial contracts. Internal Sherivs operations stay off customer navigation."
      crumbs={[{ label: "Enterprise" }]}
    >
      <div className="max-w-prose space-y-5 text-base leading-7 text-muted-foreground">
        <p>
          Enterprise adoption is identity, tenant, runtime selection, policy and billing — not a
          forced Scholar login. Super-admin and internal workspaces are a separate boundary.
        </p>
        <p>
          <a className="font-semibold text-foreground hover:underline" href="/pricing">
            Commercial tiers
          </a>
          {" · "}
          <a className="font-semibold text-foreground hover:underline" href="/security">
            Security
          </a>
        </p>
      </div>
    </PublicArticle>
  );
}
