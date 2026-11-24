import { describe, expect, it } from "vitest";
import { apexRedirectLocation } from "../../frontend/src/lib/http/apex-redirect";
import { serveFetch } from "../../frontend/src/server";

describe("apex host redirects", () => {
  it("redirects apex requests and preserves their path and query", () => {
    expect(apexRedirectLocation(new Request("https://sherivs.com/"))).toBe(
      "https://www.sherivs.com/",
    );
    expect(apexRedirectLocation(new Request("https://sherivs.com/fees?x=1"))).toBe(
      "https://www.sherivs.com/fees?x=1",
    );
    expect(apexRedirectLocation(new Request("https://sherivs.ng/fees?x=1"))).toBe(
      "https://www.sherivs.ng/fees?x=1",
    );
  });

  it("handles normalized hostnames and redirects normalized dot-segment paths", () => {
    expect(apexRedirectLocation(new Request("https://SHERIVS.COM./fees"))).toBe(
      "https://www.sherivs.com/fees",
    );
    expect(apexRedirectLocation(new Request("https://sherivs.com/.well-known/../fees"))).toBe(
      "https://www.sherivs.com/fees",
    );
  });

  it("passes association documents through on apex hosts", () => {
    for (const host of ["sherivs.com", "sherivs.ng"]) {
      for (const path of [
        "/.well-known/assetlinks.json",
        "/.well-known/apple-app-site-association",
        "/.well-known/webauthn",
      ]) {
        expect(apexRedirectLocation(new Request(`https://${host}${path}`))).toBeNull();
      }
    }
  });

  it("leaves non-apex hosts untouched", () => {
    for (const url of [
      "https://www.sherivs.com/",
      "https://app.sherivs.com/",
      "https://console.sherivs.com/",
      "https://tenant.example/",
      "http://localhost:8080/",
      "https://example.sherivs.com/",
    ]) {
      expect(apexRedirectLocation(new Request(url))).toBeNull();
    }
    expect(
      apexRedirectLocation(
        new Request("https://www.sherivs.com/", {
          headers: { "x-forwarded-host": "sherivs.com" },
        }),
      ),
    ).toBeNull();
  });

  it("serves apex redirects before TanStack with telemetry and security headers", async () => {
    let entryLoaded = false;
    let telemetryStatus = 0;
    const response = await serveFetch(
      new Request("https://sherivs.com/fees?x=1"),
      {},
      {},
      {
        loadEntry: async () => {
          entryLoaded = true;
          return { fetch: () => new Response("app") };
        },
        startTelemetry: () => ({
          end: (status) => {
            telemetryStatus = status;
          },
        }),
      },
    );

    expect(entryLoaded).toBe(false);
    expect(telemetryStatus).toBe(308);
    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe("https://www.sherivs.com/fees?x=1");
    expect(response.headers.get("Strict-Transport-Security")).toContain("max-age=31536000");
  });
});
