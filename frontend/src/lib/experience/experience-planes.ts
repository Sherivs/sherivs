/**
 * Sherivs — experience-plane lock (ACTIVE-V1).
 *
 * Every surface belongs to exactly one primary plane. This module is the
 * executable lock consumed by routing and the identity gateway. It does not
 * render UI and does not un-freeze V2/V3.
 *
 * Planes:
 *   A public_sherivs          — sherivs.com company/platform
 *   B public_organization     — customer organization's public presence
 *   C organization_workspace  — member operational workspace (+ domain runtime)
 *   D sherivs_internal        — Sherivs employees, Jarvis, control plane
 */
export const EXPERIENCE_PLANES = [
  "public_sherivs",
  "public_organization",
  "organization_workspace",
  "sherivs_internal",
] as const;

export type ExperiencePlane = (typeof EXPERIENCE_PLANES)[number];

export const EXPERIENCE_PLANE_A = "public_sherivs" as const;
export const EXPERIENCE_PLANE_B = "public_organization" as const;
export const EXPERIENCE_PLANE_C = "organization_workspace" as const;
export const EXPERIENCE_PLANE_D = "sherivs_internal" as const;

export interface ExperienceSurfaceClassification {
  readonly path: string;
  readonly plane: ExperiencePlane;
  readonly runtime: "none" | "scholar" | "platform";
  readonly public: boolean;
  readonly legacyPath?: string;
}

const PREFIX_RULES: readonly {
  readonly prefix: string;
  readonly plane: ExperiencePlane;
  readonly runtime: ExperienceSurfaceClassification["runtime"];
  readonly public: boolean;
}[] = [
  { prefix: "/super-admin", plane: "sherivs_internal", runtime: "platform", public: false },
  { prefix: "/command-centre", plane: "sherivs_internal", runtime: "platform", public: false },
  { prefix: "/super-admin-bootstrap", plane: "sherivs_internal", runtime: "platform", public: true },
  { prefix: "/admin", plane: "organization_workspace", runtime: "scholar", public: false },
  { prefix: "/teacher", plane: "organization_workspace", runtime: "scholar", public: false },
  { prefix: "/student", plane: "organization_workspace", runtime: "scholar", public: false },
  { prefix: "/parent", plane: "organization_workspace", runtime: "scholar", public: false },
  { prefix: "/bursar", plane: "organization_workspace", runtime: "scholar", public: false },
  { prefix: "/hq", plane: "organization_workspace", runtime: "scholar", public: false },
  { prefix: "/driver", plane: "organization_workspace", runtime: "scholar", public: false },
  { prefix: "/messages", plane: "organization_workspace", runtime: "platform", public: false },
  { prefix: "/notifications", plane: "organization_workspace", runtime: "platform", public: false },
  { prefix: "/settings", plane: "organization_workspace", runtime: "platform", public: false },
  { prefix: "/runtime", plane: "organization_workspace", runtime: "platform", public: false },
  { prefix: "/onboarding", plane: "public_sherivs", runtime: "none", public: true },
  { prefix: "/internal", plane: "sherivs_internal", runtime: "platform", public: false },
  { prefix: "/platform/org", plane: "sherivs_internal", runtime: "platform", public: true },
  { prefix: "/foundation-loop", plane: "sherivs_internal", runtime: "platform", public: false },
  { prefix: "/scholar-foundation-loop", plane: "organization_workspace", runtime: "scholar", public: false },
  { prefix: "/reality", plane: "public_sherivs", runtime: "platform", public: true },
  { prefix: "/admissions", plane: "public_organization", runtime: "scholar", public: true },
  { prefix: "/blog", plane: "public_organization", runtime: "scholar", public: true },
  { prefix: "/news", plane: "public_organization", runtime: "scholar", public: true },
  { prefix: "/events", plane: "public_organization", runtime: "scholar", public: true },
  { prefix: "/privacy", plane: "public_organization", runtime: "scholar", public: true },
  { prefix: "/rules", plane: "public_organization", runtime: "scholar", public: true },
  { prefix: "/auth", plane: "public_sherivs", runtime: "none", public: true },
  { prefix: "/login", plane: "public_sherivs", runtime: "none", public: true },
  { prefix: "/signin", plane: "public_sherivs", runtime: "none", public: true },
  { prefix: "/reset-password", plane: "public_sherivs", runtime: "none", public: true },
  { prefix: "/platform", plane: "public_sherivs", runtime: "platform", public: true },
  { prefix: "/marketplace", plane: "public_sherivs", runtime: "platform", public: true },
  { prefix: "/coregrid", plane: "public_sherivs", runtime: "none", public: true },
];

const EXACT_RULES: Readonly<Record<string, ExperienceSurfaceClassification>> = {
  "/": {
    path: "/",
    plane: "public_sherivs",
    runtime: "none",
    public: true,
  },
  "/health.json": {
    path: "/health.json",
    plane: "public_sherivs",
    runtime: "platform",
    public: true,
  },
  "/sitemap.xml": {
    path: "/sitemap.xml",
    plane: "public_sherivs",
    runtime: "platform",
    public: true,
  },
  "/manifest.webmanifest": {
    path: "/manifest.webmanifest",
    plane: "public_sherivs",
    runtime: "platform",
    public: true,
  },
};

/**
 * Classify a URL path onto exactly one experience plane.
 * Tenant host `/` is Plane B at runtime (host + tenant slug), not from the
 * path alone — callers pass `tenantPublicHome` when the request is a tenant site.
 */
export function classifyExperiencePath(
  path: string,
  options: { readonly tenantPublicHome?: boolean } = {},
): ExperienceSurfaceClassification {
  const normalized = path.split("?")[0]?.split("#")[0] || "/";
  if (normalized === "/" && options.tenantPublicHome) {
    return {
      path: "/",
      plane: "public_organization",
      runtime: "scholar",
      public: true,
    };
  }
  const exact = EXACT_RULES[normalized];
  if (exact) return exact;
  const orgBound = normalized.match(/^\/o\/[a-z0-9][a-z0-9-]{1,47}(?:\/(.*))?$/);
  if (orgBound) {
    const rest = orgBound[1] ?? "";
    const scholar = rest === "scholar" || rest.startsWith("scholar/");
    return {
      path: normalized,
      plane: "organization_workspace",
      runtime: scholar ? "scholar" : "platform",
      public: false,
    };
  }
  for (const rule of PREFIX_RULES) {
    if (normalized === rule.prefix || normalized.startsWith(`${rule.prefix}/`)) {
      return {
        path: normalized,
        plane: rule.plane,
        runtime: rule.runtime,
        public: rule.public,
        legacyPath:
          rule.prefix === "/coregrid" ||
          [
            "/admin",
            "/teacher",
            "/student",
            "/parent",
            "/bursar",
            "/hq",
            "/driver",
          ].includes(rule.prefix)
            ? rule.prefix
            : undefined,
      };
    }
  }
  return {
    path: normalized,
    plane: "public_sherivs",
    runtime: "none",
    public: true,
  };
}

export function assertSingleExperiencePlane(path: string): ExperiencePlane {
  return classifyExperiencePath(path).plane;
}
