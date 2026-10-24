/**
 * Tenant host resolution unit tests (Plane B custom domains).
 *
 * Covers the pure host classifier and the window-dependent resolution entry
 * points that feed organization lookup (slug subdomains vs registered
 * custom domains vs platform hosts).
 */
import { afterEach, describe, expect, it } from "vitest";
import { classifyTenantHost, resolveTenantDomain, resolveTenantSlug } from "@/lib/tenant";

const ORIGINAL_WINDOW = globalThis.window;

function withLocation(href: string) {
  // The resolvers only read window.location.href; a minimal stub is enough.
  (globalThis as { window?: unknown }).window = { location: new URL(href) };
}

afterEach(() => {
  (globalThis as { window?: unknown }).window = ORIGINAL_WINDOW;
});

describe("classifyTenantHost", () => {
  it("classifies platform hosts as platform", () => {
    expect(classifyTenantHost("sherivs.com")).toEqual({ kind: "platform" });
    expect(classifyTenantHost("www.sherivs.com")).toEqual({ kind: "platform" });
    expect(classifyTenantHost("app.sherivs.com")).toEqual({ kind: "platform" });
    expect(classifyTenantHost("console.sherivs.com")).toEqual({ kind: "platform" });
    expect(classifyTenantHost("internal.sherivs.com")).toEqual({ kind: "platform" });
    expect(classifyTenantHost("localhost")).toEqual({ kind: "platform" });
    expect(classifyTenantHost("127.0.0.1")).toEqual({ kind: "platform" });
    expect(classifyTenantHost("app.universalschoolos.com")).toEqual({ kind: "platform" });
  });

  it("is case-insensitive for platform hosts", () => {
    expect(classifyTenantHost("SHERIVS.COM")).toEqual({ kind: "platform" });
    expect(classifyTenantHost("App.Sherivs.Com")).toEqual({ kind: "platform" });
  });

  it("classifies bare IP addresses and IPv6 loopback as platform", () => {
    expect(classifyTenantHost("192.168.1.4")).toEqual({ kind: "platform" });
    expect(classifyTenantHost("[::1]")).toEqual({ kind: "platform" });
  });

  it("classifies reserved subdomains of platform roots as platform", () => {
    for (const sub of ["www", "app", "api", "admin", "dashboard", "console", "internal", "gov"]) {
      expect(classifyTenantHost(`${sub}.sherivs.com`)).toEqual({ kind: "platform" });
    }
  });

  it("never treats government console hosts as school tenants (SHERIVS-029)", () => {
    expect(classifyTenantHost("gov.sherivs.com")).toEqual({ kind: "platform" });
    expect(classifyTenantHost("borno.gov.sherivs.com")).toEqual({ kind: "platform" });
    expect(classifyTenantHost("console.unimaid.sherivs.com")).toEqual({ kind: "platform" });
  });

  it("does not treat generated Vercel hosts as organization slugs", () => {
    expect(classifyTenantHost("coregrid-scholar-migration-abc.vercel.app")).toEqual({
      kind: "platform",
    });
    expect(classifyTenantHost("preview.vercel.sh")).toEqual({ kind: "platform" });
  });

  it("classifies a first subdomain label as a tenant slug", () => {
    expect(classifyTenantHost("acme.sherivs.com")).toEqual({ kind: "subdomain", slug: "acme" });
    expect(classifyTenantHost("lincoln.universalschoolos.com")).toEqual({
      kind: "subdomain",
      slug: "lincoln",
    });
    // Outside the platform roots a multi-label host is the school's own domain, not a slug.
    expect(classifyTenantHost("acme.example.com")).toEqual({ kind: "custom-domain", domain: "acme.example.com" });
  });

  it("classifies Nigerian school domains as custom domains, never as bogus slugs (SHERIVS-029)", () => {
    expect(classifyTenantHost("portal.kingsschool.sch.ng")).toEqual({ kind: "custom-domain", domain: "portal.kingsschool.sch.ng" });
    expect(classifyTenantHost("kingsschool.sch.ng")).toEqual({ kind: "custom-domain", domain: "kingsschool.sch.ng" });
    expect(classifyTenantHost("unimaid.edu.ng")).toEqual({ kind: "custom-domain", domain: "unimaid.edu.ng" });
    expect(classifyTenantHost("portal.unimaid.edu.ng")).toEqual({ kind: "custom-domain", domain: "portal.unimaid.edu.ng" });
    expect(classifyTenantHost("www.kingsschool.com.ng")).toEqual({ kind: "custom-domain", domain: "www.kingsschool.com.ng" });
    expect(classifyTenantHost("PORTAL.KingsSchool.SCH.NG")).toEqual({ kind: "custom-domain", domain: "portal.kingsschool.sch.ng" });
  });

  it("classifies non-subdomain hostnames as tenant custom domains", () => {
    expect(classifyTenantHost("organization-domain.com")).toEqual({
      kind: "custom-domain",
      domain: "organization-domain.com",
    });
    expect(classifyTenantHost("lincolnacademy.org")).toEqual({
      kind: "custom-domain",
      domain: "lincolnacademy.org",
    });
  });
});

describe("resolveTenantSlug", () => {
  it("returns null on the server (no window)", () => {
    (globalThis as { window?: unknown }).window = undefined;
    expect(resolveTenantSlug()).toBeNull();
  });

  it("prefers the ?school= query parameter", () => {
    withLocation("https://acme.sherivs.com/?school=lincoln");
    expect(resolveTenantSlug()).toBe("lincoln");
  });

  it("returns the subdomain slug when present", () => {
    withLocation("https://acme.sherivs.com/dashboard");
    expect(resolveTenantSlug()).toBe("acme");
  });

  it("returns null on platform hosts and custom domains", () => {
    withLocation("https://sherivs.com/");
    expect(resolveTenantSlug()).toBeNull();
    withLocation("https://console.sherivs.com/");
    expect(resolveTenantSlug()).toBeNull();
    withLocation("https://app.sherivs.com/");
    expect(resolveTenantSlug()).toBeNull();
    withLocation("https://organization-domain.com/");
    expect(resolveTenantSlug()).toBeNull();
  });
});

describe("resolveTenantDomain", () => {
  it("returns null on the server (no window)", () => {
    (globalThis as { window?: unknown }).window = undefined;
    expect(resolveTenantDomain()).toBeNull();
  });

  it("returns the hostname for a tenant custom domain", () => {
    withLocation("https://organization-domain.com/");
    expect(resolveTenantDomain()).toBe("organization-domain.com");
  });

  it("returns null on platform hosts and slug subdomains", () => {
    withLocation("https://sherivs.com/");
    expect(resolveTenantDomain()).toBeNull();
    withLocation("https://acme.sherivs.com/");
    expect(resolveTenantDomain()).toBeNull();
  });

  it("returns null when a school query parameter is present", () => {
    withLocation("https://organization-domain.com/?school=lincoln");
    expect(resolveTenantDomain()).toBeNull();
  });
});
