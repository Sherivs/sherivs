// ─── Phase 22 — Mobile Platform: platform-core ───────────────────────
import { describe, it, expect } from "vitest";
import {
  createLaunchContext,
  getBreakpoint,
  classifyConnectivity,
  createApiRequest,
  createDeepLinkHandler,
  validateNavigationRoute,
  type ClientState,
} from "@/lib/platform-core";

describe("platform-core — Launch Context", () => {
  it("creates launch context from user source", () => {
    const ctx = createLaunchContext({ source: "user" });
    expect(ctx.source).toBe("user");
    expect(ctx.deepLink).toBeNull();
    expect(ctx.timestamp).toBeTruthy();
  });

  it("creates launch context from deep link with payload", () => {
    const ctx = createLaunchContext({
      source: "deep_link",
      deepLink: "coregrid://academic/grades",
      notificationPayload: { gradeId: "123" },
    });
    expect(ctx.deepLink).toBe("coregrid://academic/grades");
  });
});

describe("platform-core — Breakpoints", () => {
  it("returns xs for small screens", () => {
    expect(getBreakpoint(300)).toBe("xs");
  });
  it("returns sm for medium-small screens", () => {
    expect(getBreakpoint(600)).toBe("sm");
  });
  it("returns md for medium screens", () => {
    expect(getBreakpoint(800)).toBe("md");
  });
  it("returns lg for large screens", () => {
    expect(getBreakpoint(1000)).toBe("lg");
  });
  it("returns xl for extra-large screens", () => {
    expect(getBreakpoint(1300)).toBe("xl");
  });
  it("returns xxl for very large screens", () => {
    expect(getBreakpoint(1500)).toBe("xxl");
  });
});

describe("platform-core — Connectivity Classification", () => {
  it("returns none when offline", () => {
    expect(classifyConnectivity(false, 0)).toBe("none");
  });
  it("returns good when online and low latency", () => {
    expect(classifyConnectivity(true, 50)).toBe("good");
  });
  it("returns fair when online and medium latency", () => {
    expect(classifyConnectivity(true, 200)).toBe("fair");
  });
  it("returns poor when online and high latency", () => {
    expect(classifyConnectivity(true, 1000)).toBe("poor");
  });
});

describe("platform-core — API Request", () => {
  it("creates authenticated API request", () => {
    const req = createApiRequest({ method: "GET", path: "/api/v1/academic/grades" });
    expect(req.method).toBe("GET");
    expect(req.requiresAuth).toBe(true);
    expect(req.timeout).toBe(30000);
  });

  it("rejects empty path", () => {
    expect(() => createApiRequest({ method: "GET", path: "" })).toThrow();
  });

  it("creates POST request with body", () => {
    const req = createApiRequest({
      method: "POST",
      path: "/api/v1/communication/message",
      body: { text: "Hello" },
      idempotencyKey: "idem-123",
    });
    expect(req.idempotencyKey).toBe("idem-123");
    expect(req.body).toEqual({ text: "Hello" });
  });
});

describe("platform-core — Deep Link Handler", () => {
  it("creates deep link handler", () => {
    const h = createDeepLinkHandler({
      scheme: "coregrid",
      pathPattern: "/academic/:id",
      targetRoute: "academic",
    });
    expect(h.scheme).toBe("coregrid");
    expect(h.requiresAuth).toBe(true);
  });

  it("rejects missing scheme", () => {
    expect(() =>
      createDeepLinkHandler({ scheme: "", pathPattern: "/test", targetRoute: "settings" }),
    ).toThrow();
  });
});

describe("platform-core — Navigation Route Validation", () => {
  it("validates known route", () => {
    expect(validateNavigationRoute("academic")).toBe("academic");
  });
  it("rejects unknown route", () => {
    expect(validateNavigationRoute("invalid_route")).toBeNull();
  });
});
