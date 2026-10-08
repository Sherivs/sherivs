/**
 * Sherivs public route registry — the single source for public navigation,
 * footer, sitemap and the route-conformance test.
 *
 * Law (brief §5): "Only create pages where actual content/capability exists.
 * Never fabricate claims." A route is therefore either:
 *   LIVE      a real page exists and is linked from navigation / sitemap
 *   DEFERRED  intentionally NOT built; the reason is recorded here so the gap
 *             is explicit rather than silently papered over with a stub
 *
 * Navigation, footer and sitemap are derived from LIVE entries only, so a
 * deferred page can never appear as a dead link.
 */

export type PublicRouteStatus = "LIVE" | "DEFERRED";
export type PublicNavGroup =
  | "platform"
  | "solutions"
  | "trust"
  | "resources"
  | "company"
  | "legal"
  | "product"
  | "none";

export interface PublicRouteEntry {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly group: PublicNavGroup;
  readonly status: PublicRouteStatus;
  /** Present for DEFERRED entries: why the page does not exist yet. */
  readonly deferredReason?: string;
  /** Sitemap priority; omitted for entries that must not be indexed. */
  readonly priority?: number;
  readonly changefreq?: "weekly" | "monthly" | "yearly";
}

const live = (
  path: string,
  title: string,
  description: string,
  group: PublicNavGroup,
  priority: number,
  changefreq: "weekly" | "monthly" | "yearly" = "monthly",
): PublicRouteEntry => ({ path, title, description, group, status: "LIVE", priority, changefreq });

const deferred = (
  path: string,
  title: string,
  group: PublicNavGroup,
  deferredReason: string,
): PublicRouteEntry => ({
  path,
  title,
  description: "",
  group,
  status: "DEFERRED",
  deferredReason,
});

const NEEDS_COPY =
  "No verified, approved content exists for this page yet; publishing a placeholder would fabricate claims.";
const NEEDS_LEGAL = "Legal text must be authored and approved by counsel; it is not generated.";
const NEEDS_INTAKE =
  "Requires a real intake channel (monitored mailbox or CRM form endpoint). None is configured, and submissions must never be faked.";

export const PUBLIC_ROUTES: readonly PublicRouteEntry[] = [
  live(
    "/",
    "Sherivs — Institutional Intelligence Infrastructure",
    "Sherivs models an organization's reality, gives it memory and context, and lets a governed AI workforce complete missions with evidence and verification.",
    "none",
    1,
    "weekly",
  ),

  live(
    "/platform",
    "Platform",
    "The Sherivs platform: reality model, memory, intelligence, AI workforce, missions, governance and integrations.",
    "platform",
    0.9,
  ),
  live(
    "/platform/reality",
    "Reality",
    "A canonical model of what an organization is — kept separate from what is inferred about it.",
    "platform",
    0.8,
  ),
  live(
    "/platform/memory",
    "Memory",
    "Scoped, provenance-carrying memory that humans and workers can use without crossing a boundary.",
    "platform",
    0.8,
  ),
  live(
    "/platform/intelligence",
    "Intelligence",
    "Context assembly, knowledge and a single governed gateway for every model call.",
    "platform",
    0.8,
  ),
  live(
    "/platform/ai-workforce",
    "AI workforce",
    "Governed AI workers with identity, owners, scopes and a lifecycle — never magical autonomous characters.",
    "platform",
    0.8,
  ),
  live(
    "/platform/missions",
    "Missions",
    "Work expressed as first-class missions: plan, execute, evidence, verify, outcome.",
    "platform",
    0.8,
  ),
  live(
    "/platform/governance",
    "Governance",
    "Authority, policy, evidence, verification and audit as native properties of the platform.",
    "platform",
    0.8,
  ),
  live(
    "/platform/integrations",
    "Integrations",
    "Provider adapters keep payments, messaging, storage and AI vendors behind Sherivs contracts.",
    "platform",
    0.7,
  ),

  live(
    "/solutions",
    "Solutions",
    "How different organizations run on the same governed kernel.",
    "solutions",
    0.8,
  ),
  live(
    "/solutions/organizations",
    "For organizations",
    "A capability-driven workspace and public presence generated from your organization's own reality.",
    "solutions",
    0.7,
  ),
  live(
    "/solutions/education",
    "Sherivs Scholar",
    "Sherivs Scholar, the education runtime installed on the Sherivs kernel.",
    "solutions",
    0.7,
  ),
  deferred("/solutions/enterprise", "Enterprise", "solutions", NEEDS_COPY),
  deferred("/solutions/operations", "Operations", "solutions", NEEDS_COPY),
  deferred(
    "/solutions/ai-workforce",
    "AI workforce solution",
    "solutions",
    "Covered by /platform/ai-workforce; a second page would duplicate it.",
  ),

  live(
    "/security",
    "Security",
    "Tenant isolation enforced by the database, layered authorization, and AI output that is untrusted by default.",
    "trust",
    0.8,
  ),
  live(
    "/pricing",
    "Pricing",
    "Commercial tiers for organizations running on Sherivs.",
    "trust",
    0.7,
  ),
  deferred("/enterprise", "Enterprise", "trust", NEEDS_COPY),

  live(
    "/resources",
    "Resources",
    "Guides, case studies, changelog and documentation published by Sherivs.",
    "resources",
    0.5,
    "weekly",
  ),

  deferred("/about", "About", "company", NEEDS_COPY),
  deferred("/company", "Company", "company", NEEDS_COPY),
  deferred("/careers", "Careers", "company", "No open roles or hiring process to describe."),
  deferred("/contact", "Contact", "company", NEEDS_INTAKE),
  deferred("/request-demo", "Request a demo", "company", NEEDS_INTAKE),

  live(
    "/legal/accessibility",
    "Accessibility",
    "Sherivs accessibility commitments, current status and how to report a barrier.",
    "legal",
    0.3,
    "yearly",
  ),
  deferred("/legal/privacy", "Privacy", "legal", NEEDS_LEGAL),
  deferred("/legal/terms", "Terms", "legal", NEEDS_LEGAL),
  deferred("/legal/cookies", "Cookies", "legal", NEEDS_LEGAL),

  live(
    "/status",
    "System status",
    "Live platform health, read from the same endpoint used by uptime probes.",
    "product",
    0.4,
    "weekly",
  ),
];

export const LIVE_PUBLIC_ROUTES: readonly PublicRouteEntry[] = PUBLIC_ROUTES.filter(
  (r) => r.status === "LIVE",
);
export const DEFERRED_PUBLIC_ROUTES: readonly PublicRouteEntry[] = PUBLIC_ROUTES.filter(
  (r) => r.status === "DEFERRED",
);

export function liveRoutesIn(group: PublicNavGroup): readonly PublicRouteEntry[] {
  return LIVE_PUBLIC_ROUTES.filter((r) => r.group === group);
}

/** Breadcrumb trail for a public path, from registry titles (home → … → page). */
export function publicBreadcrumbs(path: string): ReadonlyArray<{ label: string; path: string }> {
  const trail: Array<{ label: string; path: string }> = [{ label: "Home", path: "/" }];
  const parts = path.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    const entry = LIVE_PUBLIC_ROUTES.find((r) => r.path === current);
    if (entry) trail.push({ label: entry.title, path: entry.path });
  }
  return trail;
}
