/**
 * Sherivs public experience information architecture.
 *
 * Domain-neutral route catalog for the customer-facing Sherivs website.
 * Runtime names do not belong here. Installed-runtime proofs live in the
 * public content module under the (site) route group.
 *
 * Only routes with real product capability or honest disclosure are listed
 * as `published`. Speculative marketing pages stay `deferred`.
 */

export type PublicNavGroup =
  | "platform"
  | "solutions"
  | "enterprise"
  | "resources"
  | "company"
  | "developers"
  | "support"
  | "legal";

export type PublicRouteStatus = "published" | "alias" | "deferred";

export interface PublicRouteRecord {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly group: PublicNavGroup;
  readonly status: PublicRouteStatus;
  readonly nav?: { readonly label: string; readonly primary?: boolean };
}

export const SHERIVS_PUBLIC_ROUTES: readonly PublicRouteRecord[] = [
  {
    path: "/",
    title: "Sherivs",
    description: "Institutional Intelligence Infrastructure.",
    group: "platform",
    status: "published",
    nav: { label: "Overview", primary: true },
  },
  {
    path: "/platform",
    title: "Platform",
    description: "Governed kernel capabilities organizations consume.",
    group: "platform",
    status: "published",
    nav: { label: "Platform", primary: true },
  },
  {
    path: "/platform/reality",
    title: "Reality",
    description: "Canonical organizational reality, separate from inference.",
    group: "platform",
    status: "published",
  },
  {
    path: "/platform/memory",
    title: "Memory",
    description: "Governed organizational memory and provenance.",
    group: "platform",
    status: "published",
  },
  {
    path: "/platform/ai-workforce",
    title: "AI Workforce",
    description: "Governed AI workers with identity, authority and audit.",
    group: "platform",
    status: "published",
  },
  {
    path: "/platform/missions",
    title: "Missions",
    description: "Work as governed missions with evidence and verification.",
    group: "platform",
    status: "published",
  },
  {
    path: "/platform/intelligence",
    title: "Intelligence",
    description: "Context, knowledge and executive intelligence — untrusted by default.",
    group: "platform",
    status: "published",
  },
  {
    path: "/platform/governance",
    title: "Governance",
    description: "Authorization, policy, audit and agent lifecycle.",
    group: "platform",
    status: "published",
  },
  {
    path: "/platform/integrations",
    title: "Integrations",
    description: "Provider-agnostic adapters for identity, payments, messaging and storage.",
    group: "platform",
    status: "published",
  },
  {
    path: "/solutions",
    title: "Solutions",
    description: "How organizations use Sherivs without assuming a single domain.",
    group: "solutions",
    status: "published",
    nav: { label: "Solutions", primary: true },
  },
  {
    path: "/solutions/organizations",
    title: "Organizations",
    description: "Identity, tenancy, workspaces and governed operations.",
    group: "solutions",
    status: "published",
  },
  {
    path: "/solutions/enterprise",
    title: "Enterprise",
    description: "Isolation, policy, audit and operational control.",
    group: "solutions",
    status: "published",
  },
  {
    path: "/solutions/education",
    title: "Education",
    description: "The first installed domain runtime for education institutions.",
    group: "solutions",
    status: "published",
  },
  {
    path: "/solutions/operations",
    title: "Operations",
    description: "Missions, communications, calendar, files and reporting.",
    group: "solutions",
    status: "published",
  },
  {
    path: "/solutions/ai-workforce",
    title: "AI Workforce",
    description: "Human and governed AI workers operating under policy.",
    group: "solutions",
    status: "published",
  },
  {
    path: "/security",
    title: "Security",
    description: "Tenant isolation, layered authorization, evidence and audit.",
    group: "enterprise",
    status: "published",
    nav: { label: "Security", primary: true },
  },
  {
    path: "/enterprise",
    title: "Enterprise",
    description: "Architecture for institutions — without exposing internals that enable attack.",
    group: "enterprise",
    status: "published",
  },
  {
    path: "/pricing",
    title: "Pricing",
    description: "Commercial tiers mirrored from the platform catalog.",
    group: "enterprise",
    status: "published",
    nav: { label: "Pricing" },
  },
  {
    path: "/resources",
    title: "Resources",
    description: "Documentation, guides and published writing that actually exists.",
    group: "resources",
    status: "published",
    nav: { label: "Resources" },
  },
  {
    path: "/resources/blog",
    title: "Blog",
    description: "Published writing. Empty until content is authored.",
    group: "resources",
    status: "published",
  },
  {
    path: "/resources/docs",
    title: "Docs",
    description: "Public documentation of platform capabilities that are real.",
    group: "resources",
    status: "published",
  },
  {
    path: "/resources/guides",
    title: "Guides",
    description: "Operational guides. Empty until authored.",
    group: "resources",
    status: "published",
  },
  {
    path: "/resources/case-studies",
    title: "Case studies",
    description: "Customer stories. Empty until authorized publications exist.",
    group: "resources",
    status: "published",
  },
  {
    path: "/about",
    title: "About",
    description: "What Sherivs is, and what it is not.",
    group: "company",
    status: "published",
  },
  {
    path: "/company",
    title: "Company",
    description: "Product category and operating posture.",
    group: "company",
    status: "published",
    nav: { label: "Company" },
  },
  {
    path: "/contact",
    title: "Contact",
    description: "Reach Sherivs through real product surfaces.",
    group: "company",
    status: "published",
  },
  {
    path: "/request-demo",
    title: "Request a demo",
    description: "Request access through the real account surface.",
    group: "company",
    status: "published",
  },
  {
    path: "/legal/privacy",
    title: "Privacy",
    description: "How the platform handles data.",
    group: "legal",
    status: "published",
  },
  {
    path: "/legal/terms",
    title: "Terms",
    description: "Product terms for use of the platform.",
    group: "legal",
    status: "published",
  },
  {
    path: "/legal/cookies",
    title: "Cookies",
    description: "Cookies and similar storage used by the product.",
    group: "legal",
    status: "published",
  },
  {
    path: "/legal/accessibility",
    title: "Accessibility",
    description: "Accessibility posture and contact for barriers.",
    group: "legal",
    status: "published",
  },
  {
    path: "/status",
    title: "Status",
    description: "Live health from the platform health endpoint.",
    group: "support",
    status: "published",
  },
  {
    path: "/coregrid",
    title: "CoreGrid (alias)",
    description: "Legacy customer path. Redirects to the Sherivs homepage.",
    group: "platform",
    status: "alias",
  },
  {
    path: "/careers",
    title: "Careers",
    description: "Deferred until real open roles exist. Not fabricated.",
    group: "company",
    status: "deferred",
  },
] as const;

export interface PublicNavLink {
  readonly href: string;
  readonly label: string;
}

export const PUBLIC_PRIMARY_NAV: readonly PublicNavLink[] = [
  { href: "/platform", label: "Platform" },
  { href: "/solutions", label: "Solutions" },
  { href: "/security", label: "Security" },
  { href: "/enterprise", label: "Enterprise" },
  { href: "/resources", label: "Resources" },
];

export const PUBLIC_FOOTER_NAV: Record<string, readonly PublicNavLink[]> = {
  Platform: [
    { href: "/platform", label: "Overview" },
    { href: "/platform/reality", label: "Reality" },
    { href: "/platform/memory", label: "Memory" },
    { href: "/platform/ai-workforce", label: "AI Workforce" },
    { href: "/platform/missions", label: "Missions" },
    { href: "/platform/intelligence", label: "Intelligence" },
    { href: "/platform/governance", label: "Governance" },
    { href: "/platform/integrations", label: "Integrations" },
  ],
  Solutions: [
    { href: "/solutions", label: "All solutions" },
    { href: "/solutions/organizations", label: "Organizations" },
    { href: "/solutions/enterprise", label: "Enterprise" },
    { href: "/solutions/education", label: "Education" },
    { href: "/solutions/operations", label: "Operations" },
    { href: "/solutions/ai-workforce", label: "AI Workforce" },
  ],
  Company: [
    { href: "/about", label: "About" },
    { href: "/company", label: "Company" },
    { href: "/contact", label: "Contact" },
    { href: "/request-demo", label: "Request a demo" },
    { href: "/pricing", label: "Pricing" },
  ],
  Resources: [
    { href: "/resources", label: "Overview" },
    { href: "/resources/docs", label: "Docs" },
    { href: "/resources/guides", label: "Guides" },
    { href: "/resources/blog", label: "Blog" },
    { href: "/resources/case-studies", label: "Case studies" },
    { href: "/status", label: "Status" },
  ],
  Legal: [
    { href: "/legal/privacy", label: "Privacy" },
    { href: "/legal/terms", label: "Terms" },
    { href: "/legal/cookies", label: "Cookies" },
    { href: "/legal/accessibility", label: "Accessibility" },
  ],
};

export function publishedPublicPaths(): string[] {
  return SHERIVS_PUBLIC_ROUTES.filter((route) => route.status === "published").map(
    (route) => route.path,
  );
}

export function publicRouteByPath(path: string): PublicRouteRecord | undefined {
  return SHERIVS_PUBLIC_ROUTES.find((route) => route.path === path);
}
