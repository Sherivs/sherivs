import { describe, expect, it } from "vitest";
import {
  androidAssetLinks,
  appleAppSiteAssociation,
} from "../../frontend/src/lib/auth/webauthn-associated-domains";
import {
  AuthedWebAuthnBodySchema,
  PublicWebAuthnBodySchema,
} from "../../frontend/src/lib/auth/webauthn-http.server";

describe("native associated domains", () => {
  it("advertises no iOS apps until a 10-character team id is configured", () => {
    expect(appleAppSiteAssociation({}).webcredentials.apps).toEqual([]);
    expect(
      appleAppSiteAssociation({
        WEBAUTHN_APPLE_TEAM_ID: "ABCD123456",
        WEBAUTHN_IOS_BUNDLE_ID: "com.coregrid.app",
      }).webcredentials.apps,
    ).toEqual(["ABCD123456.com.coregrid.app"]);
  });

  it("advertises no Android apps until SHA-256 fingerprints are configured", () => {
    expect(androidAssetLinks({})).toEqual([]);
    const fingerprint = "AA:".repeat(31) + "AA";
    const links = androidAssetLinks({
      WEBAUTHN_ANDROID_SHA256_CERTS: fingerprint.toLowerCase(),
    });
    expect(links).toHaveLength(1);
    expect(links[0]?.target.package_name).toBe("com.coregrid.app");
    expect(links[0]?.target.sha256_cert_fingerprints[0]).toBe(fingerprint);
  });
});

describe("native WebAuthn HTTP contracts", () => {
  it("accepts authentication options and verify bodies", () => {
    expect(PublicWebAuthnBodySchema.parse({ action: "authentication.options" }).action).toBe(
      "authentication.options",
    );
    expect(() => PublicWebAuthnBodySchema.parse({ action: "credentials.list" })).toThrow();
  });

  it("keeps registration behind the authenticated contract", () => {
    expect(AuthedWebAuthnBodySchema.parse({ action: "registration.options" }).action).toBe(
      "registration.options",
    );
    expect(
      AuthedWebAuthnBodySchema.parse({
        action: "credentials.remove",
        credentialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }).action,
    ).toBe("credentials.remove");
  });
});
