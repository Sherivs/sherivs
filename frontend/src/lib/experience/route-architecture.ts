/**
 * Sherivs Experience System — ROUTE ARCHITECTURE contract
 * (SHERIVS_ROUTE_ARCHITECTURE.md is the prose twin of this module).
 *
 * Every experience plane and every route Sherivs exposes is declared here
 * with an honest status. The declaration is CONSUMED, not decorative:
 *   - the public header / footer render only LIVE public routes;
 *   - the sitemap emits only LIVE, indexable public routes;
 *   - tests/unit/sherivs-route-architecture.test.ts proves every LIVE route
 *     has a route file, and that no PLANNED route has leaked into chrome.
 *
 * Status vocabulary:
 *   LIVE      implemented, reachable, backed by real content or real data
 *   LEGACY    implemented before the Sherivs system; kept, to be migrated
 *   PLANNED   declared in the architecture; NOT implemented — never linked
 */

export type ExperiencePlane =
  | "public" // Sherivs public website (sherivs.com)
  | "org-public" // an organization's public site (tenant host / ?school=slug)
  | "auth" // authentication & recovery
  | "shell" // universal application shell surfaces (account, notifications…)
  | "org-workspace" // organization workspace (runtime-contributed navigation)
  | "internal" // Sherivs internal / platform-operator workspace (separate boundary)
  | "developer" // API & developer experience
  | "system"; // machine endpoints (health, sitemap, manifest, APIs)

export type RouteStatus = "LIVE" | "LEGACY" | "PLANNED";

export interface ExperienceRoute {
  /** Canonical path (TanStack path syntax for dynamic segments). */
  path: string;
  plane: ExperiencePlane;
  /** Human label used by navigation surfaces. */
  label: string;
  status: RouteStatus;
  /** Appears in the public primary navigation (public plane only). */
  primaryNav?: boolean;
  /** Footer group key (public plane only). */
  footerGroup?: "platform" | "solutions" | "trust" | "company" | "legal";
  /** Indexable by search engines (public plane only; LIVE required). */
  indexable?: boolean;
  /** Short description (meta description / nav hint). */
  description?: string;
  /** Owning mission id from the Sherivs mission portfolio. */
  mission: string;
}

export const EXPERIENCE_ROUTES: readonly ExperienceRoute[] = [
  // ── Sherivs public ────────────────────────────────────────────────
  {
    path: "/",
    plane: "public",
    label: "Home",
    status: "LIVE",
    indexable: true,
    description: "Sherivs — institutional intelligence infrastructure.",
    mission: "SX-12",
  },
  {
    path: "/platform",
    plane: "public",
    label: "Platform",
    status: "LIVE",
    primaryNav: true,
    footerGroup: "platform",
    indexable: true,
    description: "The platform: reality, memory, AI workforce, missions, intelligence, governance, integrations.",
    mission: "SX-12",
  },
  { path: "/platform/reality", plane: "public", label: "Reality", status: "LIVE", footerGroup: "platform", indexable: true, mission: "SX-12" },
  { path: "/platform/memory", plane: "public", label: "Memory", status: "LIVE", footerGroup: "platform", indexable: true, mission: "SX-12" },
  { path: "/platform/ai-workforce", plane: "public", label: "AI Workforce", status: "LIVE", footerGroup: "platform", indexable: true, mission: "SX-12" },
  { path: "/platform/missions", plane: "public", label: "Missions", status: "LIVE", footerGroup: "platform", indexable: true, mission: "SX-12" },
  { path: "/platform/intelligence", plane: "public", label: "Intelligence", status: "LIVE", footerGroup: "platform", indexable: true, mission: "SX-12" },
  { path: "/platform/governance", plane: "public", label: "Governance", status: "LIVE", footerGroup: "platform", indexable: true, mission: "SX-12" },
  { path: "/platform/integrations", plane: "public", label: "Integrations", status: "LIVE", footerGroup: "platform", indexable: true, mission: "SX-12" },
  {
    path: "/platform/kernel",
    plane: "public",
    label: "Kernel registry",
    status: "LIVE",
    indexable: true,
    description: "Live view of the kernel capability registry and runtime consumption.",
    mission: "SX-12",
  },
  { path: "/platform/org", plane: "public", label: "Organization provisioning map", status: "LEGACY", mission: "SX-12" },
  {
    path: "/solutions",
    plane: "public",
    label: "Solutions",
    status: "LIVE",
    primaryNav: true,
    footerGroup: "solutions",
    indexable: true,
    description: "Sherivs for organizations, enterprises, education and governed AI workforces.",
    mission: "SX-12",
  },
  { path: "/solutions/organizations", plane: "public", label: "Organizations", status: "LIVE", footerGroup: "solutions", indexable: true, mission: "SX-12" },
  { path: "/solutions/enterprise", plane: "public", label: "Enterprise", status: "LIVE", footerGroup: "solutions", indexable: true, mission: "SX-12" },
  { path: "/solutions/education", plane: "public", label: "Education", status: "LIVE", footerGroup: "solutions", indexable: true, mission: "SX-12" },
  { path: "/solutions/ai-workforce", plane: "public", label: "AI Workforce", status: "LIVE", footerGroup: "solutions", indexable: true, mission: "SX-12" },
  { path: "/solutions/operations", plane: "public", label: "Operations", status: "PLANNED", mission: "SX-12" },
  {
    path: "/security",
    plane: "public",
    label: "Security",
    status: "LIVE",
    primaryNav: true,
    footerGroup: "trust",
    indexable: true,
    description: "Tenant isolation, layered authorization, canonical-truth protection, AI output trust, audit.",
    mission: "SX-12",
  },
  {
    path: "/pricing",
    plane: "public",
    label: "Pricing",
    status: "LIVE",
    primaryNav: true,
    footerGroup: "company",
    indexable: true,
    description: "Commercial tiers, mirrored from the platform's tier catalog.",
    mission: "SX-12",
  },
  {
    path: "/status",
    plane: "public",
    label: "Status",
    status: "LIVE",
    footerGroup: "trust",
    indexable: false,
    description: "Live platform health, read from the health endpoint.",
    mission: "SX-12",
  },
  { path: "/enterprise", plane: "public", label: "Enterprise", status: "PLANNED", mission: "SX-12" },
  { path: "/resources", plane: "public", label: "Resources", status: "PLANNED", mission: "SX-27" },
  { path: "/resources/blog", plane: "public", label: "Blog", status: "PLANNED", mission: "SX-27" },
  { path: "/resources/docs", plane: "public", label: "Docs", status: "PLANNED", mission: "SX-27" },
  { path: "/resources/guides", plane: "public", label: "Guides", status: "PLANNED", mission: "SX-27" },
  { path: "/resources/case-studies", plane: "public", label: "Case studies", status: "PLANNED", mission: "SX-27" },
  { path: "/resources/changelog", plane: "public", label: "Changelog", status: "PLANNED", mission: "SX-27" },
  { path: "/about", plane: "public", label: "About", status: "PLANNED", mission: "SX-12" },
  { path: "/company", plane: "public", label: "Company", status: "PLANNED", mission: "SX-12" },
  { path: "/careers", plane: "public", label: "Careers", status: "PLANNED", mission: "SX-12" },
  { path: "/contact", plane: "public", label: "Contact", status: "PLANNED", mission: "SX-12" },
  { path: "/request-demo", plane: "public", label: "Request demo", status: "PLANNED", mission: "SX-12" },
  { path: "/legal", plane: "public", label: "Legal", status: "LIVE", footerGroup: "legal", indexable: true, mission: "SX-12" },
  { path: "/legal/accessibility", plane: "public", label: "Accessibility", status: "LIVE", footerGroup: "legal", indexable: true, mission: "SX-10" },
  { path: "/legal/privacy", plane: "public", label: "Privacy", status: "PLANNED", mission: "SX-12" },
  { path: "/legal/terms", plane: "public", label: "Terms", status: "PLANNED", mission: "SX-12" },
  { path: "/legal/cookies", plane: "public", label: "Cookies", status: "PLANNED", mission: "SX-12" },

  // ── Organization public (tenant host or ?school=<slug>) ───────────
  { path: "/", plane: "org-public", label: "Organization home", status: "LEGACY", mission: "SX-13" },
  { path: "/admissions", plane: "org-public", label: "Admissions (education runtime)", status: "LEGACY", mission: "SX-13" },
  { path: "/blog", plane: "org-public", label: "Blog", status: "LEGACY", mission: "SX-13" },
  { path: "/blog/$slug", plane: "org-public", label: "Blog post", status: "LEGACY", mission: "SX-13" },
  { path: "/news/$id", plane: "org-public", label: "News item", status: "LEGACY", mission: "SX-13" },
  { path: "/events/$id", plane: "org-public", label: "Event", status: "LEGACY", mission: "SX-13" },
  { path: "/privacy", plane: "org-public", label: "Organization privacy policy", status: "LEGACY", mission: "SX-13" },
  { path: "/rules", plane: "org-public", label: "Organization rules", status: "LEGACY", mission: "SX-13" },

  // ── Authentication ────────────────────────────────────────────────
  { path: "/auth", plane: "auth", label: "Sign in / create account", status: "LIVE", mission: "SX-17" },
  { path: "/login", plane: "auth", label: "Sign in (redirect)", status: "LEGACY", mission: "SX-17" },
  { path: "/reset-password", plane: "auth", label: "Reset password", status: "LEGACY", mission: "SX-17" },
  { path: "/super-admin-bootstrap", plane: "auth", label: "Platform operator bootstrap", status: "LEGACY", mission: "SX-17" },

  // ── Universal application shell ───────────────────────────────────
  { path: "/settings", plane: "shell", label: "Account & settings", status: "LEGACY", mission: "SX-24" },
  { path: "/notifications", plane: "shell", label: "Notifications", status: "LEGACY", mission: "SX-26" },
  { path: "/messages", plane: "shell", label: "Messages", status: "LEGACY", mission: "SX-14" },
  { path: "/runtime", plane: "shell", label: "Runtime", status: "LEGACY", mission: "SX-14" },
  { path: "/command-centre", plane: "shell", label: "Command centre — operations projection", status: "LEGACY", mission: "SX-14" },
  { path: "/command-centre/provision", plane: "shell", label: "Provisioning rehearsal", status: "LIVE", mission: "SX-14" },

  // ── Organization workspace (runtime-contributed; see nav-registry) ─
  { path: "/admin/*", plane: "org-workspace", label: "Organization administration", status: "LEGACY", mission: "SX-15" },
  { path: "/teacher/*", plane: "org-workspace", label: "Educator workspace", status: "LEGACY", mission: "SX-15" },
  { path: "/student/*", plane: "org-workspace", label: "Learner workspace", status: "LEGACY", mission: "SX-15" },
  { path: "/parent/*", plane: "org-workspace", label: "Guardian workspace", status: "LEGACY", mission: "SX-15" },
  { path: "/bursar/*", plane: "org-workspace", label: "Finance workspace", status: "LEGACY", mission: "SX-15" },
  { path: "/driver/*", plane: "org-workspace", label: "Transport workspace", status: "LEGACY", mission: "SX-15" },

  // ── Sherivs internal (platform operator) ──────────────────────────
  { path: "/super-admin/*", plane: "internal", label: "Platform administration", status: "LEGACY", mission: "SX-16" },
  { path: "/hq/*", plane: "internal", label: "Network HQ", status: "LEGACY", mission: "SX-16" },

  // ── Developer ─────────────────────────────────────────────────────
  { path: "/developers", plane: "developer", label: "Developer portal", status: "PLANNED", mission: "SX-27" },

  // ── System ────────────────────────────────────────────────────────
  { path: "/health.json", plane: "system", label: "Health", status: "LIVE", mission: "SX-39" },
  { path: "/sitemap.xml", plane: "system", label: "Sitemap", status: "LIVE", mission: "SX-35" },
  { path: "/manifest.webmanifest", plane: "system", label: "Web manifest", status: "LIVE", mission: "SX-29" },
  { path: "/robots.txt", plane: "system", label: "Robots", status: "LIVE", mission: "SX-35" },
];

export function routesForPlane(plane: ExperiencePlane): readonly ExperienceRoute[] {
  return EXPERIENCE_ROUTES.filter((route) => route.plane === plane);
}

/** LIVE public routes that may be linked from chrome. */
export function linkablePublicRoutes(): readonly ExperienceRoute[] {
  return EXPERIENCE_ROUTES.filter((route) => route.plane === "public" && route.status === "LIVE");
}

export function publicPrimaryNav(): readonly ExperienceRoute[] {
  return linkablePublicRoutes().filter((route) => route.primaryNav);
}

export function publicFooterGroups(): ReadonlyArray<{
  key: NonNullable<ExperienceRoute["footerGroup"]>;
  label: string;
  routes: readonly ExperienceRoute[];
}> {
  const groups: Array<{ key: NonNullable<ExperienceRoute["footerGroup"]>; label: string }> = [
    { key: "platform", label: "Platform" },
    { key: "solutions", label: "Solutions" },
    { key: "trust", label: "Trust" },
    { key: "company", label: "Company" },
    { key: "legal", label: "Legal" },
  ];
  return groups
    .map((group) => ({
      ...group,
      routes: linkablePublicRoutes().filter((route) => route.footerGroup === group.key),
    }))
    .filter((group) => group.routes.length > 0);
}

/** Public routes eligible for the sitemap: LIVE, indexable, no dynamic segment. */
export function sitemapRoutes(): readonly ExperienceRoute[] {
  return linkablePublicRoutes().filter(
    (route) => route.indexable === true && !route.path.includes("$") && !route.path.includes("*"),
  );
}

/** Path with TanStack dynamic/splat segments → route-file candidates. */
export function routeFileCandidates(path: string): readonly string[] {
  if (path === "/") return ["index.tsx"];
  const trimmed = path.replace(/^\//, "").replace(/\/\*$/, "");
  const dotted = trimmed.replace(/\//g, ".");
  const nested = trimmed;
  return [
    `${dotted}.tsx`,
    `${dotted}.ts`,
    `${dotted}.index.tsx`,
    `${nested}.tsx`,
    `${nested}/index.tsx`,
    `${nested}/route.tsx`,
    `${dotted.replace(/\./g, "[.]")}.ts`,
  ];
}
