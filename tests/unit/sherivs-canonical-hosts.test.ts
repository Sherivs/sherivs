/**
 * Canonical hostname contract for Sherivs V1 (ACTIVE-V1).
 *
 * sherivs.com / www.sherivs.com  — public platform
 * app.sherivs.com                — customer application
 * console.sherivs.com            — protected internal operations
 *
 * Kind name `internal` is architectural. The hostname is console.
 * Hostname classification must not grant authorization.
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
  isVercelPlatformHostname,
  resolveExperienceHost,
  shouldRedirectCanonicalRootToAuth,
} from "@/lib/experience/experience-host";
import { identityFromAppState } from "@/lib/identity/context";
import { SHERIVS_INTERNAL_HOME, UNLINKED_ACCOUNT_PATH } from "@/lib/identity/identity";
import { classifyTenantHost, tenantSlugFromHostname } from "@/lib/tenant";
import { PLATFORM_URL } from "@/lib/platform";

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
    expect(hostnameFromHostHeader("[::1]")).toBe("[::1]");
    expect(hostnameFromHostHeader("[::1]:443")).toBe("[::1]");
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
    expect(classifyTenantHost("console.sherivs.com")).toEqual({ kind: "platform" });
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

  it("classifies generated Vercel preview hosts as local, never as tenant slugs", () => {
    const unique = "coregrid-scholar-migration-cepnexfsm-vibeora.vercel.app";
    const gitAlias = "coregrid-scholar-migration-git-cursor-sherivs-ca-130d21-vibeora.vercel.app";
    for (const host of [unique, gitAlias, "preview.vercel.sh"]) {
      expect(isVercelPlatformHostname(host)).toBe(true);
      expect(resolveExperienceHost(host)).toBe("local");
      expect(tenantSlugFromHostname(host)).toBeNull();
      expect(shouldRedirectCanonicalRootToAuth(resolveExperienceHost(host))).toBe(false);
    }
    expect(isVercelPlatformHostname("northwind.sherivs.com")).toBe(false);
    expect(isVercelPlatformHostname("sherivs.com")).toBe(false);
    expect(isVercelPlatformHostname("vercel.app.attacker.example")).toBe(false);
  });
});

describe("Vercel SSR output wiring", () => {
  it("registers the Nitro Vite plugin required for .vercel/output/functions", () => {
    const vite = read("vite.config.ts");
    expect(vite).toContain('from "nitro/vite"');
    expect(vite).toMatch(/\bnitro\s*\(/);
  });

  it("keeps the TanStack Start security patch pin", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@tanstack/react-start"]).toBe("^1.168.60");
    expect(pkg.dependencies["@tanstack/react-router"]).toBe("^1.170.41");
  });
});

describe("canonical root redirect", () => {
  it("classifies app and console as hosts that must not SSR the public homepage", () => {
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
    expect(index).toContain("isRetiredApplicationHostname");
    expect(index).toContain("ApplicationUnavailable");
    expect(index).toContain("AppEntryScreen");
    expect(index).toContain("<SherivsHome />");
    expect(index).toContain("readRequestHostname");
  });
});

describe("authorization is independent of hostname classification", () => {
  it("does not treat console as an organization slug that could leak tenant lookup", () => {
    expect(tenantSlugFromHostname("console.sherivs.com")).toBeNull();
    expect(tenantSlugFromHostname("app.sherivs.com")).toBeNull();
    expect(tenantSlugFromHostname("www.sherivs.com")).toBeNull();
  });

  it("does not grant the internal workforce destination from hostname alone", () => {
    const unlinked = identityFromAppState({
      superAdmin: null,
      profile: null,
      school: null,
    });
    expect(unlinked.kind).toBe("unlinked");
    expect(unlinked.destination).toBe(UNLINKED_ACCOUNT_PATH);
    expect(unlinked.destination).not.toBe(SHERIVS_INTERNAL_HOME);
  });

  it("still requires a super-admin profile for the internal operating environment", () => {
    const internal = identityFromAppState({
      superAdmin: { id: "sa-1", full_name: "Operator", email: "ops@sherivs.com" },
      profile: null,
      school: null,
    });
    expect(internal.kind).toBe("sherivs_internal");
    expect(internal.destination).toBe(SHERIVS_INTERNAL_HOME);
  });

  it("does not ship hardcoded internal console or super-admin shells", () => {
    expect(existsSync(join(ROOT, "frontend/src/routes/_authenticated/internal.tsx"))).toBe(false);
    expect(existsSync(join(ROOT, "frontend/src/routes/_authenticated/super-admin/route.tsx"))).toBe(
      false,
    );
    expect(existsSync(join(ROOT, "frontend/src/routes/_authenticated/route.tsx"))).toBe(false);
  });
});

describe("public assets and SEO endpoints", () => {
  it("keeps the existing Open Graph absolute URL on the root document", () => {
    const root = read("frontend/src/routes/__root.tsx");
    expect(root).toContain("https://sherivs.com/og-image.png");
    expect(PLATFORM_URL).toBe("https://sherivs.com");
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
    expect(sitemap).toContain('const BASE_URL = "https://sherivs.com"');
    expect(sitemap).toContain('path: "/"');
    expect(sitemap).toContain('path: "/auth"');
    expect(sitemap).not.toContain("/super-admin");
    expect(sitemap).not.toContain("/command-centre");
    expect(sitemap).not.toContain("console.sherivs.com");
    expect(sitemap).not.toContain("app.sherivs.com");
  });
});
