/**
 * Canonical hostname contract for Sherivs V1.
 *
 * sherivs.com / www.sherivs.com  — public platform
 * app.sherivs.com                — customer application
 * console.sherivs.com            — protected internal operations
 *
 * Kind name `internal` is architectural. The hostname is console.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_APP_HOST,
  CANONICAL_CONSOLE_HOST,
  CANONICAL_PUBLIC_HOSTS,
  hostnameFromHostHeader,
  resolveExperienceHost,
  shouldRedirectCanonicalRootToAuth,
} from "@/lib/experience/experience-host";
import { resolveIdentityGateway } from "@/lib/identity/identity-gateway";
import { tenantSlugFromHostname } from "@/lib/tenant";
import {
  PLATFORM_OG_IMAGE_PATH,
  PLATFORM_OG_IMAGE_URL,
  PLATFORM_PUBLIC_ORIGIN,
} from "@/lib/platform";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (ref: string) => readFileSync(join(ROOT, ref), "utf8");

describe("canonical hostname constants", () => {
  it("names the four existing production hosts only", () => {
    expect(CANONICAL_PUBLIC_HOSTS).toEqual(["sherivs.com", "www.sherivs.com"]);
    expect(CANONICAL_APP_HOST).toBe("app.sherivs.com");
    expect(CANONICAL_CONSOLE_HOST).toBe("console.sherivs.com");
  });
});

describe("hostnameFromHostHeader", () => {
  it("strips ports, forwarded lists, and case", () => {
    expect(hostnameFromHostHeader("App.Sherivs.com:443")).toBe("app.sherivs.com");
    expect(hostnameFromHostHeader("console.sherivs.com, www.sherivs.com")).toBe(
      "console.sherivs.com",
    );
    expect(hostnameFromHostHeader(null)).toBe("");
    expect(hostnameFromHostHeader(undefined)).toBe("");
  });
});

describe("resolveExperienceHost — four canonical hosts", () => {
  it("classifies public hosts as public_platform (www is not reversed to apex)", () => {
    expect(resolveExperienceHost("sherivs.com")).toBe("public_platform");
    expect(resolveExperienceHost("www.sherivs.com")).toBe("public_platform");
    expect(resolveExperienceHost("WWW.SHERIVS.COM:443")).toBe("public_platform");
  });

  it("classifies the customer application host as app", () => {
    expect(resolveExperienceHost("app.sherivs.com")).toBe("app");
  });

  it("classifies console as internal, never as a tenant slug", () => {
    expect(resolveExperienceHost("console.sherivs.com")).toBe("internal");
    expect(tenantSlugFromHostname("console.sherivs.com")).toBeNull();
  });

  it("keeps the LEGACY internal label as internal so it cannot become a tenant", () => {
    expect(resolveExperienceHost("internal.sherivs.com")).toBe("internal");
    expect(tenantSlugFromHostname("internal.sherivs.com")).toBeNull();
  });

  it("does not use substring matching for protected experiences", () => {
    expect(resolveExperienceHost("notapp.sherivs.com")).toBe("tenant");
    expect(resolveExperienceHost("console.sherivs.com.attacker.example")).toBe("public_platform");
    expect(resolveExperienceHost("app.sherivs.com.attacker.example")).toBe("public_platform");
    expect(resolveExperienceHost("myconsole.sherivs.com")).toBe("tenant");
  });

  it("does not grant protected experiences to unknown or reserved hosts", () => {
    expect(resolveExperienceHost("unknown.example")).toBe("public_platform");
    expect(resolveExperienceHost("api.sherivs.com")).toBe("public_platform");
    expect(resolveExperienceHost("admin.sherivs.com")).toBe("public_platform");
    expect(resolveExperienceHost("dashboard.sherivs.com")).toBe("public_platform");
    expect(resolveExperienceHost("")).toBe("public_platform");
    expect(resolveExperienceHost("localhost")).toBe("local");
  });

  it("treats a genuine organization subdomain as tenant, not console", () => {
    expect(resolveExperienceHost("northwind.sherivs.com")).toBe("tenant");
    expect(tenantSlugFromHostname("northwind.sherivs.com")).toBe("northwind");
  });
});

describe("canonical root redirect", () => {
  it("sends app and console `/` to /auth and leaves public/www on `/`", () => {
    expect(shouldRedirectCanonicalRootToAuth(resolveExperienceHost("app.sherivs.com"))).toBe(true);
    expect(shouldRedirectCanonicalRootToAuth(resolveExperienceHost("console.sherivs.com"))).toBe(
      true,
    );
    expect(shouldRedirectCanonicalRootToAuth(resolveExperienceHost("sherivs.com"))).toBe(false);
    expect(shouldRedirectCanonicalRootToAuth(resolveExperienceHost("www.sherivs.com"))).toBe(false);
    expect(shouldRedirectCanonicalRootToAuth(resolveExperienceHost("northwind.sherivs.com"))).toBe(
      false,
    );
  });

  it("keeps host classification independent of nested paths and query strings", () => {
    expect(resolveExperienceHost("app.sherivs.com")).toBe("app");
    expect(resolveExperienceHost("console.sherivs.com")).toBe("internal");
    const index = read("frontend/src/routes/index.tsx");
    expect(index).toContain("shouldRedirectCanonicalRootToAuth");
    expect(index).toContain('throw redirect({ to: "/auth" })');
    expect(index).toContain("readRequestHostname");
  });
});

describe("identity gateway on canonical hosts", () => {
  it("sends unsigned console visitors to sign-in, not a workspace", () => {
    const decision = resolveIdentityGateway({
      authenticated: false,
      role: null,
      superAdmin: false,
      tenantSlug: tenantSlugFromHostname("console.sherivs.com"),
      hasOrganizationMembership: false,
      installedRuntimeId: null,
      hostKind: resolveExperienceHost("console.sherivs.com"),
    });
    expect(decision.destination).toBe("/auth");
    expect(decision.reason).toBe("internal_signin");
  });

  it("rejects a signed-in org member on the console host", () => {
    const decision = resolveIdentityGateway({
      authenticated: true,
      role: "teacher",
      superAdmin: false,
      tenantSlug: null,
      organizationSlug: "northwind",
      hasOrganizationMembership: true,
      installedRuntimeId: "runtime:scholar",
      hostKind: resolveExperienceHost("console.sherivs.com"),
    });
    expect(decision.destination).toBe("/auth");
    expect(decision.reason).toBe("unauthorized_internal");
  });

  it("sends unsigned app visitors to sign-in", () => {
    const decision = resolveIdentityGateway({
      authenticated: false,
      role: null,
      superAdmin: false,
      tenantSlug: tenantSlugFromHostname("app.sherivs.com"),
      hasOrganizationMembership: false,
      installedRuntimeId: null,
      hostKind: resolveExperienceHost("app.sherivs.com"),
    });
    expect(decision.destination).toBe("/auth");
    expect(decision.reason).toBe("app_signin");
  });

  it("keeps unsigned public/www visitors on the Sherivs public plane", () => {
    for (const host of CANONICAL_PUBLIC_HOSTS) {
      const decision = resolveIdentityGateway({
        authenticated: false,
        role: null,
        superAdmin: false,
        tenantSlug: tenantSlugFromHostname(host),
        hasOrganizationMembership: false,
        installedRuntimeId: null,
        hostKind: resolveExperienceHost(host),
      });
      expect(decision.destination).toBeNull();
      expect(decision.reason).toBe("sherivs_public");
    }
  });
});

describe("public assets and SEO endpoints", () => {
  it("ships the existing Open Graph image and absolute URL", () => {
    expect(PLATFORM_OG_IMAGE_PATH).toBe("/og-image.png");
    expect(PLATFORM_OG_IMAGE_URL).toBe("https://sherivs.com/og-image.png");
    expect(existsSync(join(ROOT, "public/og-image.png"))).toBe(true);
    const root = read("frontend/src/routes/__root.tsx");
    expect(root).toContain("PLATFORM_OG_IMAGE_URL");
    expect(root).not.toMatch(/og:image", content: PLATFORM_OG_IMAGE_PATH/);
  });

  it("registers the existing health and sitemap routes", () => {
    expect(existsSync(join(ROOT, "frontend/src/routes/health[.]json.ts"))).toBe(true);
    expect(existsSync(join(ROOT, "frontend/src/routes/sitemap[.]xml.ts"))).toBe(true);
    const health = read("frontend/src/routes/health[.]json.ts");
    expect(health).toContain('createFileRoute("/health.json")');
    expect(health).toContain("buildHealthReport");
  });

  it("keeps the public sitemap on sherivs.com and excludes private routes", () => {
    const sitemap = read("frontend/src/routes/sitemap[.]xml.ts");
    expect(sitemap).toContain("PLATFORM_PUBLIC_ORIGIN");
    expect(PLATFORM_PUBLIC_ORIGIN).toBe("https://sherivs.com");
    expect(sitemap).toContain('path: "/"');
    expect(sitemap).toContain('path: "/auth"');
    expect(sitemap).not.toContain("/super-admin");
    expect(sitemap).not.toContain("/command-centre");
    expect(sitemap).not.toContain("/o/");
    expect(sitemap).not.toContain("console.sherivs.com");
    expect(sitemap).not.toContain("app.sherivs.com");
  });
});
