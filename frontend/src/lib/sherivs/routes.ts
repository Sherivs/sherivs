/**
 * Sherivs route architecture — the governed registry of public experience routes.
 *
 * One typed list drives: public navigation, the footer, the sitemap, breadcrumbs
 * and the route-conformance test. A route may be `live` only when a route file
 * exists for it (enforced by tests/unit/sherivs-routes.test.ts); a route that the
 * program lists but that has no real content or backing capability is recorded
 * `withheld` with the reason — it is never faked.
 *
 * Scope: the PUBLIC plane (visitor, unauthenticated). The authenticated planes
 * (application shell, organization workspace, Sherivs workspace) are described by
 * `ROUTE_PLANES` and the file-based route tree; their navigation is capability-
 * driven at runtime, never listed statically here.
 */

export type RoutePlaneId =
  | "public"
  | "org-public"
  | "auth"
  | "application"
  | "organization-workspace"
  | "sherivs-workspace"
  | "runtime"
  | "developer"
  | "system";

export interface RoutePlane {
  readonly id: RoutePlaneId;
  readonly audience: string;
  readonly boundary: string;
  readonly examples: readonly string[];
}

/** The experience planes and the security boundary each one sits behind. */
export const ROUTE_PLANES: readonly RoutePlane[] = [
  {
    id: "public",
    audience: "Anyone",
    boundary: "No identity. Static, reviewed content only; no tenant context; no database reads.",
    examples: ["/", "/platform", "/security", "/pricing", "/resources"],
  },
  {
    id: "org-public",
    audience: "Visitors of one organization",
    boundary:
      "Tenant resolved server-side from host or slug; only fields the organization published; sections gated by active runtimes.",
    examples: ["/?school=<slug>", "<tenant>.<domain>/"],
  },
  {
    id: "auth",
    audience: "Anyone establishing identity",
    boundary: "Supabase-backed sign-in; the destination is resolved from the person's real context, never assumed.",
    examples: ["/auth", "/reset-password"],
  },
  {
    id: "application",
    audience: "Any authenticated person",
    boundary: "Universal shell: account, notifications, search, command, settings. Requires a session.",
    examples: ["/notifications", "/messages", "/settings"],
  },
  {
    id: "organization-workspace",
    audience: "Members of an organization",
    boundary: "Navigation is resolved from runtime contributions x the viewer's authorized capabilities; RLS enforces data.",
    examples: ["/admin/*", "/teacher/*", "/parent/*", "/student/*"],
  },
  {
    id: "sherivs-workspace",
    audience: "Sherivs staff (super_admin)",
    boundary: "Separate security boundary behind a server-checked role; never linked from customer navigation.",
    examples: ["/super-admin/*", "/command-centre"],
  },
  {
    id: "runtime",
    audience: "Members using a domain runtime",
    boundary: "Runtime-specific surfaces contributed as data; Scholar sections load only when the Scholar runtime is installed.",
    examples: ["/admin/students", "/teacher/gradebook"],
  },
  {
    id: "developer",
    audience: "Integrators",
    boundary: "API keys and webhooks are tenant-scoped, authenticated surfaces; public docs describe only shipped APIs.",
    examples: ["/admin/api-keys"],
  },
  {
    id: "system",
    audience: "Operators and probes",
    boundary: "Machine endpoints with leak-free whitelisted payloads.",
    examples: ["/health.json", "/sitemap.xml", "/manifest.webmanifest"],
  },
] as const;

export type PublicRouteStatus = "live" | "withheld";
export type NavGroup = "platform" | "solutions" | "resources" | "company" | "legal" | "primary";

export interface PublicRouteSpec {
  readonly path: string;
  readonly title: string;
  readonly summary: string;
  readonly status: PublicRouteStatus;
  readonly nav?: { readonly group: NavGroup; readonly order: number; readonly label?: string };
  readonly sitemap: boolean;
  /** Route file that implements the path (relative to frontend/src/routes). */
  readonly file?: string;
  /** For withheld routes: the honest reason no page exists. */
  readonly withheldReason?: string;
}

const live = (spec: Omit<PublicRouteSpec, "status">): PublicRouteSpec => ({ ...spec, status: "live" });
const withheld = (
  path: string,
  title: string,
  withheldReason: string,
): PublicRouteSpec => ({ path, title, summary: "", status: "withheld", sitemap: false, withheldReason });

export const PUBLIC_ROUTES: readonly PublicRouteSpec[] = [
  live({ path: "/", title: "Sherivs", summary: "Institutional intelligence infrastructure.", sitemap: true, file: "index.tsx" }),

  live({ path: "/platform", title: "Platform", summary: "The governed platform: reality, memory, intelligence, workforce, missions, governance, integrations.", nav: { group: "platform", order: 0, label: "Platform overview" }, sitemap: true, file: "(site)/platform/index.tsx" }),
  live({ path: "/platform/reality", title: "Organizational reality", summary: "The canonical record of people, structure, state and events.", nav: { group: "platform", order: 1 }, sitemap: true, file: "(site)/platform/$capability.tsx" }),
  live({ path: "/platform/memory", title: "Memory and knowledge", summary: "Practical, scoped memory and governed context.", nav: { group: "platform", order: 2 }, sitemap: true, file: "(site)/platform/$capability.tsx" }),
  live({ path: "/platform/intelligence", title: "Intelligence", summary: "A governed gateway to models, with trust applied to every output.", nav: { group: "platform", order: 3 }, sitemap: true, file: "(site)/platform/$capability.tsx" }),
  live({ path: "/platform/ai-workforce", title: "AI workforce", summary: "Governed workers with identity, scope, tools and leases.", nav: { group: "platform", order: 4 }, sitemap: true, file: "(site)/platform/$capability.tsx" }),
  live({ path: "/platform/missions", title: "Missions", summary: "Work as a first-class, evidenced, verifiable object.", nav: { group: "platform", order: 5 }, sitemap: true, file: "(site)/platform/$capability.tsx" }),
  live({ path: "/platform/governance", title: "Governance", summary: "Authority, policy, approval and audit on every decision.", nav: { group: "platform", order: 6 }, sitemap: true, file: "(site)/platform/$capability.tsx" }),
  live({ path: "/platform/integrations", title: "Integrations", summary: "Provider-agnostic adapters behind Sherivs contracts.", nav: { group: "platform", order: 7 }, sitemap: true, file: "(site)/platform/$capability.tsx" }),

  live({ path: "/solutions", title: "Solutions", summary: "How different organizations run on one governed core.", nav: { group: "solutions", order: 0, label: "All solutions" }, sitemap: true, file: "(site)/solutions/index.tsx" }),
  live({ path: "/solutions/organizations", title: "For organizations", summary: "A domain-neutral operating environment for any organization.", nav: { group: "solutions", order: 1 }, sitemap: true, file: "(site)/solutions/$audience.tsx" }),
  live({ path: "/solutions/education", title: "Education — Sherivs Scholar", summary: "The first runtime installed on Sherivs.", nav: { group: "solutions", order: 2 }, sitemap: true, file: "(site)/solutions/$audience.tsx" }),

  live({ path: "/security", title: "Security", summary: "Tenant isolation, layered authorization and immutable audit.", nav: { group: "primary", order: 1 }, sitemap: true, file: "(site)/security.tsx" }),
  live({ path: "/pricing", title: "Pricing", summary: "Commercial plans from the platform's tier catalog.", nav: { group: "primary", order: 2 }, sitemap: true, file: "(site)/pricing.tsx" }),

  live({ path: "/resources", title: "Resources", summary: "Documentation, guides, case studies and release notes.", nav: { group: "resources", order: 0, label: "All resources" }, sitemap: true, file: "(site)/resources/index.tsx" }),
  live({ path: "/resources/docs", title: "Documentation", summary: "Concepts and reference.", nav: { group: "resources", order: 1 }, sitemap: true, file: "(site)/resources/$section/index.tsx" }),
  live({ path: "/resources/changelog", title: "Changelog", summary: "What changed, and when.", nav: { group: "resources", order: 2 }, sitemap: true, file: "(site)/resources/$section/index.tsx" }),
  live({ path: "/resources/blog", title: "Blog", summary: "Articles from the Sherivs team.", nav: { group: "resources", order: 3 }, sitemap: true, file: "(site)/resources/$section/index.tsx" }),
  live({ path: "/resources/guides", title: "Guides", summary: "Task-oriented guides.", nav: { group: "resources", order: 4 }, sitemap: true, file: "(site)/resources/$section/index.tsx" }),
  live({ path: "/resources/case-studies", title: "Case studies", summary: "Customer outcomes.", nav: { group: "resources", order: 5 }, sitemap: true, file: "(site)/resources/$section/index.tsx" }),

  live({ path: "/status", title: "System status", summary: "Live health of this deployment.", nav: { group: "company", order: 1 }, sitemap: true, file: "(site)/status.tsx" }),
  live({ path: "/legal", title: "Legal", summary: "Legal and accessibility statements.", nav: { group: "legal", order: 0 }, sitemap: true, file: "(site)/legal/index.tsx" }),
  live({ path: "/legal/accessibility", title: "Accessibility statement", summary: "Sherivs's accessibility commitments and known limitations.", nav: { group: "legal", order: 1 }, sitemap: true, file: "(site)/legal/accessibility.tsx" }),

  withheld("/about", "About", "No approved company narrative exists in the repository; inventing one is prohibited."),
  withheld("/company", "Company", "No approved company information exists; page withheld rather than fabricated."),
  withheld("/careers", "Careers", "No real openings or hiring process are recorded."),
  withheld("/contact", "Contact", "No monitored contact channel or lead-intake capability exists to wire a form to."),
  withheld("/request-demo", "Request a demo", "No lead-intake capability (server function, storage, audit) exists; /auth is the real entry."),
  withheld("/enterprise", "Enterprise", "Covered truthfully by /security and /solutions/organizations; no separate verified enterprise offer is recorded."),
  withheld("/solutions/enterprise", "Enterprise solutions", "No distinct capability beyond /solutions/organizations."),
  withheld("/solutions/operations", "Operations solutions", "No distinct capability beyond /solutions/organizations."),
  withheld("/solutions/ai-workforce", "AI workforce solutions", "Duplicate of /platform/ai-workforce."),
  withheld("/legal/privacy", "Privacy policy", "Legal text requires counsel approval; none is recorded."),
  withheld("/legal/terms", "Terms of service", "Legal text requires counsel approval; none is recorded."),
  withheld("/legal/cookies", "Cookie policy", "Legal text requires counsel approval; none is recorded."),
] as const;

export const livePublicRoutes = (): readonly PublicRouteSpec[] =>
  PUBLIC_ROUTES.filter((r) => r.status === "live");

export const withheldPublicRoutes = (): readonly PublicRouteSpec[] =>
  PUBLIC_ROUTES.filter((r) => r.status === "withheld");

export function navGroup(group: NavGroup): readonly PublicRouteSpec[] {
  return livePublicRoutes()
    .filter((r) => r.nav?.group === group)
    .sort((a, b) => (a.nav?.order ?? 0) - (b.nav?.order ?? 0));
}

export function navLabel(route: PublicRouteSpec): string {
  return route.nav?.label ?? route.title;
}

/** Sitemap entries derive from the registry only — a route absent here is not advertised. */
export function sitemapPaths(): readonly string[] {
  return livePublicRoutes()
    .filter((r) => r.sitemap)
    .map((r) => r.path);
}

export interface Crumb {
  readonly label: string;
  readonly href?: string;
}

/** Breadcrumb trail for a public path, built from the registry (honest labels). */
export function breadcrumbsFor(path: string): readonly Crumb[] {
  const crumbs: Crumb[] = [{ label: "Sherivs", href: "/" }];
  const segments = path.split("/").filter(Boolean);
  let acc = "";
  for (let i = 0; i < segments.length; i++) {
    acc += `/${segments[i]}`;
    const known = PUBLIC_ROUTES.find((r) => r.path === acc && r.status === "live");
    const last = i === segments.length - 1;
    crumbs.push({
      label: known?.title ?? segments[i].replace(/-/g, " "),
      href: last ? undefined : known ? acc : undefined,
    });
  }
  return crumbs;
}
