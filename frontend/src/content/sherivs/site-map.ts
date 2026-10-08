/**
 * Sherivs public site — route registry, navigation and footer.
 *
 * One registry drives the sitemap, the primary navigation, the footer and the route
 * conformance test. A path appears here only when a real route renders real content
 * behind it; target routes that are not built yet are tracked in
 * docs/experience/SHERIVS_ROUTE_ARCHITECTURE.md, never linked.
 */
import { PublicPageSchema, type PublicPage } from "../schema";
import { PLATFORM_LAYERS } from "./platform-layers";
import { SOLUTION_SEGMENTS } from "./solutions";

const RAW_PUBLIC_PAGES: PublicPage[] = [
  {
    path: "/",
    title: "Sherivs — Institutional Intelligence Infrastructure",
    description:
      "Sherivs is institutional intelligence infrastructure: a governed layer for an organization's reality, its knowledge and the AI workers that act on it.",
    changefreq: "weekly",
    priority: 1,
    indexable: true,
  },
  {
    path: "/platform",
    title: "Platform — Sherivs",
    description:
      "The Sherivs platform: reality, memory, AI workforce, missions, intelligence, governance and integrations, plus the kernel capabilities and phase contracts behind them.",
    changefreq: "monthly",
    priority: 0.9,
    indexable: true,
  },
  ...PLATFORM_LAYERS.map<PublicPage>((layer) => ({
    path: `/platform/${layer.slug}`,
    title: `${layer.name} — Sherivs platform`,
    description: `${layer.statement} ${layer.problem}`.slice(0, 165),
    changefreq: "monthly",
    priority: 0.8,
    indexable: true,
  })),
  {
    path: "/solutions",
    title: "Solutions — Sherivs",
    description:
      "How organizations use Sherivs: one governed platform, with domain runtimes for sectors that need their own vocabulary and workflows.",
    changefreq: "monthly",
    priority: 0.8,
    indexable: true,
  },
  ...SOLUTION_SEGMENTS.map<PublicPage>((segment) => ({
    path: `/solutions/${segment.slug}`,
    title: `${segment.name} — Sherivs`,
    description: segment.summary.slice(0, 165),
    changefreq: "monthly",
    priority: 0.7,
    indexable: true,
  })),
  {
    path: "/security",
    title: "Security — Sherivs",
    description:
      "How Sherivs protects institutions: database-enforced tenancy, layered authorization, governed AI, canonical truth protection and immutable audit.",
    changefreq: "monthly",
    priority: 0.8,
    indexable: true,
  },
  {
    path: "/pricing",
    title: "Pricing — Sherivs",
    description:
      "Sherivs plans in ₦, from a free trial to enterprise contracts. Entitlements are enforced by the platform after activation, never by this page.",
    changefreq: "monthly",
    priority: 0.7,
    indexable: true,
  },
  {
    path: "/status",
    title: "System status — Sherivs",
    description:
      "Live health of the Sherivs instance serving this page, read from the public health endpoint at request time. No cached or simulated status.",
    changefreq: "daily",
    priority: 0.4,
    indexable: true,
  },
  {
    path: "/legal/accessibility",
    title: "Accessibility statement — Sherivs",
    description:
      "The accessibility standard Sherivs builds to, what is in place today, the known gaps, and how to report a barrier you encounter on the platform.",
    changefreq: "yearly",
    priority: 0.3,
    indexable: true,
  },
  {
    path: "/auth",
    title: "Sign in — Sherivs",
    description:
      "Sign in to Sherivs or create an account. Your workspace is resolved from your actual organization membership, roles and permissions.",
    changefreq: "yearly",
    priority: 0.3,
    indexable: true,
  },
];

export const PUBLIC_PAGES: readonly PublicPage[] = RAW_PUBLIC_PAGES.map((page) =>
  PublicPageSchema.parse(page),
);

export function findPublicPage(path: string): PublicPage | undefined {
  return PUBLIC_PAGES.find((page) => page.path === path);
}

export interface NavLink {
  label: string;
  href: string;
  description?: string;
}

export interface NavGroup {
  label: string;
  href: string;
  /** Mega-menu columns; absent for a plain link. */
  links?: readonly NavLink[];
}

export const PRIMARY_NAV: readonly NavGroup[] = [
  {
    label: "Platform",
    href: "/platform",
    links: PLATFORM_LAYERS.map((layer) => ({
      label: layer.name,
      href: `/platform/${layer.slug}`,
      description: layer.statement,
    })),
  },
  {
    label: "Solutions",
    href: "/solutions",
    links: SOLUTION_SEGMENTS.map((segment) => ({
      label: segment.name,
      href: `/solutions/${segment.slug}`,
      description: segment.tagline,
    })),
  },
  { label: "Security", href: "/security" },
  { label: "Pricing", href: "/pricing" },
];

export interface FooterColumn {
  heading: string;
  links: readonly NavLink[];
}

export const FOOTER_COLUMNS: readonly FooterColumn[] = [
  {
    heading: "Platform",
    links: [
      { label: "Overview", href: "/platform" },
      ...PLATFORM_LAYERS.map((layer) => ({ label: layer.name, href: `/platform/${layer.slug}` })),
    ],
  },
  {
    heading: "Solutions",
    links: [
      { label: "Overview", href: "/solutions" },
      ...SOLUTION_SEGMENTS.map((segment) => ({
        label: segment.name,
        href: `/solutions/${segment.slug}`,
      })),
    ],
  },
  {
    heading: "Trust",
    links: [
      { label: "Security", href: "/security" },
      { label: "System status", href: "/status" },
      { label: "Accessibility", href: "/legal/accessibility" },
    ],
  },
  {
    heading: "Account",
    links: [
      { label: "Sign in", href: "/auth" },
      { label: "Create an account", href: "/auth" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
];
