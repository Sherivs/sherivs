import { POSITIONING_TAGLINE } from "@/lib/public-site/company";

/**
 * Public navigation and footer model. Links only to real public routes.
 * Internal `/platform` (engineering) and console hosts are never linked.
 */
export interface NavLink {
  href: string;
  label: string;
  description?: string;
  status?: "available" | "in_development" | "planned";
}

export interface NavGroup {
  id: string;
  label: string;
  href?: string;
  items: readonly NavLink[];
}

export const PLATFORM_NAV: NavGroup = {
  id: "platform",
  label: "Platform",
  href: "/sherivs",
  items: [
    {
      href: "/sherivs",
      label: "Platform overview",
      description: `${POSITIONING_TAGLINE}.`,
    },
    {
      href: "/product/architecture",
      label: "Architecture",
      description: "The layers of the institutional computing platform.",
    },
    {
      href: "/product/ai-workforce",
      label: "AI workforce",
      description: "Governed agents with permissions, oversight, and usage controls.",
    },
    {
      href: "/product/digital-twins",
      label: "Digital twins",
      description: "Persistent identity, state, relationships, and events.",
    },
    {
      href: "/product/institutional-computing",
      label: "Institutional computing",
      description: "A shared environment for organizational work.",
    },
    {
      href: "/product/intelligence",
      label: "Intelligence infrastructure",
      description: "Model routing and grounded institutional intelligence.",
    },
    {
      href: "/developers",
      label: "Developer platform",
      description: "What developers can use today — without invented SDKs.",
      status: "planned",
    },
  ],
};

export const SOLUTIONS_NAV: NavGroup = {
  id: "solutions",
  label: "Solutions",
  href: "/solutions",
  items: [
    {
      href: "/solutions/education",
      label: "Education",
      description: "Sherivs Scholar — the education runtime available today.",
      status: "available",
    },
    {
      href: "/solutions/enterprise",
      label: "Enterprise",
      description: "The same platform for organizations beyond education.",
      status: "in_development",
    },
    {
      href: "/solutions/research",
      label: "Research and innovation",
      description: "A directional offering for research institutions.",
      status: "planned",
    },
  ],
};

export const TECHNOLOGY_NAV: NavGroup = {
  id: "technology",
  label: "Technology",
  href: "/product/architecture",
  items: [
    { href: "/product/architecture", label: "Architecture" },
    { href: "/security", label: "Security and trust" },
    { href: "/integrations", label: "Integrations" },
    { href: "/docs", label: "Developer documentation" },
  ],
};

export const RESOURCES_NAV: NavGroup = {
  id: "resources",
  label: "Resources",
  href: "/insights",
  items: [
    { href: "/insights", label: "Insights" },
    { href: "/faq", label: "FAQs" },
    { href: "/help", label: "Help center" },
    { href: "/docs", label: "Documentation" },
    { href: "/support", label: "Support" },
    { href: "/status", label: "System status" },
  ],
};

export const COMPANY_NAV: NavGroup = {
  id: "company",
  label: "Company",
  href: "/about",
  items: [
    { href: "/about", label: "About" },
    { href: "/company/vision", label: "Vision and mission" },
    { href: "/company/partners", label: "Partners" },
    { href: "/contact", label: "Contact" },
    { href: "/company/careers", label: "Careers" },
  ],
};

export const TRUST_NAV: NavGroup = {
  id: "trust",
  label: "Trust",
  href: "/trust",
  items: [
    { href: "/security", label: "Security" },
    { href: "/privacy-policy", label: "Privacy" },
    { href: "/trust", label: "Trust center" },
    { href: "/accessibility", label: "Accessibility" },
  ],
};

export const LEGAL_NAV: NavGroup = {
  id: "legal",
  label: "Legal",
  href: "/privacy-policy",
  items: [
    { href: "/privacy-policy", label: "Privacy policy" },
    { href: "/terms", label: "Terms" },
    { href: "/legal/acceptable-use", label: "Acceptable use" },
    { href: "/legal/cookies", label: "Cookie policy" },
    { href: "/legal/contact", label: "Legal contact" },
  ],
};

export const HEADER_GROUPS: readonly NavGroup[] = [
  PLATFORM_NAV,
  SOLUTIONS_NAV,
  TECHNOLOGY_NAV,
  RESOURCES_NAV,
  COMPANY_NAV,
];

export const FOOTER_GROUPS: readonly NavGroup[] = [
  PLATFORM_NAV,
  SOLUTIONS_NAV,
  RESOURCES_NAV,
  COMPANY_NAV,
  TRUST_NAV,
  LEGAL_NAV,
];

/** Primary public sitemap entries (indexable, canonical company site). */
export const PUBLIC_SITEMAP_PATHS: readonly string[] = [
  "/",
  "/sherivs",
  "/product/architecture",
  "/product/ai-workforce",
  "/product/digital-twins",
  "/product/institutional-computing",
  "/product/intelligence",
  "/developers",
  "/docs",
  "/integrations",
  "/solutions",
  "/solutions/education",
  "/solutions/enterprise",
  "/solutions/research",
  "/about",
  "/company/vision",
  "/company/partners",
  "/company/careers",
  "/contact",
  "/request-demo",
  "/insights",
  "/faq",
  "/help",
  "/support",
  "/status",
  "/security",
  "/trust",
  "/privacy-policy",
  "/terms",
  "/legal/contact",
  "/accessibility",
  "/security/disclosure",
];
