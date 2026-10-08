/**
 * Sherivs public experience registry (V1).
 *
 * Single source of truth for public navigation, footer columns, legal and
 * resource links. EVERY entry must resolve to a real route or a real anchor
 * on a real route — fabricated destinations are a defect. Add an entry only
 * when the target surface exists and is reachable.
 */

export interface PublicLink {
  label: string;
  to: string;
}

export interface PublicColumn {
  heading: string;
  links: readonly PublicLink[];
}

export const SHERIVS_PRIMARY_NAV: readonly PublicLink[] = [
  { label: "Platform", to: "/platform" },
  { label: "Solutions", to: "/solutions/education" },
  { label: "Security", to: "/security" },
  { label: "Enterprise", to: "/enterprise" },
  { label: "Pricing", to: "/pricing" },
  { label: "Resources", to: "/resources" },
];

export const SHERIVS_FOOTER_COLUMNS: readonly PublicColumn[] = [
  {
    heading: "Platform",
    links: [
      { label: "Overview", to: "/sherivs" },
      { label: "Kernel capabilities", to: "/platform#capabilities" },
      { label: "Domain runtimes", to: "/platform#runtimes" },
      { label: "Governance", to: "/security" },
    ],
  },
  {
    heading: "Solutions",
    links: [
      { label: "Education", to: "/solutions/education" },
      { label: "Enterprise", to: "/enterprise" },
      { label: "Organizations", to: "/solutions/education" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Blog", to: "/blog" },
      { label: "Documentation", to: "/resources" },
      { label: "Platform status", to: "/status" },
      { label: "Request a demo", to: "/request-demo" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", to: "/about" },
      { label: "Contact", to: "/contact" },
      { label: "Sign in", to: "/auth" },
      { label: "Create account", to: "/auth" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy", to: "/legal/privacy" },
      { label: "Terms", to: "/legal/terms" },
      { label: "Cookies", to: "/legal/cookies" },
      { label: "Accessibility", to: "/legal/accessibility" },
    ],
  },
];

/**
 * Social profiles are intentionally absent: Sherivs has no verified public
 * social accounts in V1, and the experience program forbids fabricating
 * them. Add this registry entry only when a real account exists.
 */
export const SHERIVS_SOCIAL_LINKS: readonly PublicLink[] = [];
