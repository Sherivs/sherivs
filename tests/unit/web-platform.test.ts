import { describe, it, expect } from "vitest";
import {
  createAccessibilityConfig,
  createErrorBoundary,
  createErrorPage,
  checkARIACompliance,
} from "@/lib/web-platform";
import {
  createServiceWorkerConfig,
  createPWAWebManifest,
  queueOfflineAction,
  resolveConflict,
  checkFileUpload,
  checkWebPermission,
} from "@/lib/web-storage";
import {
  evaluateCoreWebVital,
  checkPerformanceBudget,
  createSEOConfig,
  createBundleOptimization,
  createCDNConfig,
} from "@/lib/web-performance";

describe("web-platform — Accessibility", () => {
  it("creates AA config by default", () => {
    const a = createAccessibilityConfig();
    expect(a.wcagLevel).toBe("AA");
  });
  it("creates AAA config", () => {
    const a = createAccessibilityConfig("AAA");
    expect(a.wcagLevel).toBe("AAA");
  });
});

describe("web-platform — Error Boundaries", () => {
  it("creates error boundary", () => {
    const e = createErrorBoundary({
      id: "eb-1",
      componentName: "DashboardPage",
      fallbackComponent: "ErrorScreen",
    });
    expect(e.logErrors).toBe(true);
    expect(e.showStackTrace).toBe(false);
  });
  it("rejects missing id", () => {
    expect(() =>
      createErrorBoundary({ id: "", componentName: "X", fallbackComponent: "Y" }),
    ).toThrow();
  });
});

describe("web-platform — Error Pages", () => {
  it("creates 404 page", () => {
    const p = createErrorPage(404);
    expect(p.title).toBe("Page Not Found");
  });
  it("creates 403 page", () => {
    const p = createErrorPage(403);
    expect(p.title).toBe("Access Denied");
  });
  it("creates 500 page with retry", () => {
    const p = createErrorPage(500);
    expect(p.showRetryButton).toBe(true);
  });
  it("creates generic error for unknown code", () => {
    const p = createErrorPage(418);
    expect(p.title).toBe("Error");
  });
});

describe("web-platform — ARIA Compliance", () => {
  it("reports no violations when all compliant", () => {
    const r = checkARIACompliance({ "role=button": true, "role=navigation": true });
    expect(r.compliant).toBe(true);
  });
  it("reports violations when roles missing", () => {
    const r = checkARIACompliance({ "role=button": true, "role=alert": false });
    expect(r.compliant).toBe(false);
    expect(r.violations).toContain("role=alert");
  });
});

describe("web-storage — Service Worker", () => {
  it("creates SW config", () => {
    const sw = createServiceWorkerConfig({
      scope: "/",
      cacheName: "coregrid-v1",
      precacheUrls: ["/index.html", "/app.js"],
    });
    expect(sw.skipWaiting).toBe(true);
    expect(sw.cacheName).toBe("coregrid-v1");
  });
  it("rejects missing scope", () => {
    expect(() =>
      createServiceWorkerConfig({ scope: "", cacheName: "x", precacheUrls: [] }),
    ).toThrow();
  });
});

describe("web-storage — PWA Manifest", () => {
  it("creates manifest", () => {
    const m = createPWAWebManifest({
      name: "CoreGrid",
      shortName: "CoreGrid",
      description: "Education OS",
      startUrl: "/",
      icons: [{ src: "/icon.png", sizes: "192x192", type: "image/png" }],
      themeColor: "#000",
      backgroundColor: "#fff",
    });
    expect(m.display).toBe("standalone");
  });
});

describe("web-storage — Offline Queue", () => {
  it("queues offline action", () => {
    const a = queueOfflineAction({
      entityType: "grade",
      entityId: "g-1",
      operation: "update",
      payload: { score: 90 },
    });
    expect(a.retryCount).toBe(0);
  });
  it("resolves conflict", () => {
    const c = resolveConflict({
      entityId: "g-1",
      localVersion: 2,
      serverVersion: 3,
      localData: { score: 90 },
      serverData: { score: 85 },
      resolution: "server_wins",
    });
    expect(c.resolvedAt).toBeTruthy();
  });
});

describe("web-storage — File Upload", () => {
  it("validates file size", () => {
    const r = checkFileUpload(
      { size: 11_000_000, type: "image/png" },
      {
        maxFileSize: 10_000_000,
        allowedMimeTypes: [],
        chunkSize: 1024,
        parallelUploads: 1,
        resumeSupported: false,
        clientSideEncryption: false,
      },
    );
    expect(r.valid).toBe(false);
  });
  it("validates file type", () => {
    const r = checkFileUpload(
      { size: 1000, type: "text/html" },
      {
        maxFileSize: 10_000_000,
        allowedMimeTypes: ["image/png", "application/pdf"],
        chunkSize: 1024,
        parallelUploads: 1,
        resumeSupported: false,
        clientSideEncryption: false,
      },
    );
    expect(r.valid).toBe(false);
  });
  it("accepts valid file", () => {
    const r = checkFileUpload(
      { size: 1000, type: "image/png" },
      {
        maxFileSize: 10_000_000,
        allowedMimeTypes: ["image/png", "application/pdf"],
        chunkSize: 1024,
        parallelUploads: 1,
        resumeSupported: false,
        clientSideEncryption: false,
      },
    );
    expect(r.valid).toBe(true);
  });
});

describe("web-storage — Permission Check", () => {
  it("returns granted status", () => {
    const p = checkWebPermission("notifications", "granted");
    expect(p.status).toBe("granted");
  });
  it("returns fallback for unknown", () => {
    const p = checkWebPermission("geolocation", "unknown");
    expect(p.status).toBe("not_supported");
  });
});

describe("web-performance — Core Web Vitals", () => {
  it("evaluates good LCP", () => {
    const m = evaluateCoreWebVital("lcp", 1500);
    expect(m.rating).toBe("good");
  });
  it("evaluates poor LCP", () => {
    const m = evaluateCoreWebVital("lcp", 5000);
    expect(m.rating).toBe("poor");
  });
  it("evaluates needs_improvement CLS", () => {
    const m = evaluateCoreWebVital("cls", 0.15);
    expect(m.rating).toBe("needs_improvement");
  });
});

describe("web-performance — Budget Check", () => {
  it("passes when under budget", () => {
    const r = checkPerformanceBudget(
      {
        maxBundleSizeKB: 500,
        maxInitialLoadKB: 200,
        maxLCP: 2500,
        maxFID: 100,
        maxCLS: 0.1,
        maxTTFB: 800,
        maxImageSizeKB: 200,
        maxFontSizeKB: 50,
      },
      { bundleKB: 300, initialKB: 150 },
    );
    expect(r.pass).toBe(true);
  });
  it("fails when over budget", () => {
    const r = checkPerformanceBudget(
      {
        maxBundleSizeKB: 500,
        maxInitialLoadKB: 200,
        maxLCP: 2500,
        maxFID: 100,
        maxCLS: 0.1,
        maxTTFB: 800,
        maxImageSizeKB: 200,
        maxFontSizeKB: 50,
      },
      { bundleKB: 600, initialKB: 100 },
    );
    expect(r.pass).toBe(false);
  });
});

describe("web-performance — Config Creation", () => {
  it("creates SEO config", () => {
    const s = createSEOConfig({
      titleTemplate: "%s — CoreGrid",
      defaultDescription: "Education OS",
      canonicalUrl: "https://coregrid.io",
    });
    expect(s.robotsTxt).toBe(true);
  });
  it("creates bundle optimization defaults", () => {
    const b = createBundleOptimization();
    expect(b.compression).toBe("brotli");
  });
  it("creates CDN config", () => {
    const c = createCDNConfig({
      provider: "cloudflare",
      regions: ["us-east", "eu-west"],
      cacheTTL: 3600,
    });
    expect(c.ddosProtection).toBe(true);
  });
});
