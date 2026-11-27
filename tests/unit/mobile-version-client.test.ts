import { describe, expect, it, vi } from "vitest";
import {
  compareStrictSemver,
  decideVersionGate,
  fetchMobileVersionConfig,
  normalizeStrictSemver,
} from "../../mobile/src/lib/version/core";

describe("mobile version gate semver rules", () => {
  it("accepts strict stable semver only", () => {
    expect(normalizeStrictSemver("1.2.3")).toBe("1.2.3");
    expect(normalizeStrictSemver(" 1.2.3 ")).toBe("1.2.3");
    expect(normalizeStrictSemver("1.2")).toBeNull();
    expect(normalizeStrictSemver("1.2.3-beta.1")).toBeNull();
    expect(normalizeStrictSemver(null)).toBeNull();
  });

  it("compares strict semver tuples", () => {
    expect(compareStrictSemver("1.2.3", "1.2.3")).toBe(0);
    expect(compareStrictSemver("1.2.3", "1.2.4")).toBe(-1);
    expect(compareStrictSemver("2.0.0", "1.9.9")).toBe(1);
  });

  it("blocks below min, soft-prompts below latest, and no-ops at or above latest", () => {
    expect(
      decideVersionGate("1.0.0", {
        min: "1.1.0",
        latest: "1.3.0",
        storeUrl: "https://apps.example/ios",
      }),
    ).toEqual({ kind: "block", min: "1.1.0", storeUrl: "https://apps.example/ios" });

    expect(
      decideVersionGate("1.2.0", {
        min: "1.1.0",
        latest: "1.3.0",
        storeUrl: "https://apps.example/ios",
      }),
    ).toEqual({ kind: "soft", latest: "1.3.0", storeUrl: "https://apps.example/ios" });

    expect(
      decideVersionGate("1.3.0", {
        min: "1.1.0",
        latest: "1.3.0",
        storeUrl: "https://apps.example/ios",
      }),
    ).toEqual({ kind: "none" });
  });

  it("fails open for malformed versions and invalid https store URLs", () => {
    expect(
      decideVersionGate("1.0.0-beta", {
        min: "1.1.0",
        latest: "1.2.0",
        storeUrl: "https://apps.example/ios",
      }),
    ).toEqual({ kind: "none" });

    expect(
      decideVersionGate("1.0.0", {
        min: "not-semver",
        latest: "also-invalid",
        storeUrl: "javascript:alert(1)",
      }),
    ).toEqual({ kind: "none" });

    expect(
      decideVersionGate("1.0.0", {
        min: "1.0.1",
        latest: "1.2.0",
        storeUrl: "http://insecure.example",
      }),
    ).toEqual({ kind: "block", min: "1.0.1", storeUrl: null });

    expect(
      decideVersionGate("1.0.0", {
        min: "2.0.0",
        latest: "1.0.0",
        storeUrl: "https://apps.example/ios",
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("mobile version gate fetch fail-open behavior", () => {
  it("returns normalized platform config from a valid endpoint response", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ios: { min: "1.1.0", latest: "1.3.0", storeUrl: " https://apps.example/ios " },
            android: { min: "1.0.0", latest: "1.2.0", storeUrl: null },
          }),
          { status: 200 },
        ),
    );

    await expect(
      fetchMobileVersionConfig({
        baseUrl: "https://app.sherivs.com",
        platform: "ios",
        fetchImpl,
      }),
    ).resolves.toEqual({ min: "1.1.0", latest: "1.3.0", storeUrl: "https://apps.example/ios" });
  });

  it("fails open when unreachable, non-200, or non-JSON", async () => {
    const unreachable = vi.fn(async () => {
      throw new Error("network down");
    });
    const notOk = vi.fn(async () => new Response("denied", { status: 503 }));
    const nonJson = vi.fn(async () => new Response("<html>oops</html>", { status: 200 }));

    await expect(
      fetchMobileVersionConfig({
        baseUrl: "https://app.sherivs.com",
        platform: "ios",
        fetchImpl: unreachable,
      }),
    ).resolves.toBeNull();

    await expect(
      fetchMobileVersionConfig({
        baseUrl: "https://app.sherivs.com",
        platform: "ios",
        fetchImpl: notOk,
      }),
    ).resolves.toBeNull();

    await expect(
      fetchMobileVersionConfig({
        baseUrl: "https://app.sherivs.com",
        platform: "ios",
        fetchImpl: nonJson,
      }),
    ).resolves.toBeNull();
  });
});
