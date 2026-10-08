/**
 * Public information architecture.
 *
 * Links exist only for routes this program actually ships.
 */

export interface PublicNavItem {
  href: string;
  label: string;
}

export const PRIMARY_NAV: readonly PublicNavItem[] = [
  { href: "/platform", label: "Platform" },
  { href: "/solutions", label: "Solutions" },
  { href: "/security", label: "Security" },
  { href: "/enterprise", label: "Enterprise" },
  { href: "/pricing", label: "Pricing" },
  { href: "/resources", label: "Resources" },
];

export const FOOTER_NAV: readonly { title: string; items: readonly PublicNavItem[] }[] = [
  {
    title: "Platform",
    items: [
      { href: "/platform", label: "Platform" },
      { href: "/platform/reality", label: "Reality" },
      { href: "/platform/memory", label: "Memory" },
      { href: "/platform/ai-workforce", label: "AI workforce" },
      { href: "/platform/missions", label: "Missions" },
      { href: "/platform/intelligence", label: "Intelligence" },
      { href: "/platform/governance", label: "Governance" },
      { href: "/platform/integrations", label: "Integrations" },
    ],
  },
  {
    title: "Solutions",
    items: [
      { href: "/solutions", label: "Overview" },
      { href: "/solutions/organizations", label: "Organizations" },
      { href: "/solutions/enterprise", label: "Enterprise" },
      { href: "/solutions/education", label: "Education" },
      { href: "/solutions/operations", label: "Operations" },
      { href: "/solutions/ai-workforce", label: "AI workforce" },
    ],
  },
  {
    title: "Resources",
    items: [
      { href: "/resources", label: "Resources" },
      { href: "/resources/docs", label: "Documentation" },
      { href: "/resources/blog", label: "Essays" },
      { href: "/resources/guides", label: "Guides" },
      { href: "/resources/case-studies", label: "Case studies" },
      { href: "/resources/changelog", label: "Changelog" },
      { href: "/status", label: "Status" },
    ],
  },
  {
    title: "Company",
    items: [
      { href: "/about", label: "About" },
      { href: "/careers", label: "Careers" },
      { href: "/contact", label: "Contact" },
      { href: "/request-demo", label: "Request access" },
    ],
  },
  {
    title: "Legal",
    items: [
      { href: "/legal/privacy", label: "Privacy" },
      { href: "/legal/terms", label: "Terms" },
      { href: "/legal/cookies", label: "Cookies" },
      { href: "/legal/accessibility", label: "Accessibility" },
    ],
  },
];

/** Proof-page anchors required by the existing public-site contract. */
export const PROOF_ANCHORS: readonly PublicNavItem[] = [
  { href: "/coregrid#capabilities", label: "Capability index" },
  { href: "/coregrid#runtimes", label: "Installed runtime" },
  { href: "/coregrid#security", label: "Security guarantees" },
  { href: "/coregrid#pricing", label: "Published tiers" },
];

/**
 * Target organization workspace navigation.
 * These are capability gates, not routes. The live sidebar is still the
 * installed runtime's contribution catalog. A domain-neutral workspace must
 * not be implied by linking every organization to education paths.
 */
export const ORGANIZATION_WORKSPACE_NAV = [
  { id: "overview", label: "Overview", requires: ["org.overview"] },
  { id: "reality", label: "Reality", requires: ["org.reality"] },
  { id: "people", label: "People", requires: ["org.people"] },
  { id: "teams", label: "Teams", requires: ["org.teams"] },
  { id: "work", label: "Work", requires: ["org.work"] },
  { id: "missions", label: "Missions", requires: ["org.missions"] },
  { id: "knowledge", label: "Knowledge", requires: ["org.knowledge"] },
  { id: "memory", label: "Memory", requires: ["org.memory"] },
  { id: "communications", label: "Communications", requires: ["org.communications"] },
  { id: "calendar", label: "Calendar", requires: ["org.calendar"] },
  { id: "tasks", label: "Tasks", requires: ["org.tasks"] },
  { id: "files", label: "Files", requires: ["org.files"] },
  { id: "data", label: "Data", requires: ["org.data"] },
  { id: "reports", label: "Reports", requires: ["org.reports"] },
  { id: "automation", label: "Automation", requires: ["org.automation"] },
  { id: "ai-workforce", label: "AI workforce", requires: ["org.ai-workforce"] },
  { id: "integrations", label: "Integrations", requires: ["org.integrations"] },
  { id: "analytics", label: "Analytics", requires: ["org.analytics"] },
  { id: "governance", label: "Governance", requires: ["org.governance"] },
  { id: "settings", label: "Settings", requires: ["org.settings"] },
] as const;

/**
 * Internal Sherivs workspace areas. They are not linked from customer navigation.
 * The generated projection currently lives at /platform/org and is not a tenant.
 */
export const INTERNAL_WORKSPACE_AREAS = [
  "Executive",
  "Jarvis",
  "Missions",
  "AI Workforce",
  "Customers",
  "Organizations",
  "Product",
  "Engineering",
  "Architecture",
  "Infrastructure",
  "Security",
  "Operations",
  "Support",
  "Finance",
  "Research",
  "Analytics",
  "Releases",
  "Incidents",
  "Governance",
  "Documentation",
] as const;
