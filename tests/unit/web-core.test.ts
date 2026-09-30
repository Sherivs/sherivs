// ─── Phase 23 — Web Platform: web-core tests ─────────────────────────
import { describe, it, expect } from "vitest";
import {
  createWebRouteDefinition,
  createContentSecurityPolicy,
  validateURL,
  sanitizeHTML,
  classifyBrowser,
} from "@/lib/web-core";

describe("web-core — Route Definition", () => {
  it("creates route definition", () => {
    const r = createWebRouteDefinition({
      path: "/academic/grades",
      component: "GradesPage",
      security: "authenticated",
      lazyLoaded: true,
    });
    expect(r.path).toBe("/academic/grades");
    expect(r.security).toBe("authenticated");
    expect(r.lazyLoaded).toBe(true);
  });
  it("rejects missing path", () => {
    expect(() =>
      createWebRouteDefinition({ path: "", component: "X", security: "public" }),
    ).toThrow();
  });
});

describe("web-core — CSP", () => {
  it("creates default CSP", () => {
    const c = createContentSecurityPolicy({});
    expect(c.defaultSrc).toEqual(["'self'"]);
  });
  it("merges custom directives", () => {
    const c = createContentSecurityPolicy({
      scriptSrc: ["'self'", "https://analytics.example.com"],
    });
    expect(c.scriptSrc).toContain("https://analytics.example.com");
  });
});

describe("web-core — URL Validation", () => {
  it("validates HTTPS URL", () => {
    const r = validateURL("https://coregrid.io/dashboard");
    expect(r.valid).toBe(true);
    expect(r.sanitized).toBeTruthy();
  });
  it("rejects invalid URL", () => {
    const r = validateURL("not-a-url");
    expect(r.valid).toBe(false);
  });
  it("rejects HTTP for non-localhost", () => {
    const r = validateURL("http://evil.com");
    expect(r.valid).toBe(false);
  });
  it("allows localhost HTTP", () => {
    const r = validateURL("http://localhost:3000");
    expect(r.valid).toBe(true);
  });
});

describe("web-core — HTML Sanitization", () => {
  it("escapes HTML", () => {
    expect(sanitizeHTML("<script>alert('xss')</script>")).toBe(
      "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;",
    );
  });
});

describe("web-core — Browser Classification", () => {
  it("classifies Chrome", () => {
    const b = classifyBrowser("Mozilla/5.0 Chrome/120");
    expect(b.browser).toBe("chrome");
  });
  it("classifies Firefox", () => {
    const b = classifyBrowser("Mozilla/5.0 Firefox/120");
    expect(b.browser).toBe("firefox");
  });
  it("classifies Safari", () => {
    const b = classifyBrowser("Mozilla/5.0 Safari/605");
    expect(b.browser).toBe("safari");
  });
  it("classifies Edge", () => {
    const b = classifyBrowser("Mozilla/5.0 Edg/120");
    expect(b.browser).toBe("edge");
  });
});
