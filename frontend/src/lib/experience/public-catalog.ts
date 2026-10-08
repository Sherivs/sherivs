/**
 * Sherivs public experience catalog.
 *
 * Typed inventory of public routes that actually ship. Pages exist only when
 * honest content or a real capability backs them. Empty editorial catalogs
 * (blog, guides, case studies) are declared as empty — never fabricated.
 *
 * Version-target: V1 organizational envelope.
 */
import { PLATFORM_NAME, PLATFORM_TAGLINE, PRODUCT_JARVIS } from "@/lib/platform";
import { INSTALLED_RUNTIME_PRODUCT } from "@/lib/runtime/installed-runtimes";
import {
  INSTALLED_RUNTIME_PROOFS,
  SECURITY_GUARANTEES,
  SITE_CAPABILITIES,
} from "@/routes/(site)/-content/site-content";

export type ExperiencePlane =
  | "public_sherivs"
  | "public_organization"
  | "application_shell"
  | "organization_workspace"
  | "internal_sherivs"
  | "domain_runtime"
  | "authentication"
  | "account";

export type PublicNavGroup = "platform" | "solutions" | "resources" | "company" | "legal";

export interface PublicRouteRecord {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly group: PublicNavGroup | "home" | "utility";
  readonly navLabel?: string;
  readonly inPrimaryNav?: boolean;
  readonly inFooter?: boolean;
  readonly capability: "live" | "empty_catalog" | "compatibility";
  readonly notes: string;
}

export const SHERIVS_PUBLIC_ROUTES: readonly PublicRouteRecord[] = [
  {
    path: "/",
    title: `${PLATFORM_NAME} — ${PLATFORM_TAGLINE}`,
    description: PLATFORM_TAGLINE,
    group: "home",
    navLabel: PLATFORM_NAME,
    inPrimaryNav: false,
    inFooter: false,
    capability: "live",
    notes: "Platform host homepage. Tenant hosts render the organization public experience instead.",
  },
  {
    path: "/coregrid",
    title: `${PLATFORM_NAME} (legacy URL)`,
    description: "Compatibility URL for the previous platform marketing path.",
    group: "home",
    capability: "compatibility",
    notes: "Renders the same public home so existing /coregrid anchors and e2e journeys keep working.",
  },
  {
    path: "/platform",
    title: "Platform",
    description: "Governed kernel capabilities organizations consume.",
    group: "platform",
    navLabel: "Platform",
    inPrimaryNav: true,
    inFooter: true,
    capability: "live",
    notes: "Backed by KERNEL_CAPABILITIES and foundation standards.",
  },
  {
    path: "/platform/reality",
    title: "Reality",
    description: "Canonical organizational reality, separate from inference.",
    group: "platform",
    navLabel: "Reality",
    inFooter: true,
    capability: "live",
    notes: "Maps to the reality-model capability already published on the public site.",
  },
  {
    path: "/platform/memory",
    title: "Memory",
    description: "Scoped organizational memory and knowledge records.",
    group: "platform",
    navLabel: "Memory",
    inFooter: true,
    capability: "live",
    notes: "Describes existing tenant-scoped knowledge, records, and purpose-limited AI context — not a fabricated memory product.",
  },
  {
    path: "/platform/ai-workforce",
    title: "AI workforce",
    description: "Governed AI workers with identity, authority and evidence.",
    group: "platform",
    navLabel: "AI workforce",
    inFooter: true,
    capability: "live",
    notes: "Backed by worker registry, launch contracts, and super-admin worker-missions.",
  },
  {
    path: "/platform/missions",
    title: "Missions",
    description: "Governed work from proposal through verified outcome.",
    group: "platform",
    navLabel: "Missions",
    inFooter: true,
    capability: "live",
    notes: "Backed by mission contracts and worker mission surfaces.",
  },
  {
    path: "/platform/intelligence",
    title: "Intelligence",
    description: `${PRODUCT_JARVIS} and governed AI assistance.`,
    group: "platform",
    navLabel: "Intelligence",
    inFooter: true,
    capability: "live",
    notes: "Jarvis briefing/escalation contracts and role AI assistants exist. No fake live thinking is claimed.",
  },
  {
    path: "/platform/governance",
    title: "Governance",
    description: "Authorization, evidence, audit and policy.",
    group: "platform",
    navLabel: "Governance",
    inFooter: true,
    capability: "live",
    notes: "Backed by SECURITY_GUARANTEES and layered authorization model.",
  },
  {
    path: "/platform/integrations",
    title: "Integrations",
    description: "Provider adapters the platform actually wires.",
    group: "platform",
    navLabel: "Integrations",
    inFooter: true,
    capability: "live",
    notes: "Honest list: auth, data, payments, communication, storage, push — no invented partner logos.",
  },
  {
    path: "/solutions",
    title: "Solutions",
    description: "How organizations use Sherivs without assuming a single domain.",
    group: "solutions",
    navLabel: "Solutions",
    inPrimaryNav: true,
    inFooter: true,
    capability: "live",
    notes: "Generic organization envelope. Education is one installed runtime.",
  },
  {
    path: "/solutions/organizations",
    title: "Organizations",
    description: "Tenant, identity, workspace and public presence.",
    group: "solutions",
    navLabel: "Organizations",
    inFooter: true,
    capability: "live",
    notes: "V1 organizational capability.",
  },
  {
    path: "/solutions/enterprise",
    title: "Enterprise",
    description: "Isolation, policy, audit and commercial tiers.",
    group: "solutions",
    navLabel: "Enterprise",
    inFooter: true,
    capability: "live",
    notes: "Does not claim certifications that are not in-repo.",
  },
  {
    path: "/solutions/education",
    title: "Education",
    description: `${INSTALLED_RUNTIME_PRODUCT} — the installed education runtime.`,
    group: "solutions",
    navLabel: "Education",
    inFooter: true,
    capability: "live",
    notes: "Runtime-001 (Scholar). Not the platform identity.",
  },
  {
    path: "/solutions/operations",
    title: "Operations",
    description: "Work, calendar, files, communication and reporting.",
    group: "solutions",
    navLabel: "Operations",
    inFooter: true,
    capability: "live",
    notes: "Describes V1 workspace primitives that already exist.",
  },
  {
    path: "/solutions/ai-workforce",
    title: "AI workforce",
    description: "Governed workers alongside human members.",
    group: "solutions",
    navLabel: "AI workforce",
    inFooter: true,
    capability: "live",
    notes: "Same capability family as /platform/ai-workforce, framed for operators.",
  },
  {
    path: "/security",
    title: "Security",
    description: "Tenant isolation, authorization, audit, AI trust.",
    group: "platform",
    navLabel: "Security",
    inPrimaryNav: true,
    inFooter: true,
    capability: "live",
    notes: "Mirrors SECURITY_GUARANTEES. No invented compliance badges.",
  },
  {
    path: "/enterprise",
    title: "Enterprise",
    description: "How institutions adopt Sherivs.",
    group: "company",
    navLabel: "Enterprise",
    inFooter: true,
    capability: "live",
    notes: "Architecture narrative; does not expose internal control-plane details.",
  },
  {
    path: "/pricing",
    title: "Pricing",
    description: "Commercial tiers mirrored from the entitlement catalog.",
    group: "company",
    navLabel: "Pricing",
    inPrimaryNav: true,
    inFooter: true,
    capability: "live",
    notes: "Prices come from MARKETING_TIERS. Entitlements are not decided by this page.",
  },
  {
    path: "/resources",
    title: "Resources",
    description: "Documentation and publishing indexes.",
    group: "resources",
    navLabel: "Resources",
    inPrimaryNav: true,
    inFooter: true,
    capability: "live",
    notes: "Hub. Child catalogs that have no posts stay empty.",
  },
  {
    path: "/resources/docs",
    title: "Documentation",
    description: "Customer-safe platform documentation.",
    group: "resources",
    navLabel: "Docs",
    inFooter: true,
    capability: "live",
    notes: "Points at live routes and kernel capability pages — not internal ADRs.",
  },
  {
    path: "/resources/blog",
    title: "Blog",
    description: "Sherivs platform editorial.",
    group: "resources",
    navLabel: "Blog",
    inFooter: true,
    capability: "empty_catalog",
    notes: "No platform posts exist. Tenant blogs remain at /blog on organization sites.",
  },
  {
    path: "/resources/guides",
    title: "Guides",
    description: "Operational guides.",
    group: "resources",
    navLabel: "Guides",
    inFooter: true,
    capability: "empty_catalog",
    notes: "Empty until authored.",
  },
  {
    path: "/resources/case-studies",
    title: "Case studies",
    description: "Customer stories.",
    group: "resources",
    navLabel: "Case studies",
    inFooter: true,
    capability: "empty_catalog",
    notes: "Empty. Social proof is never fabricated.",
  },
  {
    path: "/about",
    title: "About",
    description: "What Sherivs is.",
    group: "company",
    navLabel: "About",
    inFooter: true,
    capability: "live",
    notes: "Category and product family only. No fake history, offices, or headcount.",
  },
  {
    path: "/company",
    title: "Company",
    description: "How the company is presented publicly.",
    group: "company",
    navLabel: "Company",
    inFooter: true,
    capability: "live",
    notes: "Same honesty constraints as /about.",
  },
  {
    path: "/careers",
    title: "Careers",
    description: "Open roles.",
    group: "company",
    navLabel: "Careers",
    inFooter: true,
    capability: "empty_catalog",
    notes: "No public role listings are published in this repository.",
  },
  {
    path: "/contact",
    title: "Contact",
    description: "How to reach Sherivs.",
    group: "company",
    navLabel: "Contact",
    inFooter: true,
    capability: "live",
    notes: "Routes to real auth/account surfaces. No fake CRM form.",
  },
  {
    path: "/request-demo",
    title: "Request a demo",
    description: "Start on the real account surface.",
    group: "utility",
    navLabel: "Request demo",
    inPrimaryNav: true,
    inFooter: true,
    capability: "live",
    notes: "CTA to /auth and /provision. Does not invent a sales pipeline.",
  },
  {
    path: "/provision",
    title: "Provision an organization",
    description: "Operator onboarding for a new organization.",
    group: "utility",
    capability: "live",
    notes: "The former unsigned Command Centre surface, no longer the public homepage.",
  },
  {
    path: "/legal/privacy",
    title: "Privacy",
    description: "Platform privacy notice.",
    group: "legal",
    navLabel: "Privacy",
    inFooter: true,
    capability: "live",
    notes: "Describes actual platform practices. Tenant school policies remain at /privacy.",
  },
  {
    path: "/legal/terms",
    title: "Terms",
    description: "Platform terms of use.",
    group: "legal",
    navLabel: "Terms",
    inFooter: true,
    capability: "live",
    notes: "Conservative terms matching shipped capabilities.",
  },
  {
    path: "/legal/cookies",
    title: "Cookies",
    description: "Cookie and local storage notice.",
    group: "legal",
    navLabel: "Cookies",
    inFooter: true,
    capability: "live",
    notes: "Session, theme, command recents, PWA — no invented trackers.",
  },
  {
    path: "/legal/accessibility",
    title: "Accessibility",
    description: "Accessibility commitment.",
    group: "legal",
    navLabel: "Accessibility",
    inFooter: true,
    capability: "live",
    notes: "WCAG 2.2 AA target. Honest about current gaps.",
  },
  {
    path: "/status",
    title: "Status",
    description: "Instance health from the public health endpoint.",
    group: "utility",
    navLabel: "Status",
    inFooter: true,
    capability: "live",
    notes: "Reads /health.json. Does not invent a multi-region status network.",
  },
];

export const PUBLIC_PRIMARY_NAV = SHERIVS_PUBLIC_ROUTES.filter((route) => route.inPrimaryNav);
export const PUBLIC_FOOTER_NAV = SHERIVS_PUBLIC_ROUTES.filter((route) => route.inFooter);

export const PLATFORM_SLUGS = [
  "reality",
  "memory",
  "ai-workforce",
  "missions",
  "intelligence",
  "governance",
  "integrations",
] as const;
export type PlatformSlug = (typeof PLATFORM_SLUGS)[number];

export const SOLUTION_SLUGS = [
  "organizations",
  "enterprise",
  "education",
  "operations",
  "ai-workforce",
] as const;
export type SolutionSlug = (typeof SOLUTION_SLUGS)[number];

export const LEGAL_SLUGS = ["privacy", "terms", "cookies", "accessibility"] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

export const RESOURCE_SLUGS = ["docs", "blog", "guides", "case-studies"] as const;
export type ResourceSlug = (typeof RESOURCE_SLUGS)[number];

export function isPlatformSlug(value: string): value is PlatformSlug {
  return (PLATFORM_SLUGS as readonly string[]).includes(value);
}
export function isSolutionSlug(value: string): value is SolutionSlug {
  return (SOLUTION_SLUGS as readonly string[]).includes(value);
}
export function isLegalSlug(value: string): value is LegalSlug {
  return (LEGAL_SLUGS as readonly string[]).includes(value);
}
export function isResourceSlug(value: string): value is ResourceSlug {
  return (RESOURCE_SLUGS as readonly string[]).includes(value);
}

export function publicRouteByPath(path: string): PublicRouteRecord | undefined {
  return SHERIVS_PUBLIC_ROUTES.find((route) => route.path === path);
}

export const PUBLIC_CAPABILITIES = SITE_CAPABILITIES;
export const PUBLIC_SECURITY = SECURITY_GUARANTEES;
export const PUBLIC_RUNTIMES = INSTALLED_RUNTIME_PROOFS;
