/** SHERIVS-B01: head console host parsing and MFA return path. */
import { afterEach, describe, expect, it } from "vitest";
import { headConsoleSlug, headConsoleSlugFromHost, rememberMfaReturn, takeMfaReturn } from "@/lib/head-console/host";
import { classifyTenantHost } from "@/lib/tenant";

describe("headConsoleSlugFromHost", () => {
  it("reads console.<inst>.sherivs.com only", () => {
    expect(headConsoleSlugFromHost("console.unimaid.sherivs.com")).toBe("unimaid");
    expect(headConsoleSlugFromHost("CONSOLE.Unimaid.Sherivs.com:443")).toBe("unimaid");
    expect(headConsoleSlugFromHost("console.sherivs.com")).toBeNull();
    expect(headConsoleSlugFromHost("console.app.sherivs.com")).toBeNull();
    expect(headConsoleSlugFromHost("console.unimaid.sherivs.com.evil.com")).toBeNull();
    expect(headConsoleSlugFromHost("unimaid.console.sherivs.com")).toBeNull();
    expect(headConsoleSlugFromHost("console.unimaid.edu.ng")).toBeNull();
  });
  it("is never a school tenant slug", () => {
    expect(classifyTenantHost("console.unimaid.sherivs.com")).toEqual({ kind: "platform" });
  });
  it("accepts ?inst= only on local / preview hosts", () => {
    expect(headConsoleSlug({ hostname: "localhost", search: "?inst=unimaid" })).toBe("unimaid");
    expect(headConsoleSlug({ hostname: "x.vercel.app", search: "?inst=unimaid" })).toBe("unimaid");
    expect(headConsoleSlug({ hostname: "app.sherivs.com", search: "?inst=unimaid" })).toBeNull();
  });
});

describe("MFA return path", () => {
  const store: Record<string, string> = {};
  (globalThis as { sessionStorage?: unknown }).sessionStorage = {
    getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; },
  };
  afterEach(() => { for (const k of Object.keys(store)) delete store[k]; });
  it("returns to a same-origin path once, rejects protocol-relative", () => {
    rememberMfaReturn("/head?inst=x");
    expect(takeMfaReturn("/internal")).toBe("/head?inst=x");
    expect(takeMfaReturn("/internal")).toBe("/internal");
    rememberMfaReturn("//evil.com");
    expect(takeMfaReturn("/internal")).toBe("/internal");
  });
});
